import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Higiene da suíte: `npm test` não pode deixar lixo na máquina de quem roda.

const testFiles = (): string[] => fs.readdirSync('tests', { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));

test('nenhum teste cria pasta temporária fora de tests/helpers/tmp.ts, que apaga as pastas no fim do processo', () => {
  const helper = path.join('helpers', 'tmp.ts');
  const offenders = testFiles().filter((f) => f !== helper && /\bmkdtempSync\s*\(/.test(fs.readFileSync(path.join('tests', f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('makeTempDir apaga a pasta, com o que houver dentro, quando o processo termina', () => {
  const helperUrl = pathToFileURL(path.resolve('tests/helpers/tmp.ts')).href;
  const script = `import fs from 'node:fs';
import { makeTempDir } from ${JSON.stringify(helperUrl)};
const dir = makeTempDir('dda-hygiene');
fs.mkdirSync(dir + '/sub');
fs.writeFileSync(dir + '/sub/arquivo.db', 'x');
console.log(dir);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const dir = r.stdout.trim();
  assert.match(path.basename(dir), /^dda-hygiene-/);
  assert.equal(fs.existsSync(dir), false, `${dir} ficou para trás`);
});
