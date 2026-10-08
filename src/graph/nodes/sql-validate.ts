// Nó sqlValidate (SQL-02, SQL-03, SQL-05, SQL-10): política estática, reescrita do LIMIT e EXPLAIN sob o authorizer.
// Política violada bloqueia sem correção; erro corrigível pede correção até o teto.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { SqlValidator } from '../../sql/validator.ts';
import { POLICY_BLOCK_MESSAGE } from '../messages.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';
import { pendingOrExhausted } from './sql-common.ts';

export function createSqlValidateNode(deps: { validator: SqlValidator; maxCorrections: number }) {
  return async (state: AskState, _config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const sql = state.sql;
    if (!sql) throw new Error('sqlValidate chamado sem sql no estado');
    const t0 = performance.now();
    const trace = (note: string) => [{ node: NODE.sqlValidate, ms: elapsedMs(t0), note }];

    // Correção que falhou no modelo: não há SQL nova para validar, só a regra do teto.
    if (sql.pendingError) return { ...pendingOrExhausted(sql, sql.pendingError, deps.maxCorrections), trace: trace('erro pendente') };

    const v = deps.validator.validate(sql.query);
    if (v.ok) {
      return { sql: { ...sql, query: v.sql, limitApplied: v.limitApplied, pendingError: null }, trace: trace(v.limitApplied ? 'ok; LIMIT aplicado' : 'ok') };
    }
    if (v.kind === 'policy') {
      return {
        sql: { ...sql, pendingError: { kind: 'policy', message: v.message, rule: v.rule } },
        outcome: { status: 'blocked', blockedBy: v.rule === 'authorizer' ? 'sql_authorizer' : 'sql_policy', answer: POLICY_BLOCK_MESSAGE, followUpQuestions: [] },
        warnings: [`sql_policy:${v.rule}`],
        trace: trace(`política: ${v.rule}`),
      };
    }
    return { ...pendingOrExhausted(sql, { kind: 'correctable', message: v.message }, deps.maxCorrections), trace: trace('corrigível') };
  };
}
