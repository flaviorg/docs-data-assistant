# 2026-10-04: `LIKE` denied by the authorizer

## Context

Review of the SQL layer design, before the code. The first version of the authorizer allowed, under `SQLITE_FUNCTION`, only a short allowlist (aggregates and a few text and date functions) and treated any other function as a policy violation. The adversarial review of the design asked how operators such as `LIKE` reach the authorizer.

## Symptom

In a probe with `db.setAuthorizer()` on Node 24.21 (SQLite 3.53.4), `SELECT city FROM customers WHERE city LIKE 'Cur%'` reaches the authorizer as `SQLITE_FUNCTION` named `like` (and `GLOB` as `glob`). Denying the function, `prepare()` fails with `not authorized to use function: like` (errcode 1). With the short allowlist, the legitimate question "customers from Curitiba" would become an `sql_authorizer` block, counted as a false block.

## Cause

In SQLite, `LIKE` and `GLOB` are implemented as SQL functions (`like(pattern, value)`), and the authorizer receives the function call, not the operator. The short list was written with "functions the user writes" in mind, not with what SQLite generates underneath.

## Correction

- The allowlist in `src/sql/sql-functions.ts` was extended to pure text, number, date and window functions, including `like` and `glob` (49 functions in total).
- A function outside the allowlist that is **not** on the risk list (for example `random()`) is no longer a policy matter: it becomes a correctable error, with the list of allowed functions attached to the correction request (criterion SQL-10). Only the risk list (`load_extension`, `printf`, `format`, `zeroblob`, `randomblob`, `fts3_tokenizer`) blocks.
- The classification uses the authorizer's record of denials (type and name), not the text of the message.

## Test that prevents regression

- `tests/unit/readonly-connection.unit.test.ts`, the `SQL-08` test (`LIKE` allowed; `printf` is risky; `random` outside the allowlist; recursive CTE denied).
- `tests/unit/sql-validator.unit.test.ts`, the `SQL-02` test (the policy and classification table covers every rule, including `WHERE city LIKE 'Cur%'` allowed) and the `SQL-10` test (a function outside the allowlist and outside the risk list is correctable, with the allowlist in the message).
