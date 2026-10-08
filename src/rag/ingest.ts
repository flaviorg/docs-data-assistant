// Ingestão da base (RAG-05, GRD-04): lê data/kb/*.md, rechunka e sanitiza só o que mudou, ajusta o IDF sobre
// todos os chunks e recalcula os vetores de todos quando o IDF (fingerprint) muda.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReindexRequiredError } from '../domain/errors.ts';
import type { Embedder } from '../embeddings/embedder.ts';
import { createHashEmbedder } from '../embeddings/hash-embedder.ts';
import { fitIdf } from '../embeddings/text-features.ts';
import type { IdfTable } from '../embeddings/text-features.ts';
import { chunkMarkdown } from './chunker.ts';
import { sanitizeChunk } from './sanitizer.ts';
import { createVectorStore } from './vector-store.ts';
import type { KbStore, SanitizedChunk, StoredChunk } from './vector-store.ts';

export interface IngestReport {
  added: number; changed: number; unchanged: number; removed: number;
  chunksRecreated: number; vectorsRecomputed: number; flagged: number; fingerprint: string;
}

const DEFAULT_CHUNK_SIZE = 600;
const DEFAULT_CHUNK_OVERLAP = 100;

/** Texto que vira vetor: título do documento e seção dão contexto ao trecho. A seção entra duas vezes para
 * reforçar o tópico do chunk (ver docs/incidents/2026-10-04-hash-v1-calibration.md). */
export function embeddingText(c: Pick<StoredChunk, 'docTitle' | 'heading' | 'text'>): string {
  return `${c.docTitle} — ${c.heading} — ${c.heading}\n${c.text}`;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export async function ingestKnowledgeBase(deps: {
  store: KbStore;
  kbDir: string;
  force?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
}): Promise<IngestReport> {
  const { store, kbDir } = deps;
  const force = deps.force === true;
  const size = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = deps.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const chunking = `${size}/${overlap}`;
  // Mudou o tamanho ou o overlap: os chunks antigos não valem mais, mesmo com os arquivos iguais.
  const rechunkAll = force || store.getMeta('chunking') !== chunking;

  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md')).sort();
  const seen = new Set<string>();
  let added = 0, changed = 0, unchanged = 0, removed = 0, chunksRecreated = 0;

  for (const file of files) {
    const slug = file.slice(0, -'.md'.length);
    seen.add(slug);
    const markdown = fs.readFileSync(path.join(kbDir, file), 'utf8');
    const sha = sha256(markdown);
    const previous = store.documentSha(slug);
    if (previous === null) added++;
    else if (previous !== sha) changed++;
    else unchanged++;
    if (previous === sha && !rechunkAll) continue;

    const raw = chunkMarkdown({ slug, markdown }, { size, overlap });
    const chunks: SanitizedChunk[] = raw.map((c) => {
      const s = sanitizeChunk(c.text);
      return { ...c, text: s.text, flagged: s.flagged, flagReasons: s.reasons, redactedSpans: s.redactedSpans };
    });
    const title = raw[0]?.docTitle ?? /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? slug;
    if (previous === sha) store.removeDocument(slug);   // rechunk forçado: o upsert por sha seria no-op
    store.upsertDocument({ slug, title, sha256: sha }, chunks);
    chunksRecreated += chunks.length;
  }

  for (const d of store.listDocuments()) {
    if (!seen.has(d.slug)) {
      store.removeDocument(d.slug);
      removed++;
    }
  }
  store.setMeta('chunking', chunking);

  const all = store.allChunks();
  const texts = all.map(embeddingText);
  const idf = fitIdf(texts);
  const embedder = createHashEmbedder(idf);
  const needVectors = force || store.getMeta('fingerprint') !== embedder.fingerprint || all.some((c) => !c.hasVector);
  let vectorsRecomputed = 0;
  if (needVectors) {
    const vectors = await embedder.embed(texts);
    store.replaceVectors(embedder.fingerprint, new Map(all.map((c, i) => [c.id, vectors[i]!])));
    store.setMeta('idf', JSON.stringify(idf));
    vectorsRecomputed = all.length;
  } else if (store.getMeta('idf') === null) {
    store.setMeta('idf', JSON.stringify(idf));
  }

  return {
    added, changed, unchanged, removed, chunksRecreated, vectorsRecomputed,
    flagged: store.counts().flagged, fingerprint: embedder.fingerprint,
  };
}

/** Reconstrói o embedder a partir do IDF gravado no índice e confere o fingerprint. */
export function loadEmbedder(store: KbStore): Embedder {
  const raw = store.getMeta('idf');
  if (raw === null) throw new ReindexRequiredError('the index has no stored IDF: run npm run ingest -- --force');
  const idf = JSON.parse(raw) as IdfTable;
  if (typeof idf?.n !== 'number' || typeof idf.df !== 'object' || idf.df === null) {
    throw new ReindexRequiredError('the IDF stored in the index is corrupted: run npm run ingest -- --force');
  }
  const embedder = createHashEmbedder(idf);
  store.assertEmbedder(embedder.fingerprint);
  return embedder;
}

/** Índice completo em :memory: (testes, demo e eval). */
export async function ingestToMemory(kbDir = 'data/kb'): Promise<{ db: DatabaseSync; store: KbStore; embedder: Embedder; report: IngestReport }> {
  const db = new DatabaseSync(':memory:');
  const store = createVectorStore(db);
  const report = await ingestKnowledgeBase({ store, kbDir });
  return { db, store, embedder: loadEmbedder(store), report };
}
