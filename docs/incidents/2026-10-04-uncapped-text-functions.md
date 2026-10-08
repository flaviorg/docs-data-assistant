# 2026-10-04: Allowed text functions allocated hundreds of MB within the deadline

## Context

Second adversarial review before publication. `printf` and `format` were on the risk list because a width specifier allocates hundreds of MB in a single call. Spec 003 and the README said that `node:sqlite` does not expose `sqlite3_limit` and that what holds back a query that allocates too much is the execution deadline and SQLite's internal limit.

## Symptom

- `WITH s(t) AS (SELECT 'a'×64) SELECT length(replace(replace(replace(t,'a',t),'a',t),'a',t))` got through the validator and returned 16,777,216.
- With four levels, SQLite answered `string or blob too big` in about 100 ms (88 and 110 ms in two probes), but the process RSS had already reached 1,059 MB.
- `SELECT length(group_concat(a.id)) FROM orders a JOIN orders b ON 1=1` returned 75,571,999.

The 5 s deadline does not help: everything happens in under a second. The child process isolates the server, but the machine pays for the memory.

## Cause

`replace()`, `group_concat()`, `concat()`, `hex()` and `char()` are on the allowlist and multiply the size of a value just like `printf`. SQLite's internal limit is 1 GB per value and acts only after the allocation.

The spec's premise was out of date: since Node 24.15, `node:sqlite` exposes `sqlite3_limit` as `DatabaseSync.limits`. The attempt with `PRAGMA hard_heap_limit` did not work: Node's SQLite is compiled with `SQLITE_DEFAULT_MEMSTATUS=0`, and without memory accounting the limit stays at 0 and is not applied.

## Correction

- `openSalesConnection` sets `db.limits.length = 100000` (`SQL_MAX_VALUE_BYTES`) on every analytical connection: the validator's, the child process's and the layer matrix variants. The same queries fail with `string or blob too big` in under 1 ms (the `group_concat` over `ON 1=1`, in 183 ms), with stable RSS.
- The largest legitimate value is far from the cap: cells are cut at 200 characters and a `group_concat` of all order IDs is about 20 KB.
- A size error follows the SQL-04 rule (it goes to correction), because it fails right away and does not use up the deadline.
- `engines` became `>=24.15`, and `assertSqliteFeatures` asks for Node 24.15+ when `DatabaseSync.limits` does not exist.
- New EARS criterion `SQL-12`.

## Test that prevents regression

- `tests/unit/readonly-connection.unit.test.ts`, the `SQL-12` test (text and blob limited to `SQL_MAX_VALUE_BYTES`).
- `tests/unit/query-runner.unit.test.ts`, the `SQL-12` test (the child process opens its connection with the same size cap).
- `tests/unit/env-example.unit.test.ts`, the two Node 24.15+ tests.
