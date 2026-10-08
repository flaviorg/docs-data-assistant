# Incidents

A record of real problems found during the build: an API that behaved differently than expected, a failing metric, a test that caught a wrong design. None of this affected users (the project had not been published). The goal is to keep the cause and the test that prevents a regression in view of whoever touches the code later.

Project rule (`specs/constitution.md`): when an eval metric fails, the mechanism is fixed or the threshold is recalibrated on the `calibration` split, and the decision is recorded here. Golden questions and fixtures are not rewritten to pass.

The incidents dated 2026-10-04 were written while the product was still in Portuguese and were translated on 2026-10-08. Questions, messages and test descriptions quoted in them are given in English; test names in the code are still in Portuguese, so each test is identified by file and, where there is one, by its EARS ID.

## Template

Copy to `docs/incidents/YYYY-MM-DD-<short-subject>.md`:

```markdown
# YYYY-MM-DD: <one-line title>

## Context
Where we were (task, component, library version) and what was expected.

## Symptom
What was observed, with the exact message or number.

## Cause
Why it happened. If it is library behavior, how it was confirmed.

## Correction
What changed in the code or the design, and what deliberately did not change.

## Test that prevents regression
File and test name (or command) that fails if the problem comes back.
```

## Log

| Date | Incident | Area |
|---|---|---|
| 2026-10-04 | [`prepare()` silently drops extra statements](2026-10-04-prepare-drops-statements.md) | SQL |
| 2026-10-04 | [`readOnly` does not hold on shared memory](2026-10-04-readonly-fails-on-shared-memory.md) | SQL |
| 2026-10-04 | [`LIKE` denied by the authorizer](2026-10-04-like-denied-by-authorizer.md) | SQL |
| 2026-10-04 | [`hash-v1` separation below target on the first calibration](2026-10-04-hash-v1-calibration.md) | RAG |
| 2026-10-04 | [Chaos state shared across requests](2026-10-04-chaos-shared-across-requests.md) | LLM client |
| 2026-10-04 | [False `query_only` redundancy in the layer matrix](2026-10-04-false-redundancy-in-matrix.md) | Eval |
| 2026-10-04 | [Legitimate item blocked in the fake eval (`docs-003`)](2026-10-04-false-block-docs-003-in-fake-eval.md) | Eval |
| 2026-10-04 | [A Cartesian product got through the policy and froze the server](2026-10-04-cartesian-product-freezes-server.md) | SQL |
| 2026-10-04 | [`Worker.terminate()` does not interrupt a `node:sqlite` query](2026-10-04-terminate-does-not-interrupt-sqlite.md) | SQL |
| 2026-10-04 | [The output guard did not see the route reason or the dropped citation ID](2026-10-04-output-guard-missed-route-reason.md) | Guardrails |
| 2026-10-04 | [The answer's SQL block bypassed the output guard](2026-10-04-sql-block-bypassed-output-guard.md) | Guardrails |
| 2026-10-04 | [The question could forge a passage in the RAG prompt](2026-10-04-question-forges-rag-passage.md) | Guardrails |
| 2026-10-04 | [Allowed text functions allocated hundreds of MB within the deadline](2026-10-04-uncapped-text-functions.md) | SQL |
| 2026-10-08 | [Refusal threshold recalibrated after translating the product to English](2026-10-08-translation-to-english.md) | RAG |
