import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createVectorStore } from '../../src/rag/vector-store.ts';
import type { KbDocument, SanitizedChunk } from '../../src/rag/vector-store.ts';
import { ReindexRequiredError } from '../../src/domain/errors.ts';

const doc = (slug: string, sha256: string): KbDocument => ({ slug, title: `Título ${slug}`, sha256 });
const chunk = (id: string, ordinal = 0, extra: Partial<SanitizedChunk> = {}): SanitizedChunk => ({
  id, docSlug: id.split('#')[0]!, docTitle: `Título ${id.split('#')[0]}`, heading: 'Seção', ordinal, text: `texto ${id}`,
  flagged: false, flagReasons: [], redactedSpans: [], ...extra,
});
const chunksFor = (slug: string, n: number): SanitizedChunk[] => Array.from({ length: n }, (_, i) => chunk(`${slug}#x-${i + 1}`, i));
function storeWithVectors(vectors: Record<string, number[]>) {
  const s = createVectorStore(new DatabaseSync(':memory:'));
  const ids = Object.keys(vectors);
  s.upsertDocument(doc('a', 'sha-a'), ids.map((id, i) => chunk(id, i)));
  s.replaceVectors('hash-v1:idf=aaaaaaaaaaaa', new Map(ids.map((id) => [id, new Float32Array(vectors[id]!)])));
  return s;
}

test('upsert idempotente por sha256', () => {
  const s = createVectorStore(new DatabaseSync(':memory:'));
  assert.equal(s.upsertDocument(doc('a', 'sha1'), chunksFor('a', 3)).changed, true);
  assert.equal(s.upsertDocument(doc('a', 'sha1'), chunksFor('a', 3)).changed, false);
  assert.equal(s.counts().chunks, 3);
});
test('RAG-01 busca por cosseno ordenada, com k e ignorando chunks sem vetor', () => {
  const s = storeWithVectors({ 'a#x-1': [1, 0], 'a#x-2': [0.6, 0.8], 'a#x-3': [0, 1] }); // vetores 2D de teste
  const r = s.search(new Float32Array([1, 0]), 2);
  assert.deepEqual(r.map((h) => h.chunk.id), ['a#x-1', 'a#x-2']);
  assert.ok(r[0]!.score >= r[1]!.score);
});
test('índice vazio devolve lista vazia', () => {
  assert.deepEqual(createVectorStore(new DatabaseSync(':memory:')).search(new Float32Array(2048), 3), []);
});
test('assertEmbedder exige o mesmo fingerprint', () => {
  const s = createVectorStore(new DatabaseSync(':memory:'));
  assert.throws(() => s.assertEmbedder('hash-v1:idf=aaaaaaaaaaaa'), ReindexRequiredError);
  s.replaceVectors('hash-v1:idf=aaaaaaaaaaaa', new Map());
  s.assertEmbedder('hash-v1:idf=aaaaaaaaaaaa');
  assert.throws(() => s.assertEmbedder('hash-v1:idf=bbbbbbbbbbbb'), ReindexRequiredError);
});

// Complementos
test('chunk sem vetor fica fora da busca e marcado hasVector false', () => {
  const s = storeWithVectors({ 'a#x-1': [1, 0] });
  s.upsertDocument(doc('b', 'sha-b'), [chunk('b#y-1')]);
  assert.equal(s.getChunk('b#y-1')?.hasVector, false);
  assert.equal(s.getChunk('a#x-1')?.hasVector, true);
  assert.deepEqual(s.search(new Float32Array([1, 0]), 5).map((h) => h.chunk.id), ['a#x-1']);
});
test('upsert com sha novo troca os chunks do documento e invalida a busca', () => {
  const s = storeWithVectors({ 'a#x-1': [1, 0], 'a#x-2': [0, 1] });
  assert.equal(s.search(new Float32Array([1, 0]), 3).length, 2);
  assert.equal(s.upsertDocument(doc('a', 'sha-novo'), [chunk('a#z-1')]).changed, true);
  assert.deepEqual(s.allChunks().map((c) => c.id), ['a#z-1']);
  assert.equal(s.documentSha('a'), 'sha-novo');
  assert.deepEqual(s.search(new Float32Array([1, 0]), 3), []);
});
test('campos sanitizados sobrevivem ao banco; counts conta sinalizados', () => {
  const s = createVectorStore(new DatabaseSync(':memory:'));
  s.upsertDocument(doc('c', 'sha-c'), [chunk('c#p-1', 0, { flagged: true, flagReasons: ['automated_systems_note'], redactedSpans: ['span original'] }), chunk('c#p-2', 1)]);
  const c = s.getChunk('c#p-1')!;
  assert.deepEqual([c.flagged, c.flagReasons, c.redactedSpans, c.docTitle, c.heading, c.ordinal], [true, ['automated_systems_note'], ['span original'], 'Título c', 'Seção', 0]);
  assert.deepEqual(s.counts(), { documents: 1, chunks: 2, flagged: 1 });
  assert.equal(s.getChunk('inexistente'), undefined);
});
test('removeDocument, listDocuments, documentSha e meta', () => {
  const s = createVectorStore(new DatabaseSync(':memory:'));
  s.upsertDocument(doc('a', 'sha-a'), chunksFor('a', 2));
  s.upsertDocument(doc('b', 'sha-b'), chunksFor('b', 1));
  assert.deepEqual(s.listDocuments().map((d) => d.slug), ['a', 'b']);
  s.removeDocument('a');
  assert.deepEqual(s.listDocuments(), [{ slug: 'b', title: 'Título b', sha256: 'sha-b' }]);
  assert.equal(s.documentSha('a'), null);
  assert.equal(s.counts().chunks, 1);
  assert.equal(s.getMeta('idf'), null);
  s.setMeta('idf', '{"n":1}'); s.setMeta('idf', '{"n":2}');
  assert.equal(s.getMeta('idf'), '{"n":2}');
});
test('replaceVectors apaga vetores fora do mapa e grava o fingerprint', () => {
  const s = storeWithVectors({ 'a#x-1': [1, 0], 'a#x-2': [0, 1] });
  s.replaceVectors('hash-v1:idf=cccccccccccc', new Map([['a#x-2', new Float32Array([0, 1])]]));
  assert.equal(s.getChunk('a#x-1')?.hasVector, false);
  assert.equal(s.getMeta('fingerprint'), 'hash-v1:idf=cccccccccccc');
  assert.deepEqual(s.search(new Float32Array([0, 1]), 3).map((h) => [h.chunk.id, h.score]), [['a#x-2', 1]]);
});
test('vetor de dimensão diferente da consulta exige reindexação', () => {
  const s = storeWithVectors({ 'a#x-1': [1, 0] });
  assert.throws(() => s.search(new Float32Array(3), 1), ReindexRequiredError);
});
test('empate de score desempata por ordinal', () => {
  const s = storeWithVectors({ 'a#x-1': [0, 1], 'a#x-2': [1, 0], 'a#x-3': [1, 0] });
  assert.deepEqual(s.search(new Float32Array([1, 0]), 2).map((h) => h.chunk.id), ['a#x-2', 'a#x-3']);
});
