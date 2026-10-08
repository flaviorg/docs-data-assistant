// Formatação de texto para as CLIs (ask e demo): números no padrão brasileiro, quebra de linha e tabela simples.
import type { AskResponse } from '../domain/schemas.ts';

const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const formatInt = (n: number): string => intFmt.format(n);
export const formatNumber = (n: number): string => numFmt.format(n);

export function formatCost(costUsd: number | null, fictional: boolean): string {
  if (costUsd === null) return 'custo indisponível';
  return `US$ ${usdFmt.format(costUsd)}${fictional ? ' (fictício)' : ''}`;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Quebra o texto em linhas de até `width` caracteres, por palavra, com recuo opcional. */
export function wrap(text: string, width = 88, indent = ''): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && indent.length + line.length + 1 + word.length > width) {
        lines.push(indent + line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(indent + line);
  }
  return lines;
}

/** Tabela alinhada: números à direita, texto à esquerda, sem espaço sobrando no fim da linha. */
export function table(columns: readonly string[], rows: readonly (readonly (string | number | null)[])[], indent = '  '): string[] {
  const cell = (v: string | number | null): string => (v === null ? 'NULL' : typeof v === 'number' ? formatNumber(v) : v);
  const numeric = columns.map((_c, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number' || r[i] === null));
  const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => cell(r[i] ?? null).length)));
  const line = (values: readonly string[]): string =>
    (indent + values.map((v, i) => (numeric[i] ? v.padStart(widths[i]!) : v.padEnd(widths[i]!))).join('   ')).trimEnd();
  return [line(columns), ...rows.map((r) => line(columns.map((_c, i) => cell(r[i] ?? null))))];
}

/** Rótulo curto do provedor e do embedder: "[FAKE · hash-v1]". */
export function profileTag(meta: AskResponse['meta']): string {
  return `[${meta.provider.toUpperCase()} · ${meta.embedder.split(':')[0]}]`;
}
