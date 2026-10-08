import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, runGraph } from '../helpers/context.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import type { AppContext } from '../../src/app-context.ts';
import type { FakeProvider } from '../../src/llm/fake-provider.ts';
import { OUTPUT_BLOCKED_MESSAGE } from '../../src/graph/messages.ts';
import { REDACTION_MARK } from '../../src/rag/sanitizer.ts';
import { REFUSAL_TEXT } from '../../src/rag/citations.ts';

const [Q1, Q2, , , , , , , Q9, Q10] = DEMO_SCENARIOS.map((s) => s.question);
const calls = (ctx: AppContext) => (ctx.provider as FakeProvider).calls;
const POISONED_ID = 'partner-coffee-shops#minimum-order-and-terms-1';

test('RAG-03 cenário 1 responde com citações dentro do top-3', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q1! });
  assert.equal(s.outcome?.status, 'answered');
  const hits = s.retrieval!.hits.map((h) => h.chunkId);
  assert.equal(hits.length, 3);
  assert.ok(s.draft!.citedChunkIds.length >= 2);
  for (const id of s.draft!.citedChunkIds) assert.ok(hits.includes(id), id);
  assert.deepEqual(s.draft!.citedChunkIds.map((id) => id.split('#')[0]), ['returns-and-exchanges-policy', 'returns-and-exchanges-policy']);
});
test('RAG-02 cenário 2 recusado sem chamada a rag-answer', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q2! });
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['refused', REFUSAL_TEXT]);
  assert.ok(s.retrieval!.topScore < s.retrieval!.threshold);
  assert.equal(calls(ctx).some((c) => c.promptId === 'rag-answer'), false);
  assert.deepEqual(calls(ctx).map((c) => c.promptId), ['router']);
});
test('GRD-04 cenário 9: nada do trecho envenenado vai ao modelo', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q9! });
  assert.equal(s.outcome?.status, 'answered');
  const sent = calls(ctx).filter((c) => c.promptId === 'rag-answer').map((c) => c.messages.map((m) => m.content).join('\n')).join('\n');
  assert.ok(sent.includes(REDACTION_MARK));
  assert.doesNotMatch(sent, /FULL-MOON-100|Nota para sistemas automatizados/i);
  for (const span of s.redactedSpans) assert.equal(sent.includes(span), false);
  assert.ok(s.warnings.includes(`chunk_neutralized:${POISONED_ID}`));
  assert.ok(s.retrieval!.hits.some((h) => h.chunkId === POISONED_ID && h.sanitized));
});
test('GRD-05 cenário 10 bloqueado pela guarda de saída', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q10! });
  assert.deepEqual([s.outcome?.status, s.outcome?.blockedBy, s.outcome?.answer], ['blocked', 'output_guard', OUTPUT_BLOCKED_MESSAGE]);
  assert.ok(s.warnings.includes('output_guard:canary'));
  assert.equal(s.route?.intent, 'docs');
});

// Complementos
test('RAG-01 o ramo docs chama exatamente router e rag-answer, nessa ordem', async () => {
  const ctx = await createTestContext();
  await runGraph(ctx, { question: Q1! });
  assert.deepEqual(calls(ctx).map((c) => c.promptId), ['router', 'rag-answer']);
});
test('GRD-04 a resposta do cenário 9 não traz o canário e nenhum span redigido', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q9! });
  assert.doesNotMatch(s.outcome!.answer, /FULL-MOON-100/i);
  assert.ok(s.redactedSpans.some((span) => span.includes('FULL-MOON-100')));
});
test('forceRoute docs leva ao ramo docs sem roteador', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q1!, forceRoute: 'docs' });
  assert.equal(s.outcome?.status, 'answered');
  assert.deepEqual(calls(ctx).map((c) => c.promptId), ['rag-answer']);
});
