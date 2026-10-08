import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bestThreshold, medianSeparation, recallAtK, sweepThresholds } from '../../src/eval/retrieval-metrics.ts';
import { loadGolden } from '../../src/eval/golden.ts';
import { makeTempDir } from '../helpers/tmp.ts';

test('recallAtK, separação e varredura em dados conhecidos', () => {
  assert.equal(recallAtK([{ expected: ['a'], retrieved: ['x', 'a', 'y'] }, { expected: ['b'], retrieved: ['x', 'y', 'z'] }], 3), 0.5);
  assert.ok(Math.abs(medianSeparation([0.6, 0.5, 0.7], [0.2, 0.3]) - 0.35) < 1e-9);
  const samples = [0.6, 0.55, 0.5].map((s) => ({ topScore: s, shouldRefuse: false })).concat([0.2, 0.3].map((s) => ({ topScore: s, shouldRefuse: true })));
  const best = bestThreshold(sweepThresholds(samples));
  assert.ok(best > 0.3 && best <= 0.5);
});

// Complementos
test('recallAtK corta em k e lista vazia dá 0', () => {
  assert.equal(recallAtK([{ expected: ['a'], retrieved: ['x', 'y', 'z', 'a'] }], 3), 0);
  assert.equal(recallAtK([{ expected: ['a', 'b'], retrieved: ['b'] }], 3), 1);
  assert.equal(recallAtK([], 3), 0);
});
test('varredura: grade padrão de 0,05 a 0,80 em passos de 0,01, sem erro de ponto flutuante', () => {
  const s = sweepThresholds([{ topScore: 0.4, shouldRefuse: false }]);
  assert.equal(s.length, 76);
  assert.equal(s[0]!.threshold, 0.05); assert.equal(s.at(-1)!.threshold, 0.8);
  assert.ok(s.some((t) => t.threshold === 0.29));
  assert.equal(s.find((t) => t.threshold === 0.4)!.accuracy, 1);   // 0,4 não é < 0,4: responde
  assert.equal(s.find((t) => t.threshold === 0.41)!.accuracy, 0);
});
test('bestThreshold pega o meio do platô mais longo de acurácia máxima', () => {
  const sweep = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((threshold, i) => ({ threshold, accuracy: [0.5, 1, 0.8, 1, 1, 1, 0.9][i]! }));
  assert.equal(bestThreshold(sweep), 0.5);
  assert.throws(() => bestThreshold([]));
});
test('mediana com número par de itens usa a média dos dois centrais', () => {
  assert.ok(Math.abs(medianSeparation([0.4, 0.6], [0.1, 0.2, 0.3]) - 0.3) < 1e-9);
});
test('loadGolden recusa id duplicado, versão errada e docs_answerable sem chunkIds', () => {
  const dir = makeTempDir('dda');
  const file = path.join(dir, 'g.json');
  const item = { id: 'docs-001', split: 'test', category: 'docs_answerable', question: 'Pergunta?', expected: { route: 'docs', status: 'answered', chunkIds: ['a#b-1'] } };
  fs.writeFileSync(file, JSON.stringify({ version: 'v1', items: [item] }));
  assert.equal(loadGolden(file).length, 1);
  fs.writeFileSync(file, JSON.stringify({ version: 'v1', items: [item, item] }));
  assert.throws(() => loadGolden(file), /docs-001/);
  fs.writeFileSync(file, JSON.stringify({ version: 'v2', items: [item] }));
  assert.throws(() => loadGolden(file));
  fs.writeFileSync(file, JSON.stringify({ version: 'v1', items: [{ ...item, expected: { route: 'docs', status: 'answered' } }] }));
  assert.throws(() => loadGolden(file), /chunkIds/);
});
