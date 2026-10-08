import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { AskResponseSchema } from '../../src/domain/schemas.ts';
import { exitCodeFor } from '../../src/cli/ask.ts';
import { makeTempDir } from '../helpers/tmp.ts';

const env = (dir: string, extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH!, NODE_OPTIONS: process.env.NODE_OPTIONS!, APP_DB_PATH: `${dir}/app.db`, SALES_DB_PATH: `${dir}/sales.db`, LLM_PROVIDER: 'fake', ...extra,
});
const tmp = () => makeTempDir('dda');

// --- ask ---
test('ask --json sai com 0 e imprime AskResponse válido', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['src/cli/ask.ts', '--json', DEMO_SCENARIOS[0]!.question], { env: env(dir), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(AskResponseSchema.safeParse(JSON.parse(r.stdout)).success, true);
});

test('LLM-05 pergunta sem fixture sai com código 2', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['src/cli/ask.ts', 'pergunta sem fixture alguma'], { env: env(dir), encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /fixtures\/llm/);
});

// Complementos
test('ask sem --json imprime rota, status, fontes e a linha de meta', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['src/cli/ask.ts', DEMO_SCENARIOS[0]!.question], { env: env(dir), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[FAKE · hash-v1\] route=docs \(.+\) · status=answered$/m);
  assert.match(r.stdout, /^Sources$/m);
  assert.match(r.stdout, /^ {2}\[1\] .+ › .+ {2,}score 0\.\d{2}$/m);
  assert.match(r.stdout, /^2 LLM calls · [\d,]+ tokens \(estimated\) · US\$ \d+\.\d+ \(fictional\) · \d+ ms · req [0-9a-f]{8}$/m);
  assert.ok(fs.existsSync(path.join(dir, 'sales.db')) && fs.existsSync(path.join(dir, 'app.db')), 'modo file grava os bancos indicados');
});

test('ask de dados mostra a SQL com a correção, a tabela e as perguntas para continuar', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['src/cli/ask.ts', DEMO_SCENARIOS[3]!.question], { env: env(dir), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /route=data/); assert.match(r.stdout, /^SQL \(1 correction\)$/m);
  assert.match(r.stdout, /SUM\(oi\.quantity\)/); assert.match(r.stdout, /^ {2}name +total$/m);
  assert.match(r.stdout, /^Follow-up questions:$/m);
  assert.match(r.stdout, /· 1 correction ·/);
});

test('RTE-02 ask --route data força a rota e o bloqueio aparece com o motivo', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['src/cli/ask.ts', '--route', 'data', '--json', DEMO_SCENARIOS[11]!.question], { env: env(dir), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const body = AskResponseSchema.parse(JSON.parse(r.stdout));
  assert.deepEqual([body.overridden, body.route, body.status, body.blockedBy], [true, 'data', 'blocked', 'sql_authorizer']);
});

test('LLM-03 ask com todos os modelos fora sai com código 3; argumentos inválidos saem com 1', () => {
  const dir = tmp();
  const down = spawnSync(process.execPath, ['src/cli/ask.ts', DEMO_SCENARIOS[0]!.question], { env: env(dir, { LLM_FAKE_CHAOS: 'all-down', LLM_MAX_RETRIES: '0' }), encoding: 'utf8' });
  assert.equal(down.status, 3, down.stderr); assert.match(down.stderr, /llm_unavailable/);
  for (const args of [[], ['--route', 'sql', 'qual o prazo?'], ['--nao-existe', 'qual o prazo?']]) {
    const r = spawnSync(process.execPath, ['src/cli/ask.ts', ...args], { env: env(dir), encoding: 'utf8' });
    assert.equal(r.status, 1, JSON.stringify(args)); assert.match(r.stderr, /usage:/);
  }
});

test('códigos de saída do ask seguem a spec 005', () => {
  assert.deepEqual([200, 422, 503, 504, 400, 500].map(exitCodeFor), [0, 2, 3, 4, 1, 1]);
});

// --- demo ---
test('ENV-04 demo sai com 0, ignora a chave do shell e não grava em data/', () => {
  const before = fs.existsSync('data') ? fs.readdirSync('data').map((f) => [f, fs.statSync(path.join('data', f)).mtimeMs]) : [];
  const r = spawnSync(process.execPath, ['src/cli/demo.ts'], { env: { PATH: process.env.PATH!, NODE_OPTIONS: process.env.NODE_OPTIONS!, OPENROUTER_API_KEY: 'sk-or-shell-key' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Provider: fake/); assert.match(r.stdout, /13\/13/); assert.match(r.stdout, /simulated compliant model/);
  const after = fs.existsSync('data') ? fs.readdirSync('data').map((f) => [f, fs.statSync(path.join('data', f)).mtimeMs]) : [];
  assert.deepEqual(after, before);
});

// Complementos
test('ENV-04 runDemo em processo imprime cabeçalho, 13 linhas, rodapé e a linha de /stats', async () => {
  const { runDemo } = await import('../../src/cli/demo.ts');
  const lines: string[] = [];
  const code = await runDemo({ write: (s) => lines.push(s) });
  const out = lines.join('\n');
  assert.equal(code, 0, out);
  assert.match(out, /^Lunar Mill · docs-data-assistant · scripted demo$/m);
  assert.match(out, /Embedder: hash-v1\. In-memory data\./);
  for (let i = 1; i <= 13; i++) assert.match(out, new RegExp(`^ ?${i} `, 'm'), `linha do cenário ${i}`);
  assert.match(out, /^ ?8 .+ - +blocked +input_rules: instruction_override/m);
  assert.match(out, /^10 .+\* +docs +blocked +output_guard: canary/m);
  assert.match(out, /^11 .+\* +data +blocked +sql_policy: not_select/m);
  assert.match(out, /^13 .+ docs +answered +.*4 retries · 2 fallbacks → fake\/fallback/m);
  assert.match(out, /^\/stats: 13 req · P50 \d+ ms · P95 \d+ ms · \d+ LLM calls · 4 retries · 2 fallbacks · US\$ \d+\.\d+ \(fictional\)$/m);
});
