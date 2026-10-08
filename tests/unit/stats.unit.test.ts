import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLedger } from '../../src/obs/ledger.ts';
import type { LlmCallEvent } from '../../src/obs/ledger.ts';
import { parseSince, percentileNearestRank } from '../../src/obs/stats.ts';
import { StatsSnapshotSchema } from '../../src/domain/schemas.ts';

const call = (partial: Partial<LlmCallEvent> & { requestId: string }): LlmCallEvent => ({
  ts: 1_000_000, promptId: 'router', promptVersion: 'v1', model: 'fake/primary', attempts: 1, retries: 0,
  fallbackUsed: false, parseRetried: false, latencyMs: 5, promptTokens: 0, completionTokens: 0, estimated: false,
  costUsd: null, costIsFictional: false, ok: true, errorKind: null, ...partial,
});

test('OBS-01 percentis por nearest rank', () => {
  assert.equal(percentileNearestRank([], 50), null);
  assert.equal(percentileNearestRank([5], 95), 5);
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentileNearestRank(ten, 50), 5);
  assert.equal(percentileNearestRank(ten, 95), 10);
  assert.equal(percentileNearestRank(Array.from({ length: 20 }, (_, i) => i + 1), 95), 19);
});

test('parseSince aceita só as janelas do contrato', () => {
  assert.deepEqual(['15m', '1h', '24h', '7d'].map(parseSince), [900_000, 3_600_000, 86_400_000, 604_800_000]);
  assert.equal(parseSince('2h'), null); assert.equal(parseSince('abc'), null);
});

test('OBS-01 ledger agrega requisições e chamadas na janela', () => {
  const now = 1_000_000; const l = createLedger(new DatabaseSync(':memory:'), { now: () => now });
  l.recordRequest({ requestId: 'old-00001', ts: now - 90_000_000, route: 'docs', status: 'answered', httpStatus: 200, latencyMs: 9, llmCalls: 1 });
  l.recordRequest({ requestId: 'r1-000001', ts: now, route: 'docs', status: 'answered', httpStatus: 200, latencyMs: 10, llmCalls: 2 });
  l.recordRequest({ requestId: 'r2-000001', ts: now, route: 'data', status: 'error', httpStatus: 200, latencyMs: 30, llmCalls: 5 });
  l.recordRequest({ requestId: 'r3-000001', ts: now, route: null, status: null, httpStatus: 503, latencyMs: 20, llmCalls: 1 });
  l.recordCall(call({ requestId: 'r1-000001', retries: 2, fallbackUsed: true, promptTokens: 100, completionTokens: 10, costUsd: 0.001, costIsFictional: true }));
  const s = l.stats(86_400_000);
  assert.equal(s.requests.total, 3);
  assert.equal(s.requests.errorRate, 2 / 3);
  assert.deepEqual(s.requests.byRoute, { docs: 1, data: 1, none: 1 });
  assert.equal(s.llm.retries, 2); assert.equal(s.llm.fallbacks, 1);
  assert.equal(s.llm.costIsFictional, true);
  assert.equal(StatsSnapshotSchema.safeParse(s).success, true);
});

// Complementos
test('OBS-01 latência P50/P95, status, tokens, falhas e custo somados; since rotulado', () => {
  const now = 5_000_000; const l = createLedger(new DatabaseSync(':memory:'), { now: () => now });
  for (const [i, ms] of [10, 20, 30, 40].entries()) {
    l.recordRequest({ requestId: `req-0000${i}`, ts: now - 1000, route: 'docs', status: i === 3 ? 'refused' : 'answered', httpStatus: 200, latencyMs: ms, llmCalls: 1 });
  }
  l.recordCall(call({ requestId: 'req-00000', ts: now, promptTokens: 100, completionTokens: 20, estimated: true, costUsd: 0.5 }));
  l.recordCall(call({ requestId: 'req-00001', ts: now, promptTokens: 50, completionTokens: 5, costUsd: 0.25, ok: false, errorKind: 'parse' }));
  l.recordCall(call({ requestId: 'req-00002', ts: now - 2_000_000, promptTokens: 999 }));
  const s = l.stats(900_000);
  assert.equal(s.since, '15m');
  assert.deepEqual(s.requests.latencyMs, { p50: 20, p95: 40 });
  assert.deepEqual(s.requests.byStatus, { answered: 3, refused: 1 });
  assert.equal(s.requests.errorRate, 0);
  assert.equal(s.llm.calls, 2); assert.equal(s.llm.failures, 1);
  assert.deepEqual(s.llm.tokens, { prompt: 150, completion: 25, estimated: true });
  assert.equal(s.llm.costUsd, 0.75); assert.equal(s.llm.costIsFictional, false);
});

test('janela vazia devolve zeros e percentis nulos', () => {
  const s = createLedger(new DatabaseSync(':memory:')).stats(3_600_000);
  assert.equal(s.since, '1h');
  assert.equal(s.requests.total, 0); assert.equal(s.requests.errorRate, 0);
  assert.deepEqual(s.requests.latencyMs, { p50: null, p95: null });
  assert.equal(StatsSnapshotSchema.safeParse(s).success, true);
});

test('callsFor devolve as chamadas da requisição em ordem, com booleanos e custo nulo preservados', () => {
  const l = createLedger(new DatabaseSync(':memory:'));
  l.recordCall(call({ requestId: 'r-aaaaaaaa', promptId: 'router' }));
  l.recordCall(call({ requestId: 'r-bbbbbbbb', promptId: 'router' }));
  l.recordCall(call({ requestId: 'r-aaaaaaaa', promptId: 'rag-answer', fallbackUsed: true, ok: false, errorKind: 'truncated' }));
  const rows = l.callsFor('r-aaaaaaaa');
  assert.deepEqual(rows.map((r) => r.promptId), ['router', 'rag-answer']);
  assert.equal(rows[1]!.fallbackUsed, true); assert.equal(rows[1]!.ok, false); assert.equal(rows[1]!.errorKind, 'truncated');
  assert.equal(rows[0]!.costUsd, null);
});

test('createLedger reaproveita tabelas existentes', () => {
  const db = new DatabaseSync(':memory:');
  createLedger(db).recordCall(call({ requestId: 'r-cccccccc' }));
  assert.equal(createLedger(db).callsFor('r-cccccccc').length, 1);
});
