// Sanitização de documentos na ingestão (spec 002, GRD-04): frase a frase, troca instruções embutidas pela
// marca de redação e devolve os trechos removidos (usados depois pela guarda de saída).
import { matchRules } from '../guardrails/rules.ts';

export const REDACTION_MARK = '[trecho removido: possível instrução embutida]';

interface Segment { text: string; sentence: boolean }

/** Separa o texto em frases e espaços. Frase termina em [.!?] seguido de espaço (ou fim) ou numa quebra de linha. */
function splitSentences(text: string): Segment[] {
  const out: Segment[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && /\s/.test(text[j]!)) j++;
    if (j > i) { out.push({ text: text.slice(i, j), sentence: false }); i = j; continue; }
    while (j < n && text[j] !== '\n') {
      if ('.!?'.includes(text[j]!)) {
        let k = j;
        while (k < n && '.!?'.includes(text[k]!)) k++;
        j = k;
        if (k >= n || /\s/.test(text[k]!)) break;
        continue;
      }
      j++;
    }
    const raw = text.slice(i, j);
    const body = raw.replace(/\s+$/, '');
    out.push({ text: body, sentence: true });
    if (body.length < raw.length) out.push({ text: raw.slice(body.length), sentence: false });
    i = j;
  }
  return out;
}

export function sanitizeChunk(text: string): { text: string; flagged: boolean; reasons: string[]; redactedSpans: string[] } {
  const reasons: string[] = [];
  const redactedSpans: string[] = [];
  const parts = splitSentences(text).map((seg) => {
    if (!seg.sentence) return seg.text;
    const r = matchRules(seg.text, 'document');
    if (!r.blocked) return seg.text;
    redactedSpans.push(seg.text);
    for (const m of r.matches) if (!reasons.includes(m.id)) reasons.push(m.id);
    return REDACTION_MARK;
  });
  const flagged = redactedSpans.length > 0;
  return { text: flagged ? parts.join('') : text, flagged, reasons, redactedSpans };
}
