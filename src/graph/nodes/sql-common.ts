// Regra de teto compartilhada por sqlValidate e sqlExecute (SQL-04, SQL-05): erro corrigível vira pendingError
// enquanto houver correções; no teto, vira outcome `error` determinístico sem nova chamada ao modelo.
import { SQL_EXHAUSTED_MESSAGE } from '../messages.ts';
import type { AskState, AskStateUpdate } from '../state.ts';

export type SqlState = NonNullable<AskState['sql']>;
export type PendingError = NonNullable<SqlState['pendingError']>;

export function pendingOrExhausted(sql: SqlState, error: PendingError, maxCorrections: number): AskStateUpdate {
  const next: SqlState = { ...sql, pendingError: error };
  if (sql.corrections >= maxCorrections) {
    return {
      sql: next,   // pendingError fica como lastError na resposta
      outcome: { status: 'error', blockedBy: null, answer: SQL_EXHAUSTED_MESSAGE, followUpQuestions: [] },
      warnings: ['sql_corrections_exhausted'],
    };
  }
  return { sql: next };
}
