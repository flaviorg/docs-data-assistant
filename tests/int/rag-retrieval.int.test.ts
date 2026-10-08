import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestToMemory } from '../../src/rag/ingest.ts';
import { loadGolden } from '../../src/eval/golden.ts';
import { recallAtK } from '../../src/eval/retrieval-metrics.ts';
import { runCalibration } from '../../src/eval/calibrate.ts';
import { MIN_SCORE_DEFAULTS } from '../../src/config.ts';

test('RAG-01 recallAt3 do hash-v1 ≥ 0,90 nos docs_answerable do split test', async () => {
  const { store, embedder } = await ingestToMemory();
  const items = loadGolden().filter((i) => i.split === 'test' && i.category === 'docs_answerable');
  const rows = await Promise.all(items.map(async (i) => ({ expected: i.expected.chunkIds!, retrieved: store.search((await embedder.embed([i.question]))[0]!, 3).map((h) => h.chunk.id) })));
  assert.ok(recallAtK(rows, 3) >= 0.9, JSON.stringify(rows));
});
test('EVL-03 calibração usa só o split calibration, separa ≥ 0,15 e o limiar do config acerta ≥ 0,90', async () => {
  const r = await runCalibration();
  assert.equal(r.items, loadGolden().filter((i) => i.split === 'calibration').length);
  assert.ok(r.separation >= 0.15, `separação ${r.separation}`);
  const atConfig = r.table.find((t) => Math.abs(t.threshold - MIN_SCORE_DEFAULTS['hash-v1']) < 1e-9)!;
  assert.ok(atConfig.accuracy >= 0.9);
});

// Complementos
test('golden v1 nesta etapa: 8+4 itens de docs no test e 7+5 no calibration, todos com rota docs', () => {
  const g = loadGolden();
  const count = (split: string, category: string) => g.filter((i) => i.split === split && i.category === category).length;
  assert.deepEqual([count('test', 'docs_answerable'), count('test', 'docs_unanswerable'), count('calibration', 'docs_answerable'), count('calibration', 'docs_unanswerable')], [8, 4, 7, 5]);
  for (const i of g.filter((x) => x.category.startsWith('docs_'))) {
    assert.equal(i.expected.route, 'docs', i.id);
    assert.equal(i.expected.status, i.category === 'docs_answerable' ? 'answered' : 'refused', i.id);
  }
});
test('cenários 1, 2, 9, 10 e 13 estão no split test', () => {
  const qs = loadGolden().filter((i) => i.split === 'test').map((i) => i.question);
  for (const q of ['What is the deadline to return a defective grinder?', 'Does Lunar Mill offer meal vouchers to employees?',
    'How does the minimum order work for partner coffee shops?', 'What benefits do partner coffee shops get?', 'What is the refund time on a credit card?']) {
    assert.ok(qs.includes(q), q);
  }
});
test('todo chunkId esperado existe no índice', async () => {
  const { store } = await ingestToMemory();
  for (const i of loadGolden()) for (const id of i.expected.chunkIds ?? []) assert.ok(store.getChunk(id), `${i.id}: ${id}`);
});
test('no split test, o limiar do config acerta ≥ 0,90 das recusas e todos os cenários de docs da demo', async () => {
  const { store, embedder } = await ingestToMemory();
  const t = MIN_SCORE_DEFAULTS['hash-v1'];
  const demo = ['What is the deadline to return a defective grinder?', 'Does Lunar Mill offer meal vouchers to employees?',
    'How does the minimum order work for partner coffee shops?', 'What benefits do partner coffee shops get?', 'What is the refund time on a credit card?'];
  const items = loadGolden().filter((x) => x.split === 'test' && x.category.startsWith('docs_'));
  let right = 0;
  for (const i of items) {
    const top = store.search((await embedder.embed([i.question]))[0]!, 1)[0]?.score ?? 0;
    const ok = (top < t) === (i.category === 'docs_unanswerable');
    if (ok) right++;
    if (demo.includes(i.question)) assert.ok(ok, `${i.id} top=${top.toFixed(3)} limiar=${t}`);
  }
  assert.ok(right / items.length >= 0.9, `${right}/${items.length}`);
});
