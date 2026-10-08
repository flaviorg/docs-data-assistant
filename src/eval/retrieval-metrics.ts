// Métricas de recuperação (RAG-01, EVL-03): recall@k, separação das medianas e varredura do limiar de recusa.

/** Acerto de um item no recall@k: ao menos um ID esperado entre os k primeiros recuperados. */
export function hitAtK(expected: readonly string[], retrieved: readonly string[], k: number): boolean {
  return retrieved.slice(0, k).some((id) => expected.includes(id));
}

export function recallAtK(items: readonly { expected: readonly string[]; retrieved: readonly string[] }[], k: number): number {
  if (items.length === 0) return 0;
  return items.filter((i) => hitAtK(i.expected, i.retrieved, k)).length / items.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mediana do top-1 das respondíveis menos a mediana do top-1 das não respondíveis. */
export function medianSeparation(answerableTop: readonly number[], unanswerableTop: readonly number[]): number {
  return median(answerableTop) - median(unanswerableTop);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
export const DEFAULT_THRESHOLD_GRID: readonly number[] = Array.from({ length: 76 }, (_, i) => round2(0.05 + i * 0.01));

/** Acurácia da decisão "recusa se topScore < limiar" para cada limiar da grade. */
export function sweepThresholds(
  samples: readonly { topScore: number; shouldRefuse: boolean }[],
  grid: readonly number[] = DEFAULT_THRESHOLD_GRID,
): { threshold: number; accuracy: number }[] {
  return grid.map((threshold) => {
    const right = samples.filter((s) => (s.topScore < threshold) === s.shouldRefuse).length;
    return { threshold, accuracy: samples.length === 0 ? 0 : right / samples.length };
  });
}

/** Entre os limiares de acurácia máxima, o do meio do platô contíguo mais longo (o primeiro, em empate). */
export function bestThreshold(sweep: readonly { threshold: number; accuracy: number }[]): number {
  if (sweep.length === 0) throw new Error('varredura vazia');
  const max = Math.max(...sweep.map((s) => s.accuracy));
  let best: { start: number; len: number } = { start: 0, len: 0 };
  let start = -1;
  sweep.forEach((s, i) => {
    if (s.accuracy === max) {
      if (start === -1) start = i;
      const len = i - start + 1;
      if (len > best.len) best = { start, len };
    } else {
      start = -1;
    }
  });
  return sweep[best.start + Math.floor((best.len - 1) / 2)]!.threshold;
}
