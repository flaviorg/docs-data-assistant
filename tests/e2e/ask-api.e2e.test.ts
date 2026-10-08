import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InjectOptions } from 'fastify';
import { createTestContext } from '../helpers/context.ts';
import { okJson, scriptedByPrompt, waitsForAbortProvider } from '../helpers/providers.ts';
import { createServer } from '../../src/server.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { AskResponseSchema, ErrorBodySchema, REQUEST_ID_PATTERN } from '../../src/domain/schemas.ts';

const Q1 = DEMO_SCENARIOS[0]!.question;
const app = async (overrides: Record<string, string> = {}) => createServer(await createTestContext(overrides));

test('API-03 os 12 cenários dos chips devolvem 200 e corpo válido', async () => {
  const a = await app();
  for (const s of DEMO_SCENARIOS.filter((x) => x.id <= 12)) {
    const r = await a.inject({ method: 'POST', url: '/ask', payload: { question: s.question } });
    assert.equal(r.statusCode, 200, s.label);
    const body = AskResponseSchema.parse(r.json());
    assert.equal(body.status, s.expected.status, s.label);
    assert.equal(r.headers['x-request-id'], body.requestId, s.label);
  }
});

test('API-01 corpo inválido dá 400 com issues', async () => {
  const r = await (await app()).inject({ method: 'POST', url: '/ask', payload: { question: 'a', extra: 1 } });
  assert.equal(r.statusCode, 400); assert.ok(Array.isArray(r.json().issues));
  assert.equal(ErrorBodySchema.safeParse(r.json()).success, true);
});

test('API-04 JSON malformado, corpo vazio, XML e rota inexistente seguem o contrato', async () => {
  const a = await app();
  const cases: [Partial<InjectOptions>, number, string][] = [
    [{ payload: '{', headers: { 'content-type': 'application/json' } }, 400, 'bad_request'],
    [{ payload: '', headers: { 'content-type': 'application/json' } }, 400, 'bad_request'],
    [{ payload: '<a/>', headers: { 'content-type': 'application/xml' } }, 415, 'unsupported_media_type'],
  ];
  for (const [opts, status, error] of cases) {
    const r = await a.inject({ method: 'POST', url: '/ask', ...opts } as InjectOptions);
    assert.equal(r.statusCode, status); assert.equal(ErrorBodySchema.safeParse(r.json()).success, true);
    assert.equal(r.json().error, error); assert.ok(r.headers['x-request-id']);
    assert.equal(r.json().requestId, r.headers['x-request-id']);
  }
  const nf = await a.inject({ method: 'GET', url: '/nada' });
  assert.equal(nf.statusCode, 404); assert.equal(nf.json().error, 'not_found'); assert.ok(nf.headers['x-request-id']);
  assert.equal(ErrorBodySchema.safeParse(nf.json()).success, true);
});

test('LLM-05 pergunta sem fixture dá 422 com suggestions; LLM-03 all-down dá 503; API-02 timeout dá 504', async () => {
  const missing = await (await app()).inject({ method: 'POST', url: '/ask', payload: { question: 'pergunta sem fixture alguma' } });
  assert.equal(missing.statusCode, 422); assert.equal(missing.json().error, 'fixture_missing');
  assert.equal(missing.json().suggestions.length, 12);

  const down = await (await app({ LLM_FAKE_CHAOS: 'all-down' })).inject({ method: 'POST', url: '/ask', payload: { question: Q1 } });
  assert.equal(down.statusCode, 503); assert.equal(down.json().error, 'llm_unavailable');

  const slow = createServer(await createTestContext({ ASK_TIMEOUT_MS: '50' }, { provider: waitsForAbortProvider() }));
  const timeout = await slow.inject({ method: 'POST', url: '/ask', payload: { question: Q1 } });
  assert.equal(timeout.statusCode, 504); assert.equal(timeout.json().error, 'timeout');

  for (const r of [missing, down, timeout]) {
    assert.equal(ErrorBodySchema.safeParse(r.json()).success, true);
    assert.match(String(r.headers['x-request-id']), REQUEST_ID_PATTERN);
    assert.equal(r.json().requestId, r.headers['x-request-id']);
  }
});

test('OBS-02 X-Request-Id ecoado quando válido, trocado quando inválido, gerado quando ausente', async () => {
  const a = await app();
  const ok = await a.inject({ method: 'POST', url: '/ask', payload: { question: Q1 }, headers: { 'x-request-id': 'abc-12345' } });
  assert.equal(ok.headers['x-request-id'], 'abc-12345'); assert.equal(ok.json().requestId, 'abc-12345');
  assert.equal(ok.json().warnings.includes('request_id_replaced'), false);
  const bad = await a.inject({ method: 'POST', url: '/ask', payload: { question: Q1 }, headers: { 'x-request-id': 'abc' } });
  assert.notEqual(bad.headers['x-request-id'], 'abc'); assert.ok(bad.json().warnings.includes('request_id_replaced'));
  assert.equal(bad.json().requestId, bad.headers['x-request-id']);
  const none = await a.inject({ method: 'POST', url: '/ask', payload: { question: Q1 } });
  assert.match(String(none.headers['x-request-id']), REQUEST_ID_PATTERN);
  assert.equal(none.json().warnings.includes('request_id_replaced'), false);
});

// Complementos
test('OBS-02 X-Request-Id também vale nas respostas de erro: ecoado no 404 e trocado no 400', async () => {
  const a = await app();
  const nf = await a.inject({ method: 'GET', url: '/nada', headers: { 'x-request-id': 'req-erro-0001' } });
  assert.equal(nf.headers['x-request-id'], 'req-erro-0001'); assert.equal(nf.json().requestId, 'req-erro-0001');
  const bad = await a.inject({ method: 'POST', url: '/ask', payload: '{', headers: { 'content-type': 'application/json', 'x-request-id': 'x y' } });
  assert.notEqual(bad.headers['x-request-id'], 'x y'); assert.match(String(bad.headers['x-request-id']), REQUEST_ID_PATTERN);
});

test('corpo acima de 16 KiB dá 413 com o corpo do contrato', async () => {
  const r = await (await app()).inject({ method: 'POST', url: '/ask', payload: { question: 'x'.repeat(17 * 1024) } });
  assert.equal(r.statusCode, 413); assert.equal(r.json().error, 'payload_too_large');
  assert.equal(ErrorBodySchema.safeParse(r.json()).success, true); assert.ok(r.headers['x-request-id']);
});

test('text/plain chega ao AskService como texto e dá 400 com issues', async () => {
  const r = await (await app()).inject({ method: 'POST', url: '/ask', payload: 'qual o prazo?', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.statusCode, 400); assert.ok(Array.isArray(r.json().issues));
});

test('RTE-02 forceRoute passa pela API e devolve overridden', async () => {
  const r = await (await app()).inject({ method: 'POST', url: '/ask', payload: { question: DEMO_SCENARIOS[2]!.question, forceRoute: 'data' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().overridden, true); assert.equal(r.json().route, 'data');
});

test('erro inesperado vira 500 sem stack no corpo', async () => {
  const { throwsTypeErrorProvider } = await import('../helpers/providers.ts');
  const a = createServer(await createTestContext({}, { provider: throwsTypeErrorProvider() }));
  const r = await a.inject({ method: 'POST', url: '/ask', payload: { question: Q1 } });
  assert.equal(r.statusCode, 500); assert.equal(r.json().error, 'internal');
  assert.doesNotMatch(r.body, /at .*\.ts/);
});

test('GET em /ask não existe (404) e método errado não vaza detalhe interno', async () => {
  const r = await (await app()).inject({ method: 'GET', url: '/ask' });
  assert.equal(r.statusCode, 404); assert.equal(r.json().error, 'not_found');
});

test('SQL-11 /health responde enquanto uma consulta pesada roda; a pergunta termina com sql_timeout', async () => {
  const heavy = 'SELECT COUNT(*) AS n FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1';
  const ctx = await createTestContext({ SQL_TIMEOUT_MS: '1500' }, { provider: scriptedByPrompt({ 'sql-generate': okJson({ sql: heavy, rationale: 'x' }) }) });
  const a = createServer(ctx);
  try {
    let askDone = false;
    const ask = a.inject({ method: 'POST', url: '/ask', payload: { question: 'Quantas combinações de três pedidos existem?', forceRoute: 'data' } })
      .then((r) => { askDone = true; return r; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const health = await a.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(askDone, false, '/health só respondeu depois da consulta');
    const r = await ask;
    assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'error'); assert.ok(r.json().warnings.includes('sql_timeout'));
  } finally {
    await a.close();
    ctx.close();
  }
});
