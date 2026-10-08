import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createVectorStore } from '../../src/rag/vector-store.ts';
import { embeddingText, ingestKnowledgeBase, ingestToMemory, loadEmbedder } from '../../src/rag/ingest.ts';
import { ReindexRequiredError } from '../../src/domain/errors.ts';
import { makeTempDir } from '../helpers/tmp.ts';

// Copia data/kb para um tmpdir e cria a store em :memory:.
async function freshCopy() {
  const kbDir = makeTempDir('dda');
  for (const f of fs.readdirSync('data/kb')) fs.copyFileSync(path.join('data/kb', f), path.join(kbDir, f));
  return { kbDir, store: createVectorStore(new DatabaseSync(':memory:')) };
}

test('RAG-05 ingerir duas vezes não recria chunks nem vetores', async () => {
  const { store, kbDir } = await freshCopy();
  await ingestKnowledgeBase({ store, kbDir });
  const second = await ingestKnowledgeBase({ store, kbDir });
  assert.deepEqual([second.changed, second.chunksRecreated, second.vectorsRecomputed], [0, 0, 0]);
});
test('alterar um documento recria só os chunks dele e recalcula todos os vetores', async () => {
  const { store, kbDir } = await freshCopy(); const first = await ingestKnowledgeBase({ store, kbDir });
  const before = new Map(store.allChunks().filter((c) => c.docSlug !== 'shipping-and-delivery-times').map((c) => [c.id, c.text]));
  fs.appendFileSync(path.join(kbDir, 'shipping-and-delivery-times.md'), '\nNova frase sobre entregas expressas.\n');
  const r = await ingestKnowledgeBase({ store, kbDir });
  assert.equal(r.changed, 1);
  assert.equal(r.chunksRecreated, store.allChunks().filter((c) => c.docSlug === 'shipping-and-delivery-times').length);
  assert.equal(r.vectorsRecomputed, store.counts().chunks);
  assert.notEqual(r.fingerprint, first.fingerprint);
  for (const [id, text] of before) assert.equal(store.getChunk(id)?.text, text);
});
test('GRD-04 o chunk envenenado fica flagged, redigido e com o span guardado', async () => {
  const { store } = await ingestToMemory();
  const c = store.allChunks().find((x) => x.flagged)!;
  assert.ok(c.flagReasons.includes('automated_systems_note'));
  assert.doesNotMatch(c.text, /FULL-MOON-100/);
  assert.ok(c.redactedSpans.some((s) => s.includes('FULL-MOON-100')));
});
test('documento apagado tem os chunks removidos', async () => {
  const { store, kbDir } = await freshCopy(); await ingestKnowledgeBase({ store, kbDir });
  fs.rmSync(path.join(kbDir, 'subscription-club.md'));
  const r = await ingestKnowledgeBase({ store, kbDir });
  assert.equal(r.removed, 1);
  assert.equal(store.allChunks().some((c) => c.docSlug === 'subscription-club'), false);
});

// Complementos
test('primeira ingestão: 8 documentos novos, 1 chunk sinalizado, todos com vetor e fingerprint no índice', async () => {
  const { store, embedder, report } = await ingestToMemory();
  assert.deepEqual([report.added, report.changed, report.unchanged, report.removed], [8, 0, 0, 0]);
  assert.equal(report.chunksRecreated, store.counts().chunks);
  assert.equal(report.vectorsRecomputed, store.counts().chunks);
  assert.equal(report.flagged, 1);
  assert.ok(store.allChunks().every((c) => c.hasVector));
  assert.equal(embedder.fingerprint, report.fingerprint);
  store.assertEmbedder(embedder.fingerprint);
  assert.match(report.fingerprint, /^hash-v1:idf=[0-9a-f]{12}$/);
});
test('force recria chunks e vetores sem mudança de conteúdo; mesmo fingerprint', async () => {
  const { store, kbDir } = await freshCopy(); const first = await ingestKnowledgeBase({ store, kbDir });
  const r = await ingestKnowledgeBase({ store, kbDir, force: true });
  assert.equal(r.unchanged, 8);
  assert.equal(r.chunksRecreated, store.counts().chunks);
  assert.equal(r.vectorsRecomputed, store.counts().chunks);
  assert.equal(r.fingerprint, first.fingerprint);
});
test('mudar o tamanho do chunk rechunka tudo mesmo sem mudança nos arquivos', async () => {
  const { store, kbDir } = await freshCopy(); await ingestKnowledgeBase({ store, kbDir });
  const r = await ingestKnowledgeBase({ store, kbDir, chunkSize: 400, chunkOverlap: 50 });
  assert.equal(r.chunksRecreated, store.counts().chunks);
  assert.ok(store.allChunks().every((c) => c.text.length <= 400));
});
test('loadEmbedder sem IDF gravado exige reindexação; índice vazio ingere sem quebrar', async () => {
  const empty = createVectorStore(new DatabaseSync(':memory:'));
  assert.throws(() => loadEmbedder(empty), ReindexRequiredError);
  const kbDir = makeTempDir('dda');
  const r = await ingestKnowledgeBase({ store: empty, kbDir });
  assert.deepEqual([r.added, r.chunksRecreated], [0, 0]);
  assert.deepEqual(empty.search((await loadEmbedder(empty).embed(['shipping']))[0]!, 3), []);
});
test('o texto embedado inclui título e seção: a busca acha a seção pelo nome', async () => {
  const { store, embedder } = await ingestToMemory();
  const [q] = await embedder.embed(['Order tracking']);
  assert.equal(store.search(q!, 1)[0]?.chunk.id, 'shipping-and-delivery-times#order-tracking-1');
});
test('CLI ingest grava app.db, imprime o relatório e a segunda execução não recria nada', () => {
  const dir = makeTempDir('dda');
  const appDb = path.join(dir, 'sub', 'app.db');
  const env = { ...process.env, APP_DB_PATH: appDb };
  const first = spawnSync(process.execPath, ['src/cli/ingest.ts', '--force'], { env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /documents: 8 new/);
  assert.match(first.stdout, /chunks flagged: 1/);
  assert.ok(fs.existsSync(appDb));
  const second = spawnSync(process.execPath, ['src/cli/ingest.ts'], { env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /0 new, 0 changed, 8 unchanged/);
  assert.match(second.stdout, /chunks recreated: 0/);
  assert.match(second.stdout, /vectors recomputed: 0/);
});
test('texto embedado: título, seção contada duas vezes (reforço do tópico) e o trecho', () => {
  assert.equal(embeddingText({ docTitle: 'Frete', heading: 'Rastreio do pedido', text: 'Código por e-mail.' }),
    'Frete — Rastreio do pedido — Rastreio do pedido\nCódigo por e-mail.');
});
