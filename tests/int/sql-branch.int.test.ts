import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, runGraph } from '../helpers/context.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import type { AppContext } from '../../src/app-context.ts';
import type { FakeProvider } from '../../src/llm/fake-provider.ts';
import { NO_RESULTS_MESSAGE, POLICY_BLOCK_MESSAGE, SQL_EXHAUSTED_MESSAGE, SQL_TIMEOUT_MESSAGE } from '../../src/graph/messages.ts';
import { okJson, scriptedByPrompt } from '../helpers/providers.ts';

const [, , Q3, Q4, Q5, Q6, , , , , Q11, Q12] = DEMO_SCENARIOS.map((s) => s.question);
const count = (ctx: AppContext, id: string) => (ctx.provider as FakeProvider).calls.filter((c) => c.promptId === id).length;

test('SQL-07 cenário 3 responde com 3 linhas e follow-ups', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q3! });
  assert.equal(s.outcome?.status, 'answered');
  assert.equal(s.sql!.result!.rows.length, 3);
  assert.deepEqual(s.sql!.result!.columns, ['channel', 'revenue_brl']);
  const n = s.outcome!.followUpQuestions.length; assert.ok(n >= 1 && n <= 3);
  assert.equal(count(ctx, 'sql-correct'), 0);
});
test('SQL-04 cenário 4 com exatamente 1 sql-correct e originalQuery guardada', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q4! });
  assert.equal(s.outcome?.status, 'answered');
  assert.equal(count(ctx, 'sql-correct'), 1);
  assert.equal(s.sql!.corrections, 1);
  assert.match(s.sql!.originalQuery!, /oi\.qty\b/);
  assert.match(s.sql!.query, /quantity/);
  assert.equal(s.sql!.result!.rows.length, 5);
});
test('SQL-05 cenário 5: 1 sql-generate, 3 sql-correct e nenhum sql-answer', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q5! });
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['error', SQL_EXHAUSTED_MESSAGE]);
  assert.equal(s.sql!.corrections, 3);
  assert.match(s.sql!.pendingError!.message, /no such table/);
  assert.deepEqual([count(ctx, 'sql-generate'), count(ctx, 'sql-correct'), count(ctx, 'sql-answer')], [1, 3, 0]);
});
test('SQL-06 cenário 6 no_results sem sql-answer', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q6! });
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['no_results', NO_RESULTS_MESSAGE]);
  assert.equal(count(ctx, 'sql-answer'), 0);
  assert.equal(s.sql!.result!.noResults, true);
});
test('SQL-02 cenários 11 e 12 bloqueados sem sql-correct', async () => {
  for (const [q, blockedBy] of [[Q11!, 'sql_policy'], [Q12!, 'sql_authorizer']] as const) {
    const ctx = await createTestContext();
    const s = await runGraph(ctx, { question: q });
    assert.deepEqual([s.outcome?.status, s.outcome?.blockedBy, s.outcome?.answer], ['blocked', blockedBy, POLICY_BLOCK_MESSAGE], q);
    assert.equal(count(ctx, 'sql-correct'), 0, q);
    assert.equal(count(ctx, 'sql-answer'), 0, q);
    assert.equal(s.sql!.result, null, q);
  }
});
test('SQL-03 LIMIT aplicado na SQL executada', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q3! });
  assert.match(s.sql!.query, /LIMIT 200$/);
  assert.equal(s.sql!.result!.limitApplied, true);
});

// Complementos
test('SQL-07 a mensagem a sql-answer leva no máximo 50 linhas, a SQL executada e a pergunta', async () => {
  const ctx = await createTestContext({ SQL_ROWS_TO_LLM: '2' });
  const s = await runGraph(ctx, { question: Q3! });
  const user = (ctx.provider as FakeProvider).calls.find((c) => c.promptId === 'sql-answer')!.messages[1]!.content;
  assert.equal(JSON.parse(user.slice(user.indexOf('['))).length, 2);
  assert.ok(user.includes(s.sql!.query) && user.includes(Q3!));
});
test('SQL-01 a mensagem a sql-generate leva o DDL introspectado sem dado pessoal', async () => {
  const ctx = await createTestContext();
  await runGraph(ctx, { question: Q3! });
  const user = (ctx.provider as FakeProvider).calls.find((c) => c.promptId === 'sql-generate')!.messages[1]!.content;
  assert.match(user, /CREATE TABLE order_items \(/);
  assert.doesNotMatch(user, /customer_contacts|^\s*name TEXT NOT NULL,\s+-- dado pessoal/m);
});
test('SQL-03 o teto de linhas vem de SQL_MAX_ROWS', async () => {
  const ctx = await createTestContext({ SQL_MAX_ROWS: '2' });
  const s = await runGraph(ctx, { question: Q3! });
  assert.match(s.sql!.query, /LIMIT 2$/);
  assert.equal(s.sql!.result!.rows.length, 2);
});
test('SQL-05 SQL_MAX_CORRECTIONS menor encerra antes', async () => {
  const ctx = await createTestContext({ SQL_MAX_CORRECTIONS: '1' });
  const s = await runGraph(ctx, { question: Q5! });
  assert.equal(s.outcome?.status, 'error'); assert.equal(count(ctx, 'sql-correct'), 1);
});

// Revisão final: produto cartesiano que passa pela política estática (ON 1=1). Antes, travava o event loop e o 504 não saía.
const HEAVY_SQL = 'SELECT COUNT(*) AS n FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1';
const HEAVY_Q = 'Quantas combinações de três pedidos existem?';
const heavyProvider = () => scriptedByPrompt({ 'sql-generate': okJson({ sql: HEAVY_SQL, rationale: 'conta combinações' }) });
test('SQL-11 consulta pesada é cortada por SQL_TIMEOUT_MS: status error com sql_timeout e event loop livre', async () => {
  const ctx = await createTestContext({ SQL_TIMEOUT_MS: '300' }, { provider: heavyProvider() });
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 20);
  try {
    const t0 = performance.now();
    const r = await ctx.askService.ask({ question: HEAVY_Q, forceRoute: 'data' });
    assert.ok(performance.now() - t0 < 5000, 'a resposta não saiu no prazo');
    assert.ok(r.ok);
    assert.deepEqual([r.response.status, r.response.blockedBy, r.response.answer], ['error', null, SQL_TIMEOUT_MESSAGE]);
    assert.ok(r.response.warnings.includes('sql_timeout'));
    assert.match(r.response.sql!.lastError!, /300 ms/);
    assert.equal(r.response.sql!.corrections, 0);
    assert.ok(ticks >= 5, `o event loop ficou parado (${ticks} ticks)`);
  } finally {
    clearInterval(ticker);
    ctx.close();
  }
});
test('API-02 com ASK_TIMEOUT_MS menor que SQL_TIMEOUT_MS, a consulta pesada dá 504 no prazo da requisição', async () => {
  const ctx = await createTestContext({ ASK_TIMEOUT_MS: '300', SQL_TIMEOUT_MS: '60000' }, { provider: heavyProvider() });
  try {
    const t0 = performance.now();
    const r = await ctx.askService.ask({ question: HEAVY_Q, forceRoute: 'data' });
    assert.ok(performance.now() - t0 < 5000, 'o 504 não saiu no prazo');
    assert.deepEqual([r.ok, !r.ok && r.httpStatus, !r.ok && r.body.error], [false, 504, 'timeout']);
  } finally {
    ctx.close();
  }
});
