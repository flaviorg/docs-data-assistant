// Nó sqlAnswer (SQL-07): envia ao modelo no máximo rowsToLlm linhas. Falha do modelo vira resposta determinística
// com a contagem de linhas (a tabela vai na resposta da API).
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LlmClient } from '../../llm/llm-client.ts';
import type { sqlAnswerPrompt } from '../../prompts/v1/sql-answer.ts';
import { callContextFrom } from '../call-context.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

export function createSqlAnswerNode(deps: { llm: LlmClient; prompt: typeof sqlAnswerPrompt; rowsToLlm: number }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const result = state.sql?.result;
    if (!state.sql || !result) throw new Error('sqlAnswer called without a result in the state');
    const t0 = performance.now();
    const rows = result.rows.slice(0, deps.rowsToLlm);
    const r = await deps.llm.generateStructured(deps.prompt, { question: state.question, sql: state.sql.query, columns: result.columns, rows }, callContextFrom(config));
    if (!r.success) {
      const warning = r.error.kind === 'truncated' ? 'llm_truncated' : 'llm_parse_failed';
      return {
        outcome: { status: 'answered', blockedBy: null, answer: `Query result: ${result.rows.length} row(s). See the table.`, followUpQuestions: [] },
        warnings: [warning],
        trace: [{ node: NODE.sqlAnswer, ms: elapsedMs(t0), note: warning }],
      };
    }
    return {
      outcome: { status: 'answered', blockedBy: null, answer: r.data.answer, followUpQuestions: r.data.followUpQuestions },
      trace: [{ node: NODE.sqlAnswer, ms: elapsedMs(t0), note: `${rows.length} linha(s) enviadas` }],
    };
  };
}
