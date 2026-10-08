# 005: Interfaces and eval

## Context

The same `AskService` serves the Fastify API, the web page, the CLIs, the demo and the eval. The project needs to run with one command, with no key, no Docker and no network after `npm install`, and to prove its quality with an eval gate in CI and an attack × layer matrix.

## Scope

- **Environment:** `src/config.ts` (`loadConfig` with Zod, fail-fast, `ENV_KEYS` in the order of `.env.example`), `tests/helpers/no-network.ts` (network block in `npm test`, propagated to child processes) and `src/ensure-data.ts` (seed and ingestion in `file` mode when they are missing or out of date).
- **API:** `src/server.ts` and `src/index.ts`: `POST /ask`, `GET /stats`, `GET /health`, `GET /demo/questions`, `GET /` with `/app.js` and `/app.css`; a `bodyLimit` of 16 KiB; the contract's error body; the `X-Request-Id` header.
- **Page:** `src/web/index.html`, `app.js` and `app.css`, with no build, no CDN and no inline script or style.
- **CLIs:** `ask`, `seed`, `ingest`, `demo`, `eval`, `calibrate` and `layers` (`src/cli/`, `src/eval/`).
- **Eval:** `eval/golden.v1.json` (34 items in the `test` split, 12 in `calibration`), `eval/thresholds.json` (`fake` and `live` profiles), `src/eval/metrics.ts`, `report.ts` and `run-eval.ts`.
- **Layer matrix:** `eval/attacks.v1.json` (19 attacks written from scratch; 14 in the first version, plus `sql-replace-into`, `sql-cross-join` and `out-citation-id` in the first final review and `dir-forged-document` and `out-sql-literal` in the second) and `src/eval/layers.ts`.

## Non-goals

- SSE streaming, authentication, rate limiting and multi-user support (the API is local and for demonstration).
- A frontend with a framework or a build; hosted deployment or GitHub Pages.
- An MCP server (the project does not depend on the MCP SDK).
- Docker, Ollama and Python.

## Acceptance criteria (EARS)

- **ENV-01** The system shall use `LLM_PROVIDER=fake` and `EMBEDDER=hash` when no variable is set.
- **ENV-02** If `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY` is missing, then the system shall fail at startup with a message that names the variable.
- **ENV-03** While `npm test` runs, the system shall not open an external network connection.
- **ENV-04** When `npm run demo` is run on a fresh clone, after `npm install`, the system shall seed the database and index the base in memory and run the 13 scenarios with no key, no network, without reading `.env` and without writing to `data/`.
- **API-01** When `POST /ask` receives an invalid body, the system shall answer 400 with Zod's `issues`.
- **API-02** If execution exceeds `ASK_TIMEOUT_MS`, then the system shall answer 504.
- **API-03** The system shall validate every `/ask` response against `AskResponseSchema` before sending it.
- **API-04** If the body is not valid JSON, the content type is not supported or the route does not exist, then the system shall answer with the contract's error body and the `X-Request-Id` header.
- **WEB-01** The system shall serve the page with a CSP without `'unsafe-inline'`, and the page shall build content coming from the API only with `textContent` and `createElement`.
- **EVL-01** When `npm run eval` finishes, the system shall print the report and exit with code 1 if any metric falls below the active profile's threshold.
- **EVL-02** The system shall label the report with profile (`FAKE` or `LIVE`), provider, embedder, models, guardrail mode, split and date, and mark each metric as `mechanism` or `contract (fixture)` on the fake profile.
- **EVL-03** When `npm run calibrate` is run, the system shall use only the `calibration` split and print the threshold × refusal-accuracy table, the median separation and the threshold that maximizes accuracy on that split.
- **EVL-04** When `npm run layers` is run, the system shall print the attack × layer matrix and exit with code 1 if any attack is stopped by no layer or any write via SQL is stopped by fewer than two.

## Decisions

- **Demo and eval in memory, with explicit config.** `loadConfig({ env: {}, overrides })` reads neither `.env` nor the shell: an exported `OPENROUTER_API_KEY` does not change the demo, and nothing is written to `data/`.
- **Network block at a single point.** `net.Socket.prototype.connect` covers `net`, `tls`, `http`, `https` and undici's `fetch`; the hook propagates through `NODE_OPTIONS`, including on a path with a space.
- **A page with no raw HTML.** It displays document passages (including the poisoned one) and model answers; with `innerHTML`, a document with `<img onerror=...>` would run a script. The CSP is `default-src 'none'`, with `'self'` only where needed.
- **Metrics with a nature.** On the fake profile, `routeAccuracy`, `citationValidity` and `sqlExecutionAccuracy` are a *contract (fixture)*: the author-written fixture already encodes the route, the citations and the SQL. They fail CI if they break, but they are not sold as quality. `recallAt3`, `refusalAccuracy`, `injectionBlockRate` and `falseBlockRate` are a *mechanism*. Only the `live` profile measures generation.
- **The layer matrix uses no LLM.** Each attack goes through each deterministic layer in isolation (input rules, sanitizer, lexer, authorizer without the lexer, `query_only` without the authorizer, output guard). That shows real redundancy: a write via SQL is stopped by more than one layer on its own, and reading personal data gets past `query_only` and is stopped by the authorizer.
- **CI with actions pinned by SHA**, `permissions: contents: read`, Node `24.x` and the eval report as an artifact even on failure.

## How to verify

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/config.unit.test.ts tests/unit/env-example.unit.test.ts tests/unit/no-network.unit.test.ts tests/unit/schemas.unit.test.ts tests/unit/web-assets.unit.test.ts tests/unit/golden-schema.unit.test.ts tests/unit/fixtures-contract.unit.test.ts tests/unit/metrics.unit.test.ts tests/unit/layers.unit.test.ts tests/unit/retrieval-metrics.unit.test.ts tests/e2e/ask-api.e2e.test.ts tests/e2e/web.e2e.test.ts tests/e2e/cli.e2e.test.ts tests/e2e/eval.e2e.test.ts
npm run demo && npm run eval && npm run layers && npm run calibrate
```
