// Ledger de uso em app.db: uma linha por requisição e uma por execução lógica de prompt (LLM-04, OBS-01).
import type { DatabaseSync } from 'node:sqlite';
import type { StatsSnapshot } from '../domain/schemas.ts';
import { formatSince, percentileNearestRank } from './stats.ts';

export interface LlmCallEvent {
  requestId: string; ts: number; promptId: string; promptVersion: string; model: string;
  attempts: number; retries: number; fallbackUsed: boolean; parseRetried: boolean; latencyMs: number;
  promptTokens: number; completionTokens: number; estimated: boolean;
  costUsd: number | null; costIsFictional: boolean; ok: boolean; errorKind: string | null;
}

export interface RequestEvent {
  requestId: string; ts: number; route: string | null; status: string | null;
  httpStatus: number; latencyMs: number; llmCalls: number;
}

export interface UsageLedger {
  recordCall(e: LlmCallEvent): void;
  recordRequest(e: RequestEvent): void;
  callsFor(requestId: string): LlmCallEvent[];
  stats(sinceMs: number): StatsSnapshot;
}

const DDL = `
CREATE TABLE IF NOT EXISTS requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  route TEXT,
  status TEXT,
  http_status INTEGER NOT NULL,
  latency_ms REAL NOT NULL,
  llm_calls INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts);
CREATE TABLE IF NOT EXISTS llm_calls (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  retries INTEGER NOT NULL,
  fallback_used INTEGER NOT NULL,
  parse_retried INTEGER NOT NULL,
  latency_ms REAL NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  estimated INTEGER NOT NULL,
  cost_usd REAL,
  cost_is_fictional INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error_kind TEXT
);
CREATE INDEX IF NOT EXISTS llm_calls_ts ON llm_calls (ts);
CREATE INDEX IF NOT EXISTS llm_calls_request ON llm_calls (request_id);
`;

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

function toCall(r: Row): LlmCallEvent {
  return {
    requestId: String(r.request_id), ts: num(r.ts), promptId: String(r.prompt_id), promptVersion: String(r.prompt_version),
    model: String(r.model), attempts: num(r.attempts), retries: num(r.retries), fallbackUsed: num(r.fallback_used) === 1,
    parseRetried: num(r.parse_retried) === 1, latencyMs: num(r.latency_ms), promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens), estimated: num(r.estimated) === 1,
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    costIsFictional: num(r.cost_is_fictional) === 1, ok: num(r.ok) === 1,
    errorKind: r.error_kind === null || r.error_kind === undefined ? null : String(r.error_kind),
  };
}

const b = (v: boolean): number => (v ? 1 : 0);

export function createLedger(db: DatabaseSync, opts: { now?: () => number } = {}): UsageLedger {
  const now = opts.now ?? Date.now;
  db.exec(DDL);
  const insertRequest = db.prepare(`INSERT INTO requests (request_id, ts, route, status, http_status, latency_ms, llm_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertCall = db.prepare(`INSERT INTO llm_calls (request_id, ts, prompt_id, prompt_version, model, attempts, retries,
    fallback_used, parse_retried, latency_ms, prompt_tokens, completion_tokens, estimated, cost_usd, cost_is_fictional, ok, error_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectCallsFor = db.prepare('SELECT * FROM llm_calls WHERE request_id = ? ORDER BY seq');
  const selectRequests = db.prepare('SELECT route, status, http_status, latency_ms FROM requests WHERE ts >= ? ORDER BY seq');
  const selectCalls = db.prepare('SELECT * FROM llm_calls WHERE ts >= ? ORDER BY seq');

  return {
    recordRequest(e) {
      insertRequest.run(e.requestId, e.ts, e.route, e.status, e.httpStatus, e.latencyMs, e.llmCalls);
    },
    recordCall(e) {
      insertCall.run(e.requestId, e.ts, e.promptId, e.promptVersion, e.model, e.attempts, e.retries, b(e.fallbackUsed),
        b(e.parseRetried), e.latencyMs, e.promptTokens, e.completionTokens, b(e.estimated), e.costUsd,
        b(e.costIsFictional), b(e.ok), e.errorKind);
    },
    callsFor(requestId) {
      return (selectCallsFor.all(requestId) as Row[]).map(toCall);
    },
    stats(sinceMs) {
      const from = now() - sinceMs;
      const reqs = selectRequests.all(from) as Row[];
      const byRoute: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let errors = 0;
      for (const r of reqs) {
        const route = r.route === null ? 'none' : String(r.route);
        const status = r.status === null ? 'none' : String(r.status);
        byRoute[route] = (byRoute[route] ?? 0) + 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        if (r.status === 'error' || num(r.http_status) >= 500) errors++;
      }
      const latencies = reqs.map((r) => num(r.latency_ms));
      const calls = (selectCalls.all(from) as Row[]).map(toCall);
      return {
        since: formatSince(sinceMs),
        requests: {
          total: reqs.length,
          byRoute,
          byStatus,
          errorRate: reqs.length === 0 ? 0 : errors / reqs.length,
          latencyMs: { p50: percentileNearestRank(latencies, 50), p95: percentileNearestRank(latencies, 95) },
        },
        llm: {
          calls: calls.length,
          failures: calls.filter((c) => !c.ok).length,
          retries: calls.reduce((s, c) => s + c.retries, 0),
          fallbacks: calls.filter((c) => c.fallbackUsed).length,
          tokens: {
            prompt: calls.reduce((s, c) => s + c.promptTokens, 0),
            completion: calls.reduce((s, c) => s + c.completionTokens, 0),
            estimated: calls.some((c) => c.estimated),
          },
          costUsd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0),
          costIsFictional: calls.some((c) => c.costIsFictional),
        },
      };
    },
  };
}
