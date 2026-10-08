import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from '../../src/llm/tokens.ts';
import { costUsd, loadPrices } from '../../src/llm/pricing.ts';
import { makeTempDir } from '../helpers/tmp.ts';

test('estimateTokens arredonda para cima', () => {
  assert.deepEqual([estimateTokens(''), estimateTokens('abcd'), estimateTokens('abcde')], [0, 1, 2]);
});

test('custo por 1M tokens, modelo sem preço e modelo fictício', () => {
  const t = loadPrices();
  assert.equal(costUsd(t, 'openai/gpt-oss-120b', 1_000_000, 0).usd, 0.037);
  assert.deepEqual(costUsd(t, 'desconhecido/x', 10, 10), { usd: null, fictional: false });
  assert.equal(costUsd(t, 'fake/primary', 1000, 1000).fictional, true);
});

// Complementos
test('tabela traz os 3 modelos reais e os 3 fake, só os fake fictícios', () => {
  const t = loadPrices();
  assert.equal(t.updatedAt, '2026-10-04');
  for (const m of ['openai/gpt-oss-120b', 'google/gemini-2.5-flash', 'openai/gpt-oss-safeguard-20b']) {
    assert.ok(t.models[m], m);
    assert.notEqual(t.models[m]!.fictional, true);
  }
  for (const m of ['fake/primary', 'fake/fallback', 'fake/guardrail']) assert.equal(t.models[m]?.fictional, true, m);
});

test('custo soma entrada e saída', () => {
  const t = loadPrices();
  const c = costUsd(t, 'google/gemini-2.5-flash', 1_000_000, 1_000_000);
  assert.ok(Math.abs(c.usd! - 2.8) < 1e-9);
  assert.equal(c.fictional, false);
});

test('loadPrices recusa updatedAt fora do formato e preço negativo', () => {
  const dir = makeTempDir('dda');
  const bad = path.join(dir, 'p.json');
  fs.writeFileSync(bad, JSON.stringify({ updatedAt: '04/10/2026', models: {} }));
  assert.throws(() => loadPrices(bad), /updatedAt/);
  fs.writeFileSync(bad, JSON.stringify({ updatedAt: '2026-10-04', models: { x: { prompt: -1, completion: 0 } } }));
  assert.throws(() => loadPrices(bad));
});
