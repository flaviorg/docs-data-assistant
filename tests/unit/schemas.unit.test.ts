import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AskRequestSchema, AskResponseSchema, ErrorBodySchema, StatsSnapshotSchema, SqlResultSchema,
  RouterOutputSchema, SqlAnswerOutputSchema, REQUEST_ID_PATTERN,
} from '../../src/domain/schemas.ts';
import type { AskResponse } from '../../src/domain/schemas.ts';
import { resolveRequestId } from '../../src/domain/request-id.ts';

function minimalResponse(): AskResponse {
  return {
    requestId: 'r-12345678',
    route: null,
    routeReason: null,
    overridden: false,
    status: 'blocked',
    blockedBy: 'input_rules',
    answer: 'Não posso atender a esse pedido.',
    citations: [],
    sql: null,
    followUpQuestions: [],
    guardrail: { verdict: 'unsafe', layer: 'rules', reasons: ['instruction_override'] },
    warnings: [],
    meta: {
      provider: 'fake',
      embedder: 'hash-v1:idf=000000000000',
      models: [],
      llmCalls: 0,
      fallbackUsed: false,
      tokens: { prompt: 0, completion: 0, estimated: false },
      costUsd: 0,
      costIsFictional: true,
      latencyMs: 1,
      trace: [{ node: 'guardrailInput', ms: 1 }],
    },
  };
}

test('AskRequest rejeita chave extra, só espaços e mais de 500 caracteres', () => {
  assert.equal(AskRequestSchema.safeParse({ question: 'qual o prazo?', x: 1 }).success, false);
  assert.equal(AskRequestSchema.safeParse({ question: '     ' }).success, false);
  assert.equal(AskRequestSchema.safeParse({ question: 'a'.repeat(501) }).success, false);
  assert.equal(AskRequestSchema.safeParse({ question: 'a'.repeat(500) }).success, true);
  assert.equal(AskRequestSchema.safeParse({ question: 'qual o prazo?', forceRoute: 'out_of_scope' }).success, false);
});
test('OBS-02 resolveRequestId aceita padrão válido e troca inválido', () => {
  assert.deepEqual(resolveRequestId('abc-12345'), { id: 'abc-12345', replaced: false });
  const u = '6f0c2a1e-1111-4222-8333-444455556666';
  assert.deepEqual(resolveRequestId(u), { id: u, replaced: false });
  for (const bad of ['abc', 'a b c d e f g', 'x'.repeat(65), ['abc-12345']]) {
    const r = resolveRequestId(bad, () => 'gen-00000001');
    assert.deepEqual(r, { id: 'gen-00000001', replaced: true });
  }
  assert.deepEqual(resolveRequestId(undefined, () => 'gen-00000001'), { id: 'gen-00000001', replaced: false });
});
test('AskResponseSchema aceita resposta mínima e rejeita requestId fora do padrão', () => {
  const ok = minimalResponse();
  assert.equal(AskResponseSchema.safeParse(ok).success, true);
  assert.equal(AskResponseSchema.safeParse({ ...ok, requestId: 'abc' }).success, false);
});

// Complementos
test('OBS-02 resolveRequestId gera UUID válido por padrão', () => {
  const r = resolveRequestId(undefined);
  assert.equal(r.replaced, false);
  assert.match(r.id, REQUEST_ID_PATTERN);
  assert.match(r.id, /^[0-9a-f-]{36}$/);
});
test('AskRequest corta espaços e aceita forceRoute docs ou data', () => {
  const r = AskRequestSchema.parse({ question: '  qual o prazo?  ', forceRoute: 'data' });
  assert.deepEqual(r, { question: 'qual o prazo?', forceRoute: 'data' });
});
test('AskResponse limita citações a 3 e follow-ups a 3', () => {
  const ok = minimalResponse();
  const c = { chunkId: 'a#b-1', docTitle: 'A', heading: 'B', score: 0.5, snippet: 's', sanitized: false };
  assert.equal(AskResponseSchema.safeParse({ ...ok, citations: [c, c, c, c] }).success, false);
  assert.equal(AskResponseSchema.safeParse({ ...ok, followUpQuestions: ['a', 'b', 'c', 'd'] }).success, false);
  assert.equal(AskResponseSchema.safeParse({ ...ok, answer: '' }).success, false);
});
test('SqlResult limita linhas a 50, células a 201 caracteres e correções a 3', () => {
  const base = { query: 'SELECT 1', originalQuery: null, corrections: 0, limitApplied: true, rowCount: 1, truncated: false, columns: ['x'], rows: [[1]], lastError: null };
  assert.equal(SqlResultSchema.safeParse(base).success, true);
  assert.equal(SqlResultSchema.safeParse({ ...base, rows: Array.from({ length: 51 }, () => [1]) }).success, false);
  assert.equal(SqlResultSchema.safeParse({ ...base, rows: [['x'.repeat(202)]] }).success, false);
  assert.equal(SqlResultSchema.safeParse({ ...base, corrections: 4 }).success, false);
});
test('saídas do LLM validam enums e tamanhos', () => {
  assert.equal(RouterOutputSchema.safeParse({ intent: 'docs', reason: 'política' }).success, true);
  assert.equal(RouterOutputSchema.safeParse({ intent: 'other', reason: 'política' }).success, false);
  assert.equal(SqlAnswerOutputSchema.safeParse({ answer: 'ok', followUpQuestions: [] }).success, false);
});
test('ErrorBody e StatsSnapshot aceitam os formatos do contrato', () => {
  assert.equal(ErrorBodySchema.safeParse({ error: 'bad_request', message: 'x', requestId: 'r-12345678', issues: [{}] }).success, true);
  assert.equal(ErrorBodySchema.safeParse({ error: 'x', message: 'x' }).success, false);
  const stats = {
    since: '24h',
    requests: { total: 0, byRoute: {}, byStatus: {}, errorRate: 0, latencyMs: { p50: null, p95: null } },
    llm: { calls: 0, failures: 0, retries: 0, fallbacks: 0, tokens: { prompt: 0, completion: 0, estimated: false }, costUsd: 0, costIsFictional: true },
  };
  assert.equal(StatsSnapshotSchema.safeParse(stats).success, true);
});
