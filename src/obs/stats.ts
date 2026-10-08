// Funções puras de /stats: percentil por nearest rank e janelas aceitas pelo contrato.

/** Percentil por nearest rank: posição ceil(p/100 × n) na lista ordenada. Lista vazia devolve null. */
export function percentileNearestRank(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

const WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ['15m', 15 * 60_000],
  ['1h', 60 * 60_000],
  ['24h', 24 * 60 * 60_000],
  ['7d', 7 * 24 * 60 * 60_000],
];

/** Aceita só `15m`, `1h`, `24h` e `7d`; qualquer outra coisa devolve null (400 na API). */
export function parseSince(s: string): number | null {
  return WINDOWS.find(([label]) => label === s)?.[1] ?? null;
}

/** Rótulo da janela para o campo `since` do snapshot; janela fora do contrato vira `<ms>ms`. */
export function formatSince(ms: number): string {
  return WINDOWS.find(([, v]) => v === ms)?.[0] ?? `${ms}ms`;
}
