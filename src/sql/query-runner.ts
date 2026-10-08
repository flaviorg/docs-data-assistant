// Execução da SQL gerada fora do processo principal (spec 003, camada 5). O node:sqlite é síncrono e não expõe
// progress handler nem sqlite3_interrupt: uma consulta pesada (um produto cartesiano com ON 1=1, por exemplo) travaria
// o event loop inteiro, /health incluído, e o 504 do AskService nunca sairia, porque o timer dele depende do event loop.
// Um Worker não resolve: terminate() não interrompe código nativo, a thread segue presa no sqlite3_step e o processo
// nem consegue sair (ver docs/incidents/2026-10-04-terminate-does-not-interrupt-sqlite.md). Por isso a consulta roda num
// processo filho com a própria conexão somente leitura. Se passar de SQL_TIMEOUT_MS, ou se a requisição abortar, o
// filho leva SIGKILL e o próximo pedido abre outro. Um pedido por vez, em fila.
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { AskAbortedError, SqlRuntimeError, SqlTimeoutError } from '../domain/errors.ts';
import type { QueryResult } from './executor.ts';
import type { AuthorizerDenial, SalesSource } from './readonly-connection.ts';

export interface QueryRunner {
  /** Executa no processo filho. Rejeita com SqlRuntimeError (erro do SQLite, com as negações), SqlTimeoutError ou AskAbortedError. */
  run(sql: string, opts: { maxRows: number; signal?: AbortSignal }): Promise<QueryResult>;
  /** Encerra o processo filho e rejeita o que estiver rodando ou na fila. */
  close(): void;
}

export type ParentMessage =
  | { type: 'init'; source: SalesSource }
  | { type: 'run'; id: number; sql: string; maxRows: number };
export type ChildReply =
  | { type: 'ready' }
  | { type: 'init_error'; message: string }
  | { type: 'result'; id: number; result: QueryResult }
  | { type: 'runtime_error'; id: number; message: string; denials: AuthorizerDenial[] }
  | { type: 'internal_error'; id: number; message: string };

interface Job {
  id: number;
  sql: string;
  maxRows: number;
  signal: AbortSignal | undefined;
  resolve(result: QueryResult): void;
  reject(err: unknown): void;
  onAbort(): void;
}

const CHILD_URL = new URL('./query-process.ts', import.meta.url);
const CLOSED_MESSAGE = 'the SQL executor was closed';

export function createQueryRunner(source: SalesSource, opts: { timeoutMs: number }): QueryRunner {
  const queue: Job[] = [];
  let child: ChildProcess | null = null;
  let ready = false;
  let current: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null;
  let nextId = 1;
  let closed = false;

  const detach = (job: Job): void => job.signal?.removeEventListener('abort', job.onAbort);

  /** Tira o pedido em andamento (sem resolver nem rejeitar) e devolve-o. */
  function takeCurrent(): Job | null {
    if (!current) return null;
    const { job, timer } = current;
    clearTimeout(timer);
    current = null;
    detach(job);
    return job;
  }

  function killChild(): void {
    const c = child;
    child = null;
    ready = false;
    c?.kill('SIGKILL');
  }

  function rejectQueued(err: Error): void {
    for (const job of queue.splice(0)) {
      detach(job);
      job.reject(err);
    }
  }

  /** O filho saiu ou não subiu: rejeita o pedido em andamento ou, se ele nem ficou pronto, a fila inteira. */
  function childFailed(c: ChildProcess, failure: Error): void {
    if (c !== child) return;   // já descartado (prazo, abort ou close)
    const wasReady = ready;
    child = null;
    ready = false;
    const job = takeCurrent();
    if (job) job.reject(failure);
    else if (!wasReady) rejectQueued(failure);   // sem conexão, nenhum pedido da fila rodaria
    pump();
  }

  function spawn(): ChildProcess {
    // execArgv vazio: o filho não herda --inspect, --watch nem as opções do node --test. O ambiente vem por process.env.
    const c = fork(CHILD_URL, [], { serialization: 'advanced', execArgv: [] });
    child = c;
    ready = false;
    let initError: string | null = null;
    c.on('message', (msg: ChildReply) => {
      if (c !== child) return;   // resposta tardia de um filho já descartado
      if (msg.type === 'ready') {
        ready = true;
        pump();
        return;
      }
      if (msg.type === 'init_error') {
        initError = msg.message;
        return;
      }
      if (!current || current.job.id !== msg.id) return;
      const job = takeCurrent()!;
      if (msg.type === 'result') job.resolve(msg.result);
      else if (msg.type === 'runtime_error') job.reject(new SqlRuntimeError(msg.message, msg.denials));
      else job.reject(new Error(`SQL process failure: ${msg.message}`));
      pump();
    });
    c.on('error', (err) => childFailed(c, new Error(`the SQL process failed: ${err.message}`)));
    c.on('exit', (code, signal) => {
      childFailed(c, new Error(initError
        ? `the SQL process could not open the database: ${initError}`
        : `the SQL process exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`));
    });
    c.send({ type: 'init', source } satisfies ParentMessage);
    return c;
  }

  function dispatch(): void {
    if (closed || current || queue.length === 0) return;
    const c = child ?? spawn();
    if (!ready) return;   // a mensagem 'ready' chama pump de novo
    const job = queue.shift()!;
    const timer = setTimeout(() => {
      if (current?.job !== job) return;
      takeCurrent();
      killChild();
      job.reject(new SqlTimeoutError(opts.timeoutMs));
      pump();
    }, opts.timeoutMs);
    current = { job, timer };
    c.send({ type: 'run', id: job.id, sql: job.sql, maxRows: job.maxRows } satisfies ParentMessage);
  }

  /** Despacha o próximo pedido e só deixa o filho segurar o processo principal enquanto houver pedido. */
  function pump(): void {
    dispatch();
    if (!child) return;
    if (current || queue.length > 0) {
      child.ref();
      child.channel?.ref();
    } else {
      child.unref();
      child.channel?.unref();
    }
  }

  function abort(job: Job): void {
    if (current?.job === job) {
      takeCurrent();
      killChild();
    } else {
      const i = queue.indexOf(job);
      if (i === -1) return;
      queue.splice(i, 1);
      detach(job);
    }
    job.reject(new AskAbortedError());
    pump();
  }

  return {
    run(sql, { maxRows, signal }) {
      if (closed) return Promise.reject(new Error(CLOSED_MESSAGE));
      if (signal?.aborted) return Promise.reject(new AskAbortedError());
      return new Promise<QueryResult>((resolve, reject) => {
        const job: Job = { id: nextId++, sql, maxRows, signal, resolve, reject, onAbort: () => abort(job) };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        queue.push(job);
        pump();
      });
    },
    close() {
      if (closed) return;
      closed = true;
      const failure = new Error(CLOSED_MESSAGE);
      takeCurrent()?.reject(failure);
      rejectQueued(failure);
      killChild();
    },
  };
}
