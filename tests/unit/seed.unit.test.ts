import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { seedSales, createSalesSnapshot, fingerprintSales } from '../../src/sql/seed.ts';
import { mulberry32 } from '../../src/sql/prng.ts';

test('DATA-01 mesma semente, mesmo fingerprint; semente diferente, outro', () => {
  const a = seedSales(new DatabaseSync(':memory:')).fingerprint;
  const b = seedSales(new DatabaseSync(':memory:')).fingerprint;
  const c = seedSales(new DatabaseSync(':memory:'), { seed: 7 }).fingerprint;
  assert.equal(a, b); assert.notEqual(a, c);
});
test('DATA-01 total_cents é a soma dos itens em todo pedido', () => {
  const db = new DatabaseSync(':memory:'); seedSales(db);
  const bad = db.prepare(`SELECT COUNT(*) n FROM orders o WHERE o.total_cents <>
    (SELECT SUM(quantity * unit_price_cents) FROM order_items i WHERE i.order_id = o.id)`).get() as { n: number };
  assert.equal(bad.n, 0);
});
test('volumes e distribuição dentro das faixas esperadas', () => {
  const db = new DatabaseSync(':memory:'); const r = seedSales(db);
  assert.deepEqual([r.counts.customers, r.counts.products, r.counts.orders, r.counts.contacts], [300, 40, 4000, 300]);
  assert.ok(r.counts.orderItems >= 8000 && r.counts.orderItems <= 10000);
  const share = (sql: string) => (db.prepare(sql).get() as { s: number }).s;
  assert.ok(Math.abs(share(`SELECT AVG(segment = 'cafeteria') s FROM customers`) - 0.15) <= 0.03);
  assert.ok(Math.abs(share(`SELECT AVG(status = 'pago') s FROM orders`) - 0.90) <= 0.02);
  const q = (m1: string, m2: string) => share(`SELECT COUNT(*) s FROM orders WHERE ordered_at >= '${m1}' AND ordered_at < '${m2}'`);
  assert.ok(q('2025-10-01', '2026-01-01') > q('2025-01-01', '2025-04-01'));
});
test('nenhum pedido fora de 2025 e e-mails só em .example', () => {
  const db = new DatabaseSync(':memory:'); seedSales(db);
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM orders WHERE ordered_at < '2025-01-01' OR ordered_at >= '2026-01-01'`).get() as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM customer_contacts WHERE email NOT LIKE '%.example'`).get() as { n: number }).n, 0);
});
test('CHECK rejeita preço zero', () => {
  const db = new DatabaseSync(':memory:'); seedSales(db);
  assert.throws(() => db.exec(`INSERT INTO products VALUES (999,'X-1','x','graos',0,1)`), /CHECK constraint failed/);
});
test('createSalesSnapshot é memoizado', () => {
  assert.equal(createSalesSnapshot(), createSalesSnapshot());
});

// Complementos
test('mulberry32 é determinístico e fica em [0, 1)', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
test('DATA-01 fingerprint é sha256 hex e reflete o banco', () => {
  const db = new DatabaseSync(':memory:'); const r = seedSales(db);
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprintSales(db), r.fingerprint);
  db.exec(`UPDATE orders SET status = 'cancelado' WHERE id = (SELECT MIN(id) FROM orders WHERE status = 'pago')`);
  assert.notEqual(fingerprintSales(db), r.fingerprint);
});
test('status perto de 90/6/4, sem dados antes de 2025 e itens de 1 a 4 produtos distintos', () => {
  const db = new DatabaseSync(':memory:'); seedSales(db);
  const share = (st: string) => (db.prepare(`SELECT AVG(status = ?) s FROM orders`).get(st) as { s: number }).s;
  assert.ok(Math.abs(share('cancelado') - 0.06) <= 0.02);
  assert.ok(Math.abs(share('reembolsado') - 0.04) <= 0.02);
  const per = db.prepare(`SELECT MIN(n) mn, MAX(n) mx FROM (SELECT COUNT(*) n FROM order_items GROUP BY order_id)`).get() as { mn: number; mx: number };
  assert.ok(per.mn >= 1 && per.mx <= 4);
  const orphan = db.prepare(`SELECT COUNT(*) n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)`).get() as { n: number };
  assert.equal(orphan.n, 0);
  const curitiba = db.prepare(`SELECT COUNT(*) n FROM customers WHERE city = 'Curitiba' AND state = 'PR'`).get() as { n: number };
  assert.ok(curitiba.n > 0);
});
test('snapshot desserializa num banco com os mesmos dados', () => {
  const db = new DatabaseSync(':memory:');
  db.deserialize(createSalesSnapshot());
  assert.equal(fingerprintSales(db), seedSales(new DatabaseSync(':memory:')).fingerprint);
});
