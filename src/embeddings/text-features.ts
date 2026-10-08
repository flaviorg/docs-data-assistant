// Tokenização, stopwords em inglês, features lexicais e IDF do embedder hash-v1.
// A base e as perguntas estavam em português até 2026-10-08; as regras abaixo foram reescritas para o inglês
// (ver docs/incidents/2026-10-08-translation-to-english.md).
import { createHash } from 'node:crypto';
import { normalizeText } from '../domain/normalize.ts';

// Palavras funcionais do inglês (já normalizadas: sem acento, minúsculas).
export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'without', 'into', 'onto', 'about', 'over',
  'under', 'after', 'before', 'between', 'during', 'through', 'up', 'down', 'out', 'off', 'and', 'or', 'but', 'nor',
  'so', 'if', 'then', 'than', 'as', 'because', 'while', 'that', 'this', 'these', 'those', 'there', 'here', 'what',
  'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'doing', 'done', 'have', 'has', 'had', 'having', 'can', 'could', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'it', 'its', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their', 'theirs', 'myself', 'yourself', 'itself', 'not',
  'no', 'yes', 'any', 'all', 'some', 'each', 'every', 'both', 'either', 'neither', 'other', 'another', 'such', 'same',
  'only', 'just', 'also', 'too', 'very', 'more', 'most', 'less', 'least', 'much', 'many', 'few', 'again', 'still',
  'already', 'yet', 'ever', 'never', 'always', 'now', 'today', 'once', 'there', 'anyone', 'someone', 'something',
  'anything', 'nothing', 'everything', 'one', 'ones', 'per', 'via', 'etc', 'like', 'let', 'lets', 'until', 'till',
  'within', 'upon', 'since', 'whether', 'though', 'although', 'unless',
  // Andaime de pergunta: verbos que enquadram a dúvida e quase nunca aparecem nos documentos. Sem casar com nada,
  // eles só baixavam o cosseno das perguntas respondíveis (ver docs/incidents/2026-10-04-hash-v1-calibration.md).
  'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'know', 'tell', 'please', 'happen', 'happens', 'happened',
  'get', 'gets', 'got', 'getting', 'take', 'takes', 'took', 'make', 'makes', 'made', 'work', 'works', 'exist', 'exists',
  'offer', 'offers', 'possible', 'able', 'way', 'long', 'kind', 'thing', 'things', 'someone', 'anybody', 'nobody',
]);

// Verbos irregulares comuns: passado e particípio voltam ao infinitivo (kept → keep, bought → buy), porque as regras
// de sufixo do radical não alcançam essas formas.
const IRREGULAR_VERBS: Readonly<Record<string, string>> = {
  bought: 'buy', kept: 'keep', sold: 'sell', paid: 'pay', sent: 'send', spent: 'spend', broke: 'break', broken: 'break',
  fell: 'fall', fallen: 'fall', won: 'win', lost: 'lose', chose: 'choose', chosen: 'choose', gave: 'give', given: 'give',
  took: 'take', taken: 'take', brought: 'bring', found: 'find', left: 'leave', held: 'hold', told: 'tell', came: 'come',
  went: 'go', gone: 'go', saw: 'see', seen: 'see', knew: 'know', known: 'know', wrote: 'write', written: 'write',
  began: 'begin', begun: 'begin', grew: 'grow', grown: 'grow', built: 'build', thought: 'think', caught: 'catch',
  ran: 'run', met: 'meet', led: 'lead', drew: 'draw', drawn: 'draw', hid: 'hide', hidden: 'hide', shook: 'shake',
  froze: 'freeze', frozen: 'freeze', stole: 'steal', stolen: 'steal', tore: 'tear', torn: 'tear', wore: 'wear', worn: 'wear',
};

/** normalizeText, separa por espaço, descarta tokens com menos de 2 caracteres e stopwords e leva verbos irregulares
 * comuns ao infinitivo. */
export function tokenize(text: string): string[] {
  const norm = normalizeText(text);
  if (norm === '') return [];
  return norm.split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t)).map((t) => IRREGULAR_VERBS[t] ?? t);
}

/** Plural para singular (regras do inglês, sem dicionário): deliveries → delivery, boxes → box, days → day. */
export function singularize(t: string): string {
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh|z)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

// Sufixos de flexão e derivação, do mais longo ao mais curto; remove um só, deixando ao menos 3 letras.
const SUFFIXES = ['ization', 'ational', 'ations', 'ation', 'ments', 'ment', 'ness', 'ings', 'ing', 'able', 'ible', 'edly',
  'ers', 'ed', 'er', 'ly', 'al', 'ive', 'ous', 'ful', 'es', 'y', 'e'];

/** Radical leve: singular, um sufixo removido e consoante dobrada desfeita (shipping e shipped → ship; refunded e
 * refunds → refund; delivery e delivered → deliver). */
export function stem(t: string): string {
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  let w = singularize(t);
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break; }
  }
  if (w.length >= 4 && /([b-df-hj-np-rtv-y])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

const FEATURE_WEIGHTS: Readonly<Record<string, number>> = { w: 1, s: 1, b: 0.3, c: 0.3 };

/** Peso de cada família de feature: palavra no singular (w:) e radical (s:) valem 1; bigrama (b:) e trigrama
 * de caractere (c:) valem 0,3, como complemento. */
export function featureWeight(feature: string): number {
  return FEATURE_WEIGHTS[feature.slice(0, 1)] ?? 1;
}

/** Número de ocorrências de cada feature (sem peso). */
export function featureOccurrences(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const words = tokens.map(singularize);
  const counts = new Map<string, number>();
  const add = (f: string) => counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const w of words) add(`w:${w}`);
  for (const t of tokens) add(`s:${stem(t)}`);
  for (let i = 1; i < words.length; i++) add(`b:${words[i - 1]}_${words[i]}`);
  for (const t of tokens) {
    const padded = `_${t}_`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`);
  }
  return counts;
}

export interface IdfTable { n: number; df: Record<string, number> }

export function fitIdf(texts: readonly string[]): IdfTable {
  const df: Record<string, number> = {};
  for (const text of texts) {
    for (const f of featureOccurrences(text).keys()) df[f] = (df[f] ?? 0) + 1;
  }
  return { n: texts.length, df };
}

/** ln((1 + n) / (1 + df)) + 1; feature ausente do corpus tem df = 0. */
export function idfWeight(t: IdfTable, feature: string): number {
  return Math.log((1 + t.n) / (1 + (t.df[feature] ?? 0))) + 1;
}

export function fingerprintIdf(t: IdfTable): string {
  const df: Record<string, number> = {};
  for (const k of Object.keys(t.df).sort()) df[k] = t.df[k]!;
  const canonical = JSON.stringify({ n: t.n, df });
  return `hash-v1:idf=${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}
