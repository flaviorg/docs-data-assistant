# 2026-10-04: chaos state shared across requests

## Context

Building `AskService`. One of the review criteria of the initial design requires that two concurrent requests share neither budget, `requestId` nor chaos state. The fake provider, as first designed, kept the `primary-timeout-once` mode in a field of the provider itself: the first call to `fake/primary` failed with `timeout` and the following ones went through. Since `AppContext` has a single provider for the whole process, that state was global.

## Symptom

The problem showed up while designing the concurrency test, before it became a runtime failure: with `LLM_FAKE_CHAOS=primary-timeout-once` and two questions in `Promise.all` over the same provider, only the process's first call to `fake/primary` would fail. The other question would go through clean, and which of the two got the timeout would depend on scheduling order. On a demo server, "fail once" would apply once per process, not per question. (The "once per provider" behavior still exists when there is no `requestId`, and it is covered by a test.)

## Cause

Mutable per-provider state, with no request key. `ProviderRequest` carried nothing that identified the request, so the fake had no way to tell one question from another.

## Correction

- `ProviderRequest.meta` got an optional `requestId?`, filled in by `LlmClient` from the `CallContext`. The OpenRouter provider does not send `meta` to the API.
- The fake arms `primary-timeout-once` once **per `requestId`**. Without a `requestId` (direct provider tests), it still applies once per provider.
- The registry of requests already hit is capped at 10,000 keys, so it does not grow without bound on a long-running server with chaos on.
- `setChaos()` (used only by the demo) clears the registry when the mode changes.

## Test that prevents regression

- `tests/int/ask-service.int.test.ts`, the `API-03` test showing that chaos state is not shared (`primary-timeout-once` applies to each question): the two concurrent questions have `attempts` equal to `[2, 1]` in the ledger (timeout and retry in the router, a clean call in the next node).
- `tests/int/ask-service.int.test.ts`, the `API-03` test showing that two concurrent questions have independent budgets and `requestId`s.
- `tests/unit/fake-provider.unit.test.ts`, the test showing that `primary-timeout-once` does not affect the fallback, that `setChaos` re-arms the mode and that `none` goes back to normal.
