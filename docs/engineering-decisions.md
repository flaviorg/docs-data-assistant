# Engineering decisions

Decisions that shape the design of `docs-data-assistant`, each with the spec or incident that records it. The [README](../README.md) has the summary; this page has the why.

## Data and SQL

- **Separate databases:** `sales.db` holds only the sales tables; documents, vectors and ledger live in `app.db`. Generated SQL never sees internal tables ([spec 003](../specs/003-safe-text-to-sql/spec.md)).
- **A SQL policy violation does not go to correction:** it blocks right away. Sending it back to the model would give an attacker new attempts; only syntax errors, a missing table or column, and an ordinary function outside the allowlist are correctable ([spec 003](../specs/003-safe-text-to-sql/spec.md)).
- **A 100,000-byte cap per value on the SQL connection:** without it, three nested `replace()` calls built 16 MB and `group_concat()` over an `ON 1=1` join returned 75 MB, within the execution deadline. With `DatabaseSync.limits.length` (Node 24.15+), the query fails right away with `string or blob too big`. `printf` and `format` stay on the risk list, because formatting numbers is the job of `sqlAnswer` ([spec 003](../specs/003-safe-text-to-sql/spec.md), [incident](incidents/2026-10-04-uncapped-text-functions.md)).
- **Generated SQL runs in a child process with a deadline:** `node:sqlite` is synchronous and cannot interrupt a query; on the main thread, a Cartesian product froze the whole server. A Worker does not solve it, because `terminate()` does not interrupt native code; the child process gets `SIGKILL` ([incident](incidents/2026-10-04-terminate-does-not-interrupt-sqlite.md)).
- **`readOnly` is not enough:** on shared memory it does not prevent writes; the project uses a deserialized snapshot, `query_only` and an authorizer ([incident](incidents/2026-10-04-readonly-fails-on-shared-memory.md)).

## Evaluation

- **The matrix tests each layer on its own**, to show real redundancy and not count the same defense twice ([spec 005](../specs/005-interfaces-and-eval/spec.md), [incident](incidents/2026-10-04-false-redundancy-in-matrix.md)).

## Guardrails and model

- **The model classifier fails closed:** a response outside the format, or a truncated one, blocks, with a message saying the check failed (not that the user attempted an injection); false blocks are measured by `falseBlockRate`. If the safety model goes down, the request answers 503, like any other unavailable model, and the outage shows up in `errorRate` ([spec 004](../specs/004-guardrails-and-graph/spec.md)).
- **Retry belongs to the client, not the SDK:** `maxRetries: 0` in the `openai` SDK; `LlmClient` retries with backoff, falls back to another model and counts logical executions against a per-request cap; truncated output is not retried ([spec 001](../specs/001-llm-client-and-observability/spec.md)).

## Interface

- **A page with no raw HTML:** only `textContent` and `createElement`, with the CSP `default-src 'none'`, because it displays text from documents (including the poisoned one) and from the model ([spec 005](../specs/005-interfaces-and-eval/spec.md)).
