import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import { classifyDenials, createSqlValidator } from '../../src/sql/validator.ts';
import type { PolicyRule } from '../../src/sql/validator.ts';
import { ALLOWED_FUNCTIONS } from '../../src/sql/sql-functions.ts';

const validator = (maxRows = 200) => createSqlValidator({ conn: openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }), maxRows });

type Expect = 'ok' | ['policy', PolicyRule] | 'correctable';
const cases: [string, Expect, RegExp?][] = [
  // permitidas
  [`SELECT city FROM customers WHERE city LIKE 'Cur%'`, 'ok'],
  [`SELECT replace(sku, '-', '') FROM products`, 'ok'],
  [`SELECT id, row_number() OVER (ORDER BY total_cents DESC) FROM orders`, 'ok'],
  [`SELECT id FROM orders;`, 'ok'],
  [`SELECT 'DROP TABLE x' AS t`, 'ok'],
  [`SELECT created_at FROM customers`, 'ok'],
  [`SELECT channel, SUM(total_cents) / 100.0 AS faturamento FROM orders WHERE status = 'paid' GROUP BY channel`, 'ok'],
  [`WITH pagos AS (SELECT * FROM orders WHERE status = 'paid') SELECT channel, COUNT(*) FROM pagos GROUP BY channel`, 'ok'],
  [`SELECT "channel" FROM orders -- o canal\nWHERE status = 'paid'`, 'ok'],
  [`SELECT p.category, COUNT(*) FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category`, 'ok'],
  [`SELECT COUNT(*) FROM customers WHERE segment = 'coffee_shop'`, 'ok'],
  [`SELECT id FROM orders LIMIT 10 OFFSET 5`, 'ok'],
  // política
  [`select 1; drop table orders`, ['policy', 'multiple_statements']],
  [`SELECT 1;;`, ['policy', 'multiple_statements']],
  [`DELETE FROM orders WHERE status = 'cancelled'`, ['policy', 'not_select']],
  [`WITH x AS (SELECT 1) DELETE FROM orders`, ['policy', 'forbidden_keyword']],
  [`WITH x AS (SELECT 1) INSERT INTO orders SELECT * FROM x`, ['policy', 'forbidden_keyword']],
  [`SELECT 1 FROM orders WHERE 0; PRAGMA query_only = OFF`, ['policy', 'multiple_statements']],
  [`PRAGMA query_only = OFF`, ['policy', 'not_select']],
  [`ATTACH 'x.db' AS x`, ['policy', 'not_select']],
  [`CREATE TABLE t (a)`, ['policy', 'not_select']],
  [`UPDATE orders SET status = 'paid'`, ['policy', 'not_select']],
  [`SELEC id FROM orders`, ['policy', 'not_select']],
  [`WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT n FROM r`, ['policy', 'recursive_cte']],
  [`SELECT * FROM orders, customers`, ['policy', 'comma_join']],
  [`SELECT o.id FROM orders o JOIN (SELECT id FROM customers, products) x ON x.id = o.id`, ['policy', 'comma_join']],
  [`SELECT 1 FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1 JOIN orders d ON 1=1 JOIN orders e ON 1=1 JOIN orders f ON 1=1 JOIN orders g ON 1=1`, ['policy', 'too_many_tables']],
  // junção sem condição: produto cartesiano (revisão final)
  [`SELECT COUNT(*) FROM orders a JOIN orders b JOIN orders c`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a CROSS JOIN orders b`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a CROSS JOIN orders b ON a.id = b.id`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a NATURAL JOIN orders b`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a NATURAL LEFT OUTER JOIN orders b`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a LEFT JOIN orders b JOIN orders c USING (id)`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM orders a JOIN orders b ON a.id = b.id JOIN orders c`, ['policy', 'cross_join']],
  [`SELECT o.id FROM orders o JOIN (SELECT c.id FROM customers c JOIN products p) x ON x.id = o.id`, ['policy', 'cross_join']],
  [`SELECT COUNT(*) FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE p.category = 'cafe'`, 'ok'],
  [`SELECT COUNT(*) FROM orders o JOIN (SELECT id FROM customers WHERE segment = 'coffee_shop') c ON c.id = o.customer_id`, 'ok'],
  [`SELECT COUNT(*) FROM orders a JOIN orders b USING (id)`, 'ok'],
  // REPLACE INTO é um INSERT; replace() continua permitida (caso acima)
  [`WITH x AS (SELECT 1) REPLACE INTO orders (id) VALUES (1)`, ['policy', 'forbidden_keyword'], /INTO/],
  [`SELECT id FROM orders LIMIT (SELECT 5)`, ['policy', 'non_literal_limit']],
  [`SELECT id FROM orders LIMIT -1`, ['policy', 'non_literal_limit']],
  [`SELECT id FROM orders LIMIT 10 OFFSET abs(-5)`, ['policy', 'non_literal_limit']],
  [`SELECT email FROM customer_contacts`, ['policy', 'authorizer']],
  [`SELECT name FROM customers WHERE city = 'Curitiba'`, ['policy', 'authorizer']],
  [`SELECT * FROM customers`, ['policy', 'authorizer']],
  [`SELECT sql FROM sqlite_master`, ['policy', 'authorizer']],
  [`SELECT printf('%d', total_cents) FROM orders`, ['policy', 'authorizer']],
  [`SELECT upper(format('%s', city)) FROM customers`, ['policy', 'authorizer']],
  // corrigíveis
  [`SELECT p.name, SUM(oi.quantidade) FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.name`, 'correctable', /no such column/],
  [`SELECT * FROM suppliers`, 'correctable', /no such table/],
  [`SELECT random() FROM orders`, 'correctable', /random.*Use only:.*like/s],
  [`SELECT id FROM orders WHERE`, 'correctable', /syntax|incomplete/],
  [`SELECT 'abc FROM orders`, 'correctable', /syntax error/],
  [`SELECT id FROM orders o JOIN customers c ON id = c.id`, 'correctable', /ambiguous/],
];

for (const [sql, expected, message] of cases) {
  const label = typeof expected === 'string' ? expected : `${expected[0]}:${expected[1]}`;
  test(`SQL-02 ${label}: ${sql.replace(/\s+/g, ' ').slice(0, 70)}`, () => {
    const r = validator().validate(sql);
    if (expected === 'ok') {
      assert.equal(r.ok, true, JSON.stringify(r));
      return;
    }
    assert.equal(r.ok, false, `esperado ${label}`);
    if (r.ok) return;
    if (expected === 'correctable') {
      assert.equal(r.kind, 'correctable', JSON.stringify(r));
    } else {
      assert.equal(r.kind, 'policy', JSON.stringify(r));
      assert.equal(r.kind === 'policy' && r.rule, expected[1]);
    }
    assert.ok(r.message.length > 0);
    if (message) assert.match(r.message, message);
  });
}

test('SQL-02 tabela de política e classificação cobre todas as regras', () => {
  const rules = new Set(cases.flatMap(([, e]) => (Array.isArray(e) ? [e[1]] : [])));
  for (const rule of ['multiple_statements', 'not_select', 'forbidden_keyword', 'recursive_cte', 'comma_join', 'too_many_tables', 'non_literal_limit', 'authorizer'] as const) {
    assert.ok(rules.has(rule), rule);
  }
  assert.ok(cases.length >= 35);
});
test('SQL-10 função fora da allowlist e fora da lista de risco é corrigível com a allowlist na mensagem', () => {
  const r = validator().validate('SELECT random() FROM orders');
  assert.equal(r.ok === false && r.kind, 'correctable'); assert.match(!r.ok ? r.message : '', /random.*Use only:.*like/s);
  const listed = (!r.ok ? r.message : '').split('Use only:')[1]!.trim().split(', ');
  assert.deepEqual(listed, [...ALLOWED_FUNCTIONS].sort());
});

test('SQL-03 reescrita do LIMIT', () => {
  const v = validator();
  assert.match(v.rewriteLimit('SELECT id FROM orders').sql, /LIMIT 200$/);
  assert.match(v.rewriteLimit('SELECT id FROM orders LIMIT 500').sql, /LIMIT 200$/);
  assert.deepEqual(v.rewriteLimit('SELECT id FROM orders LIMIT 10'), { sql: 'SELECT id FROM orders LIMIT 10', limitApplied: false });
  assert.match(v.rewriteLimit('SELECT id FROM orders LIMIT 500 OFFSET 20').sql, /LIMIT 200 OFFSET 20$/);
  assert.match(v.rewriteLimit('SELECT id FROM orders LIMIT 20, 500').sql, /LIMIT 200 OFFSET 20$/);
  const inner = v.rewriteLimit('SELECT id FROM orders WHERE id IN (SELECT order_id FROM order_items LIMIT 5)').sql;
  assert.match(inner, /LIMIT 5\) LIMIT 200$/);
  assert.equal((v.rewriteLimit('SELECT channel FROM orders UNION SELECT city FROM customers').sql.match(/LIMIT/g) ?? []).length, 1);
  const vr = v.validate('SELECT id FROM orders;');
  assert.ok(vr.ok); assert.match(vr.sql, /orders LIMIT 200$/);
});

// Complementos
test('SQL-03 limitApplied: true quando acrescenta ou reduz; LIMIT m, n dentro do teto fica como está', () => {
  const v = validator();
  assert.equal(v.rewriteLimit('SELECT id FROM orders').limitApplied, true);
  assert.equal(v.rewriteLimit('SELECT id FROM orders LIMIT 500').limitApplied, true);
  assert.deepEqual(v.rewriteLimit('SELECT id FROM orders LIMIT 20, 10'), { sql: 'SELECT id FROM orders LIMIT 20, 10', limitApplied: false });
  assert.deepEqual(v.rewriteLimit('SELECT id FROM orders LIMIT 200'), { sql: 'SELECT id FROM orders LIMIT 200', limitApplied: false });
});
test('SQL-03 comentário de linha no fim não engole o LIMIT acrescentado', () => {
  const v = validator();
  const r = v.rewriteLimit('SELECT id FROM orders -- todos os pedidos');
  assert.equal(r.sql, 'SELECT id FROM orders LIMIT 200');
  const vr = v.validate('SELECT id FROM orders -- todos\n');
  assert.ok(vr.ok && vr.sql.endsWith('LIMIT 200'));
});
test('SQL-03 o teto vem de maxRows e a CTE não recebe o LIMIT', () => {
  const r = validator(50).rewriteLimit('WITH x AS (SELECT id FROM orders LIMIT 900) SELECT id FROM x LIMIT 70');
  assert.equal(r.sql, 'WITH x AS (SELECT id FROM orders LIMIT 900) SELECT id FROM x LIMIT 50');
});
test('validate devolve o plano do EXPLAIN e a SQL reescrita', () => {
  const r = validator().validate(`SELECT channel, COUNT(*) FROM orders GROUP BY channel`);
  assert.ok(r.ok);
  assert.equal(r.ok && r.limitApplied, true);
  assert.ok(r.ok && r.plan.length > 0);
});
test('checkPolicy não consulta o banco e devolve a SQL sem o ponto e vírgula final', () => {
  const v = validator();
  assert.deepEqual(v.checkPolicy('SELECT * FROM suppliers;'), { ok: true, sql: 'SELECT * FROM suppliers' });
  const p = v.checkPolicy('SELECT email FROM customer_contacts');
  assert.equal(p.ok, true);   // a camada léxica sozinha não conhece a allowlist
  const d = v.checkPolicy(`WITH a AS (SELECT 1) DROP TABLE orders`);
  assert.equal(!d.ok && d.rule, 'forbidden_keyword');
  assert.match(!d.ok ? d.message : '', /DROP/);
});
test('palavra proibida dentro de string ou identificador entre aspas não dispara', () => {
  assert.equal(validator().validate(`SELECT 'DELETE FROM orders' AS "update" FROM orders`).ok, true);
});
test('SQL vazia ou só comentário é corrigível', () => {
  const r = validator().validate('  -- nada ');
  assert.equal(!r.ok && r.kind, 'correctable');
});
test('classifyDenials: tabela, ação ou função de risco é política; só função comum é corrigível; sem negação é null', () => {
  assert.equal(classifyDenials([]), null);
  assert.equal(classifyDenials([{ kind: 'table', table: 'customer_contacts', column: 'email' }])?.kind, 'policy');
  assert.equal(classifyDenials([{ kind: 'action', code: 33 }])?.kind, 'policy');
  assert.equal(classifyDenials([{ kind: 'function', name: 'printf', dangerous: true }])?.kind, 'policy');
  const c = classifyDenials([{ kind: 'function', name: 'random', dangerous: false }, { kind: 'function', name: 'random', dangerous: false }]);
  assert.equal(c?.kind, 'correctable');
  assert.match(c?.message ?? '', /^function not allowed: random\. Use only: /);
});
