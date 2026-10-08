// Contexto de teste: modo memory, fake, sem ler .env nem o ambiente do shell, sleep instantâneo.
import { randomUUID } from 'node:crypto';
import { createAppContext } from '../../src/app-context.ts';
import type { AppContext } from '../../src/app-context.ts';
import { loadConfig } from '../../src/config.ts';
import { createCallBudget } from '../../src/llm/budget.ts';
import type { LlmProvider } from '../../src/llm/provider.ts';
import { createLogger } from '../../src/obs/logger.ts';
import type { AskState } from '../../src/graph/state.ts';

export async function createTestContext(overrides: Record<string, string> = {}, opts: { provider?: LlmProvider } = {}): Promise<AppContext> {
  const config = loadConfig({ env: {}, overrides });
  return createAppContext(config, {
    dataMode: 'memory',
    ...(opts.provider ? { provider: opts.provider } : {}),
    sleep: async () => {},
    logger: createLogger({ level: 'error', sink: () => {} }),
  });
}

/** Invoca o grafo direto (sem AskService), com callContext próprio e recursionLimit 25. */
export async function runGraph(ctx: AppContext, input: { question: string; forceRoute?: 'docs' | 'data' }, opts: { budget?: number } = {}): Promise<AskState> {
  const requestId = `test-${randomUUID()}`;
  const callContext = { requestId, signal: new AbortController().signal, budget: createCallBudget(opts.budget ?? ctx.config.llm.maxCallsPerRequest) };
  const state = await ctx.graph.invoke(
    { requestId, question: input.question, ...(input.forceRoute ? { forceRoute: input.forceRoute } : {}) },
    { recursionLimit: 25, configurable: { callContext } },
  );
  return state as AskState;
}
