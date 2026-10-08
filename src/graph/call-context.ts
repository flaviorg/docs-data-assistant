// O AskService passa o CallContext (requestId, signal e budget) em config.configurable.callContext.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { CallContext } from '../llm/budget.ts';

export function callContextFrom(config: LangGraphRunnableConfig): CallContext {
  const c = (config.configurable as { callContext?: Partial<CallContext> } | undefined)?.callContext;
  if (!c || typeof c.requestId !== 'string' || !(c.signal instanceof AbortSignal) || typeof c.budget?.consume !== 'function') {
    throw new Error('callContext ausente em config.configurable: o AskService precisa passá-lo ao invocar o grafo');
  }
  return c as CallContext;
}
