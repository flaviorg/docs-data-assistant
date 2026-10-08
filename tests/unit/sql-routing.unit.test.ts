import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE, routeAfterGuardrail, routeAfterRetrieve, routeAfterRouter, routeAfterSqlExecute, routeAfterSqlGenerate, routeAfterSqlValidate,
} from '../../src/graph/routing.ts';
import type { AskState } from '../../src/graph/state.ts';
import type { Route, Status } from '../../src/domain/schemas.ts';

const st = (extra: Partial<AskState>): AskState => ({ requestId: 'r-12345678', question: 'q', redactedSpans: [], warnings: [], trace: [], ...extra });
const o = (status: Status): NonNullable<AskState['outcome']> => ({ status, blockedBy: null, answer: 'a', followUpQuestions: [] });
const sql = (extra: Partial<NonNullable<AskState['sql']>>): NonNullable<AskState['sql']> =>
  ({ query: 'SELECT 1', originalQuery: null, corrections: 0, pendingError: null, result: null, ...extra });
const res = (): NonNullable<NonNullable<AskState['sql']>['result']> => ({ columns: ['a'], rows: [[1]], truncated: false, limitApplied: true, noResults: false });

test('SQL-05 funções de roteamento', () => {
  assert.equal(routeAfterSqlValidate(st({ outcome: o('error') })), NODE.finalize);
  assert.equal(routeAfterSqlValidate(st({ sql: sql({ pendingError: { kind: 'correctable', message: 'x' } }) })), NODE.sqlCorrect);
  assert.equal(routeAfterSqlValidate(st({ sql: sql({}) })), NODE.sqlExecute);
  assert.equal(routeAfterSqlExecute(st({ sql: sql({ result: res() }) })), NODE.sqlAnswer);
  assert.equal(routeAfterRetrieve(st({ outcome: o('refused') })), NODE.finalize);
  assert.equal(routeAfterGuardrail(st({ outcome: o('blocked') })), NODE.finalize);
  assert.deepEqual(['docs', 'data', 'out_of_scope'].map((i) => routeAfterRouter(st({ route: { intent: i as Route, reason: 'r', overridden: false } }))), [NODE.retrieve, NODE.sqlGenerate, NODE.outOfScope]);
});

// Complementos
test('SQL-05 teto e sem resultados vão a finalize; erro de execução vai a sqlCorrect', () => {
  assert.equal(routeAfterSqlValidate(st({ sql: sql({ corrections: 3, pendingError: { kind: 'correctable', message: 'x' } }), outcome: o('error') })), NODE.finalize);
  assert.equal(routeAfterSqlExecute(st({ sql: sql({ result: { ...res(), rows: [], noResults: true } }), outcome: o('no_results') })), NODE.finalize);
  assert.equal(routeAfterSqlExecute(st({ sql: sql({ pendingError: { kind: 'runtime', message: 'x' } }) })), NODE.sqlCorrect);
  assert.equal(routeAfterSqlValidate(st({ sql: sql({ pendingError: { kind: 'policy', message: 'x', rule: 'not_select' } }), outcome: o('blocked') })), NODE.finalize);
});
test('caminho feliz: guardrail → router, retrieve → ragAnswer, sqlGenerate → sqlValidate', () => {
  assert.equal(routeAfterGuardrail(st({})), NODE.router);
  assert.equal(routeAfterRetrieve(st({})), NODE.ragAnswer);
  assert.equal(routeAfterSqlGenerate(st({ sql: sql({}) })), NODE.sqlValidate);
  assert.equal(routeAfterSqlGenerate(st({ sql: sql({ query: '', pendingError: { kind: 'correctable', message: 'x' } }) })), NODE.sqlCorrect);
  assert.equal(routeAfterSqlGenerate(st({ outcome: o('error') })), NODE.finalize);
});
test('router: outcome vai a finalize e rota ausente cai em outOfScope (fallback seguro)', () => {
  assert.equal(routeAfterRouter(st({ outcome: o('blocked') })), NODE.finalize);
  assert.equal(routeAfterRouter(st({})), NODE.outOfScope);
});
test('NODE tem os 12 nós do grafo', () => {
  assert.deepEqual(Object.values(NODE), ['guardrailInput', 'router', 'outOfScope', 'retrieve', 'ragAnswer', 'checkCitations',
    'sqlGenerate', 'sqlValidate', 'sqlCorrect', 'sqlExecute', 'sqlAnswer', 'finalize']);
});
