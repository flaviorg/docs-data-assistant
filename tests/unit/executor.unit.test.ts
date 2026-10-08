import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import { CELL_MAX_CHARS, executeReadOnly, isNoResults } from '../../src/sql/executor.ts';
import { SqlRuntimeError } from '../../src/domain/errors.ts';

const conn = () => openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() });

test('trunca em maxRows e corta célula longa', () => {
  const r = executeReadOnly(conn(), 'SELECT id FROM orders', 200);
  assert.equal(r.rows.length, 200); assert.equal(r.truncated, true);
  const g = executeReadOnly(conn(), 'SELECT group_concat(sku) AS skus FROM products', 200);
  assert.equal((g.rows[0]![0] as string).length, 201); assert.ok((g.rows[0]![0] as string).endsWith('…'));
});
test('SQL-06 SUM sobre vazio é sem resultados; COUNT sobre vazio é resultado válido; GROUP BY vazio dá zero linhas', () => {
  const sum = executeReadOnly(conn(), `SELECT SUM(total_cents) AS total FROM orders WHERE ordered_at < '2020-01-01'`, 200);
  assert.deepEqual([sum.rows, sum.noResults], [[[null]], true]);
  const cnt = executeReadOnly(conn(), `SELECT COUNT(*) AS n FROM orders WHERE ordered_at < '2020-01-01'`, 200);
  assert.deepEqual([cnt.rows, cnt.noResults], [[[0]], false]);
  const grp = executeReadOnly(conn(), `SELECT channel, COUNT(*) FROM orders WHERE ordered_at < '2020-01-01' GROUP BY channel`, 200);
  assert.deepEqual([grp.rows, grp.noResults, grp.columns.length], [[], true, 2]);
});
test('leitura negada em execução lança SqlRuntimeError com as negações', () => {
  assert.throws(() => executeReadOnly(conn(), 'SELECT email FROM customer_contacts', 200),
    (e: unknown) => e instanceof SqlRuntimeError && e.denials[0]?.kind === 'table');
});

// Complementos
test('exatamente maxRows linhas não é truncado; colunas vêm com o nome do alias', () => {
  const r = executeReadOnly(conn(), `SELECT channel AS canal, COUNT(*) AS pedidos FROM orders GROUP BY channel ORDER BY channel`, 3);
  assert.deepEqual(r.columns, ['canal', 'pedidos']);
  assert.equal(r.rows.length, 3); assert.equal(r.truncated, false); assert.equal(r.noResults, false);
  assert.deepEqual(r.rows.map((row) => row[0]), ['app', 'marketplace', 'site']);
});
test('erro do SQLite sem negação vira SqlRuntimeError com denials vazio', () => {
  assert.throws(() => executeReadOnly(conn(), 'SELECT * FROM suppliers', 200),
    (e: unknown) => e instanceof SqlRuntimeError && /no such table/.test(e.message) && e.denials.length === 0);
});
test('negações antigas não vazam para a próxima execução', () => {
  const c = conn();
  assert.throws(() => executeReadOnly(c, 'SELECT email FROM customer_contacts', 200));
  assert.throws(() => executeReadOnly(c, 'SELECT * FROM suppliers', 200), (e: unknown) => e instanceof SqlRuntimeError && e.denials.length === 0);
});
test('célula com exatamente 200 caracteres não é cortada; número e nulo passam como estão', () => {
  const r = executeReadOnly(conn(), `SELECT substr(group_concat(sku), 1, ${CELL_MAX_CHARS}) AS s, 42 AS n, NULL AS z FROM products`, 200);
  assert.equal((r.rows[0]![0] as string).length, CELL_MAX_CHARS);
  assert.deepEqual(r.rows[0]!.slice(1), [42, null]);
});
test('isNoResults: zero linhas ou só nulos', () => {
  assert.equal(isNoResults([]), true);
  assert.equal(isNoResults([[null, null], [null]]), true);
  assert.equal(isNoResults([[null, 0]]), false);
  assert.equal(isNoResults([['']]), false);
});
