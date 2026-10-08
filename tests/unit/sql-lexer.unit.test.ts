import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlLexError, countTableRefs, stripCodeFence, stripTrailingSemicolon, tokenize } from '../../src/sql/sql-lexer.ts';

test('ponto e vírgula dentro de string e comentário não conta', () => {
  const t = tokenize(`SELECT 'a;b' -- c; d\nFROM orders /* ; */`);
  assert.equal(t.filter((x) => x.value === ';').length, 0);
  assert.equal(t.find((x) => x.kind === 'string')?.value, `'a;b'`);
});
test('detecta segunda instrução e identificador com aspas', () => {
  assert.equal(tokenize('select 1; drop table orders').filter((x) => x.value === ';').length, 1);
  assert.equal(tokenize('SELECT "weird;name" FROM t').find((x) => x.kind === 'quoted_ident')?.value, '"weird;name"');
});
test('profundidade e contagem de referências a tabela', () => {
  assert.equal(tokenize('SELECT (SELECT 1)').find((x) => x.value === '1')?.depth, 1);
  assert.equal(countTableRefs(tokenize('SELECT * FROM a JOIN b ON a.id=b.id JOIN (SELECT x FROM c) s ON s.x=a.id')), 3);
  assert.equal(countTableRefs(tokenize('WITH x AS (SELECT * FROM orders) SELECT * FROM x JOIN x y ON x.id=y.id')), 3);
});
test('remove cerca Markdown e ponto e vírgula final', () => {
  assert.equal(stripCodeFence('```sql\nSELECT 1\n```'), 'SELECT 1');
  assert.equal(stripCodeFence('```\nSELECT 1\n```'), 'SELECT 1');
  assert.equal(stripCodeFence('  SELECT 1 '), 'SELECT 1');
  assert.equal(stripTrailingSemicolon('SELECT 1; -- fim'), 'SELECT 1');
});
test('string não terminada lança SqlLexError', () => { assert.throws(() => tokenize(`SELECT 'abc`), SqlLexError); });

// Complementos
test('aspas dobradas dentro de string e de identificador, crase e colchetes', () => {
  const t = tokenize(`SELECT 'it''s', "a""b", \`c d\`, [e f] FROM t`);
  assert.deepEqual(t.filter((x) => x.kind === 'string').map((x) => x.value), [`'it''s'`]);
  assert.deepEqual(t.filter((x) => x.kind === 'quoted_ident').map((x) => x.value), ['"a""b"', '`c d`', '[e f]']);
});
test('palavras ganham upper; números, operadores e pontuação têm o próprio tipo', () => {
  const t = tokenize('select a.id, 1.5e3, 0x1F FROM t WHERE a >= 2 AND b <> 3 OR c || d');
  assert.equal(t[0]!.upper, 'SELECT'); assert.equal(t[0]!.kind, 'word');
  assert.deepEqual(t.filter((x) => x.kind === 'number').map((x) => x.value), ['1.5e3', '0x1F', '2', '3']);
  assert.deepEqual(t.filter((x) => x.kind === 'op').map((x) => x.value), ['>=', '<>', '||']);
  assert.deepEqual(t.filter((x) => x.kind === 'punct').map((x) => x.value), ['.', ',', ',']);
});
test('start e end apontam para o texto original', () => {
  const sql = `SELECT  name FROM products`;
  for (const tk of tokenize(sql)) assert.equal(sql.slice(tk.start, tk.end), tk.value);
});
test('parênteses: o próprio parêntese fica na profundidade de fora', () => {
  const t = tokenize('SELECT (a + (b))');
  assert.deepEqual(t.map((x) => `${x.value}:${x.depth}`), ['SELECT:0', '(:0', 'a:1', '+:1', '(:1', 'b:2', '):1', '):0']);
});
test('comentário de bloco ou identificador não terminados lançam SqlLexError', () => {
  assert.throws(() => tokenize('SELECT 1 /* sem fim'), SqlLexError);
  assert.throws(() => tokenize('SELECT "abc'), SqlLexError);
  assert.throws(() => tokenize('SELECT [abc'), SqlLexError);
});
test('stripTrailingSemicolon remove só um ponto e vírgula final', () => {
  assert.equal(stripTrailingSemicolon('SELECT 1;'), 'SELECT 1');
  assert.equal(stripTrailingSemicolon('SELECT 1 ; /* fim */  \n'), 'SELECT 1');
  assert.equal(stripTrailingSemicolon('SELECT 1;;'), 'SELECT 1;');
  assert.equal(stripTrailingSemicolon('SELECT 1; SELECT 2'), 'SELECT 1; SELECT 2');
  assert.equal(stripTrailingSemicolon(`SELECT ';'`), `SELECT ';'`);
});
test('stripCodeFence só remove cerca que envolve o texto inteiro', () => {
  assert.equal(stripCodeFence('```SQL\r\nSELECT 1;\r\n```'), 'SELECT 1;');
  assert.equal(stripCodeFence('```SELECT 1```'), 'SELECT 1');
  assert.equal(stripCodeFence('SELECT 1\n```\nfoo\n```'), 'SELECT 1\n```\nfoo\n```');
});
test('countTableRefs conta identificador com aspas e ignora FROM dentro de string', () => {
  assert.equal(countTableRefs(tokenize(`SELECT 'FROM x' FROM "orders" o LEFT JOIN products p ON p.id = o.id`)), 2);
});
