import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import { describeSchema } from '../../src/sql/schema-introspect.ts';
import { BUSINESS_GLOSSARY } from '../../src/sql/sales-schema.ts';

const text = describeSchema(openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }, { authorizer: false, queryOnly: true }).db);
test('SQL-01 contém o DDL real das 4 tabelas permitidas e o glossário', () => {
  for (const t of ['customers', 'products', 'orders', 'order_items']) assert.match(text, new RegExp(`CREATE TABLE ${t} \\(`));
  assert.match(text, /status = 'pago'/);
});
test('SQL-09 omite customer_contacts e customers.name, mantém products.name', () => {
  assert.doesNotMatch(text, /customer_contacts/);
  const customers = text.slice(text.indexOf('CREATE TABLE customers'), text.indexOf(');', text.indexOf('CREATE TABLE customers')));
  assert.doesNotMatch(customers, /^\s*name TEXT/m);
  const products = text.slice(text.indexOf('CREATE TABLE products'));
  assert.match(products, /^\s*name TEXT NOT NULL/m);
});

// Complementos
test('SQL-01 tabelas na ordem da allowlist e glossário no fim', () => {
  const pos = ['customers', 'products', 'orders', 'order_items'].map((t) => text.indexOf(`CREATE TABLE ${t} (`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(text.trimEnd().endsWith(BUSINESS_GLOSSARY.trimEnd()));
});
test('SQL-09 remover a última coluna ajusta a vírgula da linha anterior', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  city TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE products (id INTEGER PRIMARY KEY);
CREATE TABLE orders (id INTEGER PRIMARY KEY);
CREATE TABLE order_items (order_id INTEGER);`);
  const out = describeSchema(db);
  assert.match(out, /city TEXT NOT NULL\n\)/);
  assert.doesNotMatch(out, /name TEXT/);
});
test('SQL-01 o DDL vem do banco, não de texto colado', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, city TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, extra_col_from_db TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY);
CREATE TABLE order_items (order_id INTEGER);`);
  assert.match(describeSchema(db), /extra_col_from_db/);
});

test('glossário pede para listar as colunas de customers, porque * inclui a coluna negada e vira bloqueio de política', async () => {
  assert.match(BUSINESS_GLOSSARY, /customers.*liste as colunas.*\*/s);
  // A decisão continua sendo política: a expansão de * lê customers.name e o authorizer nega sem pedir correção.
  const { createSqlValidator } = await import('../../src/sql/validator.ts');
  const v = createSqlValidator({ conn: openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }), maxRows: 200 });
  const r = v.validate('SELECT c.* FROM customers c LIMIT 1');
  assert.ok(!r.ok && r.kind === 'policy' && /customers\.name/.test(r.message));
  assert.ok(v.validate('SELECT c.city, c.state, c.segment FROM customers c LIMIT 1').ok);
});
