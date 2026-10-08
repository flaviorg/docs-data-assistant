// Nó sqlGenerate (SQL-01): pergunta + schema introspectado → SQL. Remove uma cerca Markdown em volta da SQL
// (spec 003, camada 0). Falha do modelo vira SQL vazia com erro corrigível, que segue para sqlCorrect.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LlmClient } from '../../llm/llm-client.ts';
import type { sqlGeneratePrompt } from '../../prompts/v1/sql-generate.ts';
import { stripCodeFence } from '../../sql/sql-lexer.ts';
import { callContextFrom } from '../call-context.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

export function createSqlGenerateNode(deps: { llm: LlmClient; prompt: typeof sqlGeneratePrompt; schemaText: string }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const t0 = performance.now();
    const r = await deps.llm.generateStructured(deps.prompt, { question: state.question, schemaText: deps.schemaText }, callContextFrom(config));
    if (!r.success) {
      const warning = r.error.kind === 'truncated' ? 'llm_truncated' : 'llm_parse_failed';
      return {
        sql: { query: '', originalQuery: null, corrections: 0, pendingError: { kind: 'correctable', message: 'o modelo não devolveu SQL válida' }, result: null },
        warnings: [warning],
        trace: [{ node: NODE.sqlGenerate, ms: elapsedMs(t0), note: warning }],
      };
    }
    return {
      sql: { query: stripCodeFence(r.data.sql), originalQuery: null, corrections: 0, pendingError: null, result: null },
      trace: [{ node: NODE.sqlGenerate, ms: elapsedMs(t0), note: `${r.call.model} tentativas=${r.call.attempts}` }],
    };
  };
}
