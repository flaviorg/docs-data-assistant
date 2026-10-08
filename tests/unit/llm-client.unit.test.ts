import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCallBudget } from '../../src/llm/budget.ts';
import { createLlmClient, defaultSleep } from '../../src/llm/llm-client.ts';
import { createLedger } from '../../src/obs/ledger.ts';
import { loadPrices } from '../../src/llm/pricing.ts';
import { normalizeText } from '../../src/domain/normalize.ts';
import { RouterOutputSchema } from '../../src/domain/schemas.ts';
import type { RouterOutput } from '../../src/domain/schemas.ts';
import { AskAbortedError, BudgetExceededError, FixtureMissingError, LlmError, LlmUnavailableError } from '../../src/domain/errors.ts';
import type { LlmProvider } from '../../src/llm/provider.ts';
import type { PromptDef } from '../../src/prompts/prompt.ts';
import { createScriptedProvider, okJson, okText } from '../helpers/providers.ts';

const routerDef: PromptDef<{ question: string }, RouterOutput> = {
  id: 'router', version: 'v1',
  system: { meta: { id: 'router', version: 'v1', description: 'teste' }, role: 'classificador', context: 'loja', task: 'classifique',
    constraints: ['responda em JSON'], output: '{"intent": "...", "reason": "..."}' },
  allowedEchoes: [], buildUser: (v) => `Pergunta: ${v.question}`, schema: RouterOutputSchema,
  fixtureKey: (v) => normalizeText(v.question), temperature: 0, maxTokens: 200,
};
const ledger = createLedger(new DatabaseSync(':memory:'));
const prices = loadPrices();
const ctx = (max = 8) => ({ requestId: 'r-12345678', signal: new AbortController().signal, budget: createCallBudget(max) });
const sleeps: number[] = [];
const client = (provider: LlmProvider, extra = {}) => createLlmClient({ provider, models: { primary: 'm-primary', fallback: 'm-fallback', guardrail: 'm-guard' },
  ledger, prices, timeoutMs: 1000, maxRetries: 2, structuredMode: 'json_schema', sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, ...extra });

test('LLM-01 retry em timeout e depois sucesso', async () => {
  const r = await client(createScriptedProvider([new LlmError('timeout', 't'), okJson({ intent: 'docs', reason: 'ok r' })])).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.success, true); assert.equal(r.call.attempts, 2); assert.equal(r.call.retries, 1);
  assert.equal(sleeps.at(-1), 250);
});
test('LLM-01 429 duas vezes com backoff 250 e 500', async () => {
  sleeps.length = 0;
  const r = await client(createScriptedProvider([new LlmError('rate_limit', 'x'), new LlmError('rate_limit', 'x'), okJson({ intent: 'docs', reason: 'ok r' })])).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.call.attempts, 3); assert.deepEqual(sleeps, [250, 500]);
});
test('LLM-02 primário esgota e o fallback responde', async () => {
  const p = createScriptedProvider([(q) => q.model === 'm-primary' ? new LlmError('server_error', 'x') : okJson({ intent: 'data', reason: 'ok r' })]);
  const r = await client(p).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.success && r.call.fallbackUsed, true); assert.equal(r.call.model, 'm-fallback');
  assert.equal(r.call.attempts, 4); assert.equal(r.call.retries, 2);
});
test('400 no primário não repete e vai ao fallback uma vez', async () => {
  const p = createScriptedProvider([(q) => q.model === 'm-primary' ? new LlmError('bad_request', 'x') : okJson({ intent: 'data', reason: 'ok r' })]);
  const r = await client(p).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.call.attempts, 2); assert.equal(r.call.retries, 0); assert.equal(r.call.fallbackUsed, true);
});
test('LLM-03 todos fora lança LlmUnavailableError e grava a falha', async () => {
  await assert.rejects(client(createScriptedProvider([new LlmError('server_error', 'x')])).generateStructured(routerDef, { question: 'q' }, ctx()), LlmUnavailableError);
  assert.equal(ledger.callsFor('r-12345678').at(-1)?.ok, false);
});
test('LLM-07 truncated não repete nem usa fallback', async () => {
  const p = createScriptedProvider([new LlmError('truncated', 'len')]);
  const r = await client(p).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.success, false); assert.equal(!r.success && r.error.kind, 'truncated'); assert.equal(p.calls.length, 1);
});
test('parse inválido gera 1 retry com o erro anexado e não consome budget extra', async () => {
  const p = createScriptedProvider([okJson({ intent: 'x' }), okJson({ intent: 'docs', reason: 'ok r' })]);
  const c = ctx(); const r = await client(p).generateStructured(routerDef, { question: 'q' }, c);
  assert.equal(r.success && r.call.parseRetried, true); assert.equal(c.budget.used, 1);
  assert.match(p.calls[1]!.messages[1]!.content, /did not validate/);
});
test('LLM-06 budget de 1 recusa a segunda execução', async () => {
  const c = ctx(1); const cl = client(createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' })]));
  await cl.generateStructured(routerDef, { question: 'q' }, c);
  await assert.rejects(cl.generateStructured(routerDef, { question: 'q' }, c), BudgetExceededError);
});
test('LLM-04 ledger registra prompt, versão, modelo, tentativas, tokens e custo', async () => {
  await client(createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' }, { usage: { promptTokens: 1000, completionTokens: 100, estimated: false } })]), { models: { primary: 'fake/primary', fallback: 'fake/fallback', guardrail: 'fake/guardrail' } })
    .generateStructured(routerDef, { question: 'q' }, { ...ctx(), requestId: 'r-ledger01' });
  const row = ledger.callsFor('r-ledger01')[0]!;
  assert.equal(row.promptId, 'router'); assert.equal(row.promptVersion, 'v1'); assert.equal(row.model, 'fake/primary');
  assert.equal(row.costIsFictional, true); assert.ok(row.costUsd! > 0);
});
test('abort da requisição durante o backoff lança AskAbortedError', async () => {
  const ac = new AbortController();
  const p = createScriptedProvider([() => { ac.abort(); return new LlmError('timeout', 't'); }]);
  await assert.rejects(client(p, { sleep: defaultSleep }).generateStructured(routerDef, { question: 'q' }, { ...ctx(), signal: ac.signal }), AskAbortedError);
});
test('modo json_object descreve o schema na mensagem de sistema', async () => {
  const p = createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' })]);
  await client(p, { structuredMode: 'json_object' }).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.match(p.calls[0]!.messages[0]!.content, /"additionalProperties":\s*false/);
});

// Complementos
test('LLM-02 auth no primário vai ao fallback uma vez; fallback nulo não tenta outro modelo', async () => {
  const p = createScriptedProvider([(q) => q.model === 'm-primary' ? new LlmError('auth', 'x') : okJson({ intent: 'data', reason: 'ok r' })]);
  const r = await client(p).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.call.attempts, 2); assert.equal(r.call.fallbackUsed, true);
  const solo = createScriptedProvider([new LlmError('bad_request', 'x')]);
  await assert.rejects(client(solo, { models: { primary: 'm-primary', fallback: null, guardrail: 'm-guard' } }).generateStructured(routerDef, { question: 'q' }, ctx()), LlmUnavailableError);
  assert.deepEqual(solo.calls.map((c) => c.model), ['m-primary']);
});
test('LLM-01 todos fora faz 3 tentativas por modelo com backoff 250, 500 em cada um', async () => {
  sleeps.length = 0;
  const p = createScriptedProvider([new LlmError('server_error', 'x')]);
  await assert.rejects(client(p).generateStructured(routerDef, { question: 'q' }, { ...ctx(), requestId: 'r-alldown1' }), (e: unknown) => e instanceof LlmUnavailableError && e.lastKind === 'server_error');
  assert.deepEqual(p.calls.map((c) => c.model), ['m-primary', 'm-primary', 'm-primary', 'm-fallback', 'm-fallback', 'm-fallback']);
  assert.deepEqual(sleeps, [250, 500, 250, 500]);
  const row = ledger.callsFor('r-alldown1').at(-1)!;
  assert.equal(row.errorKind, 'llm_unavailable'); assert.equal(row.attempts, 6); assert.equal(row.retries, 4);
});
test('jitter de ±20% pelo random injetado', async () => {
  sleeps.length = 0;
  await client(createScriptedProvider([new LlmError('timeout', 't'), okJson({ intent: 'docs', reason: 'ok r' })]), { random: () => 0 }).generateStructured(routerDef, { question: 'q' }, ctx());
  await client(createScriptedProvider([new LlmError('timeout', 't'), okJson({ intent: 'docs', reason: 'ok r' })]), { random: () => 0.999999 }).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.deepEqual(sleeps, [200, 300]);
});
test('FixtureMissingError propaga sem retry nem fallback e fica no ledger', async () => {
  const p: LlmProvider & { n: number } = { name: 'scripted', n: 0, async chat() { this.n++; throw new FixtureMissingError('router', 'v1', 'q'); } };
  await assert.rejects(client(p).generateStructured(routerDef, { question: 'q' }, { ...ctx(), requestId: 'r-fixture1' }), FixtureMissingError);
  assert.equal(p.n, 1);
  assert.equal(ledger.callsFor('r-fixture1')[0]!.errorKind, 'fixture_missing');
});
test('parse falha duas vezes: Result com ParseError, ledger com errorKind parse e tokens somados', async () => {
  const p = createScriptedProvider([okText('não é json')]);
  const r = await client(p).generateStructured(routerDef, { question: 'q' }, { ...ctx(), requestId: 'r-parse001' });
  assert.equal(r.success, false);
  assert.equal(!r.success && r.error.kind, 'parse');
  assert.equal(r.call.attempts, 2); assert.equal(r.call.parseRetried, true);
  assert.equal(r.call.promptTokens, 20); assert.equal(r.call.completionTokens, 10);
  assert.match(p.calls[1]!.messages[1]!.content, /JSON/);
  const row = ledger.callsFor('r-parse001')[0]!;
  assert.equal(row.ok, false); assert.equal(row.errorKind, 'parse');
});
test('JSON dentro de cerca Markdown é aceito', async () => {
  const r = await client(createScriptedProvider([okText('```json\n{"intent":"docs","reason":"ok r"}\n```')])).generateStructured(routerDef, { question: 'q' }, ctx());
  assert.equal(r.success && r.data.intent, 'docs');
});
test('pedido leva temperatura, maxTokens, meta com a chave normalizada e responseFormat nomeado pelo prompt', async () => {
  const p = createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' })]);
  await client(p).generateStructured(routerDef, { question: 'Qual É o Prazo?' }, ctx());
  const q = p.calls[0]!;
  assert.equal(q.temperature, 0); assert.equal(q.maxTokens, 200);
  assert.deepEqual(q.meta, { promptId: 'router', promptVersion: 'v1', fixtureKey: 'qual e o prazo', requestId: 'r-12345678' });
  assert.equal(q.responseFormat?.name, 'router');
  assert.equal(q.messages[0]!.role, 'system'); assert.equal(JSON.parse(q.messages[0]!.content).meta.id, 'router');
  assert.equal(q.messages[1]!.content, 'Pergunta: Qual É o Prazo?');
});
test('generateText devolve texto aparado e prompt guardrail usa só o modelo de segurança', async () => {
  const safeguard: PromptDef<{ question: string }, null> = { ...routerDef, id: 'safeguard', system: { ...routerDef.system, meta: { ...routerDef.system.meta, id: 'safeguard' } },
    schema: null, modelRole: 'guardrail' };
  const p = createScriptedProvider([new LlmError('server_error', 'x')]);
  await assert.rejects(client(p).generateText(safeguard, { question: 'q' }, ctx()), LlmUnavailableError);
  assert.deepEqual([...new Set(p.calls.map((c) => c.model))], ['m-guard']);
  const ok = createScriptedProvider([okText('  SAFE \n')]);
  const r = await client(ok).generateText(safeguard, { question: 'q' }, ctx());
  assert.equal(r.success && r.data, 'SAFE');
  assert.equal(ok.calls[0]!.responseFormat, undefined);
});
test('modelo sem preço dá custo nulo; budget conta mesmo quando a execução falha', async () => {
  const c = ctx(2);
  const r = await client(createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' })])).generateStructured(routerDef, { question: 'q' }, c);
  assert.equal(r.call.costUsd, null);
  await client(createScriptedProvider([new LlmError('truncated', 'x')])).generateStructured(routerDef, { question: 'q' }, c);
  assert.equal(c.budget.used, 2);
  assert.throws(() => c.budget.consume('router'), (e: unknown) => e instanceof BudgetExceededError && e.max === 2);
});
test('defaultSleep resolve sem sinal abortado e rejeita com AskAbortedError se abortar', async () => {
  await defaultSleep(1, new AbortController().signal);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(defaultSleep(10_000, ac.signal), AskAbortedError);
  const ac2 = new AbortController(); setTimeout(() => ac2.abort(), 5);
  await assert.rejects(defaultSleep(10_000, ac2.signal), AskAbortedError);
});
test('sinal da requisição já abortado: AskAbortedError sem consumir budget', async () => {
  const ac = new AbortController(); ac.abort(); const c = { ...ctx(), signal: ac.signal };
  await assert.rejects(client(createScriptedProvider([okJson({ intent: 'docs', reason: 'ok r' })])).generateStructured(routerDef, { question: 'q' }, c), AskAbortedError);
  assert.equal(c.budget.used, 0);
});
