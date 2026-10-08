import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../helpers/context.ts';
import { CSP_HEADER, createServer } from '../../src/server.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';

test('WEB-01 página e arquivos com CSP exato, sem unsafe-inline', async () => {
  const a = createServer(await createTestContext());
  for (const [url, type] of [['/', /text\/html/], ['/app.js', /javascript/], ['/app.css', /text\/css/]] as const) {
    const r = await a.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200); assert.match(String(r.headers['content-type']), type);
    assert.equal(r.headers['content-security-policy'], CSP_HEADER);
    assert.doesNotMatch(String(r.headers['content-security-policy']), /unsafe-inline/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
  }
});

test('demo/questions lista 12 perguntas com desfecho; health tem contagens', async () => {
  const a = createServer(await createTestContext());
  const q = (await a.inject({ method: 'GET', url: '/demo/questions' })).json();
  assert.equal(q.questions.length, 12); assert.ok(q.questions.every((x: { expected: { status: string } }) => x.expected.status));
  const h = (await a.inject({ method: 'GET', url: '/health' })).json();
  assert.equal(h.kb.documents, 8); assert.ok(h.kb.flagged >= 1); assert.equal(h.sales.orders, 4000);
});

// Complementos
test('WEB-01 o CSP é o valor exato da spec 005', () => {
  assert.equal(CSP_HEADER, "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
});

test('demo/questions traz id, rótulo, pergunta e rota esperada na ordem dos cenários', async () => {
  const a = createServer(await createTestContext());
  const q = (await a.inject({ method: 'GET', url: '/demo/questions' })).json() as { questions: { id: number; label: string; question: string; expected: { route: string | null; status: string } }[] };
  assert.deepEqual(q.questions.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const x of q.questions) {
    const s = DEMO_SCENARIOS.find((d) => d.id === x.id)!;
    assert.deepEqual([x.label, x.question, x.expected.route, x.expected.status], [s.label, s.question, s.expected.route, s.expected.status]);
  }
});

test('health informa provedor, embedder com fingerprint e modelos do fake', async () => {
  const ctx = await createTestContext();
  const h = (await createServer(ctx).inject({ method: 'GET', url: '/health' })).json();
  assert.equal(h.ok, true); assert.equal(h.provider, 'fake'); assert.equal(h.embedder, ctx.embedder.fingerprint);
  assert.deepEqual(h.models, ['fake/primary', 'fake/fallback']); assert.equal(h.kb.chunks > 0, true);
});

test('a página referencia só app.js e app.css locais, com label no campo e região aria-live', async () => {
  const html = (await createServer(await createTestContext()).inject({ method: 'GET', url: '/' })).body;
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/app\.css">/);
  assert.match(html, /<label for="question"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /https?:\/\//);
});
