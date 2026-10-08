// Nó finalize (GRD-05): aplica a guarda de saída a todo texto do modelo que chega à resposta. Em qualquer status, confere
// o motivo do roteador e o bloco SQL (consulta, consulta original, último erro, colunas e linhas: um literal escrito pelo
// modelo vira célula), porque os dois aparecem na API e na página; a resposta e as perguntas de acompanhamento, quando
// vieram do LLM (rota docs ou data, status answered). Bloqueio troca a resposta por mensagem fixa; se o vazamento estava
// no motivo, troca o motivo também, e se estava no bloco SQL, omite a consulta e esvazia linhas, colunas e erro. Devolve
// sempre o outcome final (mesmo inalterado), para quem lê só a atualização do nó. Recebe só o OutputGuard.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { OutputGuard } from '../../guardrails/output-guard.ts';
import { OUTPUT_BLOCKED_MESSAGE, ROUTE_REASON_BLOCKED, SQL_QUERY_BLOCKED } from '../messages.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

type SqlState = NonNullable<AskState['sql']>;

/** Textos do bloco SQL que chegam à resposta. As linhas vão juntas, para um vazamento dividido entre células não escapar. */
function sqlTexts(sql: SqlState): string[] {
  const texts = [sql.query, sql.originalQuery ?? '', sql.pendingError?.message ?? ''];
  if (sql.result) {
    texts.push(sql.result.columns.join(' '));
    texts.push(sql.result.rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(' ')).join(' '));
  }
  return texts;
}

const redactSql = (sql: SqlState): SqlState => ({ ...sql, query: SQL_QUERY_BLOCKED, originalQuery: null, pendingError: null, result: null });

export function createFinalizeNode(deps: { outputGuard: OutputGuard }) {
  return async (state: AskState, _config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    const outcome = state.outcome;
    if (!outcome) throw new Error('finalize sem outcome');
    const t0 = performance.now();
    const route = state.route;
    const intent = route?.intent;
    const leak = (texts: readonly string[]): string | null => {
      for (const text of texts) {
        const c = deps.outputGuard.check(text, state.redactedSpans);
        if (c.blocked) return `${c.reason}`;
      }
      return null;
    };

    const replaced: AskStateUpdate = {};
    let reason: string | null = null;
    const routeLeak = route ? leak([route.reason]) : null;
    if (route && routeLeak) {
      reason = routeLeak;
      replaced.route = { ...route, reason: ROUTE_REASON_BLOCKED };
    }
    const sqlLeak = state.sql ? leak(sqlTexts(state.sql)) : null;
    if (state.sql && sqlLeak) {
      reason ??= sqlLeak;
      replaced.sql = redactSql(state.sql);
    }
    if (reason === null && outcome.status === 'answered' && (intent === 'docs' || intent === 'data')) {
      reason = leak([outcome.answer, ...outcome.followUpQuestions]);
    }
    if (reason === null) return { outcome, trace: [{ node: NODE.finalize, ms: elapsedMs(t0) }] };
    return {
      ...replaced,
      outcome: { status: 'blocked', blockedBy: 'output_guard', answer: OUTPUT_BLOCKED_MESSAGE, followUpQuestions: [] },
      warnings: [`output_guard:${reason}`],
      trace: [{ node: NODE.finalize, ms: elapsedMs(t0), note: `output_guard:${reason}` }],
    };
  };
}
