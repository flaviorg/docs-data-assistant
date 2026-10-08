import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { constants } from 'node:sqlite';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { SQL_MAX_VALUE_BYTES, openSalesConnection } from '../../src/sql/readonly-connection.ts';
import type { ExplainResult } from '../../src/sql/readonly-connection.ts';
import { ALLOWED_FUNCTIONS, DANGEROUS_FUNCTIONS } from '../../src/sql/sql-functions.ts';
import { makeTempDir } from '../helpers/tmp.ts';

const conn = () => openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() });
const denied = (r: ExplainResult) => (r.ok ? [] : r.denials);

test('SQL-08 escrita falha por query_only sem authorizer e pelo authorizer', () => {
  const qo = openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }, { authorizer: false });
  assert.throws(() => qo.db.exec(`DELETE FROM orders`), /readonly|read-only/i);
  assert.throws(() => conn().db.exec(`DELETE FROM orders`), /not authorized/);
});
test('SQL-08 sqlite_master e customer_contacts negados', () => {
  assert.deepEqual(denied(conn().explain(`SELECT * FROM sqlite_master`))[0], { kind: 'table', table: 'sqlite_master', column: 'type' });
  assert.equal(denied(conn().explain(`SELECT email FROM customer_contacts`))[0]?.kind, 'table');
});
test('SQL-09 customers.name negada; SELECT * negado; COUNT(*) e products.name permitidos', () => {
  assert.deepEqual(denied(conn().explain(`SELECT name FROM customers`)), [{ kind: 'table', table: 'customers', column: 'name' }]);
  assert.equal(conn().explain(`SELECT * FROM customers`).ok, false);
  assert.equal(conn().explain(`SELECT COUNT(*) FROM customers`).ok, true);
  assert.equal(conn().explain(`SELECT name FROM products`).ok, true);
});
test('SQL-08 LIKE permitido; printf de risco; random fora da allowlist; CTE recursiva negada', () => {
  assert.equal(conn().explain(`SELECT city FROM customers WHERE city LIKE 'Cur%'`).ok, true);
  assert.deepEqual(denied(conn().explain(`SELECT printf('%d', 1)`)), [{ kind: 'function', name: 'printf', dangerous: true }]);
  assert.deepEqual(denied(conn().explain(`SELECT random()`)), [{ kind: 'function', name: 'random', dangerous: false }]);
  const rec = denied(conn().explain(`WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<3) SELECT n FROM r`));
  assert.ok(rec.some((d) => d.kind === 'action' && d.code === constants.SQLITE_RECURSIVE));
});
test('SQL-08 arquivo aberto com readOnly recusa escrita mesmo sem query_only e authorizer', () => {
  const dir = makeTempDir('dda'); const file = path.join(dir, 'sales.db');
  fs.writeFileSync(file, createSalesSnapshot());
  const c = openSalesConnection({ kind: 'file', path: file }, { queryOnly: false, authorizer: false });
  assert.throws(() => c.db.exec(`DELETE FROM orders`), /readonly/i);
});
test('snapshot desserializado não altera o original', () => {
  const w = openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }, { queryOnly: false, authorizer: false });
  // order_items primeiro: o node:sqlite liga foreign keys por padrão e DELETE FROM orders sozinho falharia por FK.
  w.db.exec(`DELETE FROM order_items; DELETE FROM orders`);
  assert.equal((w.db.prepare(`SELECT COUNT(*) n FROM orders`).get() as { n: number }).n, 0);
  const fresh = conn().db.prepare(`SELECT COUNT(*) n FROM orders`).get() as { n: number };
  assert.equal(fresh.n, 4000);
});

// Funções de texto permitidas que multiplicam o tamanho de um valor: replace() aninhado e group_concat() sobre uma junção.
const A64 = 'a'.repeat(64);
const REPLACE_BOMB = `WITH s(t) AS (SELECT '${A64}') SELECT length(replace(replace(replace(t, 'a', t), 'a', t), 'a', t)) AS n FROM s`;
const CONCAT_BOMB = 'SELECT length(group_concat(a.id)) AS n FROM orders a JOIN orders b ON b.id <= 100';

test('SQL-12 texto e blob limitados a SQL_MAX_VALUE_BYTES: replace aninhado e group_concat grande falham, o legítimo passa', () => {
  const c = conn();
  assert.equal(c.db.limits.length, SQL_MAX_VALUE_BYTES);
  assert.throws(() => c.db.prepare(REPLACE_BOMB).get(), /too big/);        // 16 MB sem o limite
  assert.throws(() => c.db.prepare(CONCAT_BOMB).get(), /too big/);         // ~1,9 MB sem o limite
  const cats = c.db.prepare('SELECT group_concat(DISTINCT category) AS c FROM products').get() as { c: string };
  assert.ok(cats.c.length > 0 && cats.c.length < SQL_MAX_VALUE_BYTES);
  // O limite vale nas variações da matriz de camadas também (a conexão nunca abre sem ele).
  assert.equal(openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }, { authorizer: false, queryOnly: false }).db.limits.length, SQL_MAX_VALUE_BYTES);
});

// Complementos
test('SQL-08 explain devolve o plano quando permitido e funções de janela e data passam', () => {
  const r = conn().explain(`SELECT strftime('%m', ordered_at) m, SUM(total_cents) FROM orders WHERE status = 'pago' GROUP BY m`);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.plan.length > 0 && r.plan.every((s) => typeof s === 'string'));
  const w = conn().explain(`SELECT id, ROW_NUMBER() OVER (ORDER BY total_cents DESC) rk FROM orders`);
  assert.equal(w.ok, true);
});
test('SQL-08 negação de função compara o nome em minúsculas', () => {
  assert.deepEqual(denied(conn().explain(`SELECT PRINTF('%d', 1)`)), [{ kind: 'function', name: 'printf', dangerous: true }]);
  assert.equal(conn().explain(`SELECT COUNT(*), Sum(total_cents) FROM orders`).ok, true);
});
test('SQL-08 erro sem negação (tabela inexistente) devolve message e denials vazio', () => {
  const r = conn().explain(`SELECT x FROM suppliers`);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /no such table/.test(r.message));
  assert.deepEqual(denied(r), []);
});
test('takeDenials devolve e limpa o registro; explain começa limpo', () => {
  const c = conn();
  assert.throws(() => c.db.prepare(`SELECT name FROM customers`));
  assert.deepEqual(c.takeDenials(), [{ kind: 'table', table: 'customers', column: 'name' }]);
  assert.deepEqual(c.takeDenials(), []);
  assert.throws(() => c.db.prepare(`SELECT random()`));
  assert.equal(c.explain(`SELECT COUNT(*) FROM orders`).ok, true);
  assert.deepEqual(c.takeDenials(), []);
});
test('as negações ficam visíveis também na execução direta', () => {
  const c = conn();
  assert.throws(() => c.db.prepare(`SELECT phone FROM customer_contacts`).all(), /prohibited/);
  assert.equal(c.takeDenials()[0]?.kind, 'table');
});
test('listas de funções da spec 003', () => {
  for (const f of ['count', 'sum', 'like', 'strftime', 'row_number', 'replace', 'coalesce', 'group_concat']) assert.ok(ALLOWED_FUNCTIONS.has(f), f);
  assert.deepEqual([...DANGEROUS_FUNCTIONS].sort(), ['format', 'fts3_tokenizer', 'load_extension', 'printf', 'randomblob', 'zeroblob']);
  for (const f of DANGEROUS_FUNCTIONS) assert.equal(ALLOWED_FUNCTIONS.has(f), false, f);
  assert.equal(ALLOWED_FUNCTIONS.size, 49);
});
test('close fecha a conexão', () => {
  const c = conn(); c.close();
  assert.throws(() => c.db.prepare('SELECT 1'));
});
test('SQL-09 CTE, subconsulta, alias e JOIN continuam sob o authorizer', () => {
  assert.equal(conn().explain(`WITH t AS (SELECT customer_id, total_cents FROM orders WHERE status = 'pago')
    SELECT c.city, SUM(t.total_cents) FROM t JOIN customers c ON c.id = t.customer_id GROUP BY c.city`).ok, true);
  assert.deepEqual(denied(conn().explain(`WITH t AS (SELECT name FROM customers) SELECT * FROM t`)), [{ kind: 'table', table: 'customers', column: 'name' }]);
  assert.equal(denied(conn().explain(`SELECT x.n FROM (SELECT c.name AS n FROM customers c) x`))[0]?.kind, 'table');
  assert.equal(conn().explain(`SELECT COUNT(*) FROM customer_contacts`).ok, false);
});
