import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureData } from '../../src/ensure-data.ts';
import { createAppContext } from '../../src/app-context.ts';
import { loadConfig } from '../../src/config.ts';
import { createLogger } from '../../src/obs/logger.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { REFUSAL_TEXT } from '../../src/rag/citations.ts';
import { makeTempDir } from '../helpers/tmp.ts';

const [Q1, , Q3] = DEMO_SCENARIOS.map((s) => s.question);
const silent = createLogger({ level: 'error', sink: () => {} });
// Cópia da base em pasta temporária: os testes editam documentos sem tocar em data/kb.
const copyKb = (): string => {
  const dir = makeTempDir('dda-kb');
  fs.cpSync('data/kb', dir, { recursive: true });
  return dir;
};
const tmpConfig = () => {
  const dir = makeTempDir('dda');
  return loadConfig({ env: {}, overrides: { APP_DB_PATH: path.join(dir, 'data', 'app.db'), SALES_DB_PATH: path.join(dir, 'data', 'sales.db') } });
};

test('primeira chamada semeia e indexa; segunda não muda nada', async () => {
  const kbDir = copyKb();
  const cfg = tmpConfig(); // overrides APP_DB_PATH e SALES_DB_PATH para um tmpdir
  const a = await ensureData(cfg, { kbDir }); assert.equal(a.seeded, true); assert.ok(a.ingest.added === 8);
  const b = await ensureData(cfg, { kbDir }); assert.equal(b.seeded, false); assert.equal(b.ingest.changed + b.ingest.added, 0);
});
test('documento editado reindexa; app.db apagado reingere', async () => {
  const kbDir = copyKb();
  const cfg = tmpConfig(); await ensureData(cfg, { kbDir });
  fs.appendFileSync(path.join(kbDir, 'frete-e-prazos.md'), '\nNova regra de entrega.\n');
  assert.equal((await ensureData(cfg, { kbDir })).ingest.changed, 1);
  fs.rmSync(cfg.paths.appDb); assert.equal((await ensureData(cfg, { kbDir })).ingest.added, 8);
});
test('contexto em modo file responde o cenário 1', async () => {
  const kbDir = copyKb();
  const ctx = await createAppContext(tmpConfig(), { dataMode: 'file', kbDir, logger: silent });
  const r = await ctx.askService.ask({ question: Q1! }); assert.ok(r.ok && r.response.status === 'answered'); ctx.close();
});

// Complementos
test('ensureData cria as pastas, grava sales.db com 4000 pedidos e o índice com 41 chunks', async () => {
  const cfg = tmpConfig();
  const r = await ensureData(cfg, { kbDir: copyKb() });
  assert.ok(fs.existsSync(cfg.paths.salesDb) && fs.existsSync(cfg.paths.appDb));
  const sales = new DatabaseSync(cfg.paths.salesDb, { readOnly: true });
  assert.equal((sales.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n, 4000); sales.close();
  assert.equal(r.ingest.chunksRecreated, 41); assert.equal(r.ingest.flagged, 1);
});
test('sales.db existente não é semeado de novo (nem sobrescrito)', async () => {
  const cfg = tmpConfig();
  await ensureData(cfg, { kbDir: copyKb() });
  const before = fs.statSync(cfg.paths.salesDb).mtimeMs;
  assert.equal((await ensureData(cfg, { kbDir: copyKb() })).seeded, false);
  assert.equal(fs.statSync(cfg.paths.salesDb).mtimeMs, before);
});
test('documento apagado sai do índice na próxima execução', async () => {
  const kbDir = copyKb(); const cfg = tmpConfig(); await ensureData(cfg, { kbDir });
  fs.rmSync(path.join(kbDir, 'sobre-a-empresa.md'));
  const r = await ensureData(cfg, { kbDir });
  assert.equal(r.ingest.removed, 1); assert.equal(r.ingest.unchanged, 7);
});
test('índice vazio recusa em vez de quebrar', async () => {
  const emptyKb = makeTempDir('dda-kb-empty');
  const ctx = await createAppContext(tmpConfig(), { dataMode: 'file', kbDir: emptyKb, logger: silent });
  assert.equal(ctx.store.counts().chunks, 0);
  const r = await ctx.askService.ask({ question: Q1! });
  assert.ok(r.ok); assert.deepEqual(r.ok && [r.response.status, r.response.answer], ['refused', REFUSAL_TEXT]);
  ctx.close();
});
test('modo file: banco de vendas aberto somente leitura e ramo data funcionando', async () => {
  const ctx = await createAppContext(tmpConfig(), { dataMode: 'file', kbDir: copyKb(), logger: silent });
  assert.throws(() => ctx.sales.db.exec('DELETE FROM order_items'));
  const r = await ctx.askService.ask({ question: Q3! });
  assert.ok(r.ok && r.response.status === 'answered' && r.response.sql?.rowCount === 3);
  assert.match(ctx.schemaText, /CREATE TABLE orders/);
  ctx.close();
});
test('modo file: o ledger persiste em app.db entre contextos', async () => {
  const cfg = tmpConfig(); const kbDir = copyKb();
  const a = await createAppContext(cfg, { dataMode: 'file', kbDir, logger: silent });
  await a.askService.ask({ question: Q1! }); a.close();
  const b = await createAppContext(cfg, { dataMode: 'file', kbDir, logger: silent });
  const s = b.ledger.stats(60 * 60 * 1000);
  assert.equal(s.requests.total, 1); assert.equal(s.llm.calls, 2);
  b.close();
});
test('modo file é o padrão de createAppContext', async () => {
  const cfg = tmpConfig();
  const ctx = await createAppContext(cfg, { kbDir: copyKb(), logger: silent });
  assert.ok(fs.existsSync(cfg.paths.appDb)); ctx.close();
});
test('ensureData registra o resultado no logger quando recebe um', async () => {
  const lines: string[] = [];
  await ensureData(tmpConfig(), { kbDir: copyKb(), logger: createLogger({ level: 'info', sink: (l) => lines.push(l) }) });
  const rec = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === 'ensure_data');
  assert.equal(rec?.seeded, true); assert.equal(rec?.added, 8);
});
