// Processo filho que executa a SQL gerada (ver query-runner.ts). Abre a própria conexão somente leitura, com o mesmo
// query_only e o mesmo authorizer de readonly-connection.ts, e executa um pedido por vez. O pai o encerra com SIGKILL
// quando a consulta passa do prazo; não há estado a perder além da conexão.
import { Worker } from 'node:worker_threads';
import { SqlRuntimeError } from '../domain/errors.ts';
import { executeReadOnly } from './executor.ts';
import { openSalesConnection } from './readonly-connection.ts';
import type { SalesConnection } from './readonly-connection.ts';
import type { ChildReply, ParentMessage } from './query-runner.ts';

const send = process.send?.bind(process);
if (!send) throw new Error('query-process.ts só roda como processo filho (use createQueryRunner)');
const reply = (msg: ChildReply): void => { send(msg); };

// Vigia: se o pai morrer enquanto esta thread está presa numa consulta (código nativo, sem event loop), ninguém mais
// mandaria o SIGKILL. Uma thread separada percebe a troca do processo pai e encerra o processo.
const WATCHDOG = `const { workerData } = require('node:worker_threads');
setInterval(() => { if (process.ppid !== workerData) process.kill(process.pid, 'SIGKILL'); }, 250);`;
new Worker(WATCHDOG, { eval: true, workerData: process.ppid, execArgv: [] }).unref();

let conn: SalesConnection | null = null;

process.on('message', (msg: ParentMessage) => {
  if (msg.type === 'init') {
    try {
      conn = openSalesConnection(msg.source);
      reply({ type: 'ready' });
    } catch (err) {
      reply({ type: 'init_error', message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
    return;
  }
  if (!conn) return;
  try {
    reply({ type: 'result', id: msg.id, result: executeReadOnly(conn, msg.sql, msg.maxRows) });
  } catch (err) {
    reply(err instanceof SqlRuntimeError
      ? { type: 'runtime_error', id: msg.id, message: err.message, denials: err.denials }
      : { type: 'internal_error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
});
// Pai saiu com o filho ocioso: o canal fecha e o filho sai junto.
process.on('disconnect', () => process.exit(0));
