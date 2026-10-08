import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGolden } from '../../src/eval/golden.ts';
import { DEMO_SCENARIOS } from '../../src/demo-scenarios.ts';
import { normalizeText } from '../../src/domain/normalize.ts';
import { ingestToMemory } from '../../src/rag/ingest.ts';
import { openSalesConnection } from '../../src/sql/readonly-connection.ts';
import { createSalesSnapshot } from '../../src/sql/seed.ts';
import { createSqlValidator } from '../../src/sql/validator.ts';
import { executeReadOnly } from '../../src/sql/executor.ts';

const validatorOnSnapshot = () => {
  const conn = openSalesConnection({ kind: 'snapshot', bytes: createSalesSnapshot() });
  return { conn, ...createSqlValidator({ conn, maxRows: 200 }) };
};

test('golden.v1 valida, IDs únicos, composição da spec 005', () => {
  const items = loadGolden(); const test_ = items.filter((i) => i.split === 'test');
  assert.equal(test_.length, 34); assert.equal(items.filter((i) => i.split === 'calibration').length, 12);
  const by = (c: string) => test_.filter((i) => i.category === c).length;
  assert.deepEqual([by('docs_answerable'), by('docs_unanswerable'), by('data'), by('data_correction'), by('data_exhausted'), by('data_no_results'),
    by('out_of_scope'), by('injection_direct'), by('injection_indirect'), by('sql_attack'), by('benign_trigger')], [8, 4, 4, 2, 2, 2, 2, 3, 2, 3, 2]);
  for (const s of DEMO_SCENARIOS) assert.ok(test_.some((i) => normalizeText(i.question) === normalizeText(s.question)), s.label);
});

test('chunkIds esperados existem no índice e expected.sql executa no seed', async () => {
  const { store } = await ingestToMemory(); const v = validatorOnSnapshot();
  for (const i of loadGolden()) {
    for (const id of i.expected.chunkIds ?? []) assert.ok(store.getChunk(id), `${i.id}: ${id}`);
    if (i.expected.sql) assert.equal(v.validate(i.expected.sql).ok, true, i.id);
  }
});

// Complementos
test('perguntas do golden são únicas depois da normalização (a chave da fixture é a pergunta)', () => {
  const keys = loadGolden().map((i) => normalizeText(i.question));
  assert.equal(new Set(keys).size, keys.length);
});

test('o split calibration tem 7 respondíveis e 5 não respondíveis, só de recuperação', () => {
  const cal = loadGolden().filter((i) => i.split === 'calibration');
  assert.equal(cal.filter((i) => i.category === 'docs_answerable').length, 7);
  assert.equal(cal.filter((i) => i.category === 'docs_unanswerable').length, 5);
  assert.ok(cal.every((i) => i.expected.route === 'docs' && i.expected.sql === undefined));
});

test('expectativas coerentes por categoria (rota, status e bloqueio)', () => {
  for (const i of loadGolden().filter((x) => x.split === 'test')) {
    const e = i.expected;
    switch (i.category) {
      case 'injection_direct': assert.deepEqual([e.route, e.status, e.blockedBy], [null, 'blocked', 'input_rules'], i.id); break;
      case 'sql_attack': assert.equal(e.route, 'data', i.id); assert.equal(e.status, 'blocked', i.id); assert.ok(e.blockedBy === 'sql_policy' || e.blockedBy === 'sql_authorizer', i.id); break;
      case 'out_of_scope': assert.deepEqual([e.route, e.status], ['out_of_scope', 'refused'], i.id); break;
      case 'data': case 'data_correction': assert.deepEqual([e.route, e.status], ['data', 'answered'], i.id); assert.ok(e.sql, i.id); break;
      case 'data_no_results': assert.deepEqual([e.route, e.status], ['data', 'no_results'], i.id); assert.ok(e.sql, i.id); break;
      case 'data_exhausted': assert.deepEqual([e.route, e.status], ['data', 'error'], i.id); break;
      case 'docs_unanswerable': assert.deepEqual([e.route, e.status], ['docs', 'refused'], i.id); break;
      default: assert.equal(e.route, 'docs', i.id); assert.equal(e.status, 'answered', i.id);
    }
  }
});

test('SQL de referência: data responde com linhas, data_no_results só com NULL', () => {
  const v = validatorOnSnapshot();
  for (const i of loadGolden().filter((x) => x.expected.sql)) {
    const checked = v.validate(i.expected.sql!);
    assert.ok(checked.ok, i.id);
    const r = executeReadOnly(v.conn, checked.sql, 200);
    assert.equal(r.noResults, i.category === 'data_no_results', i.id);
  }
});
