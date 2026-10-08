// Guarda de saída (GRD-05, spec 004): bloqueia a resposta que contém o canário, 8 palavras seguidas de um trecho
// redigido (ou o trecho inteiro, se tiver menos de 8) ou 8 palavras seguidas dos blocos role, context, task ou
// constraints de um system prompt v1. Compara texto normalizado e desconta as frases que o próprio prompt manda emitir.
import { normalizeText } from '../domain/normalize.ts';
import { protectedText } from '../prompts/prompt.ts';
import type { PromptDef } from '../prompts/prompt.ts';

export const CANARY = 'LUA-CHEIA-100';
export const SHINGLE_WORDS = 8;

export type OutputGuardReason = 'canary' | 'redacted_span' | 'system_prompt_leak';
export interface OutputGuard {
  check(answer: string, redactedSpans: readonly string[]): { blocked: boolean; reason: OutputGuardReason | null };
}

const words = (s: string): string[] => {
  const n = normalizeText(s);
  return n === '' ? [] : n.split(' ');
};

function shingles(ws: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= ws.length; i++) out.add(ws.slice(i, i + SHINGLE_WORDS).join(' '));
  return out;
}

/** Sequência inteira de palavras, respeitando os limites de palavra. */
const containsSequence = (padded: string, ws: readonly string[]): boolean => padded.includes(` ${ws.join(' ')} `);

export function createOutputGuard(opts: { prompts: readonly PromptDef<any, any>[]; canary?: string }): OutputGuard {
  const protectedShingles = new Set<string>();
  for (const p of opts.prompts) {
    const allowed = new Set<string>();
    for (const echo of p.allowedEchoes) for (const s of shingles(words(echo))) allowed.add(s);
    for (const s of shingles(words(protectedText(p.system)))) if (!allowed.has(s)) protectedShingles.add(s);
  }
  const canaryWords = words(opts.canary ?? CANARY);

  return {
    check(answer, redactedSpans) {
      const answerWords = words(answer);
      const padded = ` ${answerWords.join(' ')} `;
      if (canaryWords.length > 0 && containsSequence(padded, canaryWords)) return { blocked: true, reason: 'canary' };

      const answerShingles = shingles(answerWords);
      for (const span of redactedSpans) {
        const spanWords = words(span);
        if (spanWords.length === 0) continue;
        const leaked = spanWords.length < SHINGLE_WORDS
          ? containsSequence(padded, spanWords)
          : [...shingles(spanWords)].some((s) => answerShingles.has(s));
        if (leaked) return { blocked: true, reason: 'redacted_span' };
      }

      for (const s of answerShingles) if (protectedShingles.has(s)) return { blocked: true, reason: 'system_prompt_leak' };
      return { blocked: false, reason: null };
    },
  };
}
