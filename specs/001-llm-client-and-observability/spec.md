# 001: LLM client and observability

## Context

Every model access goes through an `LlmProvider` interface (fake via fixtures, or OpenRouter via the `openai` SDK) and through a custom `LlmClient`. The client is the only piece that knows about retry, fallback, the call cap, Zod parsing, tokens and cost. Observability is a SQLite ledger with a lean `/stats`, plus JSON logs on stderr.

## Scope

- `src/llm/provider.ts`: provider contract and `LlmErrorKind` (`timeout`, `rate_limit`, `server_error`, `auth`, `bad_request`, `truncated`).
- `src/llm/fake-provider.ts` and `src/llm/fixtures.ts`: answers by fixture, normalized key, recorded `calls` (only the last 1,000, so a keyless `npm start` does not grow without a cap), chaos (`primary-timeout-once`, `primary-down`, `all-down`).
- `src/llm/openrouter-provider.ts`: `openai` SDK with `baseURL`, `maxRetries: 0`, injectable `fetch` and `response_format` with a JSON Schema without `$schema`.
- `src/llm/llm-client.ts` and `src/llm/budget.ts`: `generateStructured` and `generateText`, retry with backoff, fallback, 1 parse retry, per-request `CallBudget`.
- `src/llm/tokens.ts`, `src/llm/pricing.ts` and `config/model-prices.json`: estimated tokens (`ceil(chars / 4)`) and cost per 1M tokens.
- `src/obs/ledger.ts`, `src/obs/stats.ts` and `src/obs/logger.ts`: `requests` and `llm_calls` tables, P50 and P95 by *nearest rank*, logger with key masking.

## Non-goals

- LangSmith, Langfuse, OpenTelemetry or a detailed per-model `/stats` with percentiles.
- Token streaming.
- Caching model answers.
- Retry done by the SDK (it stays off; retry belongs to `LlmClient`).

## Acceptance criteria (EARS)

- **LLM-01** When a call fails with a timeout, a rate limit or a 5xx error, the system shall retry up to `LLM_MAX_RETRIES` times with exponential backoff.
- **LLM-02** If the primary model exhausts its attempts, then the system shall use `OPENROUTER_MODEL_FALLBACK` and return `fallbackUsed: true`.
- **LLM-03** If every model fails, then the system shall answer HTTP 503 with a `requestId`.
- **LLM-04** The system shall record for each logical execution: `promptId`, version, model, attempts, retries, fallback, latency, tokens (real or estimated, flagged as such) and estimated cost.
- **LLM-05** When the fake provider receives input with no fixture, the system shall fail with an error that names the `promptId` and the normalized key, and the API shall answer 422.
- **LLM-06** If a request exceeds `LLM_MAX_CALLS_PER_REQUEST` logical prompt executions, then the system shall stop the flow with `status: error` and the `llm_budget_exceeded` warning.
- **LLM-07** If the provider signals truncated output (`finish_reason=length`), then the system shall neither repeat the call nor use the fallback, and the node shall apply its deterministic fallback.
- **OBS-01** When `GET /stats?since=24h` is called, the system shall return the total number of requests, the error rate, P50 and P95 latency, tokens, cost, retries and fallbacks.
- **OBS-02** The system shall propagate the received `X-Request-Id` when it matches `^[A-Za-z0-9._-]{8,64}$`, or generate a UUID and warn `request_id_replaced`, in the response, the logs and the ledger.

## Decisions

- **The `openai` SDK directly, not `@langchain/openai`.** With `maxRetries: 0`, retry, fallback and counting live in a single place, testable with an injected `fetch` and no network (`tests/unit/openrouter-provider.unit.test.ts`).
- **Backoff of 250 ms × 2^n with ±20% jitter**, with an injectable clock and `sleep`; in tests `sleep` is zero.
- **The cap counts logical executions, not transport attempts.** Each `generateStructured` or `generateText` uses 1. The legitimate maximum is 7 (data with 3 corrections and the model classifier); the default of 8 is a safety net. Parse retries and transport retries do not count.
- **`truncated` gets neither retry nor fallback.** Repeating the same call with the same `maxTokens` would give the same cutoff. Each node has its own fallback (the router becomes `out_of_scope` with `router_fallback`, `ragAnswer` refuses, the SQL branch uses up a correction, `sqlAnswer` answers with the table).
- **The ledger records the requested model**, not the name the provider returns, because the price table is indexed by the requested id.
- **Cost is always labeled.** `fake/*` models have `"fictional": true` and the cost comes out as "US$ (fictional)"; a model with no price gives `costUsd: null`. `config/model-prices.json` has `updatedAt`.
- **Logs only on stderr**, one-line JSON, with `sk-or-...` and `Bearer ...` masked and the question cut at 200 characters. SQL rows and the full context do not go into the log.
- Library signatures checked in `node_modules`: [`docs/api-notes.md`](../../docs/api-notes.md).

## How to verify

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/llm-client.unit.test.ts tests/unit/openrouter-provider.unit.test.ts tests/unit/fake-provider.unit.test.ts tests/unit/fixtures-loader.unit.test.ts tests/unit/tokens-pricing.unit.test.ts tests/unit/stats.unit.test.ts tests/unit/logger.unit.test.ts tests/int/resilience.int.test.ts tests/int/ask-service.int.test.ts tests/e2e/stats-api.e2e.test.ts
npm run demo   # scenario 13: 4 retries and 2 fallbacks with primary-down
```
