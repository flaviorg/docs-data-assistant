import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../helpers/context.ts';
import { throwsTypeErrorProvider, waitsForAbortProvider } from '../helpers/providers.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { AskResponseSchema, ErrorBodySchema, REQUEST_ID_PATTERN } from '../../src/domain/schemas.ts';
import type { AskResponse } from '../../src/domain/schemas.ts';
import type { AskOutcome } from '../../src/ask-service.ts';

const [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12] = DEMO_SCENARIOS.map((s) => s.question);
const ok = (r: AskOutcome): AskResponse => { assert.ok(r.ok, JSON.stringify(r)); return r.response; };

test('LLM-05 pergunta sem fixture dá 422 com sugestões', async () => {
  const r = await (await createTestContext()).askService.ask({ question: 'pergunta que não existe em fixture nenhuma' });
  assert.equal(!r.ok && r.httpStatus, 422); assert.ok(!r.ok && r.body.suggestions!.length > 0);
});
test('LLM-03 all-down dá 503 com requestId', async () => {
  const r = await (await createTestContext({ LLM_FAKE_CHAOS: 'all-down' })).askService.ask({ question: Q1 });
  assert.equal(!r.ok && r.httpStatus, 503); assert.ok(!r.ok && r.body.requestId);
});
test('API-02 timeout da requisição dá 504', async () => {
  const ctx = await createTestContext({ ASK_TIMEOUT_MS: '50' }, { provider: waitsForAbortProvider() });
  const r = await ctx.askService.ask({ question: Q1 }); assert.equal(!r.ok && r.httpStatus, 504);
});
test('erro inesperado dá 500 sem stack no corpo', async () => {
  const ctx = await createTestContext({}, { provider: throwsTypeErrorProvider() });
  const r = await ctx.askService.ask({ question: Q1 });
  assert.equal(!r.ok && r.httpStatus, 500); assert.doesNotMatch(JSON.stringify(!r.ok && r.body), /at .*\.ts/);
});
test('OBS-02 requestId trocado gera aviso', async () => {
  const r = await (await createTestContext()).askService.ask({ question: Q1 }, { requestId: 'gen-00000001', requestIdReplaced: true });
  assert.ok(r.ok && r.response.warnings.includes('request_id_replaced') && r.response.requestId === 'gen-00000001');
});
test('duas perguntas concorrentes têm budget e requestId independentes', async () => {
  const ctx = await createTestContext();
  const [a, b] = await Promise.all([ctx.askService.ask({ question: Q1 }), ctx.askService.ask({ question: Q4 })]);
  assert.ok(a.ok && b.ok); assert.notEqual(a.response.requestId, b.response.requestId);
  assert.equal(ctx.ledger.callsFor(a.response.requestId).length, 2);
  assert.equal(ctx.ledger.callsFor(b.response.requestId).length, 4);
  for (const r of [a, b]) { assert.equal(AskResponseSchema.safeParse(r.response).success, true); assert.ok(!r.response.warnings.includes('llm_budget_exceeded')); }
});

// Complementos
test('API-01 corpo inválido dá 400 com as issues do Zod e o requestId', async () => {
  const ctx = await createTestContext();
  for (const body of [{}, { question: '  ' }, { question: 'ok ok', extra: 1 }, { question: 'x'.repeat(501) }, 'texto', null]) {
    const r = await ctx.askService.ask(body);
    assert.equal(!r.ok && r.httpStatus, 400, JSON.stringify(body));
    assert.ok(!r.ok && Array.isArray(r.body.issues) && r.body.issues.length > 0);
    assert.equal(ErrorBodySchema.safeParse(!r.ok && r.body).success, true);
    assert.match(!r.ok ? r.body.requestId : '', REQUEST_ID_PATTERN);
  }
});
test('API-03 os 12 cenários dos chips viram AskResponse válida, com rota, status e bloqueio esperados', async () => {
  const ctx = await createTestContext();
  for (const sc of DEMO_SCENARIOS.filter((s) => s.id <= 12)) {
    const resp = ok(await ctx.askService.ask({ question: sc.question }));
    assert.equal(AskResponseSchema.safeParse(resp).success, true, `cenário ${sc.id}`);
    assert.deepEqual([resp.route, resp.status, resp.blockedBy], [sc.expected.route, sc.expected.status, sc.expected.blockedBy ?? null], `cenário ${sc.id}`);
  }
});
test('resposta do cenário 1: citações com título, seção, score, trecho de até 240 caracteres e meta do ledger', async () => {
  const ctx = await createTestContext();
  const r = ok(await ctx.askService.ask({ question: Q1 }));
  assert.equal(r.citations.length, 2);
  for (const c of r.citations) {
    assert.ok(c.docTitle.length > 0 && c.heading.length > 0 && c.score > 0 && c.snippet.length > 0 && c.snippet.length <= 240);
    assert.equal(c.sanitized, false);
  }
  assert.equal(r.sql, null); assert.equal(r.routeReason?.length !== undefined, true);
  assert.deepEqual(r.meta.models, ['fake/primary']);
  assert.equal(r.meta.llmCalls, 2); assert.equal(r.meta.provider, 'fake'); assert.equal(r.meta.fallbackUsed, false);
  assert.equal(r.meta.costIsFictional, true); assert.ok(r.meta.costUsd! > 0);
  assert.equal(r.meta.tokens.estimated, true); assert.ok(r.meta.tokens.prompt > 0 && r.meta.tokens.completion > 0);
  assert.equal(r.meta.embedder, ctx.embedder.fingerprint);
  assert.deepEqual(r.meta.trace.map((t) => t.node), ['guardrailInput', 'router', 'retrieve', 'ragAnswer', 'checkCitations', 'finalize']);
  assert.match(r.requestId, REQUEST_ID_PATTERN);
});
test('resposta do cenário 9 marca a citação sanitizada e o aviso do chunk neutralizado', async () => {
  const r = ok(await (await createTestContext()).askService.ask({ question: Q9 }));
  assert.ok(r.citations.some((c) => c.sanitized));
  assert.ok(r.warnings.some((w) => w.startsWith('chunk_neutralized:')));
});
test('resposta dos cenários 4, 5, 6 e 11 traz o bloco sql com correções, lastError e linhas', async () => {
  const ctx = await createTestContext();
  const r4 = ok(await ctx.askService.ask({ question: Q4 }));
  assert.equal(r4.sql!.corrections, 1); assert.match(r4.sql!.originalQuery!, /quantidade/); assert.equal(r4.sql!.lastError, null);
  assert.equal(r4.sql!.rowCount, 5); assert.equal(r4.sql!.rows.length, 5); assert.equal(r4.sql!.limitApplied, false);
  assert.deepEqual(r4.citations, []);
  const r5 = ok(await ctx.askService.ask({ question: Q5 }));
  assert.equal(r5.sql!.corrections, 3); assert.match(r5.sql!.lastError!, /no such table/); assert.equal(r5.sql!.rowCount, 0);
  const r6 = ok(await ctx.askService.ask({ question: Q6 }));
  assert.deepEqual(r6.sql!.rows, [[null]]); assert.equal(r6.sql!.limitApplied, true);
  const r11 = ok(await ctx.askService.ask({ question: Q11 }));
  assert.match(r11.sql!.query, /^DELETE/); assert.match(r11.sql!.lastError!, /SELECT ou WITH/); assert.deepEqual(r11.sql!.rows, []);
  const r3 = ok(await ctx.askService.ask({ question: Q3 }));
  assert.equal(r3.sql!.rowCount, 3); assert.equal(r3.followUpQuestions.length, 3);
});
test('API-03 a API devolve no máximo 50 linhas e rowCount conta as linhas lidas', async () => {
  const r = ok(await (await createTestContext({ SQL_MAX_ROWS: '120' })).askService.ask({ question: Q3 }));
  assert.ok(r.sql!.rows.length <= 50);
  assert.equal(r.sql!.rowCount, 3);
});
test('cenários sem LLM: bloqueio de entrada sem rota; fora do escopo com rota e motivo', async () => {
  const ctx = await createTestContext();
  const r8 = ok(await ctx.askService.ask({ question: Q8 }));
  assert.deepEqual([r8.route, r8.routeReason, r8.overridden, r8.meta.llmCalls, r8.meta.costUsd], [null, null, false, 0, 0]);
  assert.deepEqual(r8.guardrail.layer, 'rules'); assert.equal(r8.guardrail.verdict, 'unsafe');
  const r7 = ok(await ctx.askService.ask({ question: Q7 }));
  assert.equal(r7.route, 'out_of_scope'); assert.ok(r7.routeReason!.length >= 3); assert.equal(r7.meta.llmCalls, 1);
  const r2 = ok(await ctx.askService.ask({ question: Q2 }));
  assert.equal(r2.status, 'refused'); assert.deepEqual(r2.citations, []);
});
test('forceRoute passa pela borda e grava overridden', async () => {
  const r = ok(await (await createTestContext()).askService.ask({ question: Q3, forceRoute: 'data' }));
  assert.equal(r.overridden, true); assert.equal(r.routeReason, 'forceRoute'); assert.equal(r.meta.llmCalls, 2);
});
test('OBS-02 requestId válido é mantido; inválido é trocado com aviso; ausente é gerado sem aviso', async () => {
  const ctx = await createTestContext();
  const kept = ok(await ctx.askService.ask({ question: Q1 }, { requestId: 'abc-12345' }));
  assert.equal(kept.requestId, 'abc-12345'); assert.equal(kept.warnings.includes('request_id_replaced'), false);
  const replaced = ok(await ctx.askService.ask({ question: Q1 }, { requestId: 'abc' }));
  assert.notEqual(replaced.requestId, 'abc'); assert.ok(replaced.warnings.includes('request_id_replaced'));
  const generated = ok(await ctx.askService.ask({ question: Q1 }));
  assert.equal(generated.warnings.includes('request_id_replaced'), false);
});
test('cada pergunta grava uma linha em requests, inclusive os erros HTTP', async () => {
  const ctx = await createTestContext();
  await ctx.askService.ask({ question: Q1 });
  await ctx.askService.ask({ question: Q10 });
  await ctx.askService.ask({ question: 'pergunta sem fixture nenhuma aqui' });
  await ctx.askService.ask({});
  const s = ctx.ledger.stats(60_000);
  assert.equal(s.requests.total, 4);
  assert.deepEqual(s.requests.byStatus, { answered: 1, blocked: 1, none: 2 });
  assert.equal(s.llm.calls, 2 + 2 + 1);
});
test('includeState devolve o estado final do grafo junto da resposta', async () => {
  const r = await (await createTestContext()).askService.ask({ question: Q12 }, { includeState: true });
  assert.ok(r.ok && r.state?.sql?.pendingError?.kind === 'policy');
});
test('estado de caos não é compartilhado: primary-timeout-once vale para cada pergunta', async () => {
  const ctx = await createTestContext({ LLM_FAKE_CHAOS: 'primary-timeout-once' });
  const [a, b] = await Promise.all([ctx.askService.ask({ question: Q1 }), ctx.askService.ask({ question: Q9 })]);
  for (const r of [ok(a), ok(b)]) {
    const calls = ctx.ledger.callsFor(r.requestId);
    assert.deepEqual(calls.map((c) => c.attempts), [2, 1]);
  }
});
test('os logs da pergunta vão para o logger com requestId e a pergunta cortada', async () => {
  const lines: string[] = [];
  const { createAppContext } = await import('../../src/app-context.ts');
  const { loadConfig } = await import('../../src/config.ts');
  const { createLogger } = await import('../../src/obs/logger.ts');
  const ctx = await createAppContext(loadConfig({ env: {} }), { dataMode: 'memory', sleep: async () => {}, logger: createLogger({ level: 'info', sink: (l) => lines.push(l) }) });
  const r = ok(await ctx.askService.ask({ question: Q1 }));
  const rec = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === 'ask');
  assert.equal(rec?.requestId, r.requestId); assert.equal(rec?.status, 'answered'); assert.equal(rec?.question, Q1);
  ctx.close();
});
test('composição com LLM_PROVIDER=openrouter: modelos do config, rules+model por padrão e custo real (sem rede: provider injetado)', async () => {
  const { createAppContext } = await import('../../src/app-context.ts');
  const { loadConfig } = await import('../../src/config.ts');
  const { createLogger } = await import('../../src/obs/logger.ts');
  const { scriptedByPrompt, okText } = await import('../helpers/providers.ts');
  const p = scriptedByPrompt({ safeguard: okText('SAFE') });
  const config = loadConfig({ env: {}, overrides: { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-teste-falso' } });
  assert.equal(config.guardrailMode, 'rules+model');
  const ctx = await createAppContext(config, { dataMode: 'memory', provider: p, sleep: async () => {}, logger: createLogger({ level: 'error', sink: () => {} }) });
  assert.equal(ctx.fixtures, null);
  const r = ok(await ctx.askService.ask({ question: Q1 }));
  assert.equal(r.status, 'answered');
  assert.deepEqual(p.calls.map((c) => [c.meta.promptId, c.model]), [
    ['safeguard', 'openai/gpt-oss-safeguard-20b'], ['router', 'openai/gpt-oss-120b'], ['rag-answer', 'openai/gpt-oss-120b']]);
  assert.equal(r.meta.costIsFictional, false); assert.ok(r.meta.costUsd !== null && r.meta.costUsd > 0);
  assert.equal(r.meta.llmCalls, 3);
  ctx.close();
});
