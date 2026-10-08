// Vector store em app.db (node:sqlite): documentos, chunks sanitizados, vetores e kb_meta.
// Upsert idempotente por sha256, busca top-k por produto escalar (= cosseno, vetores normalizados) com cache.
import type { DatabaseSync } from 'node:sqlite';
import { ReindexRequiredError } from '../domain/errors.ts';
import type { RawChunk } from './chunker.ts';

export interface KbDocument { slug: string; title: string; sha256: string }
export type SanitizedChunk = RawChunk & { flagged: boolean; flagReasons: string[]; redactedSpans: string[] };
export type StoredChunk = SanitizedChunk & { hasVector: boolean };
export interface ScoredChunk { chunk: StoredChunk; score: number }

export interface VectorStore {
  upsertDocument(doc: KbDocument, chunks: readonly SanitizedChunk[]): { changed: boolean };
  replaceVectors(fingerprint: string, vectors: ReadonlyMap<string, Float32Array>): void;
  search(query: Float32Array, k: number): ScoredChunk[];
  assertEmbedder(fingerprint: string): void;
  counts(): { documents: number; chunks: number; flagged: number };
}

export type KbStore = VectorStore & {
  getChunk(id: string): StoredChunk | undefined;
  allChunks(): StoredChunk[];
  documentSha(slug: string): string | null;
  listDocuments(): KbDocument[];
  removeDocument(slug: string): void;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
};

const DDL = `
CREATE TABLE IF NOT EXISTS documents (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_slug TEXT NOT NULL REFERENCES documents(slug) ON DELETE CASCADE,
  doc_title TEXT NOT NULL,
  heading TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  flagged INTEGER NOT NULL,
  flag_reasons TEXT NOT NULL,
  redacted_spans TEXT NOT NULL,
  vector BLOB
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks (doc_slug);
CREATE TABLE IF NOT EXISTS kb_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

function toChunk(r: Row): StoredChunk {
  return {
    id: String(r.id), docSlug: String(r.doc_slug), docTitle: String(r.doc_title), heading: String(r.heading),
    ordinal: Number(r.ordinal), text: String(r.text), flagged: Number(r.flagged) === 1,
    flagReasons: JSON.parse(String(r.flag_reasons)) as string[], redactedSpans: JSON.parse(String(r.redacted_spans)) as string[],
    hasVector: Number(r.has_vector) === 1,
  };
}

function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function fromBlob(b: Uint8Array): Float32Array {
  // Copia para um ArrayBuffer próprio: o buffer devolvido pelo SQLite pode não estar alinhado a 4 bytes.
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const CHUNK_COLUMNS = 'id, doc_slug, doc_title, heading, ordinal, text, flagged, flag_reasons, redacted_spans, vector IS NOT NULL AS has_vector';

export function createVectorStore(db: DatabaseSync): KbStore {
  db.exec(DDL);
  const q = {
    docSha: db.prepare('SELECT sha256 FROM documents WHERE slug = ?'),
    listDocs: db.prepare('SELECT slug, title, sha256 FROM documents ORDER BY slug'),
    upsertDoc: db.prepare(`INSERT INTO documents (slug, title, sha256, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET title = excluded.title, sha256 = excluded.sha256, updated_at = excluded.updated_at`),
    deleteDoc: db.prepare('DELETE FROM documents WHERE slug = ?'),
    deleteChunks: db.prepare('DELETE FROM chunks WHERE doc_slug = ?'),
    insertChunk: db.prepare(`INSERT INTO chunks (id, doc_slug, doc_title, heading, ordinal, text, flagged, flag_reasons, redacted_spans, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`),
    getChunk: db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks WHERE id = ?`),
    allChunks: db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks ORDER BY doc_slug, ordinal`),
    withVectors: db.prepare(`SELECT ${CHUNK_COLUMNS}, vector FROM chunks WHERE vector IS NOT NULL ORDER BY doc_slug, ordinal`),
    clearVectors: db.prepare('UPDATE chunks SET vector = NULL'),
    setVector: db.prepare('UPDATE chunks SET vector = ? WHERE id = ?'),
    getMeta: db.prepare('SELECT value FROM kb_meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO kb_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    counts: db.prepare(`SELECT (SELECT COUNT(*) FROM documents) AS documents, (SELECT COUNT(*) FROM chunks) AS chunks,
      (SELECT COUNT(*) FROM chunks WHERE flagged = 1) AS flagged`),
  };

  let cache: { chunk: StoredChunk; vector: Float32Array }[] | null = null;
  const invalidate = () => { cache = null; };

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      invalidate();
    }
  };

  const getMeta = (key: string): string | null => {
    const row = q.getMeta.get(key) as Row | undefined;
    return row ? String(row.value) : null;
  };
  const documentSha = (slug: string): string | null => {
    const row = q.docSha.get(slug) as Row | undefined;
    return row ? String(row.sha256) : null;
  };

  return {
    upsertDocument(doc, chunks) {
      if (documentSha(doc.slug) === doc.sha256) return { changed: false };
      tx(() => {
        q.deleteChunks.run(doc.slug);
        q.upsertDoc.run(doc.slug, doc.title, doc.sha256, new Date().toISOString());
        for (const c of chunks) {
          q.insertChunk.run(c.id, doc.slug, c.docTitle, c.heading, c.ordinal, c.text, c.flagged ? 1 : 0,
            JSON.stringify(c.flagReasons), JSON.stringify(c.redactedSpans));
        }
      });
      return { changed: true };
    },
    replaceVectors(fingerprint, vectors) {
      tx(() => {
        q.clearVectors.run();
        for (const [id, v] of vectors) q.setVector.run(toBlob(v), id);
        q.setMeta.run('fingerprint', fingerprint);
      });
    },
    search(query, k) {
      if (k <= 0) return [];
      cache ??= (q.withVectors.all() as Row[]).map((r) => ({ chunk: toChunk(r), vector: fromBlob(r.vector as Uint8Array) }));
      const scored: ScoredChunk[] = cache.map(({ chunk, vector }) => {
        if (vector.length !== query.length) {
          throw new ReindexRequiredError(`vetor do chunk ${chunk.id} tem ${vector.length} dimensões e a consulta ${query.length}: rode npm run ingest -- --force`);
        }
        let score = 0;
        for (let i = 0; i < vector.length; i++) score += vector[i]! * query[i]!;
        return { chunk, score };
      });
      scored.sort((a, b) => b.score - a.score || a.chunk.docSlug.localeCompare(b.chunk.docSlug) || a.chunk.ordinal - b.chunk.ordinal);
      return scored.slice(0, k);
    },
    assertEmbedder(fingerprint) {
      const stored = getMeta('fingerprint');
      if (stored === null) throw new ReindexRequiredError('o índice ainda não tem vetores: rode npm run ingest -- --force');
      if (stored !== fingerprint) {
        throw new ReindexRequiredError(`o índice foi gerado por ${stored}, mas o embedder ativo é ${fingerprint}: rode npm run ingest -- --force`);
      }
    },
    counts() {
      const r = q.counts.get() as Row;
      return { documents: Number(r.documents), chunks: Number(r.chunks), flagged: Number(r.flagged) };
    },
    getChunk(id) {
      const r = q.getChunk.get(id) as Row | undefined;
      return r ? toChunk(r) : undefined;
    },
    allChunks() {
      return (q.allChunks.all() as Row[]).map(toChunk);
    },
    documentSha,
    listDocuments() {
      return (q.listDocs.all() as Row[]).map((r) => ({ slug: String(r.slug), title: String(r.title), sha256: String(r.sha256) }));
    },
    removeDocument(slug) {
      tx(() => {
        q.deleteChunks.run(slug);
        q.deleteDoc.run(slug);
      });
    },
    getMeta,
    setMeta(key, value) {
      q.setMeta.run(key, value);
    },
  };
}
