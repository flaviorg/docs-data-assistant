// ensureData (modo file): semeia data/sales.db se não existir e mantém o índice de data/app.db em dia com data/kb.
// A ingestão já não faz nada quando nada mudou; documento editado, apagado ou app.db ausente reindexam sozinhos.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSalesDb } from './cli/seed.ts';
import type { AppConfig } from './config.ts';
import type { Logger } from './obs/logger.ts';
import { ingestKnowledgeBase } from './rag/ingest.ts';
import type { IngestReport } from './rag/ingest.ts';
import { createVectorStore } from './rag/vector-store.ts';
import { DEFAULT_SEED } from './sql/seed.ts';

export async function ensureData(config: AppConfig, opts: { kbDir?: string; logger?: Logger } = {}): Promise<{ seeded: boolean; ingest: IngestReport }> {
  const seeded = !fs.existsSync(config.paths.salesDb);
  if (seeded) writeSalesDb(config.paths.salesDb, DEFAULT_SEED);

  fs.mkdirSync(path.dirname(path.resolve(config.paths.appDb)), { recursive: true });
  const db = new DatabaseSync(config.paths.appDb);
  let ingest: IngestReport;
  try {
    ingest = await ingestKnowledgeBase({
      store: createVectorStore(db),
      kbDir: opts.kbDir ?? 'data/kb',
      chunkSize: config.rag.chunkSize,
      chunkOverlap: config.rag.chunkOverlap,
    });
  } finally {
    db.close();
  }
  opts.logger?.info('ensure_data', {
    seeded, salesDb: config.paths.salesDb, appDb: config.paths.appDb,
    added: ingest.added, changed: ingest.changed, unchanged: ingest.unchanged, removed: ingest.removed,
    chunksRecreated: ingest.chunksRecreated, vectorsRecomputed: ingest.vectorsRecomputed, fingerprint: ingest.fingerprint,
  });
  return { seeded, ingest };
}
