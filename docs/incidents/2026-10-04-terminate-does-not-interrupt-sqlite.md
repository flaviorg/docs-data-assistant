# 2026-10-04: `Worker.terminate()` does not interrupt a `node:sqlite` query

## Context

Fixing the [Cartesian product that froze the server](2026-10-04-cartesian-product-freezes-server.md). The plan was what the README already pointed to as "the right way": run the SQL in a `worker_threads.Worker` and call `terminate()` when the deadline ran out. Node 24.21.

## Symptom

- The executor tests passed, but the test process never exited: it hung until it was killed with `SIGKILL` after 40 s.
- In an isolated probe, with the Worker running `SELECT COUNT(*) FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1`: after `terminate()`, the returned promise never resolved. The process used 1,992 ms of CPU in the following 2 s (a whole core), and not even `process.exit(0)` could end it.

## Cause

`terminate()` asks V8 to stop the thread's JavaScript execution. The thread was inside `sqlite3_step`, in native code, and would only return to JavaScript at the end of the query. SQLite has `sqlite3_interrupt` and a *progress handler* for this, but the `node:sqlite` of this version exposes neither. I checked the methods of `DatabaseSync.prototype`: `open`, `close`, `prepare`, `exec`, `function`, `createTagStore`, `location`, `aggregate`, `createSession`, `applyChangeset`, `enableLoadExtension`, `enableDefensive`, `loadExtension`, `serialize`, `deserialize` and `setAuthorizer`. As long as the thread does not leave native code, the process does not end.

## Correction

- The SQL runs in a **child process** (`child_process.fork`, `advanced` serialization to carry the database snapshot). At the deadline, or when the request is aborted, the parent sends `SIGKILL`: the operating system ends the process right away, whatever code is running. In the probe, the child died 2 ms after the signal.
- The child is created on the first query (about 40 ms) and reused. Requests run one at a time, in a queue. When idle, the child does not keep the parent process alive (`unref` on the process and on the IPC channel).
- **Busy orphan:** if the parent dies while the child is stuck in a query, nobody sends the `SIGKILL`. A watchdog thread in the child checks `process.ppid` every 250 ms and ends the process if the parent changed. In the probe, with the parent exiting via `process.exit(0)` or receiving `SIGTERM` in the middle of the query, the child was gone in under 1 s. When idle, the child exits on its own on the channel's `disconnect`.
- The child gets `execArgv: []`, so it does not inherit `--inspect`, `--watch` or the options that `node --test` passes along. The environment comes through `process.env`, including the `NODE_OPTIONS` with the tests' network block.

## Test that prevents regression

- `tests/unit/query-runner.unit.test.ts`: the heavy query ends in `SqlTimeoutError` within the deadline, the parent's event loop keeps running and the next query works in a new child. The test file exits on its own; with the Worker, it hung.
- The whole suite (`npm test`) finishes without leaving a `query-process.ts` process alive (checked with `ps` after the run).
