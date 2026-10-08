// Embedder lexical hash-v1: TF sublinear × IDF com feature hashing (FNV-1a com sinal) em 2048 dimensões.
import type { Embedder } from './embedder.ts';
import { featureOccurrences, featureWeight, fingerprintIdf, idfWeight } from './text-features.ts';
import type { IdfTable } from './text-features.ts';

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function createHashEmbedder(idf: IdfTable, opts: { dim?: number } = {}): Embedder {
  const dim = opts.dim ?? 2048;
  const fingerprint = fingerprintIdf(idf);

  const embedOne = (text: string): Float32Array => {
    const acc = new Float64Array(dim);
    for (const [f, occ] of featureOccurrences(text)) {
      const value = featureWeight(f) * (1 + Math.log(occ)) * idfWeight(idf, f);
      const index = fnv1a32(f) % dim;
      const sign = fnv1a32(`#${f}`) & 1 ? -1 : 1;
      acc[index] = acc[index]! + sign * value;
    }
    let norm = 0;
    for (const x of acc) norm += x * x;
    norm = Math.sqrt(norm);
    const out = new Float32Array(dim);
    if (norm === 0) return out;
    for (let i = 0; i < dim; i++) out[i] = acc[i]! / norm;
    return out;
  };

  return {
    id: 'hash-v1',
    dim,
    fingerprint,
    async embed(texts) {
      return texts.map(embedOne);
    },
  };
}
