import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHashEmbedder } from '../../src/embeddings/hash-embedder.ts';
import { STOPWORDS, featureOccurrences, featureWeight, fitIdf, fingerprintIdf, idfWeight, singularize, stem, tokenize } from '../../src/embeddings/text-features.ts';

/** Contagem ponderada das features (ocorrências × peso), como o embedder soma antes do IDF. */
function extractFeatures(text: string): Map<string, number> {
  const weighted = new Map<string, number>();
  for (const [f, occ] of featureOccurrences(text)) weighted.set(f, occ * featureWeight(f));
  return weighted;
}

const corpus = ['Defective equipment can be returned within 90 days.', 'Free shipping over R$ 199 anywhere in Brazil.',
  'The subscription club lets you pause the delivery.', 'Card refunds show up on one of the next two statements.'];
const emb = createHashEmbedder(fitIdf(corpus));
const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);

test('determinístico, 2048 dimensões e norma 1', async () => {
  const [a, b] = await emb.embed(['return deadline', 'return deadline']);
  assert.deepEqual(a, b); assert.equal(a!.length, 2048); assert.equal(emb.dim, 2048);
  assert.ok(Math.abs(Math.hypot(...a!) - 1) < 1e-6);
});
test('texto só de stopwords dá vetor nulo', async () => {
  const [z] = await emb.embed(['the of to and what is it']);
  assert.ok(z!.every((x) => x === 0));
});
test('paráfrase lexical pontua mais que frase não relacionada', async () => {
  const [q, rel, unrel] = await emb.embed(['deadline to return defective grinder', corpus[0]!, corpus[1]!]);
  assert.ok(cos(q!, rel!) > cos(q!, unrel!));
});
test('acentos não mudam as features', () => {
  assert.deepEqual([...extractFeatures('café')], [...extractFeatures('cafe')]);
});
test('fingerprint estável e sensível ao IDF', () => {
  assert.match(emb.fingerprint, /^hash-v1:idf=[0-9a-f]{12}$/);
  assert.equal(createHashEmbedder(fitIdf(corpus)).fingerprint, emb.fingerprint);
  assert.notEqual(createHashEmbedder(fitIdf([...corpus, 'new text'])).fingerprint, emb.fingerprint);
});

// Complementos
test('tokenize normaliza, descarta stopwords e tokens de 1 caractere', () => {
  assert.deepEqual(tokenize('What is the return DEADLINE for the grinder? 7 days'), ['return', 'deadline', 'grinder', 'days']);
  assert.ok(STOPWORDS.size >= 120 && STOPWORDS.size <= 240, String(STOPWORDS.size));
  for (const w of STOPWORDS) assert.match(w, /^[a-z]+$/, w);
});
test('andaime de pergunta é stopword: "want", "need", "know", "happens" não viram feature', () => {
  for (const w of ['want', 'need', 'know', 'happens', 'exist', 'please', 'until']) assert.ok(STOPWORDS.has(w), w);
  assert.deepEqual(tokenize('I want to know how shipping works'), ['shipping']);
});
test('verbos irregulares comuns voltam ao infinitivo', () => {
  assert.deepEqual(tokenize('I bought it and you kept it'), ['buy', 'keep']);
  assert.deepEqual(tokenize('it fell and broke'), ['fall', 'break']);
});
test('features: palavra no singular e radical com peso 1, bigrama 0,3, trigrama de caractere 0,3', () => {
  const f = extractFeatures('grinder electric grinder');
  assert.equal(f.get('w:grinder'), 2);
  assert.equal(f.get('w:electric'), 1);
  assert.equal(f.get('s:grind'), 2);
  assert.equal(f.get('s:electric'), 1);
  assert.ok(Math.abs(f.get('b:grinder_electric')! - 0.3) < 1e-9);
  assert.ok(Math.abs(f.get('b:electric_grinder')! - 0.3) < 1e-9);
  assert.ok(Math.abs(f.get('c:_gr')! - 0.6) < 1e-9);
  assert.equal(f.has('w:the'), false);
});
test('plural vira singular na feature de palavra; trigramas usam a forma original', () => {
  assert.ok(extractFeatures('saturdays').has('w:saturday'));
  assert.ok(extractFeatures('deliveries').has('w:delivery'));
  assert.ok(extractFeatures('saturdays').has('c:ys_'));
  assert.equal(singularize('days'), 'day'); assert.equal(singularize('boxes'), 'box'); assert.equal(singularize('address'), 'address');
});
test('radical aproxima flexões que a palavra exata não casa', () => {
  const shared = (a: string, b: string) => [...extractFeatures(a).keys()].filter((k) => k.startsWith('s:') && extractFeatures(b).has(k));
  assert.deepEqual(shared('refunded', 'refunds'), ['s:refund']);
  assert.deepEqual(shared('shipping', 'shipped'), ['s:ship']);
  assert.deepEqual(shared('delivered', 'deliveries'), ['s:deliver']);
  assert.deepEqual(shared('cancelled', 'cancel'), ['s:cancel']);
  assert.equal(stem('day'), 'day');
  assert.equal(stem('199'), '199');
});
test('bigramas pulam stopwords: "deadline to return" vira deadline_return', () => {
  assert.ok(extractFeatures('deadline to return').has('b:deadline_return'));
});
test('IDF: df conta documentos, feature ausente tem df 0, fingerprint ignora ordem das chaves', () => {
  const t = fitIdf(['grinder grinder', 'grinder coffee', 'coffee']);
  assert.equal(t.n, 3); assert.equal(t.df['w:grinder'], 2); assert.equal(t.df['w:coffee'], 2);
  assert.ok(Math.abs(idfWeight(t, 'w:grinder') - (Math.log(4 / 3) + 1)) < 1e-12);
  assert.ok(Math.abs(idfWeight(t, 'w:missing') - (Math.log(4) + 1)) < 1e-12);
  const reordered = { n: t.n, df: Object.fromEntries(Object.entries(t.df).reverse()) };
  assert.equal(fingerprintIdf(reordered), fingerprintIdf(t));
});
test('dimensão configurável e id hash-v1', async () => {
  const small = createHashEmbedder(fitIdf(corpus), { dim: 64 });
  const [v] = await small.embed(['free shipping']);
  assert.equal(v!.length, 64); assert.equal(small.dim, 64); assert.equal(small.id, 'hash-v1');
  assert.ok(Math.abs(Math.hypot(...v!) - 1) < 1e-6);
});
test('embed de lista vazia devolve lista vazia', async () => {
  assert.deepEqual(await emb.embed([]), []);
});
