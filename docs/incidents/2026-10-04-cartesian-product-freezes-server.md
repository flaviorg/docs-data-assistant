# 2026-10-04: A Cartesian product got through the policy and froze the server

## Context

Adversarial review before publication. The README and spec 003 said the risk of a heavy query was "mitigated by rules": no `RECURSIVE`, no comma join, up to 6 table references and a risk list of functions. The only rule against a Cartesian product was `comma_join`.

## Symptom

- `validate('SELECT COUNT(*) FROM orders a JOIN orders b JOIN orders c')` returned `ok: true`, with the plan `SCAN a`, `SCAN b`, `SCAN c`. `CROSS JOIN` and `JOIN ... ON 1=1` got through too.
- With two self-joins, execution reads 16,000,000 rows in about 55 ms. With three (4,000³ rows), the process did not finish in 10 s and was killed.
- Through `AskService`, with `ASK_TIMEOUT_MS=1000` and a scripted provider returning that SQL, the question did not finish in 12 s, and no 504 came out. A 100 ms `setInterval` did not fire even once.

## Cause

- The static policy recognized only the comma join. `JOIN` without `ON`/`USING`, `CROSS JOIN` and `NATURAL JOIN` produce the same Cartesian product.
- `node:sqlite` is synchronous and ran on the main thread. A long query holds the whole event loop: the other requests, `/health` and the `ASK_TIMEOUT_MS` timer itself, which fires only when the event loop comes back. `node:sqlite` exposes neither a *progress handler* nor `sqlite3_interrupt`.
- No static rule solves the general case: `ON 1=1`, or a join with no equality (`ON a.id <> b.id`), is syntactically a join with a condition.

## Correction

- New `cross_join` policy rule in the validator: `CROSS JOIN`, `NATURAL JOIN` and `JOIN` without `ON`/`USING` before the next `JOIN`, the next clause or the end of the level. It is `policy`: it blocks and does not go back to the model.
- Generated SQL now runs in a **child process** (`src/sql/query-runner.ts` and `src/sql/query-process.ts`), with its own read-only connection (same `query_only` and same authorizer). Past `SQL_TIMEOUT_MS` (default 5000), the child gets `SIGKILL` and the response is `status: error` with the `sql_timeout` warning, with no correction request. Aborting the request also kills the child, and the 504 comes out on time. The first attempt used a Worker and did not work ([incident](2026-10-04-terminate-does-not-interrupt-sqlite.md)).
- New EARS criterion `SQL-11` in spec 003. The README and the spec stopped saying "mitigated": they now describe the rule, the deadline and what still gets past the static layers (`ON 1=1`).
- Unchanged: validation (`EXPLAIN QUERY PLAN`) stays on the main thread, because it only compiles the query. The golden questions' SQL, which the eval runs as a reference, also stays there: it is author text, not model text.

## Test that prevents regression

- `tests/unit/sql-validator.unit.test.ts`: `policy:cross_join` cases (JOIN without ON, CROSS, NATURAL, LEFT JOIN without ON, a join without a condition inside a subquery) and the `ok` cases with `ON` and `USING`.
- `tests/unit/query-runner.unit.test.ts`, the `SQL-11` test (heavy query: the child process dies at the deadline, the event loop stays free and the next query uses a new child).
- `tests/int/sql-branch.int.test.ts`, the `SQL-11` test (a heavy query is cut off by `SQL_TIMEOUT_MS`) and the `API-02` test (with `ASK_TIMEOUT_MS` lower than `SQL_TIMEOUT_MS`, the heavy query gives a 504 within the request deadline).
- `tests/e2e/ask-api.e2e.test.ts`, the `SQL-11` test (`/health` answers while a heavy query runs).
- `npm run layers`: the `sql-cross-join` attack shows up stopped only by the lexer.
