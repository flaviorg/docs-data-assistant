// Contrato do embedder (spec 002). O v1 tem só o hash-v1; o marco opcional M9 acrescenta outro id (docs/adr/001-embedder-plugavel.md).
export type EmbedderId = 'hash-v1';

export interface Embedder {
  readonly id: EmbedderId;
  readonly dim: number;                         // hash-v1: 2048
  readonly fingerprint: string;                 // 'hash-v1:idf=<12 hex do sha256 do IDF>'
  embed(texts: readonly string[]): Promise<Float32Array[]>; // norma L2 = 1, ou vetor nulo se não sobrar feature
}
