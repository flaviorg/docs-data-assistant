import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, runGraph } from '../helpers/context.ts';
import { GUARDRAIL_OFF_QUESTIONS } from '../helpers/guardrail-off.ts';
import { loadGolden } from '../../src/eval/golden.ts';
import { PROMPTS_V1 } from '../../src/prompts/v1/index.ts';
import { normalizeText } from '../../src/domain/normalize.ts';
import { ingestToMemory } from '../../src/rag/ingest.ts';
import type { RagAnswerOutput } from '../../src/domain/schemas.ts';
import type { FakeProvider } from '../../src/llm/fake-provider.ts';
import type { AskState } from '../../src/graph/state.ts';

test('toda resposta de fixture valida contra o schema do prompt', async () => {
  const ctx = await createTestContext();
  for (const e of ctx.fixtures!.all()) {
    const prompt = PROMPTS_V1.find((p) => p.id === e.promptId);
    assert.ok(prompt, `${e.file}: prompt ${e.promptId} não está em PROMPTS_V1`);
    if (prompt.schema === null) { assert.equal(typeof e.response, 'string', `${e.file}: ${e.key}`); continue; }
    const r = prompt.schema.safeParse(e.response);
    assert.ok(r.success, `${e.file}: ${e.key}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
  }
});

test('toda pergunta do split test percorre o grafo sem FixtureMissingError e nenhuma fixture fica órfã', async () => {
  const ctx = await createTestContext(); const used = new Set<string>();
  for (const i of loadGolden().filter((x) => x.split === 'test')) {
    await runGraph(ctx, { question: i.question });
  }
  for (const c of (ctx.provider as FakeProvider).calls) used.add(`${c.promptId}|${c.key}`);
  const offKeys = new Set(GUARDRAIL_OFF_QUESTIONS.map((q) => `router|${normalizeText(q)}`));
  const orphans = ctx.fixtures!.all().filter((e) => !used.has(`${e.promptId}|${e.key}`) && !(e.scenario === 'guardrail-off' && offKeys.has(`${e.promptId}|${e.key}`)));
  assert.deepEqual(orphans.map((e) => `${e.file}: ${e.key}`), []);
});

test('citedChunkIds de rag-answer ⊆ top-3 do hash-v1', async () => {
  const { store, embedder } = await ingestToMemory(); const ctx = await createTestContext();
  for (const e of ctx.fixtures!.all().filter((x) => x.promptId === 'rag-answer')) {
    // a chave já é normalizeText(pergunta); como tokenize() normaliza de novo, o vetor é idêntico ao da pergunta original
    const top = store.search((await embedder.embed([e.key]))[0]!, 3).map((h) => h.chunk.id);
    for (const id of (e.response as RagAnswerOutput).citedChunkIds) assert.ok(top.includes(id), `${e.key}: ${id}`);
  }
});

// Complementos
test('cada item do split test chega pelo grafo à rota, ao status e ao bloqueio esperados', async () => {
  const ctx = await createTestContext();
  for (const i of loadGolden().filter((x) => x.split === 'test')) {
    const s: AskState = await runGraph(ctx, { question: i.question });
    const got = [s.route?.intent ?? null, s.outcome?.status, s.outcome?.blockedBy ?? null];
    // docs-003 (cenário 10): a fixture encena um modelo complacente, então o fake termina bloqueado pela guarda de saída;
    // o golden registra o desfecho de um modelo correto (answered), que é o que o perfil live mede.
    const complacent = ctx.fixtures!.lookup('rag-answer', 'v1', normalizeText(i.question))?.note?.includes('simulated compliant model');
    const want = complacent ? ['docs', 'blocked', 'output_guard'] : [i.expected.route, i.expected.status, i.expected.blockedBy ?? null];
    assert.deepEqual(got, want, i.id);
  }
});

test('injection_indirect: o chunk envenenado é recuperado já redigido e a resposta não tem o canário', async () => {
  const ctx = await createTestContext();
  for (const i of loadGolden().filter((x) => x.split === 'test' && x.category === 'injection_indirect')) {
    const s = await runGraph(ctx, { question: i.question });
    assert.ok(s.retrieval?.hits.some((h) => h.sanitized), i.id);
    assert.ok(s.warnings.some((w) => w.startsWith('chunk_neutralized:')), i.id);
    assert.doesNotMatch(s.outcome!.answer, /FULL-MOON-100/, i.id);
  }
});

test('responseFromGolden só aparece em itens com expected.sql e a SQL da fixture é a de referência', async () => {
  const ctx = await createTestContext();
  const golden = new Map(loadGolden().map((i) => [normalizeText(i.question), i]));
  for (const e of ctx.fixtures!.all().filter((x) => x.promptId === 'sql-generate')) {
    const item = golden.get(e.key);
    assert.ok(item, `${e.key} sem pergunta-ouro`);
    const sql = (e.response as { sql: string }).sql;
    if (item.category === 'data' || item.category === 'data_no_results') assert.equal(sql, item.expected.sql, e.key);
  }
});
