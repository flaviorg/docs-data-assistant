# 2026-10-04: The answer's SQL block bypassed the output guard

## Context

Second adversarial review before publication. Spec 004 said the output guard (GRD-05) sees all model text that reaches the response. After the [route reason incident](2026-10-04-output-guard-missed-route-reason.md), `finalize` checked `answer`, `followUpQuestions` and `routeReason`.

## Symptom

With a scripted provider in which `sql-generate` returned `SELECT 'FULL-MOON-100' AS coupon, '<first constraint of rag-answer>' AS rule`, the API answered `status: answered`, `blockedBy: null` and `warnings: []`. The canary and the system prompt excerpt were in `sql.query` and in `sql.rows`, and the page shows both. Applied by hand to the same texts, the guard answered `canary` and `system_prompt_leak`.

## Cause

`finalize` did not look at the `sql` state, and `AskService` copied `query`, `originalQuery`, `pendingError.message`, `columns` and `rows` straight into the response. A literal written by the model becomes a cell, an alias becomes a column name, and a made-up identifier can come back in SQLite's error message.

The obvious fix had a side effect: the context of the `sql-generate` prompt carries three example queries, and the guard protects the `context` block. Checking the SQL against the protected blocks blocked 12 of the 23 SQL queries in the fixtures and golden questions, because they repeat the `JOIN` of `order_items`, `products` and `orders` from the examples.

## Correction

- `finalize` checks, in any status, the query, the original query, the last error, the column names and the rows (all together, so a leak split across cells cannot escape). On a leak, the response becomes `blocked` / `output_guard`, the query becomes "query withheld by the output guard", and rows, columns and error come out empty.
- The three example queries of `sql-generate` went into `allowedEchoes`: they are what the prompt tells the model to imitate, not a secret. With that, none of the 23 legitimate SQL queries is blocked, and the eval keeps `falseBlockRate` at 1/26.
- New attack `out-sql-literal` in the layer matrix.

## Test that prevents regression

- `tests/unit/control-nodes.unit.test.ts`, the `GRD-05` test showing that `finalize` checks the SQL block in any status (literal, rows built with `char()`, alias, original query, error with status `error`, a query stopped by the policy, and a legitimate SQL query similar to the examples).
- `tests/int/guardrail-layers.int.test.ts`, the `GRD-05` test showing that a compliant model leaks neither the canary nor the system prompt through the SQL block (the review's probe, through `AskService`).
