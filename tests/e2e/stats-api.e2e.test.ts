import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../helpers/context.ts';
import { createServer } from '../../src/server.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { StatsSnapshotSchema } from '../../src/domain/schemas.ts';
import type { FakeProvider } from '../../src/llm/fake-provider.ts';

const [Q1, , Q3, , , , Q7] = DEMO_SCENARIOS.map((s) => s.question);

test('OBS-01 /stats conta requisições, percentis, retries, fallbacks e custo fictício', async () => {
  const ctx = await createTestContext(); const a = createServer(ctx);
  for (const q of [Q1!, Q3!, Q7!]) await a.inject({ method: 'POST', url: '/ask', payload: { question: q } });
  (ctx.provider as FakeProvider).setChaos('primary-down');
  await a.inject({ method: 'POST', url: '/ask', payload: { question: DEMO_SCENARIOS[12]!.question } });
  const s = StatsSnapshotSchema.parse((await a.inject({ method: 'GET', url: '/stats?since=1h' })).json());
  assert.equal(s.requests.total, 4); assert.ok(s.requests.latencyMs.p50 !== null && s.requests.latencyMs.p95 !== null);
  assert.equal(s.llm.fallbacks, 2); assert.equal(s.llm.retries, 4); assert.equal(s.llm.costIsFictional, true);
  assert.equal((await a.inject({ method: 'GET', url: '/stats?since=2h' })).statusCode, 400);
});

// Complementos
test('OBS-01 /stats sem since usa 24h e traz rotas, status, taxa de erro e tokens', async () => {
  const ctx = await createTestContext(); const a = createServer(ctx);
  for (const q of [Q1!, Q3!, Q7!]) await a.inject({ method: 'POST', url: '/ask', payload: { question: q } });
  const r = await a.inject({ method: 'GET', url: '/stats' });
  assert.equal(r.statusCode, 200);
  const s = StatsSnapshotSchema.parse(r.json());
  assert.equal(s.since, '24h');
  assert.deepEqual(s.requests.byRoute, { docs: 1, data: 1, out_of_scope: 1 });
  assert.deepEqual(s.requests.byStatus, { answered: 2, refused: 1 });
  assert.equal(s.requests.errorRate, 0);
  assert.ok(s.llm.calls === 2 + 3 + 1 && s.llm.tokens.prompt > 0 && s.llm.tokens.estimated);
  assert.ok(r.headers['x-request-id']);
});

test('/stats com since inválido dá 400 com o corpo do contrato', async () => {
  const a = createServer(await createTestContext());
  for (const since of ['2h', '', 'abc', '24']) {
    const r = await a.inject({ method: 'GET', url: `/stats?since=${since}` });
    assert.equal(r.statusCode, 400, since); assert.equal(r.json().error, 'bad_request');
    assert.equal(r.json().requestId, r.headers['x-request-id']);
  }
});
