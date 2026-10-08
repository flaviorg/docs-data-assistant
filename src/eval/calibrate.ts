// npm run calibrate — tabela limiar × acurácia de recusa no split calibration (EVL-03). Não usa LLM nem fixture.
import { ingestToMemory } from '../rag/ingest.ts';
import { loadGolden } from './golden.ts';
import { bestThreshold, medianSeparation, sweepThresholds } from './retrieval-metrics.ts';

export interface CalibrationResult {
  items: number;
  table: { threshold: number; accuracy: number }[];
  separation: number;
  best: number;
  samples: { id: string; topScore: number; shouldRefuse: boolean }[];
}

export async function runCalibration(kbDir = 'data/kb', goldenFile = 'eval/golden.v1.json'): Promise<CalibrationResult> {
  const { store, embedder } = await ingestToMemory(kbDir);
  const items = loadGolden(goldenFile).filter((i) => i.split === 'calibration'
    && (i.category === 'docs_answerable' || i.category === 'docs_unanswerable'));
  const vectors = await embedder.embed(items.map((i) => i.question));
  const samples = items.map((i, n) => ({
    id: i.id,
    topScore: store.search(vectors[n]!, 1)[0]?.score ?? 0,
    shouldRefuse: i.category === 'docs_unanswerable',
  }));
  const table = sweepThresholds(samples);
  const separation = medianSeparation(
    samples.filter((s) => !s.shouldRefuse).map((s) => s.topScore),
    samples.filter((s) => s.shouldRefuse).map((s) => s.topScore),
  );
  return { items: items.length, table, separation, best: bestThreshold(table), samples };
}

async function main(): Promise<number> {
  const r = await runCalibration();
  const answerable = r.samples.filter((s) => !s.shouldRefuse).length;
  console.log(`hash-v1 calibration on the calibration split: ${r.items} items (${answerable} answerable, ${r.items - answerable} unanswerable)`);
  console.log('');
  console.log('item       top-1   expected');
  for (const s of [...r.samples].sort((a, b) => b.topScore - a.topScore)) {
    console.log(`${s.id.padEnd(10)} ${s.topScore.toFixed(3)}   ${s.shouldRefuse ? 'refuse' : 'answer'}`);
  }
  console.log('');
  console.log('threshold  accuracy');
  for (const t of r.table.filter((x) => Math.abs(x.threshold - r.best) <= 0.10 + 1e-9)) {
    console.log(`${t.threshold.toFixed(2)}       ${t.accuracy.toFixed(3)}${t.threshold === r.best ? '  ← suggested' : ''}`);
  }
  console.log('');
  console.log(`median separation: ${r.separation.toFixed(3)}`);
  console.log(`suggested threshold: ${r.best.toFixed(2)}`);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
