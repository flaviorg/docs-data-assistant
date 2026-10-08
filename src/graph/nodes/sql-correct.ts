// Nó sqlCorrect (SQL-04): manda ao modelo a SQL que falhou, o erro, a pergunta e o schema. Sucesso ou falha
// consomem uma correção; a primeira SQL fica em originalQuery.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LlmClient } from '../../llm/llm-client.ts';
import type { sqlCorrectPrompt } from '../../prompts/v1/sql-correct.ts';
import { stripCodeFence } from '../../sql/sql-lexer.ts';
import { callContextFrom } from '../call-context.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

export function createSqlCorrectNode(deps: { llm: LlmClient; prompt: typeof sqlCorrectPrompt; schemaText: string }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const sql = state.sql;
    if (!sql?.pendingError) return {};
    const t0 = performance.now();
    const attempt = Math.min(sql.corrections + 1, 3) as 1 | 2 | 3;
    const r = await deps.llm.generateStructured(deps.prompt, {
      question: state.question, schemaText: deps.schemaText, failedSql: sql.query, error: sql.pendingError.message, attempt,
    }, callContextFrom(config));
    if (!r.success) {
      const warning = r.error.kind === 'truncated' ? 'llm_truncated' : 'llm_parse_failed';
      return {
        sql: { ...sql, corrections: sql.corrections + 1 },
        warnings: [warning],
        trace: [{ node: NODE.sqlCorrect, ms: elapsedMs(t0), note: `tentativa ${attempt}: ${warning}` }],
      };
    }
    return {
      sql: {
        ...sql,
        originalQuery: sql.originalQuery ?? (sql.query === '' ? null : sql.query),
        query: stripCodeFence(r.data.correctedSql),
        corrections: sql.corrections + 1,
        pendingError: null,
      },
      trace: [{ node: NODE.sqlCorrect, ms: elapsedMs(t0), note: `tentativa ${attempt}` }],
    };
  };
}
