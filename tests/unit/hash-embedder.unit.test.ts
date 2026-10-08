import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHashEmbedder } from '../../src/embeddings/hash-embedder.ts';
import { STOPWORDS_PT, featureOccurrences, featureWeight, fitIdf, fingerprintIdf, idfWeight, singularize, stem, tokenize } from '../../src/embeddings/text-features.ts';

/** Contagem ponderada das features (ocorrências × peso), como o embedder soma antes do IDF. */
function extractFeatures(text: string): Map<string, number> {
  const weighted = new Map<string, number>();
  for (const [f, occ] of featureOccurrences(text)) weighted.set(f, occ * featureWeight(f));
  return weighted;
}

const corpus = ['Equipamentos com defeito podem ser devolvidos em até 90 dias.', 'Frete grátis acima de R$ 199 para todo o Brasil.',
  'O clube de assinatura permite pausar a entrega.', 'Estornos no cartão aparecem em até duas faturas.'];
const emb = createHashEmbedder(fitIdf(corpus));
const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);

test('determinístico, 2048 dimensões e norma 1', async () => {
  const [a, b] = await emb.embed(['prazo de devolução', 'prazo de devolução']);
  assert.deepEqual(a, b); assert.equal(a!.length, 2048); assert.equal(emb.dim, 2048);
  assert.ok(Math.abs(Math.hypot(...a!) - 1) < 1e-6);
});
test('texto só de stopwords dá vetor nulo', async () => {
  const [z] = await emb.embed(['de a o que para com']);
  assert.ok(z!.every((x) => x === 0));
});
test('paráfrase lexical pontua mais que frase não relacionada', async () => {
  const [q, rel, unrel] = await emb.embed(['prazo para devolver moedor com defeito', corpus[0]!, corpus[1]!]);
  assert.ok(cos(q!, rel!) > cos(q!, unrel!));
});
test('acentos não mudam as features', () => {
  assert.deepEqual([...extractFeatures('devolução')], [...extractFeatures('devolucao')]);
});
test('fingerprint estável e sensível ao IDF', () => {
  assert.match(emb.fingerprint, /^hash-v1:idf=[0-9a-f]{12}$/);
  assert.equal(createHashEmbedder(fitIdf(corpus)).fingerprint, emb.fingerprint);
  assert.notEqual(createHashEmbedder(fitIdf([...corpus, 'novo texto'])).fingerprint, emb.fingerprint);
});

// Complementos
test('tokenize normaliza, descarta stopwords e tokens de 1 caractere', () => {
  assert.deepEqual(tokenize('Qual é o PRAZO de devolução do moedor? 7 dias'), ['prazo', 'devolucao', 'moedor', 'dias']);
  assert.ok(STOPWORDS_PT.size >= 120 && STOPWORDS_PT.size <= 240, String(STOPWORDS_PT.size));
  for (const w of STOPWORDS_PT) assert.match(w, /^[a-z]+$/, w);
});
test('andaime de pergunta é stopword: "consigo", "existe", "funciona", "gostaria" não viram feature', () => {
  for (const w of ['consigo', 'existe', 'funciona', 'gostaria', 'acontece', 'demora']) assert.ok(STOPWORDS_PT.has(w), w);
  assert.deepEqual(tokenize('Consigo saber como funciona o frete?'), ['frete']);
});
test('features: palavra no singular e radical com peso 1, bigrama 0,3, trigrama de caractere 0,3', () => {
  const f = extractFeatures('moedor elétrico moedor');
  assert.equal(f.get('w:moedor'), 2);
  assert.equal(f.get('w:eletrico'), 1);
  assert.equal(f.get('s:moedor'), 2);
  assert.equal(f.get('s:eletric'), 1);
  assert.ok(Math.abs(f.get('b:moedor_eletrico')! - 0.3) < 1e-9);
  assert.ok(Math.abs(f.get('b:eletrico_moedor')! - 0.3) < 1e-9);
  assert.ok(Math.abs(f.get('c:_mo')! - 0.6) < 1e-9);
  assert.equal(f.has('w:o'), false);
});
test('plural vira singular na feature de palavra; trigramas usam a forma original', () => {
  assert.ok(extractFeatures('sábados').has('w:sabado'));
  assert.ok(extractFeatures('devoluções').has('w:devolucao'));
  assert.ok(extractFeatures('sábados').has('c:os_'));
  assert.equal(singularize('dias'), 'dia'); assert.equal(singularize('meses'), 'mes'); assert.equal(singularize('valores'), 'valor');
});
test('radical aproxima flexões que a palavra exata não casa', () => {
  const shared = (a: string, b: string) => [...extractFeatures(a).keys()].filter((k) => k.startsWith('s:') && extractFeatures(b).has(k));
  assert.deepEqual(shared('comprei', 'compras'), ['s:compr']);
  assert.deepEqual(shared('arrependi', 'arrependimento'), ['s:arrepend']);
  assert.deepEqual(shared('guardam', 'guardados'), ['s:guard']);
  assert.equal(stem('dia'), 'dia');
  assert.equal(stem('199'), '199');
});
test('bigramas pulam stopwords: "prazo de devolução" vira prazo_devolucao', () => {
  assert.ok(extractFeatures('prazo de devolução').has('b:prazo_devolucao'));
});
test('IDF: df conta documentos, feature ausente tem df 0, fingerprint ignora ordem das chaves', () => {
  const t = fitIdf(['moedor moedor', 'moedor cafe', 'cafe']);
  assert.equal(t.n, 3); assert.equal(t.df['w:moedor'], 2); assert.equal(t.df['w:cafe'], 2);
  assert.ok(Math.abs(idfWeight(t, 'w:moedor') - (Math.log(4 / 3) + 1)) < 1e-12);
  assert.ok(Math.abs(idfWeight(t, 'w:inexistente') - (Math.log(4) + 1)) < 1e-12);
  const reordered = { n: t.n, df: Object.fromEntries(Object.entries(t.df).reverse()) };
  assert.equal(fingerprintIdf(reordered), fingerprintIdf(t));
});
test('dimensão configurável e id hash-v1', async () => {
  const small = createHashEmbedder(fitIdf(corpus), { dim: 64 });
  const [v] = await small.embed(['frete grátis']);
  assert.equal(v!.length, 64); assert.equal(small.dim, 64); assert.equal(small.id, 'hash-v1');
  assert.ok(Math.abs(Math.hypot(...v!) - 1) < 1e-6);
});
test('embed de lista vazia devolve lista vazia', async () => {
  assert.deepEqual(await emb.embed([]), []);
});
