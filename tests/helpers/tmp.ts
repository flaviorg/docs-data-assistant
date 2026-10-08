// Pastas temporárias dos testes: criadas em os.tmpdir() e apagadas, com tudo o que houver dentro, quando o processo de
// teste termina (o node --test roda cada arquivo num processo próprio). Antes, cada `npm test` deixava 66 pastas dda-*.
// tests/unit/test-hygiene.unit.test.ts barra mkdtempSync direto nos testes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

function removeAll(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Cria `<tmpdir>/<prefix>-XXXXXX` e agenda a remoção para a saída do processo. */
export function makeTempDir(prefix = 'dda'): string {
  if (created.length === 0) process.once('exit', removeAll);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  created.push(dir);
  return dir;
}
