import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { createFakeProvider } from '../../src/llm/fake-provider.ts';
import { createLlmClient } from '../../src/llm/llm-client.ts';
import type { LlmClient } from '../../src/llm/llm-client.ts';
import { createCallBudget } from '../../src/llm/budget.ts';
import { createLedger } from '../../src/obs/ledger.ts';
import { loadPrices } from '../../src/llm/pricing.ts';
import type { LlmProvider } from '../../src/llm/provider.ts';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import { createQueryRunner } from '../../src/sql/query-runner.ts';
import { describeSchema } from '../../src/sql/schema-introspect.ts';
import { createSqlValidator } from '../../src/sql/validator.ts';
import { sqlGeneratePrompt } from '../../src/prompts/v1/sql-generate.ts';
import { sqlCorrectPrompt } from '../../src/prompts/v1/sql-correct.ts';
import { sqlAnswerPrompt } from '../../src/prompts/v1/sql-answer.ts';
import { createSqlGenerateNode } from '../../src/graph/nodes/sql-generate.ts';
import { createSqlValidateNode } from '../../src/graph/nodes/sql-validate.ts';
import { createSqlCorrectNode } from '../../src/graph/nodes/sql-correct.ts';
import { createSqlExecuteNode } from '../../src/graph/nodes/sql-execute.ts';
import { createSqlAnswerNode } from '../../src/graph/nodes/sql-answer.ts';
import { NO_RESULTS_MESSAGE, POLICY_BLOCK_MESSAGE, SQL_EXHAUSTED_MESSAGE, SQL_TIMEOUT_MESSAGE } from '../../src/graph/messages.ts';
import { routeAfterSqlGenerate, routeAfterSqlValidate, routeAfterSqlExecute, NODE } from '../../src/graph/routing.ts';
import { AskAbortedError, LlmError } from '../../src/domain/errors.ts';
import { SqlAnswerOutputSchema, SqlCorrectionOutputSchema, SqlGenerationOutputSchema } from '../../src/domain/schemas.ts';
import type { AskState, AskStateUpdate } from '../../src/graph/state.ts';
import { createScriptedProvider, okJson } from '../helpers/providers.ts';
import { loadRealFixtures } from '../helpers/fixtures.ts';

const Q3 = 'Qual foi o faturamento por canal em 2025?';
const Q4 = 'Quais os 5 produtos mais vendidos em quantidade no segundo semestre de 2025?';
const Q5 = 'Qual a margem de lucro por fornecedor em 2025?';
const Q6 = 'Quanto vendemos em 2019?';
const Q11 = 'Apague todos os pedidos cancelados.';
const Q12 = 'Liste o e-mail dos clientes de Curitiba.';

type Node = (s: AskState, c: LangGraphRunnableConfig) => Promise<AskStateUpdate>;

const clientWith = (provider: LlmProvider): LlmClient => createLlmClient({
  provider, models: { primary: 'fake/primary', fallback: 'fake/fallback', guardrail: 'fake/guardrail' },
  ledger: createLedger(new DatabaseSync(':memory:')), prices: loadPrices(), timeoutMs: 1000, maxRetries: 2, structuredMode: 'json_schema',
  sleep: async () => {},
});

// Cada teste monta o próprio fake com as fixtures reais, conexão (snapshot) e nós.
function setup(provider?: LlmProvider) {
  const fake = createFakeProvider({ fixtures: loadRealFixtures() });
  const llm = clientWith(provider ?? fake);
  const admin = openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() }, { authorizer: false });
  const schemaText = describeSchema(admin.db);
  admin.close();
  const bytes = createSalesSnapshot();
  const conn = openSalesConnection({ kind: 'snapshot', bytes });
  const runner = createQueryRunner({ kind: 'snapshot', bytes }, { timeoutMs: 10_000 });
  return {
    fake, conn,
    generate: createSqlGenerateNode({ llm, prompt: sqlGeneratePrompt, schemaText }),
    validate: createSqlValidateNode({ validator: createSqlValidator({ conn, maxRows: 200 }), maxCorrections: 3 }),
    correct: createSqlCorrectNode({ llm, prompt: sqlCorrectPrompt, schemaText }),
    execute: createSqlExecuteNode({ runner, maxRows: 200, maxCorrections: 3 }),
    answer: createSqlAnswerNode({ llm, prompt: sqlAnswerPrompt, rowsToLlm: 50 }),
  };
}

const cfg = (): LangGraphRunnableConfig =>
  ({ configurable: { callContext: { requestId: 'r-12345678', signal: new AbortController().signal, budget: createCallBudget(8) } } });
const state = (question: string): AskState => ({ requestId: 'r-12345678', question, redactedSpans: [], warnings: [], trace: [] });
async function step(s: AskState, node: Node): Promise<AskState> {
  const u = await node(s, cfg());
  return { ...s, ...u, warnings: [...s.warnings, ...(u.warnings ?? [])], trace: [...s.trace, ...(u.trace ?? [])], redactedSpans: [...s.redactedSpans, ...(u.redactedSpans ?? [])] };
}
const stateWithResult = (question: string, n: number): AskState => ({
  ...state(question),
  route: { intent: 'data', reason: 'r', overridden: false },
  sql: {
    query: 'SELECT channel, total FROM t LIMIT 200', originalQuery: null, corrections: 0, pendingError: null, limitApplied: true,
    result: { columns: ['channel', 'total'], rows: Array.from({ length: n }, (_, i) => [`canal-${i}`, i]), truncated: false, limitApplied: true, noResults: false },
  },
});

test('SQL-04 erro corrigível pede correção com query, erro e pergunta', async () => {
  const { generate, validate, correct, fake } = setup();
  let s = await step(state(Q4), generate); s = await step(s, validate);
  assert.match(s.sql!.pendingError!.message, /no such column/); assert.equal(s.sql!.corrections, 0);
  s = await step(s, correct);
  assert.equal(s.sql!.corrections, 1); assert.ok(s.sql!.originalQuery?.includes('quantidade'));
  const user = fake.calls.filter((c) => c.promptId === 'sql-correct').at(-1)!.messages[1]!.content;
  assert.ok(user.includes('quantidade') && /no such column/.test(user) && user.includes('segundo semestre'));
});
test('SQL-05 no teto, validate grava error determinístico sem chamar o modelo', async () => {
  const { validate, fake } = setup();
  const before = fake.calls.length;
  const s = await step({ ...state(Q5), sql: { query: 'SELECT * FROM suppliers', originalQuery: 'x', corrections: 3, pendingError: null, result: null } }, validate);
  assert.equal(s.outcome?.status, 'error'); assert.equal(s.outcome?.answer, SQL_EXHAUSTED_MESSAGE);
  assert.equal(fake.calls.length, before);
});
test('SQL-02 DELETE vira sql_policy e customer_contacts vira sql_authorizer', async () => {
  const { generate, validate } = setup();
  assert.equal((await step(await step(state(Q11), generate), validate)).outcome?.blockedBy, 'sql_policy');
  assert.equal((await step(await step(state(Q12), generate), validate)).outcome?.blockedBy, 'sql_authorizer');
});
test('SQL-06 SUM sobre 2019 vira no_results', async () => {
  const { generate, validate, execute } = setup();
  const s = await step(await step(await step(state(Q6), generate), validate), execute);
  assert.equal(s.outcome?.status, 'no_results');
});
test('SQL-07 sqlAnswer envia no máximo 50 linhas e devolve 1 a 3 follow-ups', async () => {
  const { answer, fake } = setup();
  const s = await step(stateWithResult(Q3, 60), answer); // 60 linhas sintéticas
  const user = fake.calls.filter((c) => c.promptId === 'sql-answer').at(-1)!.messages[1]!.content;
  assert.equal(JSON.parse(user.slice(user.indexOf('['))).length, 50);
  assert.ok(s.outcome!.followUpQuestions.length >= 1 && s.outcome!.followUpQuestions.length <= 3);
});
test('SQL com cerca Markdown e ponto e vírgula final é aceita', async () => {
  const { validate } = setup();
  const llm = clientWith(createScriptedProvider([okJson({ sql: '```sql\nSELECT channel, COUNT(*) FROM orders GROUP BY channel;\n```', rationale: 'r' })]));
  const s = await step(await step(state('pergunta qualquer'), createSqlGenerateNode({ llm, prompt: sqlGeneratePrompt, schemaText: '' })), validate);
  assert.equal(s.sql!.pendingError, null); assert.equal(s.outcome, undefined);
});

// Complementos
test('SQL-03 validate grava a SQL reescrita com LIMIT e limitApplied; execute leva limitApplied ao resultado', async () => {
  const { generate, validate, execute } = setup();
  let s = await step(await step(state(Q3), generate), validate);
  assert.match(s.sql!.query, /LIMIT 200$/); assert.equal(s.sql!.limitApplied, true);
  s = await step(s, execute);
  assert.equal(s.sql!.result?.rows.length, 3); assert.equal(s.sql!.result?.limitApplied, true); assert.equal(s.outcome, undefined);
  assert.equal(routeAfterSqlExecute(s), NODE.sqlAnswer);
});
test('SQL-02 bloqueio de política registra aviso, regra e mensagem fixa, sem pedir correção', async () => {
  const { generate, validate } = setup();
  const s = await step(await step(state(Q11), generate), validate);
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['blocked', POLICY_BLOCK_MESSAGE]);
  assert.ok(s.warnings.includes('sql_policy:not_select'));
  assert.deepEqual([s.sql?.pendingError?.kind, s.sql?.pendingError?.rule], ['policy', 'not_select']);
  assert.equal(routeAfterSqlValidate(s), NODE.finalize);
  const a = await step(await step(state(Q12), generate), validate);
  assert.ok(a.warnings.includes('sql_policy:authorizer'));
});
test('SQL-05 cenário 5 nos nós: 3 correções e error com o último erro guardado', async () => {
  const { generate, validate, correct, fake } = setup();
  let s = await step(await step(state(Q5), generate), validate);
  for (let i = 1; i <= 3; i++) {
    assert.equal(routeAfterSqlValidate(s), NODE.sqlCorrect);
    s = await step(await step(s, correct), validate);
    assert.equal(s.sql!.corrections, i);
  }
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['error', SQL_EXHAUSTED_MESSAGE]);
  assert.match(s.sql!.pendingError!.message, /no such table: suppliers/);
  assert.equal(fake.calls.filter((c) => c.promptId === 'sql-correct').length, 3);
  assert.deepEqual(fake.calls.filter((c) => c.promptId === 'sql-correct').map((c) => c.key.slice(-2)), ['#1', '#2', '#3']);
});
test('falha do LLM no sqlGenerate vira SQL vazia com erro corrigível e vai para correção', async () => {
  const llm = clientWith(createScriptedProvider([new LlmError('truncated', 'len')]));
  const s = await step(state('q q q'), createSqlGenerateNode({ llm, prompt: sqlGeneratePrompt, schemaText: '' }));
  assert.equal(s.sql!.query, ''); assert.equal(s.sql!.pendingError?.kind, 'correctable');
  assert.match(s.sql!.pendingError!.message, /não devolveu SQL válida/);
  assert.ok(s.warnings.includes('llm_truncated'));
  assert.equal(routeAfterSqlGenerate(s), NODE.sqlCorrect);
});
test('falha do LLM no sqlCorrect consome a correção e mantém o erro; no teto validate encerra', async () => {
  const llm = clientWith(createScriptedProvider([okJson({ wrong: true })]));
  const correct = createSqlCorrectNode({ llm, prompt: sqlCorrectPrompt, schemaText: '' });
  const { validate } = setup();
  let s: AskState = { ...state(Q5), sql: { query: 'SELECT * FROM suppliers', originalQuery: null, corrections: 2, pendingError: { kind: 'correctable', message: 'no such table: suppliers' }, result: null } };
  s = await step(s, correct);
  assert.equal(s.sql!.corrections, 3); assert.equal(s.sql!.pendingError?.message, 'no such table: suppliers');
  assert.ok(s.warnings.includes('llm_parse_failed'));
  s = await step(s, validate);
  assert.equal(s.outcome?.status, 'error');
  const early = await step({ ...s, outcome: undefined, sql: { ...s.sql!, corrections: 1 } }, validate);
  assert.equal(early.outcome, undefined); assert.equal(routeAfterSqlValidate(early), NODE.sqlCorrect);
});
test('sqlCorrect guarda a primeira SQL em originalQuery só uma vez', async () => {
  const { correct } = setup();
  const s0: AskState = { ...state(Q5), sql: { query: 'SELECT a FROM suppliers', originalQuery: null, corrections: 0, pendingError: { kind: 'correctable', message: 'no such table: suppliers' }, result: null } };
  const s1 = await step(s0, correct);
  assert.equal(s1.sql!.originalQuery, 'SELECT a FROM suppliers');
  const s2 = await step({ ...s1, sql: { ...s1.sql!, pendingError: { kind: 'correctable', message: 'no such table: fornecedores' } } }, correct);
  assert.equal(s2.sql!.originalQuery, 'SELECT a FROM suppliers'); assert.equal(s2.sql!.corrections, 2);
});
test('sqlExecute: negação em execução bloqueia como sql_authorizer; outro erro pede correção até o teto', async () => {
  const { execute } = setup();
  const sqlState = (query: string, corrections: number): AskState => ({ ...state(Q12), sql: { query, originalQuery: null, corrections, pendingError: null, result: null } });
  const denied = await step(sqlState('SELECT email FROM customer_contacts', 0), execute);
  assert.deepEqual([denied.outcome?.status, denied.outcome?.blockedBy], ['blocked', 'sql_authorizer']);
  const runtime = await step(sqlState('SELECT * FROM suppliers', 1), execute);
  assert.equal(runtime.sql!.pendingError?.kind, 'runtime'); assert.equal(runtime.outcome, undefined);
  assert.equal(routeAfterSqlExecute(runtime), NODE.sqlCorrect);
  const ceiling = await step(sqlState('SELECT * FROM suppliers', 3), execute);
  assert.deepEqual([ceiling.outcome?.status, ceiling.outcome?.answer], ['error', SQL_EXHAUSTED_MESSAGE]);
});
// Produto cartesiano que passa pela política estática (ON 1=1) e não termina dentro de nenhum prazo do teste.
const HEAVY = 'SELECT COUNT(*) AS n FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1 LIMIT 200';
const heavyState = (): AskState => ({ ...state(Q3), sql: { query: HEAVY, originalQuery: null, corrections: 0, pendingError: null, result: null } });
test('SQL-11 sqlExecute: consulta que passa de SQL_TIMEOUT_MS vira error com sql_timeout, sem pedir correção', async () => {
  const runner = createQueryRunner({ kind: 'snapshot', bytes: createSalesSnapshot() }, { timeoutMs: 300 });
  try {
    const t0 = performance.now();
    const s = await step(heavyState(), createSqlExecuteNode({ runner, maxRows: 200, maxCorrections: 3 }));
    assert.ok(performance.now() - t0 < 5000);
    assert.deepEqual([s.outcome?.status, s.outcome?.blockedBy, s.outcome?.answer], ['error', null, SQL_TIMEOUT_MESSAGE]);
    assert.ok(s.warnings.includes('sql_timeout'));
    assert.equal(s.sql!.pendingError?.kind, 'runtime'); assert.match(s.sql!.pendingError!.message, /300 ms/);
    assert.equal(s.sql!.result, null);
    assert.equal(routeAfterSqlExecute(s), NODE.finalize);
  } finally {
    runner.close();
  }
});
test('sqlExecute: abort da requisição interrompe a consulta e propaga AskAbortedError', async () => {
  const runner = createQueryRunner({ kind: 'snapshot', bytes: createSalesSnapshot() }, { timeoutMs: 60_000 });
  try {
    const ac = new AbortController();
    const config: LangGraphRunnableConfig = { configurable: { callContext: { requestId: 'r-12345678', signal: ac.signal, budget: createCallBudget(8) } } };
    setTimeout(() => ac.abort(), 200);
    await assert.rejects(createSqlExecuteNode({ runner, maxRows: 200, maxCorrections: 3 })(heavyState(), config), (e: unknown) => e instanceof AskAbortedError);
  } finally {
    runner.close();
  }
});
test('SQL-06 no_results guarda o resultado vazio e a mensagem fixa', async () => {
  const { generate, validate, execute } = setup();
  const s = await step(await step(await step(state(Q6), generate), validate), execute);
  assert.equal(s.outcome?.answer, NO_RESULTS_MESSAGE);
  assert.deepEqual(s.sql!.result?.rows, [[null]]); assert.equal(s.sql!.result?.noResults, true);
});
test('LLM-07 sqlAnswer com falha do modelo usa resposta determinística com a contagem de linhas', async () => {
  const llm = clientWith(createScriptedProvider([new LlmError('truncated', 'len')]));
  const s = await step(stateWithResult(Q3, 3), createSqlAnswerNode({ llm, prompt: sqlAnswerPrompt, rowsToLlm: 50 }));
  assert.deepEqual([s.outcome?.status, s.outcome?.answer], ['answered', 'Resultado da consulta: 3 linha(s). Veja a tabela.']);
  assert.deepEqual(s.outcome?.followUpQuestions, []); assert.ok(s.warnings.includes('llm_truncated'));
  const parse = await step(stateWithResult(Q3, 1), createSqlAnswerNode({ llm: clientWith(createScriptedProvider([okJson({ answer: '' })])), prompt: sqlAnswerPrompt, rowsToLlm: 50 }));
  assert.ok(parse.warnings.includes('llm_parse_failed'));
});
test('nós do ramo data passam adiante sem fazer nada quando já existe outcome', async () => {
  const { generate, validate, correct, execute, answer, fake } = setup();
  const done: AskState = { ...stateWithResult(Q3, 2), outcome: { status: 'blocked', blockedBy: 'input_rules', answer: 'x', followUpQuestions: [] } };
  for (const node of [generate, validate, correct, execute, answer]) assert.deepEqual(await node(done, cfg()), {});
  assert.equal(fake.calls.length, 0);
});
test('cada nó do ramo data deixa uma entrada no trace com o próprio nome', async () => {
  const { generate, validate, execute, answer } = setup();
  let s = state(Q3);
  for (const node of [generate, validate, execute, answer]) s = await step(s, node);
  assert.deepEqual(s.trace.map((t) => t.node), ['sqlGenerate', 'sqlValidate', 'sqlExecute', 'sqlAnswer']);
  assert.equal(s.outcome?.status, 'answered');
});
test('fixtures do ramo data validam o schema de cada prompt', () => {
  const schemas = { 'sql-generate': SqlGenerationOutputSchema, 'sql-correct': SqlCorrectionOutputSchema, 'sql-answer': SqlAnswerOutputSchema } as const;
  const entries = loadRealFixtures().all().filter((e) => e.promptId in schemas);
  assert.ok(entries.length >= 12);
  for (const e of entries) assert.equal(schemas[e.promptId as keyof typeof schemas].safeParse(e.response).success, true, `${e.promptId}: ${e.key}`);
});
