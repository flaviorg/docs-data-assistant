// AskService (spec 004; requestId pela regra de OBS-02): resolve o requestId, valida a entrada, aplica ASK_TIMEOUT_MS, cria o CallBudget, invoca
// o grafo, mapeia exceções para status e HTTP, monta e valida a AskResponse e registra a requisição no ledger.
// Fastify, CLIs, demo e eval usam este mesmo serviço.
import { z } from 'zod';
import type { AppConfig } from './config.ts';
import {
  AskAbortedError, BudgetExceededError, FixtureMissingError, LlmUnavailableError, ReindexRequiredError,
} from './domain/errors.ts';
import { resolveRequestId } from './domain/request-id.ts';
import { AskRequestSchema, AskResponseSchema } from './domain/schemas.ts';
import type { AskResponse, Citation, ErrorBody, SqlResult } from './domain/schemas.ts';
import type { AskGraph } from './graph/graph.ts';
import type { AskState } from './graph/state.ts';
import { createCallBudget } from './llm/budget.ts';
import type { LlmProvider } from './llm/provider.ts';
import type { LlmCallEvent, UsageLedger } from './obs/ledger.ts';
import type { Logger } from './obs/logger.ts';
import { truncateForLog } from './obs/logger.ts';
import type { StoredChunk } from './rag/vector-store.ts';

export type AskOutcome =
  | { ok: true; response: AskResponse; state?: AskState }
  | { ok: false; httpStatus: 400 | 422 | 500 | 503 | 504; body: ErrorBody };

export interface AskOptions { requestId?: string; requestIdReplaced?: boolean; includeState?: boolean }

export interface AskService {
  ask(body: unknown, opts?: AskOptions): Promise<AskOutcome>;
}

export interface AskServiceDeps {
  graph: AskGraph;
  ledger: UsageLedger;
  logger: Logger;
  config: AppConfig;
  providerName: LlmProvider['name'];
  embedderFingerprint: string;
  getChunk(id: string): StoredChunk | undefined;
  suggestions(): string[];
  now?: () => number;
}

export const BUDGET_EXCEEDED_MESSAGE = 'A pergunta precisou de mais chamadas ao modelo do que o limite por requisição e foi interrompida.';
const SNIPPET_MAX = 240;
const API_ROWS_MAX = 50;
const RECURSION_LIMIT = 25;

const SAFE_VERDICT = { verdict: 'safe', layer: null, reasons: [] } as const;

const snippet = (text: string): string => (text.length <= SNIPPET_MAX ? text : `${text.slice(0, SNIPPET_MAX - 1)}…`);
const round = (n: number, digits: number): number => Math.round(n * 10 ** digits) / 10 ** digits;

function metaFrom(deps: AskServiceDeps, calls: readonly LlmCallEvent[], latencyMs: number, trace: AskState['trace']): AskResponse['meta'] {
  const sum = (f: (c: LlmCallEvent) => number) => calls.reduce((n, c) => n + f(c), 0);
  const costUsd = calls.some((c) => c.costUsd === null) ? null : round(sum((c) => c.costUsd ?? 0), 10);
  return {
    provider: deps.providerName,
    embedder: deps.embedderFingerprint,
    models: [...new Set(calls.map((c) => c.model))],
    llmCalls: calls.length,
    fallbackUsed: calls.some((c) => c.fallbackUsed),
    tokens: { prompt: sum((c) => c.promptTokens), completion: sum((c) => c.completionTokens), estimated: calls.some((c) => c.estimated) },
    costUsd,
    costIsFictional: calls.some((c) => c.costIsFictional),
    latencyMs,
    trace,
  };
}

function citationsFrom(deps: AskServiceDeps, state: AskState): Citation[] {
  if (state.outcome?.status !== 'answered' || state.route?.intent !== 'docs') return [];
  const scores = new Map((state.retrieval?.hits ?? []).map((h) => [h.chunkId, h.score]));
  return (state.draft?.citedChunkIds ?? []).slice(0, 3).flatMap((id) => {
    const c = deps.getChunk(id);
    if (!c) return [];
    return [{ chunkId: id, docTitle: c.docTitle, heading: c.heading, score: round(scores.get(id) ?? 0, 4), snippet: snippet(c.text), sanitized: c.flagged }];
  });
}

function sqlFrom(state: AskState): SqlResult | null {
  const sql = state.sql;
  if (!sql) return null;
  const result = sql.result;
  return {
    query: sql.query,
    originalQuery: sql.originalQuery,
    corrections: Math.min(sql.corrections, 3),
    limitApplied: result?.limitApplied ?? sql.limitApplied ?? false,
    rowCount: result?.rows.length ?? 0,
    truncated: result?.truncated ?? false,
    columns: result?.columns ?? [],
    rows: (result?.rows ?? []).slice(0, API_ROWS_MAX),
    lastError: sql.pendingError?.message ?? null,
  };
}

export function createAskService(deps: AskServiceDeps): AskService {
  const now = deps.now ?? Date.now;

  async function ask(body: unknown, opts: AskOptions = {}): Promise<AskOutcome> {
    const ts = now();
    const t0 = performance.now();
    const latency = (): number => round(performance.now() - t0, 2);
    const resolved = resolveRequestId(opts.requestId);
    const requestId = resolved.id;
    const replacedWarning = opts.requestIdReplaced === true || resolved.replaced ? ['request_id_replaced'] : [];

    let question: string | null = null;
    const record = (route: string | null, status: string | null, httpStatus: number, ms: number): void => {
      const llmCalls = deps.ledger.callsFor(requestId).length;
      deps.ledger.recordRequest({ requestId, ts, route, status, httpStatus, latencyMs: ms, llmCalls });
      const fields = { requestId, route, status, httpStatus, ms, llmCalls, ...(question !== null ? { question: truncateForLog(question) } : {}) };
      if (httpStatus >= 500) deps.logger.warn('ask', fields);
      else deps.logger.info('ask', fields);
    };
    const fail = (httpStatus: 400 | 422 | 500 | 503 | 504, error: string, message: string, extra: Partial<ErrorBody> = {}): AskOutcome => {
      record(null, null, httpStatus, latency());
      return { ok: false, httpStatus, body: { error, message, requestId, ...extra } };
    };

    const parsed = AskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'invalid_request', `Corpo inválido: ${z.prettifyError(parsed.error).replace(/\s+/g, ' ').trim()}`, { issues: parsed.error.issues });
    }
    question = parsed.data.question;
    const forceRoute = parsed.data.forceRoute;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.config.askTimeoutMs);
    const callContext = { requestId, signal: controller.signal, budget: createCallBudget(deps.config.llm.maxCallsPerRequest) };
    let state: AskState;
    try {
      const run = deps.graph.invoke(
        { requestId, question, ...(forceRoute ? { forceRoute } : {}) },
        { recursionLimit: RECURSION_LIMIT, signal: controller.signal, configurable: { callContext } },
      );
      // O tempo total vale mesmo se um nó ignorar o sinal: a corrida termina no abort.
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new AskAbortedError()), { once: true });
      });
      run.catch(() => {});
      aborted.catch(() => {});
      state = (await Promise.race([run, aborted])) as AskState;
    } catch (err) {
      if (controller.signal.aborted || err instanceof AskAbortedError) {
        return fail(504, 'timeout', `A pergunta passou do tempo limite de ${deps.config.askTimeoutMs} ms.`);
      }
      if (err instanceof FixtureMissingError) {
        return fail(422, 'fixture_missing', `Modo demonstração (fake): não há resposta roteirizada para essa pergunta. ${err.message}`,
          { suggestions: deps.suggestions() });
      }
      if (err instanceof LlmUnavailableError) {
        return fail(503, 'llm_unavailable', 'Os modelos de linguagem estão indisponíveis no momento. Tente de novo em instantes.');
      }
      if (err instanceof BudgetExceededError) {
        const response = AskResponseSchema.parse({
          requestId, route: null, routeReason: null, overridden: false, status: 'error', blockedBy: null,
          answer: BUDGET_EXCEEDED_MESSAGE, citations: [], sql: null, followUpQuestions: [], guardrail: SAFE_VERDICT,
          warnings: [...replacedWarning, 'llm_budget_exceeded'],
          meta: metaFrom(deps, deps.ledger.callsFor(requestId), latency(), []),
        });
        record(null, 'error', 200, response.meta.latencyMs);
        return { ok: true, response };
      }
      deps.logger.error('ask_failed', { requestId, error: err });
      if (err instanceof ReindexRequiredError) return fail(500, 'reindex_required', err.message);
      return fail(500, 'internal', 'Erro interno inesperado. O requestId identifica a ocorrência no log.');
    } finally {
      clearTimeout(timer);
    }

    try {
      const outcome = state.outcome;
      if (!outcome) throw new Error('o grafo terminou sem outcome');
      const response = AskResponseSchema.parse({
        requestId,
        route: state.route?.intent ?? null,
        routeReason: state.route?.reason ?? null,
        overridden: state.route?.overridden ?? false,
        status: outcome.status,
        blockedBy: outcome.blockedBy,
        answer: outcome.answer,
        citations: citationsFrom(deps, state),
        sql: sqlFrom(state),
        followUpQuestions: outcome.followUpQuestions.slice(0, 3),
        guardrail: state.guardrail ?? SAFE_VERDICT,
        warnings: [...replacedWarning, ...state.warnings],
        meta: metaFrom(deps, deps.ledger.callsFor(requestId), latency(), state.trace),
      });
      record(response.route, response.status, 200, response.meta.latencyMs);
      return opts.includeState ? { ok: true, response, state } : { ok: true, response };
    } catch (err) {
      deps.logger.error('ask_failed', { requestId, error: err });
      return fail(500, 'internal', 'Erro interno inesperado. O requestId identifica a ocorrência no log.');
    }
  }

  return { ask };
}
