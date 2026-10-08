// Nó sqlExecute (SQL-06, SQL-08): executa no processo filho somente leitura (QueryRunner), sem acesso ao LLM. Negação de
// tabela, coluna, ação ou função de risco bloqueia; consulta que passa de SQL_TIMEOUT_MS vira error sem correção;
// outro erro pede correção até o teto; sem resultados vira no_results. Abort da requisição propaga AskAbortedError.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { SqlRuntimeError, SqlTimeoutError } from '../../domain/errors.ts';
import type { QueryResult } from '../../sql/executor.ts';
import type { QueryRunner } from '../../sql/query-runner.ts';
import { classifyDenials } from '../../sql/validator.ts';
import { callContextFrom } from '../call-context.ts';
import { NO_RESULTS_MESSAGE, POLICY_BLOCK_MESSAGE, SQL_TIMEOUT_MESSAGE } from '../messages.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';
import { pendingOrExhausted } from './sql-common.ts';

export function createSqlExecuteNode(deps: { runner: QueryRunner; maxRows: number; maxCorrections: number }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const sql = state.sql;
    if (!sql) throw new Error('sqlExecute chamado sem sql no estado');
    if (sql.pendingError) return {};
    const { signal } = callContextFrom(config);
    const t0 = performance.now();
    const trace = (note: string) => [{ node: NODE.sqlExecute, ms: elapsedMs(t0), note }];

    let r: QueryResult;
    try {
      r = await deps.runner.run(sql.query, { maxRows: deps.maxRows, signal });
    } catch (err) {
      if (err instanceof SqlTimeoutError) {
        // Pedir correção daria ao modelo mais tentativas de consulta pesada; o tempo já foi gasto.
        return {
          sql: { ...sql, pendingError: { kind: 'runtime', message: err.message } },
          outcome: { status: 'error', blockedBy: null, answer: SQL_TIMEOUT_MESSAGE, followUpQuestions: [] },
          warnings: ['sql_timeout'],
          trace: trace('tempo limite da SQL'),
        };
      }
      if (!(err instanceof SqlRuntimeError)) throw err;
      const denial = classifyDenials(err.denials);
      if (denial?.kind === 'policy') {
        return {
          sql: { ...sql, pendingError: { kind: 'policy', message: denial.message, rule: 'authorizer' } },
          outcome: { status: 'blocked', blockedBy: 'sql_authorizer', answer: POLICY_BLOCK_MESSAGE, followUpQuestions: [] },
          warnings: ['sql_policy:authorizer'],
          trace: trace('negado pelo authorizer'),
        };
      }
      return { ...pendingOrExhausted(sql, { kind: 'runtime', message: denial?.message ?? err.message }, deps.maxCorrections), trace: trace('erro de execução') };
    }

    // truncated é defesa em profundidade: o sqlValidate já deixou LIMIT <= SQL_MAX_ROWS, então o corte do executor não
    // dispara para SQL que passou pela validação; limitApplied é o sinal que a API mostra.
    const result = { columns: r.columns, rows: r.rows, truncated: r.truncated, limitApplied: sql.limitApplied ?? false, noResults: r.noResults };
    if (r.noResults) {
      return {
        sql: { ...sql, result },
        outcome: { status: 'no_results', blockedBy: null, answer: NO_RESULTS_MESSAGE, followUpQuestions: [] },
        trace: trace('sem resultados'),
      };
    }
    return { sql: { ...sql, result }, warnings: r.truncated ? ['sql_truncated'] : [], trace: trace(`${r.rows.length} linha(s)`) };
  };
}
