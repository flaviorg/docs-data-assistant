// Chunker por seção (H2 e H3) com janelas de tamanho máximo e overlap. IDs estáveis: <slug>#<seção>-<n>.
import { normalizeText } from '../domain/normalize.ts';

export interface RawChunk { id: string; docSlug: string; docTitle: string; heading: string; ordinal: number; text: string }

export function slugify(s: string): string {
  return normalizeText(s).replace(/ /g, '-');
}

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

/** Janelas de até `size` caracteres, terminando em fim de frase (ou quebra de linha) ou espaço;
 * cada janela começa `overlap` caracteres antes do fim da anterior, ajustada para o início de uma palavra. */
function windows(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  const len = text.length;
  let start = 0;
  while (start < len) {
    while (start < len && isSpace(text[start])) start++;
    if (start >= len) break;
    if (len - start <= size) {
      out.push(text.slice(start).trim());
      break;
    }
    const limit = start + size;
    let cut = -1;
    for (let i = limit; i > start + Math.floor(size / 2); i--) {
      const sentenceEnd = '.!?'.includes(text[i - 1]!) && (i >= len || isSpace(text[i]));
      if (sentenceEnd || text[i] === '\n') { cut = i; break; }
    }
    if (cut === -1) {
      for (let i = limit; i > start; i--) if (isSpace(text[i])) { cut = i; break; }
    }
    if (cut === -1) cut = limit;
    out.push(text.slice(start, cut).trim());

    let next = cut - overlap;
    while (next < cut && next > start && !isSpace(text[next - 1])) next++;
    start = next <= start || next >= cut ? cut : next;
  }
  return out.filter((w) => w.length > 0);
}

export function chunkMarkdown(doc: { slug: string; markdown: string }, opts: { size: number; overlap: number }): RawChunk[] {
  const lines = doc.markdown.replace(/\r\n/g, '\n').split('\n');
  const h1Index = lines.findIndex((l) => /^#\s+\S/.test(l));
  const docTitle = h1Index >= 0 ? lines[h1Index]!.replace(/^#\s+/, '').trim() : doc.slug;

  const sections: { heading: string; lines: string[] }[] = [{ heading: docTitle, lines: [] }];
  lines.forEach((line, i) => {
    if (i === h1Index) return;
    const h = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (h) sections.push({ heading: h[1]!, lines: [] });
    else sections.at(-1)!.lines.push(line);
  });

  const chunks: RawChunk[] = [];
  const perHeading = new Map<string, number>();
  for (const section of sections) {
    const body = section.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body === '') continue;
    const headingSlug = slugify(section.heading) || 'secao';
    for (const text of windows(body, opts.size, opts.overlap)) {
      const n = (perHeading.get(headingSlug) ?? 0) + 1;
      perHeading.set(headingSlug, n);
      chunks.push({ id: `${doc.slug}#${headingSlug}-${n}`, docSlug: doc.slug, docTitle, heading: section.heading, ordinal: chunks.length, text });
    }
  }
  return chunks;
}
