# Course lessons applied

Only IDs and topics; no excerpt or example from a lesson is in this repository. The table links each topic to the place in the code where it shows up.

| Lessons | Topic | Where it is in the code |
|---|---|---|
| 198068, 198069, 198082 | Prompt as versioned configuration; anti-hallucination contract | `src/prompts/v1/` (6-block JSON with `meta.version`) |
| 198077, 198078, 198079 | OpenAI-compatible provider, OpenRouter, switching models by configuration | `src/llm/openrouter-provider.ts`, `src/config.ts` |
| 198080, 198081, 198082 | RAG with chunking, top-k, minimum score and refusal | `src/rag/`, `src/graph/nodes/retrieve.ts` |
| 198062 | Calibrating a threshold by experiment | `src/eval/calibrate.ts`, `MIN_SCORE_DEFAULTS` |
| 200953, 200954 | Fail-fast config, injectable service, `app.inject` | `src/config.ts`, `src/server.ts`, `tests/e2e/` |
| 200955 to 200959 | `StateGraph`, conditional edges, fallback route | `src/graph/graph.ts`, `src/graph/routing.ts` |
| 200960 to 200963 | Structured output with `safeParse`; "the LLM extracts, the code decides" | `src/llm/llm-client.ts`, graph nodes |
| 200969 to 200972 | Guardrail before the router; the system prompt is not a firewall | `src/guardrails/`, `src/graph/nodes/guardrail-input.ts` |
| 200973 to 200978 | Text-to-query with a real schema, validation, correction with a cap, `no_results` | `src/sql/`, `src/graph/nodes/sql-*.ts` |
| 200968, 200980 | Evaluator with a threshold in CI; structure assertion | `src/eval/`, `.github/workflows/ci.yml` |
| 221503 to 221507 | SDD with a constitution, EARS specs, short instructions, pre-commit | `specs/`, `AGENTS.md`, `.githooks/pre-commit` |
| 221514 | Stable HTTP contract (400, 422, 504) | `src/server.ts`, `src/ask-service.ts` |
| 221515, 221516 | `node:sqlite`, `:memory:` in tests, idempotent seed | `src/sql/seed.ts`, `tests/helpers/context.ts` |
| 221519, 221521 | Embedder interface, cosine, relevance cutoff | `src/embeddings/`, `src/rag/vector-store.ts` |
| 221522 | Estimating tokens before sending | `src/llm/tokens.ts` |
| 221524 | Router with reason and override; retry, fallback and 503 | `src/graph/nodes/router.ts`, `src/llm/llm-client.ts` |
| 221525 | `requestId`, JSON logger, `/stats`; writing as autonomy tier 4 | `src/obs/`, read-only connection |

The observability and resilience showcase of the project trio is `incident-copilot`; here these patterns appear in a lean form.
