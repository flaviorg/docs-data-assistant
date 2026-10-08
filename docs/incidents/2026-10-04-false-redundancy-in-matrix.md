# 2026-10-04: false `query_only` redundancy in the layer matrix

## Context

Building `npm run layers`. The matrix runs each attack in `eval/attacks.v1.json` through each deterministic layer **in isolation**. For the `query_only` column, the initial design said: open a connection with only `PRAGMA query_only = ON` (no authorizer), run the payload and count any failure as `blocks`.

## Symptom

With that rule, the `sql-loadext` attack (`SELECT load_extension(...)`) showed up as stopped by `query_only`. The error was `not authorized` (errcode 1), not a write refusal, and it came out the same on a connection without `query_only`. The matrix would show two independent layers against `load_extension` (authorizer and `query_only`), but `query_only` has nothing to do with extensions.

## Cause

`node:sqlite` creates every connection with extension loading turned off. That is why `load_extension` fails on any connection, with or without `query_only`. The "failure = blocks" rule confused the driver's safe default with the merit of the layer. The same risk existed in the authorizer column: a query can fail for another reason (missing table, syntax) without the authorizer having denied anything.

## Correction

- `query_only` counts as `blocks` only when the error is `SQLITE_READONLY` (errcode 8), the write refusal that is this layer's job (`src/eval/layers.ts`).
- The authorizer counts as `blocks` only when it records at least one denial while compiling `EXPLAIN QUERY PLAN`.
- Result in the matrix: `sql-loadext`, `sql-contacts` and `sql-names` get past the lexer and `query_only` and are stopped only by the authorizer. The three writes are still stopped by 3, 2 and 3 layers (`sql-multi` gets past the authorizer because `prepare()` drops the `DROP`; see the [incident](2026-10-04-prepare-drops-statements.md)).

## Test that prevents regression

- `tests/unit/layers.unit.test.ts`, the `EVL-04` test showing that reading personal data and a risky function are stopped only by the authorizer, and that the lexer sees neither table nor function.
- `tests/unit/layers.unit.test.ts`, the test showing that the matrix displays the real redundancy and gaps of each layer.
- `tests/unit/layers.unit.test.ts`, the `EVL-04` test showing that every attack is stopped by at least one layer and every write by two.
