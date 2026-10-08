# Project constitution

Rules that apply to all code, every spec and every agent working in this repository. A feature spec can add detail to, but not contradict, what is here.

## Engineering principles

1. **Refusing is a feature.** Without enough evidence, the assistant answers with the canonical refusal. A made-up answer is a defect; a correct refusal is a success. The refusal threshold is calibrated and versioned (`src/config.ts`).
2. **Every LLM output goes through a schema.** Nothing the model returns is used without Zod's `safeParse` (`src/llm/llm-client.ts`). Output outside the schema gets one parse retry and, if it persists, a deterministic per-node fallback.
3. **Generated code is validated before it runs.** The model's SQL goes through a lexer, a static policy, `EXPLAIN QUERY PLAN` and an authorizer, and runs on a read-only connection. A policy violation blocks and never goes back to the model for "correction".
4. **Every loop has a cap.** SQL corrections (3), logical prompt executions per request (8), attempts per model, graph steps (`recursionLimit` 25), rows, cells, request time. Each cap has a test.
5. **The system prompt is not a firewall.** Security lives in deterministic code: input rules, document sanitization, context delimiting, authorizer, `query_only` and output guard. The model classifier is optional and fails closed.
6. **Quality is measured, not assumed.** The eval gate (`npm run eval`) runs in CI and fails below the threshold. Each metric says whether it is a *mechanism* (really measured) or a *contract (fixture)*.

## Golden-question integrity rule

Rewriting golden questions (`eval/golden.v1.json`) or fixtures (`fixtures/llm/`) to make a metric pass is forbidden. When a metric fails, the mechanism is fixed (embedder, chunker, rule, prompt) or the threshold is recalibrated on the `calibration` split only, and the decision is recorded in the feature spec or in `docs/incidents/`.

## Honest fake

The `fake` provider replaces **only the model call**. Retrieval, threshold, sanitization, SQL validation and execution, authorizer, guardrails, retry, fallback, ledger and `/stats` run for real. A question without a fixture fails with `FixtureMissingError`; there is never a generic answer. Fixtures that stage a model that gave in carry the note "simulated compliant model", and the demo and the README say so. Fake mode shows up in every output (`meta.provider`, the DEMO MODE banner, the FAKE label).

## Course material

No course material goes into the repository: transcript, slide, author's text or lesson example. Lessons are cited only by ID and topic. The fictional company's documents, the dataset, the attack corpus, the prompts and the golden questions are written from scratch.

## Human in control

No commit, push, publication or creation of a remote repository happens without an explicit request from the responsible human. Agents prepare the change, run `npm run typecheck` and `npm test`, and hand it over for validation.

## Workflow (SDD)

1. The feature spec (`specs/00N-*/spec.md`) comes before the code and carries EARS criteria with IDs.
2. The criterion's test is written first, with the ID in its name, and fails for the right reason.
3. Minimal implementation until the test passes.
4. Verification: `npm run typecheck`, `npm test`, `npm run eval` and `npm run layers` with exit code 0. The test `tests/unit/ears-coverage.unit.test.ts` ensures every spec ID has a test.
