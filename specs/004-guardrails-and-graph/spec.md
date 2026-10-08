# 004: Guardrails and graph

## Context

Every question goes through a 12-node LangGraph graph: input guardrail, a `docs | data | out_of_scope` router, the RAG and SQL branches, and a `finalize` node with an output guard. The defenses against injection live in deterministic code, before and after the model; the model classifier is an optional layer that fails closed.

## Scope

- `src/guardrails/rules.ts` and `rule-classifier.ts`: about 20 Portuguese and English patterns with id and severity (`high` blocks; `medium` only in combination), with accents and case normalized.
- `src/guardrails/safeguard-classifier.ts` and the `safeguard` prompt: a safety model with no tools, policy and question sent together, answer read by `SAFE` or `UNSAFE` at the start.
- `src/guardrails/output-guard.ts`: canary, redacted spans and 8-word shingles of the prompts' protected blocks, minus the `allowedEchoes`.
- `GUARDRAIL_MODE` `rules`, `rules+model` or `off` (turns off only the input layers).
- The `router` prompt and the `guardrailInput`, `router`, `outOfScope` and `finalize` nodes.
- `src/graph/state.ts` (explicit reducers), `src/graph/routing.ts` (pure conditional edges), `src/graph/graph.ts` (`createAskGraph`), `src/app-context.ts` (composition) and `src/ask-service.ts` (the single service used by the API, CLIs, demo and eval).

## Non-goals

- Conversation with memory or multi-turn: each question is independent.
- Hybrid questions: the router picks the dominant intent.
- LangGraph Studio (`langgraph.json`), which depends on a CLI downloaded by `npx` and on a hosted account.
- The model classifier with the fake provider (`createAppContext` refuses `rules+model` when the effective provider is `fake`).

## Acceptance criteria (EARS)

- **GRD-01** When the question matches a high-severity injection rule, the system shall answer `status: blocked` with `blockedBy: input_rules`, without calling the router or a generation model.
- **GRD-02** Where `GUARDRAIL_MODE=rules+model`, when the rules do not block, the system shall send the policy and the question to the safety model and treat an answer starting with `UNSAFE` as an `input_model` block.
- **GRD-03** If the safety classifier answers outside the format or with truncated output, then the system shall block (fail closed) with a message that does not accuse the user of injection and record the reason in `guardrail.reasons`; if the safety model is unavailable after the retries, then the system shall answer HTTP 503 (as in LLM-03) without calling the router.
- **GRD-05** If the generated answer (including the route reason and the SQL block) contains 8 consecutive words of a redacted passage, the poisoned document's canary, or 8 consecutive words of the `role`, `context`, `task` or `constraints` blocks of a system prompt (minus the sentences the prompt itself tells the model to emit), then the system shall replace it with a refusal with `status: blocked` and `blockedBy: output_guard`.
- **RTE-01** When the question passes the guardrail, the system shall classify it as `docs`, `data` or `out_of_scope` and record `routeReason`.
- **RTE-02** When `forceRoute` is given, the system shall use the given route without calling the router and return `overridden: true`.
- **RTE-03** If the router output is invalid or truncated after the parse retry, then the system shall continue through `out_of_scope` with the `router_fallback` warning.
- **RTE-04** When the route is `out_of_scope`, the system shall answer `status: refused` with a fixed message, without calling any prompt other than the router.

## Decisions

- **The rules are the weakest layer.** They catch obvious direct injection, at no cost and without an LLM. The main defense is architectural: a model with no write tools, a read-only connection, an authorizer, sanitization at ingestion, context delimiting and an output guard.
- **The classifier fails closed.** An answer outside the format or truncated output blocks with `classifier_unparseable` or `classifier_error`, and the message says the check failed, not that the user attempted an injection. A false block is visible and measured (`falseBlockRate`); an injection that gets through is not.
- **A safety model outage is a 503, not a block.** `GUARDRAIL_MODEL` has no fallback. Before, its outage became `blocked` with the injection message, HTTP 200 and `errorRate` 0: the operator did not see the outage and the user was accused over a transport failure. Now `LlmUnavailableError` propagates as in LLM-03: the request answers 503 `llm_unavailable`, nothing gets through without a verdict, and the outage shows up in `errorRate` and in the `warn` log. With `rules+model`, the assistant's availability also depends on the safety model.
- **The output guard sees all model text that reaches the response.** Besides `answer` and `followUpQuestions`, `finalize` checks in any status the `routeReason` (on a leak, the response becomes `blocked` and the reason is replaced by fixed text) and the SQL block: query, original query, last error, column names and rows, because a literal written by the model (`SELECT 'FULL-MOON-100'`) becomes a cell. On a leak in the SQL block, the query becomes "query withheld by the output guard" and rows, columns and error come out empty. The queries of the `sql-generate` examples go into `allowedEchoes`; without that, 12 of the 23 SQL queries in the fixtures and golden questions would be blocked as a leak, because they repeat the JOIN of the examples. `checkCitations` copies into the `citation_dropped:<id>` warning only an ID with a chunk shape that passes the guard; anything else becomes `citation_dropped:invalid_id` ([incident](../../docs/incidents/2026-10-04-output-guard-missed-route-reason.md)).
- **The output guard compares normalized text.** The prompts' `output` block never counts (it is the format the model must follow), and the sentences the prompt itself tells the model to emit, such as the canonical refusal, go into `allowedEchoes`, discounted per prompt.
- **Scenarios 10 and 11 use "simulated compliant model" fixtures.** A real model would not receive the poisoned passage (already redacted at ingestion). The fixture stages a model that gave in, to prove that the last line of defense blocks it anyway.
- **Explicit reducers in the state.** In LangGraph 1.4, `z.array(...).default([])` becomes a *LastValue* channel (the last node overwrites). `warnings`, `trace` and `redactedSpans` use `withLangGraph` with a concatenation reducer.
- **Every path has a route.** The longest path has 16 steps; the `recursionLimit` of 25 is only a safety net, and a test proves it is not reached.
- **Errors handled before success.** Each node checks `outcome` and `pendingError` before the happy path.
- **`GUARDRAIL_MODE=off` exists to show the impact.** With it, the direct injection of scenario 8 reaches the router (fixture marked `"scenario": "guardrail-off"`), and scenarios 9 to 12 are still stopped by the structural layers.

## How to verify

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/rule-classifier.unit.test.ts tests/unit/safeguard-classifier.unit.test.ts tests/unit/output-guard.unit.test.ts tests/unit/control-nodes.unit.test.ts tests/unit/graph-state.unit.test.ts tests/int/graph-routing.int.test.ts tests/int/guardrail-layers.int.test.ts tests/int/rag-branch.int.test.ts tests/int/sql-branch.int.test.ts
npm run layers   # each deterministic layer tested on its own against eval/attacks.v1.json
```
