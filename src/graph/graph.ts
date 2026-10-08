// Grafo LangGraph de 12 nós (spec 004). Cada nó é criado pela própria fábrica com só as dependências que usa
// (AGENTS.md, "Onde fica cada coisa") e embrulhado por withTrace, que deixa uma entrada de trace por visita.
import { END, START, StateGraph } from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { createCheckCitationsNode } from './nodes/check-citations.ts';
import { createFinalizeNode } from './nodes/finalize.ts';
import { createGuardrailInputNode } from './nodes/guardrail-input.ts';
import { createOutOfScopeNode } from './nodes/out-of-scope.ts';
import { createRagAnswerNode } from './nodes/rag-answer.ts';
import { createRetrieveNode } from './nodes/retrieve.ts';
import { createRouterNode } from './nodes/router.ts';
import { createSqlAnswerNode } from './nodes/sql-answer.ts';
import { createSqlCorrectNode } from './nodes/sql-correct.ts';
import { createSqlExecuteNode } from './nodes/sql-execute.ts';
import { createSqlGenerateNode } from './nodes/sql-generate.ts';
import { createSqlValidateNode } from './nodes/sql-validate.ts';
import {
  NODE, routeAfterGuardrail, routeAfterRetrieve, routeAfterRouter, routeAfterSqlExecute, routeAfterSqlGenerate, routeAfterSqlValidate,
} from './routing.ts';
import { AskStateSchema } from './state.ts';
import type { AskState, AskStateUpdate } from './state.ts';
import { elapsedMs } from './timing.ts';

export type Node = (state: AskState, config: LangGraphRunnableConfig) => Promise<AskStateUpdate>;

/** Mede o nó e grava exatamente uma entrada { node, ms, note? } no trace, mantendo a nota que o nó deixou. */
export function withTrace(name: string, node: Node): Node {
  return async (state, config) => {
    const t0 = performance.now();
    const update = await node(state, config);
    const note = update.trace?.find((t) => t.note !== undefined)?.note;
    return { ...update, trace: [{ node: name, ms: elapsedMs(t0), ...(note !== undefined ? { note } : {}) }] };
  };
}

export interface GraphDeps {
  guardrailInput: Parameters<typeof createGuardrailInputNode>[0];
  router: Parameters<typeof createRouterNode>[0];
  retrieve: Parameters<typeof createRetrieveNode>[0];
  ragAnswer: Parameters<typeof createRagAnswerNode>[0];
  checkCitations: Parameters<typeof createCheckCitationsNode>[0];
  sqlGenerate: Parameters<typeof createSqlGenerateNode>[0];
  sqlValidate: Parameters<typeof createSqlValidateNode>[0];
  sqlCorrect: Parameters<typeof createSqlCorrectNode>[0];
  sqlExecute: Parameters<typeof createSqlExecuteNode>[0];
  sqlAnswer: Parameters<typeof createSqlAnswerNode>[0];
  finalize: Parameters<typeof createFinalizeNode>[0];
}

export function createAskGraph(deps: GraphDeps) {
  return new StateGraph(AskStateSchema)
    .addNode(NODE.guardrailInput, withTrace(NODE.guardrailInput, createGuardrailInputNode(deps.guardrailInput)))
    .addNode(NODE.router, withTrace(NODE.router, createRouterNode(deps.router)))
    .addNode(NODE.outOfScope, withTrace(NODE.outOfScope, createOutOfScopeNode()))
    .addNode(NODE.retrieve, withTrace(NODE.retrieve, createRetrieveNode(deps.retrieve)))
    .addNode(NODE.ragAnswer, withTrace(NODE.ragAnswer, createRagAnswerNode(deps.ragAnswer)))
    .addNode(NODE.checkCitations, withTrace(NODE.checkCitations, createCheckCitationsNode(deps.checkCitations)))
    .addNode(NODE.sqlGenerate, withTrace(NODE.sqlGenerate, createSqlGenerateNode(deps.sqlGenerate)))
    .addNode(NODE.sqlValidate, withTrace(NODE.sqlValidate, createSqlValidateNode(deps.sqlValidate)))
    .addNode(NODE.sqlCorrect, withTrace(NODE.sqlCorrect, createSqlCorrectNode(deps.sqlCorrect)))
    .addNode(NODE.sqlExecute, withTrace(NODE.sqlExecute, createSqlExecuteNode(deps.sqlExecute)))
    .addNode(NODE.sqlAnswer, withTrace(NODE.sqlAnswer, createSqlAnswerNode(deps.sqlAnswer)))
    .addNode(NODE.finalize, withTrace(NODE.finalize, createFinalizeNode(deps.finalize)))
    .addEdge(START, NODE.guardrailInput)
    .addConditionalEdges(NODE.guardrailInput, routeAfterGuardrail, [NODE.router, NODE.finalize])
    .addConditionalEdges(NODE.router, routeAfterRouter, [NODE.retrieve, NODE.sqlGenerate, NODE.outOfScope, NODE.finalize])
    .addEdge(NODE.outOfScope, NODE.finalize)
    .addConditionalEdges(NODE.retrieve, routeAfterRetrieve, [NODE.ragAnswer, NODE.finalize])
    .addEdge(NODE.ragAnswer, NODE.checkCitations)
    .addEdge(NODE.checkCitations, NODE.finalize)
    .addConditionalEdges(NODE.sqlGenerate, routeAfterSqlGenerate, [NODE.sqlValidate, NODE.sqlCorrect, NODE.finalize])
    .addConditionalEdges(NODE.sqlValidate, routeAfterSqlValidate, [NODE.sqlExecute, NODE.sqlCorrect, NODE.finalize])
    .addEdge(NODE.sqlCorrect, NODE.sqlValidate)
    .addConditionalEdges(NODE.sqlExecute, routeAfterSqlExecute, [NODE.sqlAnswer, NODE.sqlCorrect, NODE.finalize])
    .addEdge(NODE.sqlAnswer, NODE.finalize)
    .addEdge(NODE.finalize, END)
    .compile();
}

export type AskGraph = ReturnType<typeof createAskGraph>;
