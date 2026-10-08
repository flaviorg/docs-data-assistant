import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createOpenRouterProvider } from '../../src/llm/openrouter-provider.ts';
import { LlmError } from '../../src/domain/errors.ts';
import { RagAnswerOutputSchema, RouterOutputSchema, SqlAnswerOutputSchema, SqlCorrectionOutputSchema, SqlGenerationOutputSchema } from '../../src/domain/schemas.ts';
import type { ProviderRequest } from '../../src/llm/provider.ts';

// Sem rede: o fetch é sempre injetado. Este host nunca é resolvido.
const BASE = 'https://openrouter.example/api/v1';
const req: ProviderRequest = {
  model: 'openai/gpt-oss-120b', temperature: 0.2, maxTokens: 321,
  messages: [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'pergunta' }],
  responseFormat: { name: 'router', jsonSchema: z.toJSONSchema(RouterOutputSchema) as Record<string, unknown> },
  meta: { promptId: 'router', promptVersion: 'v1', fixtureKey: 'pergunta' },
};
const signal = () => new AbortController().signal;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const respond = (status: number, body: unknown): typeof fetch => (async () => json(status, body)) as typeof fetch;
const okBodyRaw = (content: string | null, finish: string, usage: unknown = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) => ({
  id: 'gen-1', object: 'chat.completion', created: 1, model: 'openai/gpt-oss-120b',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage,
});
const okBody = (content: string, finish: string) => json(200, okBodyRaw(content, finish));
const capture = (seen: { url: string; init: RequestInit }[], response: Response): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init: init ?? {} }); return response; }) as typeof fetch;
const hangUntilAbort: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
})) as typeof fetch;

test('LLM-01 mapeia status HTTP para LlmErrorKind', async () => {
  for (const [status, kind] of [[429, 'rate_limit'], [500, 'server_error'], [503, 'server_error'], [401, 'auth'], [400, 'bad_request']] as const) {
    const p = createOpenRouterProvider({ apiKey: 'sk-test', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(status, { error: { message: 'x' } }) });
    await assert.rejects(p.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === kind);
  }
});
test('envia response_format strict sem $schema, max_tokens e Authorization', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const p = createOpenRouterProvider({ apiKey: 'sk-test', baseUrl: BASE, structuredMode: 'json_schema', fetch: capture(seen, okBody('{"intent":"docs","reason":"r"}', 'stop')) });
  const r = await p.chat(req, signal());
  const body = JSON.parse(String(seen[0]!.init.body));
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal('$schema' in body.response_format.json_schema.schema, false);
  assert.equal(body.max_tokens, req.maxTokens);
  assert.match(seen[0]!.url, /\/chat\/completions$/);
  assert.equal(new Headers(seen[0]!.init.headers).get('authorization'), 'Bearer sk-test');
  assert.deepEqual(r.usage, { promptTokens: 10, completionTokens: 5, estimated: false });
});
test('LLM-07 finish_reason length vira truncated', async () => {
  const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(200, okBodyRaw('{"intent":', 'length')) });
  await assert.rejects(p.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === 'truncated');
});
test('timeout e abort viram timeout', async () => {
  const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: hangUntilAbort });
  await assert.rejects(p.chat(req, AbortSignal.timeout(30)), (e: unknown) => e instanceof LlmError && e.kind === 'timeout');
});

// Complementos
test('403, 404 e 422 mapeados; erro de conexão vira server_error', async () => {
  for (const [status, kind] of [[403, 'auth'], [404, 'bad_request'], [422, 'bad_request'], [502, 'server_error']] as const) {
    const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(status, { error: { message: 'x' } }) });
    await assert.rejects(p.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === kind, String(status));
  }
  const refused = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: refused });
  await assert.rejects(p.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === 'server_error');
});
test('modo json_object envia type json_object; prompt de texto não envia response_format', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_object', fetch: capture(seen, okBody('{"intent":"docs","reason":"r"}', 'stop')) });
  await p.chat(req, signal());
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)).response_format, { type: 'json_object' });
  const seen2: { url: string; init: RequestInit }[] = [];
  const t = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: capture(seen2, okBody('SAFE', 'stop')) });
  const { responseFormat: _omit, ...textReq } = req;
  const r = await t.chat(textReq, signal());
  const body = JSON.parse(String(seen2[0]!.init.body));
  assert.equal('response_format' in body, false);
  assert.equal(body.model, 'openai/gpt-oss-120b'); assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.messages, req.messages);
  assert.equal(r.content, 'SAFE'); assert.equal(r.finishReason, 'stop'); assert.equal(r.model, 'openai/gpt-oss-120b');
});
test('conteúdo vazio vira bad_request; usage ausente é estimado', async () => {
  const empty = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(200, okBodyRaw('', 'stop')) });
  await assert.rejects(empty.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === 'bad_request');
  const nul = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(200, okBodyRaw(null, 'stop')) });
  await assert.rejects(nul.chat(req, signal()), (e: unknown) => e instanceof LlmError && e.kind === 'bad_request');
  const noUsage = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: respond(200, okBodyRaw('{"a":1}', 'stop', null)) });
  const r = await noUsage.chat(req, signal());
  assert.equal(r.usage.estimated, true); assert.equal(r.usage.completionTokens, 2);
});
test('sinal já abortado vira timeout sem chamar o fetch', async () => {
  const ac = new AbortController(); ac.abort();
  let called = 0;
  const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: (async () => { called++; return okBody('{}', 'stop'); }) as typeof fetch });
  await assert.rejects(p.chat(req, ac.signal), (e: unknown) => e instanceof LlmError && e.kind === 'timeout');
  assert.equal(called, 0);
  assert.equal(p.name, 'openrouter');
});

test('modo strict não envia minLength nem maxLength (fora do subconjunto do json_schema strict); limites de lista e o Zod ficam', async () => {
  for (const [name, schema] of [['router', RouterOutputSchema], ['rag-answer', RagAnswerOutputSchema], ['sql-generate', SqlGenerationOutputSchema],
    ['sql-correct', SqlCorrectionOutputSchema], ['sql-answer', SqlAnswerOutputSchema]] as const) {
    const seen: { url: string; init: RequestInit }[] = [];
    const p = createOpenRouterProvider({ apiKey: 'k', baseUrl: BASE, structuredMode: 'json_schema', fetch: capture(seen, okBody('{}', 'stop')) });
    const original = z.toJSONSchema(schema) as Record<string, unknown>;
    await p.chat({ ...req, responseFormat: { name, jsonSchema: original } }, signal());
    const sent = JSON.stringify(JSON.parse(String(seen[0]!.init.body)).response_format.json_schema.schema);
    assert.doesNotMatch(sent, /"(minLength|maxLength)"/, name);
    assert.match(JSON.stringify(original), /"maxLength"/, `${name}: o schema original continua com os limites`);
    if (name === 'sql-answer') assert.match(sent, /"minItems":1,"maxItems":3/);
  }
});
