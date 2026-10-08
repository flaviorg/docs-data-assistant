// Teste live (fora do npm test): só roda com OPENROUTER_API_KEY e confere estrutura, não texto livre do modelo.
// npm run test:live (lê .env se existir). Sem chave, os testes aparecem como skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppContext } from '../../src/app-context.ts';
import { loadConfig } from '../../src/config.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { AskResponseSchema } from '../../src/domain/schemas.ts';
import { createLogger } from '../../src/obs/logger.ts';

const skip = !process.env.OPENROUTER_API_KEY;

async function liveContext() {
  const config = loadConfig({ overrides: { LLM_PROVIDER: 'openrouter' } });
  return createAppContext(config, { dataMode: 'memory', logger: createLogger({ level: 'warn' }) });
}

test('LIVE cenário 1 (docs) devolve AskResponse válida com o provedor openrouter', { skip, timeout: 120_000 }, async () => {
  const ctx = await liveContext();
  try {
    const r = await ctx.askService.ask({ question: DEMO_SCENARIOS[0]!.question });
    assert.ok(r.ok, JSON.stringify(r));
    const body = AskResponseSchema.parse(r.response);
    assert.equal(body.meta.provider, 'openrouter'); assert.ok(body.meta.llmCalls >= 1);
    assert.ok(['answered', 'refused', 'blocked'].includes(body.status));
    if (body.status === 'answered') assert.ok(body.citations.length >= 1);
  } finally {
    ctx.close();
  }
});

test('LIVE cenário 3 (data) devolve AskResponse válida e, se respondida, com o bloco SQL', { skip, timeout: 120_000 }, async () => {
  const ctx = await liveContext();
  try {
    const r = await ctx.askService.ask({ question: DEMO_SCENARIOS[2]!.question });
    assert.ok(r.ok, JSON.stringify(r));
    const body = AskResponseSchema.parse(r.response);
    assert.equal(body.meta.provider, 'openrouter');
    if (body.route === 'data' && body.status === 'answered') {
      assert.ok(body.sql && body.sql.columns.length > 0 && body.sql.rowCount > 0);
      assert.ok(body.followUpQuestions.length >= 1 && body.followUpQuestions.length <= 3);
    }
  } finally {
    ctx.close();
  }
});
