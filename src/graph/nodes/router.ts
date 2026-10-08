// Nó router (RTE-01 a RTE-03): forceRoute pula o LLM; saída inválida ou truncada cai em out_of_scope com
// router_fallback (fallback seguro).
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LlmClient } from '../../llm/llm-client.ts';
import type { routerPrompt } from '../../prompts/v1/router.ts';
import { callContextFrom } from '../call-context.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

export function createRouterNode(deps: { llm: LlmClient; prompt: typeof routerPrompt }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const t0 = performance.now();
    if (state.forceRoute) {
      return {
        route: { intent: state.forceRoute, reason: 'forceRoute', overridden: true },
        trace: [{ node: NODE.router, ms: elapsedMs(t0), note: `forceRoute=${state.forceRoute}` }],
      };
    }
    const r = await deps.llm.generateStructured(deps.prompt, { question: state.question }, callContextFrom(config));
    if (!r.success) {
      return {
        route: { intent: 'out_of_scope', reason: 'router_fallback', overridden: false },
        warnings: ['router_fallback'],
        trace: [{ node: NODE.router, ms: elapsedMs(t0), note: `router_fallback (${r.error.kind})` }],
      };
    }
    return {
      route: { intent: r.data.intent, reason: r.data.reason, overridden: false },
      trace: [{ node: NODE.router, ms: elapsedMs(t0), note: r.data.intent }],
    };
  };
}
