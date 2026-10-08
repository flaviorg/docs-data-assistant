# API notes

Library signatures checked in the project itself before writing the code, with the exact versions from `package.json`, under Node 24.21.0 and `tsc` 7.0.2. The probes were throwaway scripts, kept out of version control: what each one observed is in the "Observed in the project" column, and the behavior the code depends on is covered by each module's tests (for example, `tests/unit/readonly-connection.unit.test.ts` for `node:sqlite` and `tests/unit/openrouter-provider.unit.test.ts` for the `openai` SDK).

Installed versions (`npm ls --depth=0`): `@langchain/core@1.2.14`, `@langchain/langgraph@1.4.19`, `fastify@5.12.5`, `openai@7.27.0`, `zod@4.6.5`, `typescript@7.0.2`, `@types/node@24.19.1`. `npm install` finished with `found 0 vulnerabilities`.

| API | Confirmed signature | Observed in the project | Checked in the project on |
|---|---|---|---|
| LangGraph | `new StateGraph(zodObject)`; `.addNode(name, fn)`; `.addEdge(START, 'a')`; `.addConditionalEdges(src, (s) => target, [targets])`; `.compile()`; `graph.invoke(input, { recursionLimit, signal, configurable })` | A node receives `(state, config: LangGraphRunnableConfig)`; `config.configurable.callContext.requestId` arrived as `r-12345678`; `config.signal` present | 2026-10-04 |
| LangGraph reducers | `withLangGraph(z.array(x), { reducer: { fn: (a, b) => a.concat(b) }, default: () => [] })` from `@langchain/langgraph/zod` | A `z.array(z.string()).default([])` field ended as `["b"]` (*LastValue*); the two fields with a reducer ended as `["a","b"]` | 2026-10-04 |
| LangGraph errors | `GraphRecursionError` exported from `@langchain/langgraph` | An `x → x` loop with `recursionLimit: 5` threw `GraphRecursionError` (`instanceof` true); an already aborted signal threw `AbortError` ("This operation was aborted") | 2026-10-04 |
| Zod 4.6.5 | `z.strictObject`, `z.toJSONSchema`, `z.prettifyError`, `issues[i].{code,path}`, `z.uuid()` | Extra key: `success: false`, issue `unrecognized_keys` with `path: []`; `prettifyError` prints `✖ Unrecognized key: "extra"`; `toJSONSchema` includes `$schema` (draft 2020-12) and `additionalProperties: false`; `z.uuid()` accepts a v4 UUID | 2026-10-04 |
| `openai` 7.27.0 | `new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout, fetch })`; `chat.completions.create({ ..., response_format: { type: 'json_schema', json_schema: { name, strict, schema } } }, { signal })` | 200: `finish_reason = 'length'`, `usage.prompt_tokens = 11`, `usage.completion_tokens = 7`, `model` read. 429 → `RateLimitError`; 500 → `InternalServerError`; 401 → `AuthenticationError`; 400 → `BadRequestError` (all with `status` and subclasses of `APIError`); `timeout: 50` with a pending `fetch` → `APIConnectionTimeoutError`; aborted `signal` → `APIUserAbortError` (both without `status`) | 2026-10-04 |
| Fastify 5.12.5 | `Fastify({ logger: false, bodyLimit, genReqId(req) })`; `addHook('onRequest')`; `setErrorHandler`; `setNotFoundHandler`; `app.inject` | `'{'` → 400 `FST_ERR_CTP_INVALID_JSON_BODY`; empty body → 400 `FST_ERR_CTP_EMPTY_JSON_BODY`; `application/xml` → 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`; `text/plain` accepted as a string (200); header `abc-12345` echoed; header `abc` replaced by a UUID; unknown route → 404 from `setNotFoundHandler`; `X-Request-Id` present on every response, including errors. Type of the `inject` options: `import type { InjectOptions } from 'fastify'` | 2026-10-04 |
| `node:sqlite` (Node 24.21's SQLite) | `new DatabaseSync(path, { readOnly })`; `setAuthorizer((action, arg1, arg2, dbName, triggerOrView) => number)`; `constants`; `serialize()`; `deserialize()`; `iterate()`; `columns()`; `setReturnArrays(true)` | Constants: `SQLITE_OK=0`, `SQLITE_DENY=1`, `SQLITE_READ=20`, `SQLITE_SELECT=21`, `SQLITE_FUNCTION=31`, `SQLITE_RECURSIVE=33`. `LIKE` arrives as the function `like`; `COUNT(*)` arrives as `SQLITE_READ` with column `''`; `SELECT *` and `SELECT name` → `access to customers.name is prohibited` (errcode 23); `printf` → `not authorized to use function: printf` (errcode 1); recursive CTE → action 33, `not authorized` (errcode 23); `sqlite_master` → `access to sqlite_master.type is prohibited`; `select 1; drop table t` compiles and runs only the first statement; `columns()` returns names for a zero-row query; `serialize()` returns a `Uint8Array` and `deserialize()` restores it into a new `:memory:` | 2026-10-04 |
| `node:sqlite` limits | `db.limits.length = n` (`sqlite3_limit`, since Node 24.15); `new DatabaseSync(path, { limits })` | Default `length: 1000000000`. With `length = 100000`, three nested `replace()` calls over 64 characters fail with `string or blob too big` in 0.1 ms, against 16 MB built without the limit. `PRAGMA hard_heap_limit` reads 0 and is not applied: Node's SQLite is compiled with `SQLITE_DEFAULT_MEMSTATUS=0` | 2026-10-04 |
| TypeScript 7.0.2 | `tsc --noEmit` with the project's `tsconfig.json` | Probes compile without errors (`TSC-OK`). No fallback to `~5.9` | 2026-10-04 |
| Network block | `net.Socket.prototype.connect` intercepts `net.connect`, `tls.connect`, `http.get` and undici's `fetch` | Checked by the test `tests/unit/no-network.unit.test.ts`, including a child process inheriting the block through `NODE_OPTIONS` on a path with a space | 2026-10-04 |
| MCP SDK | not applicable | `@modelcontextprotocol/sdk` not installed (MCP is out of scope) | 2026-10-04 |

## OpenRouter catalog

Public query to `https://openrouter.ai/api/v1/models` on 2026-10-04. Prices in US$ per 1M tokens (the catalog publishes per token; multiplied by 1,000,000). Used in `config/model-prices.json`.

| Model | Input (US$/1M) | Output (US$/1M) | `response_format` and `structured_outputs` |
|---|---|---|---|
| `openai/gpt-oss-120b` | 0.037 | 0.17 | yes |
| `google/gemini-2.5-flash` | 0.30 | 2.50 | yes |
| `openai/gpt-oss-safeguard-20b` | 0.075 | 0.30 | yes |

## Company name

Web search for the original Portuguese name, "Moenda Lunar" plus "café", and for "Moenda Lunar Cafés Especiais" on 2026-10-04: no real company with that name (only coffee shops with "Lunar" in the name in other countries). The name was kept, with a fiction notice and the domain `moendalunar.example`.

Update on 2026-10-08: with the translation of the product to English, the company was renamed Lunar Mill Specialty Coffee (domain `lunarmill.example`). Web search for "Lunar Mill" coffee on 2026-10-08: no coffee company with that name.

## Discrepancies

No discrepancy from the expected signatures. Typing detail noted above: the Fastify probe needed `InjectOptions` imported from `fastify` (`Parameters<typeof app.inject>[0]` does not resolve because of the overloads).
