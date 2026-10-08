import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AskStateSchema } from '../../src/graph/state.ts';

test('warnings, trace e redactedSpans acumulam; campos simples sobrescrevem', async () => {
  const g = new StateGraph(AskStateSchema)
    .addNode('a', () => ({ warnings: ['a'], trace: [{ node: 'a', ms: 1 }], redactedSpans: ['s1'], guardrail: { verdict: 'safe', layer: 'rules', reasons: [] } }))
    .addNode('b', () => ({ warnings: ['b'], trace: [{ node: 'b', ms: 2 }], redactedSpans: ['s2'], guardrail: { verdict: 'unsafe', layer: 'rules', reasons: ['x'] } }))
    .addEdge(START, 'a').addEdge('a', 'b').addEdge('b', END).compile();
  const out = await g.invoke({ requestId: 'r-12345678', question: 'q' });
  assert.deepEqual(out.warnings, ['a', 'b']);
  assert.deepEqual(out.trace.map((t) => t.node), ['a', 'b']);
  assert.deepEqual(out.redactedSpans, ['s1', 's2']);
  assert.equal(out.guardrail?.verdict, 'unsafe');
});

test('listas começam vazias quando nenhum nó escreve nelas', async () => {
  const g = new StateGraph(AskStateSchema)
    .addNode('a', () => ({ route: { intent: 'docs', reason: 'política', overridden: false } }))
    .addEdge(START, 'a').addEdge('a', END).compile();
  const out = await g.invoke({ requestId: 'r-12345678', question: 'q' });
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.trace, []);
  assert.deepEqual(out.redactedSpans, []);
  assert.equal(out.route?.intent, 'docs');
});
