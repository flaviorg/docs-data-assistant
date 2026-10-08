# 2026-10-04: `prepare()` silently drops extra statements

## Context

Checking `node:sqlite` (Node 24.21, SQLite 3.53.4) before writing the SQL layer design. The initial idea was to rely on `prepare()` to refuse SQL with more than one statement, as other drivers do by throwing a "multiple statements" error.

## Symptom

`db.prepare('select 1; drop table t')` does not throw. The compiled statement is just `select 1;`; `drop table t` is ignored without warning, and `stmt.all()` returns the `select` row.

## Cause

`StatementSync.prepare()` calls `sqlite3_prepare_v2`, which compiles the first statement and returns the rest of the text in a "tail" pointer. Node does not check whether that tail has content. In model-generated SQL, a `; DROP ...` or `; PRAGMA query_only = OFF` would be invisible: it does not run, but it does not show up in an error or a log either, and validation based on `EXPLAIN` would never see it.

## Correction

- The lexer (`src/sql/sql-lexer.ts`) tokenizes while respecting strings, quoted identifiers and comments, and the validator (`src/sql/validator.ts`) removes **a single** trailing `;` and rejects any other `;` outside a string or comment with the `multiple_statements` rule. It is `policy`: it blocks and does not go back to the model for correction.
- The rule comes before any `prepare()`, so not even `EXPLAIN QUERY PLAN` gets to compile the first part.
- `query_only` and the authorizer remain independent layers, but they are not the defense against this case: the dropped text never reaches them.

## Test that prevents regression

- `tests/unit/sql-validator.unit.test.ts`, the `SQL-02` test (the policy and classification table covers every rule): `select 1; drop table orders`, `SELECT 1;;` and `SELECT 1 FROM orders WHERE 0; PRAGMA query_only = OFF` give `policy` / `multiple_statements`.
- `tests/unit/sql-lexer.unit.test.ts`: a `;` inside a string does not count as a separator.
- `npm run layers`: the `sql-multi` attack shows up stopped by the lexer and getting past the authorizer, which documents why the lexer rule is needed.
