// npm run ingest -- [--force]
// Indexa data/kb/*.md em app.db (APP_DB_PATH). Sem --force, só rechunka documentos novos ou alterados.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config.ts';
import { ingestKnowledgeBase } from '../rag/ingest.ts';
import { createVectorStore } from '../rag/vector-store.ts';

async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { force: { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
    const config = loadConfig();
    const appDb = path.resolve(config.paths.appDb);
    fs.mkdirSync(path.dirname(appDb), { recursive: true });
    const db = new DatabaseSync(appDb);
    try {
      const r = await ingestKnowledgeBase({
        store: createVectorStore(db), kbDir: 'data/kb', force: values.force,
        chunkSize: config.rag.chunkSize, chunkOverlap: config.rag.chunkOverlap,
      });
      console.log(`documentos: ${r.added} novos, ${r.changed} alterados, ${r.unchanged} inalterados, ${r.removed} removidos`);
      console.log(`chunks recriados: ${r.chunksRecreated}`);
      console.log(`vetores recalculados: ${r.vectorsRecomputed}`);
      console.log(`chunks sinalizados: ${r.flagged}`);
      console.log(`fingerprint: ${r.fingerprint}`);
      console.log(`índice: ${appDb}`);
    } finally {
      db.close();
    }
    return 0;
  } catch (err) {
    console.error(`ingest falhou: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
