import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, runGraph } from '../helpers/context.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { LlmUnavailableError } from '../../src/domain/errors.ts';

const [Q1, , Q3] = DEMO_SCENARIOS.map((s) => s.question);
const Q13 = DEMO_SCENARIOS.find((s) => s.id === 13)!.question;

test('LLM-01 primary-timeout-once responde com 2 tentativas no ledger', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'primary-timeout-once' });
  const r = await ctx.askService.ask({ question: Q1! });
  assert.ok(r.ok && r.response.status === 'answered');
  const calls = ctx.ledger.callsFor(r.ok ? r.response.requestId : '');
  assert.equal(calls[0]!.attempts, 2); assert.equal(calls[0]!.retries, 1);
});
test('LLM-02 primary-down: fallbackUsed, 4 retries e 2 fallbacks no ledger', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'primary-down' });
  const r = await ctx.askService.ask({ question: Q13 });
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.response.status, 'answered'); assert.equal(r.response.meta.fallbackUsed, true);
  const calls = ctx.ledger.callsFor(r.response.requestId);
  assert.equal(calls.reduce((n, c) => n + c.retries, 0), 4);
  assert.equal(calls.filter((c) => c.fallbackUsed).length, 2);
  assert.ok(r.response.meta.models.includes('fake/fallback'));
});
test('LLM-03 all-down lança LlmUnavailableError no grafo', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'all-down' });
  await assert.rejects(runGraph(ctx, { question: Q1! }), LlmUnavailableError);
});
test('LLM-06 budget 2 interrompe o ramo data com llm_budget_exceeded', async () => {
  const r = await (await createTestContext({ LLM_MAX_CALLS_PER_REQUEST: '2' })).askService.ask({ question: Q3! });
  assert.ok(r.ok && r.response.status === 'error' && r.response.warnings.includes('llm_budget_exceeded'));
});

// Complementos
test('LLM-06 resposta de budget estourado tem rota nula, mensagem fixa e as chamadas feitas no meta', async () => {
  const r = await (await createTestContext({ LLM_MAX_CALLS_PER_REQUEST: '2' })).askService.ask({ question: Q3! });
  assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual([r.response.route, r.response.blockedBy, r.response.sql], [null, null, null]);
  assert.ok(r.response.answer.length > 0);
  assert.equal(r.response.meta.llmCalls, 2);
});
test('LLM-02 primary-down no ramo data também responde pelo fallback', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'primary-down' });
  const r = await ctx.askService.ask({ question: Q3! });
  assert.ok(r.ok && r.response.status === 'answered' && r.response.meta.fallbackUsed);
});
test('LLM-03 all-down grava a falha no ledger com llm_unavailable e a requisição com HTTP 503', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'all-down' });
  const r = await ctx.askService.ask({ question: Q1! });
  assert.ok(!r.ok);
  const calls = ctx.ledger.callsFor(!r.ok ? r.body.requestId : '');
  assert.deepEqual(calls.map((c) => [c.ok, c.errorKind]), [[false, 'llm_unavailable']]);
  const s = ctx.ledger.stats(60_000);
  assert.equal(s.requests.total, 1); assert.equal(s.requests.errorRate, 1);
});
