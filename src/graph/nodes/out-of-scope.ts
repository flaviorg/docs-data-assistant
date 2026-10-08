// Nó outOfScope (RTE-04): recusa com mensagem fixa, sem chamar outro prompt.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { OUT_OF_SCOPE_MESSAGE } from '../messages.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';

export function createOutOfScopeNode() {
  return async (state: AskState, _config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    return {
      outcome: { status: 'refused', blockedBy: null, answer: OUT_OF_SCOPE_MESSAGE, followUpQuestions: [] },
      trace: [{ node: NODE.outOfScope, ms: 0 }],
    };
  };
}
