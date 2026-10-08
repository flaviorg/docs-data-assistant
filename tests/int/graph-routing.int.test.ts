import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphRecursionError } from '@langchain/langgraph';
import { createTestContext, runGraph } from '../helpers/context.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import type { FakeProvider } from '../../src/llm/fake-provider.ts';
import { withTrace } from '../../src/graph/graph.ts';
import type { AskState } from '../../src/graph/state.ts';
import { createScriptedProvider, okJson } from '../helpers/providers.ts';

const [Q1, , Q3, Q4, Q5, , Q7, Q8] = DEMO_SCENARIOS.map((s) => s.question);
const calls = (ctx: { provider: unknown }) => (ctx.provider as FakeProvider).calls;

test('RTE-01 classifica docs e data e registra o motivo', async () => {
  const ctx = await createTestContext();
  const d = await runGraph(ctx, { question: Q1! }); assert.equal(d.route?.intent, 'docs'); assert.ok(d.route!.reason.length >= 3);
  assert.equal((await runGraph(ctx, { question: Q3! })).route?.intent, 'data');
});
test('RTE-04 cenário 7 só chama o roteador e termina refused', async () => {
  const ctx = await createTestContext(); const s = await runGraph(ctx, { question: Q7! });
  assert.equal(s.outcome?.status, 'refused');
  assert.deepEqual(calls(ctx).map((c) => c.promptId), ['router']);
});
test('GRD-01 cenário 8 não chama o provedor', async () => {
  const ctx = await createTestContext(); const s = await runGraph(ctx, { question: Q8! });
  assert.equal(s.outcome?.blockedBy, 'input_rules'); assert.equal(calls(ctx).length, 0);
});
test('RTE-02 forceRoute no grafo grava overridden', async () => {
  const ctx = await createTestContext(); const s = await runGraph(ctx, { question: Q3!, forceRoute: 'data' });
  assert.equal(s.route?.overridden, true); assert.equal(calls(ctx).some((c) => c.promptId === 'router'), false);
});
test('trace acumula na ordem e o caminho de 3 correções fica bem abaixo de 25 passos', async () => {
  const ctx = await createTestContext();
  assert.deepEqual((await runGraph(ctx, { question: Q4! })).trace.map((t) => t.node),
    ['guardrailInput', 'router', 'sqlGenerate', 'sqlValidate', 'sqlCorrect', 'sqlValidate', 'sqlExecute', 'sqlAnswer', 'finalize']);
  assert.ok((await runGraph(ctx, { question: Q5! })).trace.length <= 16);
});
test('rules+model com provider fake é recusado na composição', async () => {
  await assert.rejects(createTestContext({ GUARDRAIL_MODE: 'rules+model' }), /GUARDRAIL_MODE/);
});

// Complementos
test('os 13 cenários da demo terminam com rota, status e bloqueio esperados', async () => {
  for (const sc of DEMO_SCENARIOS) {
    const ctx = await createTestContext(sc.chaos ? { LLM_FAKE_CHAOS: sc.chaos } : {});
    const s = await runGraph(ctx, { question: sc.question });
    assert.equal(s.route?.intent ?? null, sc.expected.route, `cenário ${sc.id}: rota`);
    assert.equal(s.outcome?.status, sc.expected.status, `cenário ${sc.id}: status`);
    assert.equal(s.outcome?.blockedBy ?? null, sc.expected.blockedBy ?? null, `cenário ${sc.id}: blockedBy`);
  }
});
test('DEMO_SCENARIOS: 13 cenários numerados, 10 e 11 marcados como fixture complacente e 13 com caos primary-down', () => {
  assert.deepEqual(DEMO_SCENARIOS.map((s) => s.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(DEMO_SCENARIOS.filter((s) => s.complacentFixture).map((s) => s.id), [10, 11]);
  assert.deepEqual(DEMO_SCENARIOS.filter((s) => s.chaos).map((s) => [s.id, s.chaos]), [[13, 'primary-down']]);
  for (const s of DEMO_SCENARIOS) assert.ok(s.label.length > 0 && s.question.length >= 3);
});
test('caminhos docs e out_of_scope deixam uma entrada de trace por nó visitado', async () => {
  const ctx = await createTestContext();
  assert.deepEqual((await runGraph(ctx, { question: Q1! })).trace.map((t) => t.node), ['guardrailInput', 'router', 'retrieve', 'ragAnswer', 'checkCitations', 'finalize']);
  assert.deepEqual((await runGraph(ctx, { question: Q7! })).trace.map((t) => t.node), ['guardrailInput', 'router', 'outOfScope', 'finalize']);
  assert.deepEqual((await runGraph(ctx, { question: Q8! })).trace.map((t) => t.node), ['guardrailInput', 'finalize']);
});
test('cenário 5 percorre 11 passos: 3 ciclos correção-validação e finalize', async () => {
  const ctx = await createTestContext();
  const s = await runGraph(ctx, { question: Q5! });
  assert.deepEqual(s.trace.map((t) => t.node), ['guardrailInput', 'router', 'sqlGenerate', 'sqlValidate', 'sqlCorrect', 'sqlValidate',
    'sqlCorrect', 'sqlValidate', 'sqlCorrect', 'sqlValidate', 'finalize']);
});
test('o caminho mais longo possível (16 passos) cabe no recursionLimit de 25', async () => {
  // SQL que passa no EXPLAIN e falha só na execução (integer overflow): 3 ciclos correct-validate-execute e depois sucesso.
  const overflow = 'SELECT abs(-9223372036854775807 - 1) AS x FROM orders';
  const p = createScriptedProvider([(req) => {
    switch (req.meta.promptId) {
      case 'router': return okJson({ intent: 'data', reason: 'pergunta de vendas' });
      case 'sql-generate': return okJson({ sql: overflow, rationale: 'r' });
      case 'sql-correct': return okJson({ correctedSql: req.meta.fixtureKey.endsWith('#3') ? 'SELECT COUNT(*) AS n FROM orders' : overflow, fix: 'f' });
      default: return okJson({ answer: 'Há 4000 pedidos no banco.', followUpQuestions: ['Quantos pedidos foram pagos?'] });
    }
  }]);
  const ctx = await createTestContext({}, { provider: p });
  const s = await runGraph(ctx, { question: 'pergunta de teste do caminho mais longo' });
  assert.deepEqual(s.trace.map((t) => t.node), ['guardrailInput', 'router', 'sqlGenerate', 'sqlValidate', 'sqlExecute',
    'sqlCorrect', 'sqlValidate', 'sqlExecute', 'sqlCorrect', 'sqlValidate', 'sqlExecute', 'sqlCorrect', 'sqlValidate', 'sqlExecute', 'sqlAnswer', 'finalize']);
  assert.equal(s.trace.length, 16); assert.ok(s.trace.length < 25);
  assert.deepEqual([s.outcome?.status, s.sql?.corrections], ['answered', 3]);
});
test('withTrace grava exatamente uma entrada com o nome e a nota do nó', async () => {
  const st: AskState = { requestId: 'r', question: 'q', redactedSpans: [], warnings: [], trace: [] };
  const wrapped = withTrace('meuNo', async () => ({ warnings: ['w'], trace: [{ node: 'outro', ms: 99, note: 'nota' }] }));
  const u = await wrapped(st, {});
  assert.equal(u.trace?.length, 1); assert.equal(u.trace![0]!.node, 'meuNo'); assert.equal(u.trace![0]!.note, 'nota');
  assert.ok(u.trace![0]!.ms < 99); assert.deepEqual(u.warnings, ['w']);
  const empty = await withTrace('vazio', async () => ({}))(st, {});
  assert.deepEqual(empty.trace?.map((t) => t.node), ['vazio']);
});
test('recursionLimit baixo dispara GraphRecursionError (a rede de segurança existe)', async () => {
  const ctx = await createTestContext();
  const callContext = { requestId: 'r-12345678', signal: new AbortController().signal, budget: { max: 8, used: 0, consume() {} } };
  await assert.rejects(ctx.graph.invoke({ requestId: 'r-12345678', question: Q4! }, { recursionLimit: 4, configurable: { callContext } }), GraphRecursionError);
});
test('contexto em memória: schema sem dado pessoal, índice com 8 documentos e close idempotente', async () => {
  const ctx = await createTestContext();
  assert.match(ctx.schemaText, /CREATE TABLE orders/); assert.doesNotMatch(ctx.schemaText, /customer_contacts/);
  assert.equal(ctx.store.counts().documents, 8);
  assert.ok(ctx.getChunk('cafeterias-parceiras#pedido-minimo-e-condicoes-1')?.flagged);
  assert.equal(ctx.provider.name, 'fake'); assert.ok(ctx.fixtures);
  ctx.close(); ctx.close();
});
