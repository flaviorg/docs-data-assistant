# 003: Safe Text-to-SQL

## Context

The `data` route turns a sales question into SQL, validates the query before running it, executes it on a connection that cannot write, and answers with a short analysis and follow-up questions. The SQL comes from a model and is treated as untrusted input: five independent layers decide whether it runs, and an execution deadline decides for how long.

## Scope

- **Sales database:** `src/sql/sales-schema.ts`, `src/sql/prng.ts` (mulberry32) and `src/sql/seed.ts`, with the fixed seed 20251. Five tables (`customers`, `products`, `orders`, `order_items`, `customer_contacts`), values in integer cents, orders from 2025 only. `customer_contacts` stays outside the allowlist and `customers.name` is a denied column. `npm run seed` CLI.
- `src/sql/readonly-connection.ts` and `src/sql/sql-functions.ts`: read-only connection (`readOnly` for the file, a deserialized snapshot in memory), a cap of 100,000 bytes per text or blob (`DatabaseSync.limits.length`), `PRAGMA query_only = ON` and an authorizer with a table, column and function allowlist that records every denial.
- `src/sql/schema-introspect.ts`: real DDL of the allowed tables, without denied columns, plus a business glossary.
- `src/sql/sql-lexer.ts` and `src/sql/validator.ts`: a lexer that understands strings and comments, static policy, `LIMIT` rewriting, `EXPLAIN QUERY PLAN` and classification of the error as `policy` or `correctable`.
- `src/sql/executor.ts`: `iterate()` cut off at `SQL_MAX_ROWS + 1`, cells cut at 200 characters, detection of "no results". The row cutoff is defense in depth: SQL that went through `sqlValidate` already has a `LIMIT` less than or equal to `SQL_MAX_ROWS`, so `truncated` never becomes true on that path; the signal the API shows is `limitApplied`.
- `src/sql/query-runner.ts` and `src/sql/query-process.ts`: generated SQL runs in a child process with its own read-only connection; past `SQL_TIMEOUT_MS` (default 5000), or if the request is aborted, the child gets `SIGKILL`.
- The `sql-generate`, `sql-correct` and `sql-answer` prompts (`src/prompts/v1/`) and the `sqlGenerate`, `sqlValidate`, `sqlCorrect`, `sqlExecute` and `sqlAnswer` nodes, with the pure routing functions in `src/graph/routing.ts`.

## Non-goals

- Any write to the sales database by the assistant (tier 4 of the Autonomy Matrix, forbidden by construction).
- A multi-step planner: one question generates one query. Non-recursive CTEs cover compound questions.
- A total memory limit per query: the per-value cap (SQL-12) holds back the text functions, and SQLite's page cache and *sorters* have their own caps, but the child process has no RSS limit. `PRAGMA hard_heap_limit` does not work: Node's SQLite is compiled with `SQLITE_DEFAULT_MEMSTATUS=0`, and without memory accounting the limit is not applied.
- Correcting a policy violation: whatever violates the policy is blocked.

## Acceptance criteria (EARS)

- **DATA-01** When the seed runs with the same seed value, the system shall produce the same fingerprint and a `total_cents` equal to the sum of the items in every order.
- **SQL-01** When the route is `data`, the system shall include in the prompt the DDL obtained by introspecting the sales database, restricted to the allowed tables and columns.
- **SQL-02** If the generated SQL has more than one statement, does not start with `SELECT` or `WITH`, contains a forbidden keyword, or accesses a table, a column or a risky function outside the allowlist, then the system shall answer `status: blocked` without executing and without asking for a correction.
- **SQL-03** When the SQL has no literal `LIMIT` less than or equal to `SQL_MAX_ROWS`, the system shall apply `LIMIT SQL_MAX_ROWS` before executing, preserving `OFFSET`.
- **SQL-04** When `EXPLAIN QUERY PLAN` or the execution fails with a syntax error or a missing table or column, the system shall ask the model for a correction with the query, the error and the question, up to `SQL_MAX_CORRECTIONS` (3) times.
- **SQL-05** If the corrections run out, then the system shall answer `status: error` with a deterministic message, `corrections: 3` and `lastError`, without a new model call.
- **SQL-06** When the valid query returns no results (zero rows, or every row with every cell `NULL`), the system shall answer `status: no_results`, distinct from `error`.
- **SQL-07** When the query returns rows, the system shall answer with `answer` and 1 to 3 `followUpQuestions`, sending the model at most `SQL_ROWS_TO_LLM` (50) rows.
- **SQL-08** The system shall execute generated SQL only on a connection with `query_only` on and an authorizer that denies every action other than reading the allowlisted tables.
- **SQL-09** The system shall deny reading the `customers.name` column and omit it from the schema sent to the model.
- **SQL-10** If the SQL uses a function outside the allowlist that is not on the risk list, then the system shall treat it as a correctable error and attach the list of allowed functions to the correction request.
- **SQL-11** If SQL execution exceeds `SQL_TIMEOUT_MS`, then the system shall interrupt the query without freezing the other requests and answer `status: error` with the `sql_timeout` warning, without asking for a correction.
- **SQL-12** The system shall open the connection that validates and executes generated SQL with a cap of 100,000 bytes per text or blob (`SQLITE_LIMIT_LENGTH`), so that a query that builds a larger value fails with an execution error before allocating beyond the cap.

## Decisions

- **The lexer rejects any second statement.** `StatementSync.prepare()` compiles only the first one and silently drops the rest (`select 1; drop table t` becomes `select 1`). Without this rule, a hidden `DROP` would never show up in the error. A single trailing `;` is accepted.
- **`readOnly` is not enough in memory.** On an in-memory database with a shared cache, `readOnly: true` does not prevent writes. Memory mode uses a snapshot (`serialize()` and `deserialize()` on a separate connection), and `query_only` applies in both modes.
- **The authorizer decides by its list of denials, not by the error text.** A denied table, column, action or risky function becomes `policy` (`blockedBy: sql_authorizer`); only a function outside the allowlist that is not risky becomes `correctable` (SQL-10). The authorizer acts while `EXPLAIN QUERY PLAN` compiles, before execution.
- **A size cap per value (SQL-12).** The execution deadline does not limit memory: three nested `replace()` calls over 64 characters built 16 MB, four went past 1 GB of RSS in about 100 ms, and `group_concat()` over an `ON 1=1` join returned 75 MB, all within the deadline. SQLite's internal limit (1 GB) acted only after the allocation. Since Node 24.15, `node:sqlite` exposes `sqlite3_limit` as `DatabaseSync.limits`; the connection opens with `limits.length = 100000`, and the same query fails with `string or blob too big` in under 1 ms. An execution error follows the SQL-04 rule (it goes to correction), because it fails right away and does not use up the deadline. That is why `engines` asks for Node 24.15+.
- **`printf` and `format` are on the risk list.** A width specifier allocated hundreds of MB in one call; with the SQL-12 cap this also runs into 100,000 bytes, but both stay out because formatting numbers is the job of `sqlAnswer`. `load_extension`, `zeroblob`, `randomblob` and `fts3_tokenizer` are on the list too.
- **A policy violation does not go back to the model.** Sending it for correction would give an attacker new attempts to get around the rule.
- **`SELECT *` on `customers` stays a policy matter.** Expanding `*` reads `customers.name`, and the authorizer denies the read just as in `SELECT name`. Treating this case as correctable would require guessing, from the SQL text, whether the column came from `*`; the project chose to keep the rule simple and to warn, in the glossary sent to the model, to list the columns of `customers`. A real model that writes `c.*` gets `blocked`, and no golden question measures how often that happens on the live profile.
- **Separate databases.** `sales.db` holds no internal tables; documents, vectors and ledger live in `app.db`.
- **"No results" is distinct from an error.** `SUM` over an empty set returns one row with `NULL`; the executor treats zero rows and rows of only `NULL` as `no_results`, and `COUNT` over an empty set (one row with 0) as a valid result.
- **A join without a condition is a policy matter.** Besides the comma in `FROM` (`comma_join`), the `cross_join` rule stops `CROSS JOIN`, `NATURAL JOIN` and `JOIN` without `ON`/`USING`. `ON 1=1`, or a join without equality, still gets past the static layers: it is syntactically a join with a condition.
- **`INTO` is a forbidden keyword.** `REPLACE INTO` is an `INSERT`, and `REPLACE` cannot go on the list because `replace()` is an allowed function. SQLite has no `SELECT INTO`, so `INTO` outside a string only shows up in writes.
- **Execution deadline in a child process (SQL-11).** `node:sqlite` is synchronous and exposes neither a *progress handler* nor `sqlite3_interrupt`: on the main thread, a heavy query held the event loop, `/health` stopped answering and the 504 never came out ([incident](../../docs/incidents/2026-10-04-cartesian-product-freezes-server.md)). A Worker does not solve it, because `terminate()` does not interrupt native code ([incident](../../docs/incidents/2026-10-04-terminate-does-not-interrupt-sqlite.md)). The child is created on the first query, runs one request at a time and has a watchdog thread that ends it if the parent dies. Exceeding the deadline does not lead to a correction: the model gets no new attempts at a heavy query.
- **Validation stays on the main thread.** `EXPLAIN QUERY PLAN` only compiles the query. The reference SQL of the golden questions, which the eval runs directly on the main connection, is author text, not model text.

## How to verify

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/seed.unit.test.ts tests/unit/readonly-connection.unit.test.ts tests/unit/query-runner.unit.test.ts tests/unit/schema-introspect.unit.test.ts tests/unit/sql-lexer.unit.test.ts tests/unit/sql-validator.unit.test.ts tests/unit/executor.unit.test.ts tests/unit/sql-routing.unit.test.ts tests/unit/sql-nodes.unit.test.ts tests/int/sql-branch.int.test.ts
npm run seed -- --out .cache/sales-check.db   # counts and fingerprint
npm run layers                                # a write via SQL stopped by more than one layer
node --import ./tests/helpers/no-network.ts --test tests/unit/query-runner.unit.test.ts   # execution deadline (SQL-11) and per-value cap in the child (SQL-12)
```
