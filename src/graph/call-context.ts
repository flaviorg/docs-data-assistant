// O AskService passa o CallContext (requestId, signal e budget) em config.configurable.callContext.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { CallContext } from '../llm/budget.ts';

export function callContextFrom(config: LangGraphRunnableConfig): CallContext {
  const c = (config.configurable as { callContext?: Partial<CallContext> } | undefined)?.callContext;
  if (!c || typeof c.requestId !== 'string' || !(c.signal instanceof AbortSignal) || typeof c.budget?.consume !== 'function') {
    throw new Error('callContext missing from config.configurable: AskService must pass it when invoking the graph');
  }
  return c as CallContext;
}
