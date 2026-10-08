import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import type { SalesSource } from '../../src/sql/readonly-connection.ts';
import { executeReadOnly } from '../../src/sql/executor.ts';
import { createQueryRunner } from '../../src/sql/query-runner.ts';
import { AskAbortedError, SqlRuntimeError, SqlTimeoutError } from '../../src/domain/errors.ts';
import { makeTempDir } from '../helpers/tmp.ts';

const snapshot = (): SalesSource => ({ kind: 'snapshot', bytes: createSalesSnapshot() });
// Produto cartesiano que passa pela política estática (ON 1=1): 4.000³ linhas, não termina dentro de nenhum prazo do teste.
const HEAVY = 'SELECT COUNT(*) AS n FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1';

test('o processo filho devolve o mesmo resultado que a execução direta e respeita maxRows', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 10_000 });
  try {
    const sql = 'SELECT channel, COUNT(*) AS pedidos FROM orders GROUP BY channel ORDER BY channel';
    const direct = executeReadOnly(openSalesConnection(snapshot()), sql, 200);
    assert.deepEqual(await runner.run(sql, { maxRows: 200 }), direct);
    const capped = await runner.run('SELECT id FROM orders', { maxRows: 5 });
    assert.deepEqual([capped.rows.length, capped.truncated], [5, true]);
  } finally {
    runner.close();
  }
});

test('SQL-12 o processo filho abre a conexão com o mesmo limite de tamanho: replace aninhado vira SqlRuntimeError rápido', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 10_000 });
  try {
    const a64 = 'a'.repeat(64);
    const bomb = `WITH s(t) AS (SELECT '${a64}') SELECT length(replace(replace(replace(t, 'a', t), 'a', t), 'a', t)) AS n FROM s`;
    await assert.rejects(runner.run(bomb, { maxRows: 200 }), (e: unknown) => e instanceof SqlRuntimeError && /too big/.test(e.message));
  } finally {
    runner.close();
  }
});

test('SQL-08 negação do authorizer atravessa o processo filho como SqlRuntimeError com as negações', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 10_000 });
  try {
    await assert.rejects(runner.run('SELECT email FROM customer_contacts', { maxRows: 200 }),
      (e: unknown) => e instanceof SqlRuntimeError && e.denials[0]?.kind === 'table');
    await assert.rejects(runner.run("DELETE FROM orders WHERE status = 'cancelled'", { maxRows: 200 }),
      (e: unknown) => e instanceof SqlRuntimeError && e.denials.some((d) => d.kind === 'action'));
    await assert.rejects(runner.run('SELECT * FROM suppliers', { maxRows: 200 }),
      (e: unknown) => e instanceof SqlRuntimeError && /no such table/.test(e.message) && e.denials.length === 0);
  } finally {
    runner.close();
  }
});

test('SQL-11 consulta pesada: o processo filho morre no prazo, o event loop segue livre e a próxima consulta usa um filho novo', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 300 });
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 20);
  try {
    const t0 = performance.now();
    await assert.rejects(runner.run(HEAVY, { maxRows: 200 }), (e: unknown) => e instanceof SqlTimeoutError && e.timeoutMs === 300);
    const ms = performance.now() - t0;
    assert.ok(ms < 5000, `o prazo de 300 ms virou ${Math.round(ms)} ms`);
    assert.ok(ticks >= 5, `o event loop ficou parado (${ticks} ticks)`);
    assert.deepEqual((await runner.run('SELECT COUNT(*) AS n FROM orders', { maxRows: 200 })).rows, [[4000]]);
  } finally {
    clearInterval(ticker);
    runner.close();
  }
});

test('abort da requisição encerra a consulta em andamento e descarta a que esperava na fila', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 60_000 });
  try {
    const ac = new AbortController();
    const running = runner.run(HEAVY, { maxRows: 200, signal: ac.signal });
    const queued = runner.run('SELECT 1 AS x', { maxRows: 200, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await assert.rejects(running, (e: unknown) => e instanceof AskAbortedError);
    await assert.rejects(queued, (e: unknown) => e instanceof AskAbortedError);
    await assert.rejects(runner.run('SELECT 1 AS x', { maxRows: 200, signal: AbortSignal.abort() }), (e: unknown) => e instanceof AskAbortedError);
    assert.deepEqual((await runner.run('SELECT 1 AS x', { maxRows: 200 })).rows, [[1]]);
  } finally {
    runner.close();
  }
});

// Complementos
test('consultas concorrentes saem na ordem, cada uma com o próprio resultado; close rejeita o que sobrou', async () => {
  const runner = createQueryRunner(snapshot(), { timeoutMs: 60_000 });
  const [a, b] = await Promise.all([runner.run('SELECT 1 AS x', { maxRows: 200 }), runner.run('SELECT 2 AS y', { maxRows: 200 })]);
  assert.deepEqual([a.columns, a.rows, b.columns, b.rows], [['x'], [[1]], ['y'], [[2]]]);
  const pending = runner.run(HEAVY, { maxRows: 200 });
  const waiting = runner.run('SELECT 1 AS x', { maxRows: 200 });
  runner.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(waiting, /closed/);
  await assert.rejects(runner.run('SELECT 1 AS x', { maxRows: 200 }), /closed/);
});

test('fonte file: o processo filho abre o arquivo em modo somente leitura', async () => {
  const dir = makeTempDir('dda-runner');
  const file = path.join(dir, 'sales.db');
  fs.writeFileSync(file, createSalesSnapshot());
  const runner = createQueryRunner({ kind: 'file', path: file }, { timeoutMs: 10_000 });
  try {
    assert.deepEqual((await runner.run('SELECT COUNT(*) AS n FROM orders', { maxRows: 200 })).rows, [[4000]]);
    await assert.rejects(runner.run('DELETE FROM orders', { maxRows: 200 }), (e: unknown) => e instanceof SqlRuntimeError);
  } finally {
    runner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
