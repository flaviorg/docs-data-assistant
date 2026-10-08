import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFixtures } from '../../src/llm/fixtures.ts';
import { makeTempDir } from '../helpers/tmp.ts';

const dirWith = (files: Record<string, unknown>): string => {
  const dir = makeTempDir('dda');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
  return dir;
};
const genFile = (entries: unknown[]) => ({ promptId: 'sql-generate', version: 'v1', entries });
const ragFile = (embedder: string) => ({ promptId: 'rag-answer', version: 'v1', embedder, entries: [
  { key: 'qual o prazo', response: { refused: false, answer: 'x', citedChunkIds: ['a#b-1'] } },
] });
const routerFile = (keys: string[]) => ({ promptId: 'router', version: 'v1',
  entries: keys.map((key) => ({ key, response: { intent: 'docs', reason: 'motivo' } })) });

test('responseFromGolden resolve e referência inexistente falha', () => {
  const idx = loadFixtures(dirWith({ 'sql-generate.v1.json': genFile([{ key: 'k', responseFromGolden: 'data-001' }]) }),
    { activeEmbedderId: 'hash-v1', resolveGoldenSql: (id) => (id === 'data-001' ? 'SELECT 1' : undefined) });
  assert.deepEqual(idx.lookup('sql-generate', 'v1', 'k')?.response, { sql: 'SELECT 1', rationale: 'consulta de referência' });
  assert.throws(() => loadFixtures(dirWith({ 'sql-generate.v1.json': genFile([{ key: 'k', responseFromGolden: 'data-999' }]) }),
    { activeEmbedderId: 'hash-v1', resolveGoldenSql: () => undefined }), /data-999/);
});
test('cabeçalho embedder diferente do ativo falha; chave duplicada falha', () => {
  assert.throws(() => loadFixtures(dirWith({ 'rag-answer.v1.json': ragFile('hash-v1') }), { activeEmbedderId: 'minilm-l6-v2' }), /embedder/);
  assert.throws(() => loadFixtures(dirWith({ 'router.v1.json': routerFile(['a', 'a']) }), { activeEmbedderId: 'hash-v1' }), /duplicad/);
});

// Complementos
test('lookup por prompt, versão e chave; all lista as entradas com o arquivo de origem', () => {
  const idx = loadFixtures(dirWith({ 'router.v1.json': routerFile(['a', 'b']), 'rag-answer.v1.json': ragFile('hash-v1') }), { activeEmbedderId: 'hash-v1' });
  assert.equal(idx.lookup('router', 'v1', 'b')?.key, 'b');
  assert.equal(idx.lookup('router', 'v2', 'b'), undefined);
  assert.equal(idx.lookup('rag-answer', 'v1', 'b'), undefined);
  assert.equal(idx.all().length, 3);
  assert.ok(idx.all().every((e) => e.file.endsWith('.v1.json')));
});
test('rag-answer sem cabeçalho embedder falha', () => {
  const { embedder: _omit, ...noHeader } = ragFile('hash-v1');
  assert.throws(() => loadFixtures(dirWith({ 'rag-answer.v1.json': noHeader }), { activeEmbedderId: 'hash-v1' }), /embedder/);
});
test('responseFromGolden sem resolvedor, fora do sql-generate, ou junto com response falha', () => {
  assert.throws(() => loadFixtures(dirWith({ 'sql-generate.v1.json': genFile([{ key: 'k', responseFromGolden: 'data-001' }]) }), { activeEmbedderId: 'hash-v1' }), /data-001/);
  assert.throws(() => loadFixtures(dirWith({ 'router.v1.json': { promptId: 'router', version: 'v1', entries: [{ key: 'k', responseFromGolden: 'data-001' }] } }),
    { activeEmbedderId: 'hash-v1', resolveGoldenSql: () => 'SELECT 1' }), /responseFromGolden/);
  assert.throws(() => loadFixtures(dirWith({ 'sql-generate.v1.json': genFile([{ key: 'k', response: { sql: 'SELECT 1', rationale: 'r' }, responseFromGolden: 'data-001' }]) }),
    { activeEmbedderId: 'hash-v1', resolveGoldenSql: () => 'SELECT 1' }), /response/);
  assert.throws(() => loadFixtures(dirWith({ 'sql-generate.v1.json': genFile([{ key: 'k' }]) }), { activeEmbedderId: 'hash-v1' }), /response/);
});
test('nome do arquivo diferente do cabeçalho falha; chave não normalizada falha; sql-correct exige #tentativa', () => {
  assert.throws(() => loadFixtures(dirWith({ 'router.v2.json': routerFile(['a']) }), { activeEmbedderId: 'hash-v1' }), /router\.v1\.json/);
  assert.throws(() => loadFixtures(dirWith({ 'router.v1.json': routerFile(['Qual é?']) }), { activeEmbedderId: 'hash-v1' }), /normalizad/);
  const correct = (key: string) => ({ promptId: 'sql-correct', version: 'v1', entries: [{ key, response: { correctedSql: 'SELECT 1', fix: 'f' } }] });
  assert.equal(loadFixtures(dirWith({ 'sql-correct.v1.json': correct('pergunta x#3') }), { activeEmbedderId: 'hash-v1' }).all().length, 1);
  assert.throws(() => loadFixtures(dirWith({ 'sql-correct.v1.json': correct('pergunta x') }), { activeEmbedderId: 'hash-v1' }), /tentativa/);
});
test('campo desconhecido na entrada falha', () => {
  assert.throws(() => loadFixtures(dirWith({ 'router.v1.json': { promptId: 'router', version: 'v1', entries: [{ key: 'a', response: {}, extra: 1 }] } }), { activeEmbedderId: 'hash-v1' }));
});
