// Tokenização, stopwords em português, features lexicais e IDF do embedder hash-v1.
import { createHash } from 'node:crypto';
import { normalizeText } from '../domain/normalize.ts';

// Palavras funcionais do português (já normalizadas: sem acento, minúsculas), mais um punhado do inglês.
export const STOPWORDS_PT: ReadonlySet<string> = new Set([
  'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'num', 'numa',
  'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'com', 'sem', 'sob', 'sobre', 'entre', 'ate', 'apos',
  'desde', 'contra', 'ao', 'aos', 'ou', 'mas', 'nem', 'que', 'se', 'porque', 'pois', 'como', 'quando', 'onde', 'qual',
  'quais', 'quanto', 'quanta', 'quantos', 'quantas', 'quem', 'cujo', 'cuja', 'este', 'esta', 'estes', 'estas', 'esse',
  'essa', 'esses', 'essas', 'aquele', 'aquela', 'aqueles', 'aquelas', 'isto', 'isso', 'aquilo', 'eu', 'tu', 'ele', 'ela',
  'eles', 'elas', 'vos', 'voce', 'voces', 'me', 'te', 'lhe', 'lhes', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua',
  'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas', 'dele', 'dela', 'deles', 'delas', 'ser', 'sou', 'sao', 'era',
  'eram', 'foi', 'foram', 'sera', 'seria', 'sendo', 'sido', 'estar', 'estao', 'estava', 'ter', 'tem', 'tenho', 'tinha',
  'temos', 'haver', 'ha', 'houve', 'fazer', 'faz', 'fazem', 'posso', 'pode', 'podem', 'podemos', 'poder', 'devo', 'deve',
  'devem', 'vou', 'vai', 'vamos', 'ir', 'ja', 'nao', 'sim', 'mais', 'menos', 'muito', 'muita', 'muitos', 'muitas',
  'pouco', 'todo', 'toda', 'todos', 'todas', 'tudo', 'nada', 'algum', 'alguma', 'alguns', 'algumas', 'outro', 'outra',
  'outros', 'outras', 'mesmo', 'mesma', 'tambem', 'so', 'apenas', 'ainda', 'entao', 'assim', 'aqui', 'ali', 'la',
  'cada', 'qualquer', 'lo', 'the', 'of', 'and', 'to', 'is', 'in', 'for', 'on', 'what', 'how', 'does', 'can', 'my', 'your',
  // Advérbios e locuções sem tópico.
  'hoje', 'agora', 'sempre', 'nunca', 'durante', 'depois', 'antes', 'vez', 'vezes', 'tipo', 'alguem', 'ninguem',
  // Andaime de pergunta: verbos que enquadram a dúvida e quase nunca aparecem nos documentos. Sem casar com nada,
  // eles só baixavam o cosseno das perguntas respondíveis (ver docs/incidents/2026-10-04-calibracao-hash-v1.md).
  'consigo', 'conseguir', 'consegue', 'consegui', 'gostaria', 'quero', 'queria', 'preciso', 'precisa', 'precisam',
  'saber', 'sabe', 'existe', 'existem', 'acontece', 'acontecer', 'faco', 'fiz', 'dizer', 'estiver', 'estou', 'fica',
  'ficar', 'funciona', 'funcionam', 'demora', 'demoram', 'dura', 'duram', 'oferece', 'oferecem', 'possui', 'possuem',
]);

/** normalizeText, separa por espaço e descarta tokens com menos de 2 caracteres e stopwords. */
export function tokenize(text: string): string[] {
  const norm = normalizeText(text);
  if (norm === '') return [];
  return norm.split(' ').filter((t) => t.length >= 2 && !STOPWORDS_PT.has(t));
}

/** Plural para singular (regras do português, sem dicionário): sábados → sabado, devoluções → devolucao. */
export function singularize(t: string): string {
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  if (t.endsWith('oes') || t.endsWith('aes')) return `${t.slice(0, -3)}ao`;
  if (t.endsWith('ais') && t.length > 4) return `${t.slice(0, -3)}al`;
  if (t.endsWith('eis') && t.length > 4) return `${t.slice(0, -3)}el`;
  if (t.endsWith('ns')) return `${t.slice(0, -2)}m`;
  if (t.endsWith('res') || t.endsWith('zes') || t.endsWith('les') || t.endsWith('ses')) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

// Sufixos de flexão e derivação, do mais longo ao mais curto; remove um só, deixando ao menos 3 letras.
const SUFFIXES = ['amento', 'imento', 'mento', 'atura', 'acao', 'icao', 'cao', 'sao', 'ncia', 'idade', 'mente', 'avel', 'ivel',
  'ista', 'ismo', 'ador', 'edor', 'idor', 'ante', 'ente', 'ando', 'endo', 'indo', 'ario', 'aria', 'ado', 'ada', 'ido', 'ida',
  'ivo', 'iva', 'oso', 'osa', 'amos', 'emos', 'imos', 'ia', 'ar', 'er', 'ir', 'ei', 'ou', 'eu', 'iu', 'am', 'em', 'a', 'e', 'o', 'i'];

/** Radical leve: singular e um sufixo removido (comprei e compras → compr; arrependi e arrependimento → arrepend). */
export function stem(t: string): string {
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  let w = t;
  if (w.endsWith('oes') || w.endsWith('aes')) w = `${w.slice(0, -3)}ao`;
  else if (w.endsWith('ais') && w.length > 4) w = `${w.slice(0, -3)}al`;
  else if (w.endsWith('eis') && w.length > 4) w = `${w.slice(0, -3)}el`;
  else if (w.endsWith('ns')) w = `${w.slice(0, -2)}m`;
  else if (w.endsWith('res') || w.endsWith('zes') || w.endsWith('les')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
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
