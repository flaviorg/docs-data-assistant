import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ENV_KEYS, loadConfig } from '../../src/config.ts';
import { assertSqliteFeatures } from '../../src/sql/readonly-connection.ts';

function exampleLines(): string[] {
  return fs.readFileSync('.env.example', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

test('.env.example lista exatamente as chaves que o config conhece', () => {
  const keys = fs.readFileSync('.env.example', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split('=')[0]!);
  assert.deepEqual(keys, [...ENV_KEYS]);
});

// Complementos
test('ENV-01 .env.example não traz chave preenchida e seus valores passam no loadConfig', () => {
  const env: Record<string, string> = {};
  for (const line of exampleLines()) {
    const eq = line.indexOf('=');
    const value = line.slice(eq + 1).replace(/\s+#.*$/, '').trim();
    env[line.slice(0, eq)] = value;
  }
  assert.equal(env.OPENROUTER_API_KEY, '');
  assert.equal(env.LLM_PROVIDER, '');
  const config = loadConfig({ env });
  assert.equal(config.llm.provider, 'fake');
  assert.equal(config.rag.embedder, 'hash');
});

test('package.json exige Node 24.15+ e o .npmrc liga engine-strict, para o npm ci falhar cedo em Node antigo', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { engines?: { node?: string } };
  assert.equal(pkg.engines?.node, '>=24.15');
  assert.match(fs.readFileSync('.npmrc', 'utf8'), /^engine-strict=true$/m);
});
test('sem DatabaseSync.setAuthorizer ou DatabaseSync.limits (Node antigo) a conexão analítica falha com mensagem que pede Node 24.15+', () => {
  assert.throws(() => assertSqliteFeatures({}), /Node 24\.15 ou mais novo/);
  assert.throws(() => assertSqliteFeatures({ setAuthorizer() {} }), /Node 24\.15 ou mais novo.*limits/);
  assert.doesNotThrow(() => assertSqliteFeatures({ setAuthorizer() {}, limits: { length: 1 } }));
});
