import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_RECORDED_CALLS, createFakeProvider } from '../../src/llm/fake-provider.ts';
import { loadFixtures } from '../../src/llm/fixtures.ts';
import { normalizeText } from '../../src/domain/normalize.ts';
import { FixtureMissingError, LlmError } from '../../src/domain/errors.ts';
import type { PromptId } from '../../src/prompts/prompt.ts';
import type { ProviderRequest } from '../../src/llm/provider.ts';
import { makeTempDir } from '../helpers/tmp.ts';

// Fixtures num diretório temporário escrito pelo teste.
function fixturesDir(): string {
  const dir = makeTempDir('dda');
  fs.writeFileSync(path.join(dir, 'router.v1.json'), JSON.stringify({ promptId: 'router', version: 'v1', entries: [
    { key: 'oi tudo bem', response: { intent: 'out_of_scope', reason: 'saudação sem pergunta' } },
    { key: 'qual e o prazo para devolver', response: { intent: 'docs', reason: 'política de trocas' }, usage: { promptTokens: 300, completionTokens: 20 } },
  ] }));
  fs.writeFileSync(path.join(dir, 'sql-correct.v1.json'), JSON.stringify({ promptId: 'sql-correct', version: 'v1', entries: [
    { key: 'pergunta x#1', response: { correctedSql: 'SELECT 1', fix: 'primeira' } },
    { key: 'pergunta x#2', response: { correctedSql: 'SELECT 2', fix: 'segunda' } },
  ] }));
  return dir;
}
const makeFake = () => createFakeProvider({ fixtures: loadFixtures(fixturesDir(), { activeEmbedderId: 'hash-v1' }) });
const req = (promptId: PromptId, key: string, model = 'fake/primary'): ProviderRequest => ({
  model, temperature: 0, maxTokens: 200,
  messages: [{ role: 'system', content: 'sistema' }, { role: 'user', content: `pergunta: ${key}` }],
  meta: { promptId, promptVersion: 'v1', fixtureKey: key },
});
const signal = new AbortController().signal;

test('LLM-05 chave desconhecida lança FixtureMissingError com promptId e chave', async () => {
  const fake = makeFake();
  await assert.rejects(fake.chat(req('router', 'pergunta inexistente'), signal),
    (e: unknown) => e instanceof FixtureMissingError && e.promptId === 'router' && e.key === 'pergunta inexistente'
      && /fixtures\/llm\/router\.v1\.json/.test(e.message));
});
test('variações de acento, caixa e pontuação caem na mesma chave', () => {
  assert.equal(normalizeText('Qual é o PRAZO, para devolver?'), normalizeText('qual e o prazo para devolver'));
});
test('sql-correct usa a tentativa na chave', async () => {
  const r = await makeFake().chat(req('sql-correct', 'pergunta x#2'), signal);
  assert.equal(JSON.parse(r.content).correctedSql, 'SELECT 2');
});
test('caos primary-down falha só no primário; all-down falha nos dois; timeout-once falha uma vez', async () => {
  const fake = makeFake();
  fake.setChaos('primary-down');
  await assert.rejects(fake.chat(req('router', 'oi tudo bem', 'fake/primary'), signal), (e: unknown) => e instanceof LlmError && e.kind === 'server_error');
  assert.ok(await fake.chat(req('router', 'oi tudo bem', 'fake/fallback'), signal));
  fake.setChaos('all-down');
  await assert.rejects(fake.chat(req('router', 'oi tudo bem', 'fake/fallback'), signal));
  fake.setChaos('primary-timeout-once');
  await assert.rejects(fake.chat(req('router', 'oi tudo bem', 'fake/primary'), signal), (e: unknown) => e instanceof LlmError && e.kind === 'timeout');
  assert.ok(await fake.chat(req('router', 'oi tudo bem', 'fake/primary'), signal));
});
test('registra calls e estima usage sem a chave usage', async () => {
  const fake = makeFake();
  const r = await fake.chat(req('router', 'oi tudo bem'), signal);
  assert.equal(r.usage.estimated, true);
  assert.equal(fake.calls.at(-1)?.promptId, 'router');
});

// Complementos
test('Review Focus 1: pergunta com acento, caixa e pontuação cai na fixture normalizada', async () => {
  const r = await makeFake().chat(req('router', normalizeText('Qual é o PRAZO, para devolver?')), signal);
  assert.deepEqual(JSON.parse(r.content), { intent: 'docs', reason: 'política de trocas' });
  assert.deepEqual(r.usage, { promptTokens: 300, completionTokens: 20, estimated: false });
  assert.equal(r.finishReason, 'stop');
});
test('normalizeText remove diacríticos, troca símbolos por espaço e colapsa', () => {
  assert.equal(normalizeText('  Devoluções — e-mail: R$ 199,00!  '), 'devolucoes e mail r 199 00');
  assert.equal(normalizeText('ÇÃO ñ ü'), 'cao n u');
  assert.equal(normalizeText('???'), '');
});
test('modelo da resposta é o pedido; calls guarda chave, modelo e mensagens', async () => {
  const fake = makeFake();
  const r = await fake.chat(req('router', 'oi tudo bem', 'fake/fallback'), signal);
  assert.equal(r.model, 'fake/fallback');
  assert.deepEqual(fake.calls.at(-1), { promptId: 'router', key: 'oi tudo bem', model: 'fake/fallback',
    messages: [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'pergunta: oi tudo bem' }] });
});
test('primary-timeout-once não afeta o fallback; setChaos rearma o modo; none volta ao normal', async () => {
  const fake = makeFake();
  fake.setChaos('primary-timeout-once');
  assert.ok(await fake.chat(req('router', 'oi tudo bem', 'fake/fallback'), signal));
  await assert.rejects(fake.chat(req('router', 'oi tudo bem'), signal));
  assert.ok(await fake.chat(req('router', 'oi tudo bem'), signal));
  fake.setChaos('primary-timeout-once');
  await assert.rejects(fake.chat(req('router', 'oi tudo bem'), signal));
  fake.setChaos('none');
  assert.ok(await fake.chat(req('router', 'oi tudo bem'), signal));
});
test('caos inicial vem das opções', async () => {
  const fake = createFakeProvider({ fixtures: loadFixtures(fixturesDir(), { activeEmbedderId: 'hash-v1' }), chaos: 'all-down' });
  await assert.rejects(fake.chat(req('router', 'oi tudo bem'), signal), (e: unknown) => e instanceof LlmError && e.kind === 'server_error');
});
test('sinal já abortado vira LlmError timeout', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(makeFake().chat(req('router', 'oi tudo bem'), ac.signal), (e: unknown) => e instanceof LlmError && e.kind === 'timeout');
});

test('calls guarda só as últimas MAX_RECORDED_CALLS chamadas, para um servidor de demonstração no ar não crescer sem teto', async () => {
  const fake = makeFake();
  const total = MAX_RECORDED_CALLS + 5;
  for (let i = 0; i < total; i++) await fake.chat(req('router', i % 2 === 0 ? 'oi tudo bem' : 'qual e o prazo para devolver'), signal);
  assert.equal(fake.calls.length, MAX_RECORDED_CALLS);
  assert.equal(fake.calls[0]!.key, 'qual e o prazo para devolver');   // a 6ª chamada (índice 5, ímpar) é a mais antiga que sobra
  assert.equal(fake.calls.at(-1)!.key, 'oi tudo bem');                 // a última (índice total - 1, par)
});
