// npm run seed -- [--seed <n>] [--out <path>]
// Gera o banco de vendas fictício de forma determinística e grava de forma atômica (arquivo temporário + rename).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config.ts';
import { DEFAULT_SEED, seedSales } from '../sql/seed.ts';
import type { SeedReport } from '../sql/seed.ts';

export function writeSalesDb(out: string, seed: number): SeedReport {
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(':memory:');
  let report: SeedReport;
  let bytes: Uint8Array;
  try {
    report = seedSales(db, { seed });
    bytes = db.serialize();
  } finally {
    db.close();
  }
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return report;
}

function main(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { seed: { type: 'string' }, out: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error(`--seed precisa ser um inteiro entre 0 e 4294967295 (recebido: ${values.seed})`);
    }
    const out = values.out ?? loadConfig().paths.salesDb;
    const r = writeSalesDb(out, seed);
    const c = r.counts;
    console.log(`customers ${c.customers} · products ${c.products} · orders ${c.orders} · order_items ${c.orderItems} · contacts ${c.contacts}`);
    console.log(`fingerprint ${r.fingerprint}`);
    console.log(`seed ${seed} → ${path.resolve(out)}`);
    return 0;
  } catch (err) {
    console.error(`seed falhou: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
