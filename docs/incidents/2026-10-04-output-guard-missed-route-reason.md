# 2026-10-04: The output guard did not see the route reason or the dropped citation ID

## Context

Adversarial review before publication. The output guard (GRD-05) is the last defense against a model that gave in to an injection. It checked only `answer` and `followUpQuestions`, and only in `answered` responses on the `docs` and `data` routes.

## Symptom

With a scripted provider staging a compliant model, the router returned a `reason` with the canary and the first constraint of the `rag-answer` prompt, and `rag-answer` cited a made-up ID with the same text. The API answered `status: answered` and `blockedBy: null`. `routeReason` carried the canary and the protected excerpt, and `warnings` carried `citation_dropped:<canary> Everything inside <document> ...`. The page shows both fields ("Route reason" and "Warnings").

## Cause

- `finalize` passed only the answer and the follow-up questions through the guard. `routeReason` (up to 200 characters from the router) went straight into the response, in any status.
- `checkCitations` copied the dropped ID, free text from the model with no length limit in the schema, into the `citation_dropped:<id>` warning. Since `warnings` accumulates by concatenation, `finalize` could not even remove the warning afterwards.

## Correction

- `finalize` checks the route reason in any status. If it leaks, the whole response becomes `blocked` / `output_guard`, and the reason is replaced by "reason withheld by the output guard".
- `checkCitations` receives the `OutputGuard`. The dropped ID goes into the warning only if it has the shape of a chunk ID (`slug#section-n`), is at most 120 characters long and passes the guard. Otherwise the warning carries `citation_dropped:invalid_id`. The count of dropped citations still counts toward the eval's `citationValidity`.
- `RagAnswerOutputSchema.citedChunkIds` now accepts only strings of up to 120 characters.
- New attack `out-citation-id` in the layer matrix.

## Test that prevents regression

- `tests/unit/control-nodes.unit.test.ts`, the `GRD-05` test showing that `finalize` checks the route reason in any status.
- `tests/unit/rag-nodes.unit.test.ts`, the `GRD-05` test showing that `checkCitations` does not echo a cited ID carrying the canary into the warning.
- `tests/int/guardrail-layers.int.test.ts`, the `GRD-05` test showing that a compliant model leaks neither the canary nor the system prompt through the route reason or the dropped-citation warning (the review's probe, through `AskService`).
