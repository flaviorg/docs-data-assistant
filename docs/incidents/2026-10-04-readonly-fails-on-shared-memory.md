# 2026-10-04: `readOnly` does not hold on shared memory

## Context

Checking `node:sqlite` (Node 24.21, SQLite 3.53.4) before writing the design of the analytical connection. Tests, demo and eval need to run with the sales database in memory, with no file. The initial design opened the same in-memory database twice, with a shared cache (`file:sales?mode=memory&cache=shared`): one writable connection for the seed and another with `new DatabaseSync(uri, { readOnly: true })` for the assistant.

## Symptom

On the connection opened with `readOnly: true` over the shared in-memory database, an `INSERT` and a `DELETE` went through without error (the count went from 1 to 2 rows and then to 0). The same open over a **file** refused the write with `attempt to write a readonly database` (errcode 8, `SQLITE_READONLY`). The probe was repeated when the project was wrapped up, with the same result.

## Cause

With a shared cache, the two connections use the same in-memory database, and the read-only flag of the second open did not prevent writes. We did not track down the exact line in SQLite; what matters for the project is the observed behavior: the `readOnly` protection is reliable only when the database comes from a file.

## Correction

- **Memory mode:** no shared cache. The seed runs on a writable `:memory:`, the database is serialized (`db.serialize()`) and the assistant receives a **separate** connection, created with `deserialize()` from that snapshot (`src/sql/readonly-connection.ts`, `createSalesSnapshot` in `src/sql/seed.ts`). Changing the copy does not change the snapshot.
- **File mode:** `new DatabaseSync(SALES_DB_PATH, { readOnly: true })`, as planned.
- **In both modes:** `PRAGMA query_only = ON` before the authorizer, and the authorizer denies every action other than reads. Read-only no longer depends on a single flag.

## Test that prevents regression

- `tests/unit/readonly-connection.unit.test.ts`:
  - the `SQL-08` test showing that a write fails through `query_only` without the authorizer, and through the authorizer;
  - the `SQL-08` test showing that a file opened with `readOnly` refuses writes even without `query_only` and the authorizer;
  - the test showing that the deserialized snapshot does not change the original.
- `npm run layers`: the three writes via SQL are stopped by `query_only` alone, without the authorizer.
