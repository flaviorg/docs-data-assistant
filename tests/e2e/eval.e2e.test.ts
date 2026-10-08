import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runEval } from '../../src/eval/run-eval.ts';
import { makeTempDir } from '../helpers/tmp.ts';

test('EVL-01 eval fake passa com código 0 e rótulo FAKE', async () => {
  const r = await runEval({ live: false, split: 'test' });
  assert.equal(r.exitCode, 0, r.text); assert.match(r.text, /profile FAKE/); assert.match(r.text, /contract \(fixture\)/);
});

test('EVL-01 limiar impossível termina com código 1', async () => {
  assert.equal((await runEval({ live: false, split: 'test', thresholdsOverride: { recallAt3: ['>=', 1.01] } })).exitCode, 1);
});

test('EVL-02 CLI grava o relatório com o rótulo do perfil', () => {
  const out = path.join(makeTempDir('dda'), 'r.md');
  const r = spawnSync(process.execPath, ['src/eval/run-eval.ts', '--out', out], { env: { PATH: process.env.PATH!, NODE_OPTIONS: process.env.NODE_OPTIONS! }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(fs.readFileSync(out, 'utf8'), /FAKE/);
});

// Complementos
test('EVL-02 o relatório traz provedor, embedder com fingerprint, guardrail, modelos, split, data e a frase dos contratos', async () => {
  const r = await runEval({ live: false, split: 'test' });
  assert.match(r.text, /^EVAL docs-data-assistant · profile FAKE \(scripted generation; retrieval, threshold, validation and blocking really measured\) · split test \(34 items\)$/m);
  assert.match(r.text, /^provider=fake embedder=hash-v1:idf=[0-9a-f]{12} guardrail=rules models=fake\/primary,fake\/fallback · \d{4}-\d{2}-\d{2}$/m);
  assert.match(r.text, /Contracts \(fixture\) prove that fixtures, embedder and pipeline are in sync; they do not measure generation quality\./);
  assert.match(r.text, /^Result: PASSED \(exit code 0\)/m);
  assert.match(r.text, /^Simulated compliant model fixture \(tests the last line of defense\): docs-003, sql-atk-001$/m);
  assert.match(r.text, /^Items against falseBlockRate: docs-003$/m);
  for (const name of ['routeAccuracy', 'recallAt3', 'refusalAccuracy', 'citationValidity', 'sqlExecutionAccuracy', 'injectionBlockRate', 'falseBlockRate']) {
    assert.match(r.text, new RegExp(`^${name} +(contract \\(fixture\\)|mechanism) +\\d\\.\\d{2} +(=|>=|<=)\\d\\.\\d{2} +yes`, 'm'), name);
  }
  assert.match(r.markdown, /^\| metric \| nature \| value \| threshold \| ok \| items \|$/m);
  assert.match(r.markdown, /FAKE/);
});

test('EVL-01 os valores do fake: contratos em 1, mecanismos medidos e o bloqueio do cenário 10 contado em falseBlockRate', async () => {
  const r = await runEval({ live: false, split: 'test' });
  const v = Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
  assert.deepEqual([v.routeAccuracy, v.citationValidity, v.sqlExecutionAccuracy, v.injectionBlockRate], [1, 1, 1, 1]);
  assert.equal(v.recallAt3, 1); assert.equal(v.refusalAccuracy, 1);
  assert.equal(v.falseBlockRate, 1 / 26);   // docs-003: fixture do modelo complacente bloqueada pela guarda de saída
  assert.equal(r.exitCode, 0);
});

test('EVL-01 split all inclui o calibration só na recuperação, sem chamar o modelo', async () => {
  const r = await runEval({ live: false, split: 'all' });
  assert.match(r.text, /split all \(46 items\)/);
  const v = Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
  assert.equal(v.recallAt3, 15 / 15);   // em inglês, cal-007 entra no top-3 (3º lugar)
  assert.equal(v.refusalAccuracy, 24 / 24);   // limiar 0,22: as 24 decisões de recusa acertam
});

test('EVL-01 erro de execução: rules+model com o fake e --live sem chave saem com código 2 pela CLI', () => {
  const env = { PATH: process.env.PATH!, NODE_OPTIONS: process.env.NODE_OPTIONS! };
  const out = path.join(makeTempDir('dda'), 'r.md');
  const model = spawnSync(process.execPath, ['src/eval/run-eval.ts', '--guardrail', 'rules+model', '--out', out], { env, encoding: 'utf8' });
  assert.equal(model.status, 2, model.stdout + model.stderr); assert.match(model.stderr, /GUARDRAIL_MODE/);
  const live = spawnSync(process.execPath, ['src/eval/run-eval.ts', '--live', '--out', out], { env, encoding: 'utf8' });
  assert.equal(live.status, 2, live.stdout + live.stderr); assert.match(live.stderr, /OPENROUTER_API_KEY/);
  const bad = spawnSync(process.execPath, ['src/eval/run-eval.ts', '--split', 'calibration'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /usage:/);
  assert.equal(fs.existsSync(out), false);
});
