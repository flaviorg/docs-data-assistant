// Teto de execuções lógicas de prompt por requisição (LLM-06). Retry de parse e de transporte não consomem.
import { BudgetExceededError } from '../domain/errors.ts';
import type { PromptId } from '../prompts/prompt.ts';

export interface CallBudget { readonly max: number; readonly used: number; consume(promptId: PromptId): void }
export interface CallContext { requestId: string; signal: AbortSignal; budget: CallBudget }

export function createCallBudget(max: number): CallBudget {
  let used = 0;
  return {
    max,
    get used() { return used; },
    consume(_promptId) {
      if (used >= max) throw new BudgetExceededError(max);
      used++;
    },
  };
}
