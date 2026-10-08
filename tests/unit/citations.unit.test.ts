import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSAL_TEXT, validateCitations } from '../../src/rag/citations.ts';

test('RAG-03 descarta ID fora do conjunto e avisa', () => {
  assert.deepEqual(validateCitations({ refused: false, answer: 'x', citedChunkIds: ['a#s-1', 'z#s-9'] }, ['a#s-1', 'b#s-1']), { citedIds: ['a#s-1'], dropped: ['z#s-9'], refused: false });
});
test('RAG-04 sem citação válida vira recusa', () => {
  assert.equal(validateCitations({ refused: false, answer: 'x', citedChunkIds: ['z#s-9'] }, ['a#s-1']).refused, true);
});
test('resposta recusada não exige citação', () => {
  assert.deepEqual(validateCitations({ refused: true, answer: REFUSAL_TEXT, citedChunkIds: [] }, ['a#s-1']), { citedIds: [], dropped: [], refused: true });
});

// Complementos
test('RAG-04 lista de citações vazia numa resposta não recusada vira recusa', () => {
  assert.deepEqual(validateCitations({ refused: false, answer: 'x', citedChunkIds: [] }, ['a#s-1']), { citedIds: [], dropped: [], refused: true });
});
test('citação repetida conta uma vez e a ordem do modelo é mantida', () => {
  assert.deepEqual(validateCitations({ refused: false, answer: 'x', citedChunkIds: ['b#s-1', 'a#s-1', 'b#s-1'] }, ['a#s-1', 'b#s-1']).citedIds, ['b#s-1', 'a#s-1']);
});
test('REFUSAL_TEXT é a frase canônica de recusa', () => {
  assert.equal(REFUSAL_TEXT, 'Não encontrei essa informação nos documentos da Moenda Lunar.');
});
