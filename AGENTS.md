# AGENTS.md

Instructions for coding agents (Claude Code, Copilot, Codex and the like) in this repository. Also read `specs/constitution.md`.

## What it is

A TypeScript assistant that answers questions about a fictional company (Lunar Mill Specialty Coffee; base, questions and messages in English) through RAG with refusal or safe Text-to-SQL, behind a LangGraph graph with layered guardrails.
The default provider is a `fake` scripted by fixtures; OpenRouter comes in with a key in `.env`.
Runs on Node 24.15+ with no build, no Docker and no network after `npm install`.

## Commands

- `npm test`: the whole suite (unit, int, e2e) with no network. Run one file: `node --import ./tests/helpers/no-network.ts --test tests/unit/<file>.test.ts`.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run eval`: eval gate on the fake profile; exits with 1 below the threshold.
- `npm run layers`: attack × layer matrix; exits with 1 if any attack gets through every layer.
- `npm run demo`: the 13 in-memory scenarios.
- `npm run calibrate`: refusal threshold on the `calibration` split.

## TypeScript with no build (*type stripping*)

- Relative imports with the `.ts` extension; `import type` for types (`verbatimModuleSyntax`).
- Forbidden: `enum`, `namespace`, *parameter properties* (`constructor(public x)`) and decorators. Error classes declare fields in the body.
- Money values in integer cents. Emails and websites only on the `.example` domain.

## Where everything lives

- `src/graph/nodes/`: one node per file, created by a `createXNode(deps)` factory; pure edges in `src/graph/routing.ts`.
- `src/prompts/v1/`: versioned prompts (6-block JSON); register every new prompt in `src/prompts/v1/index.ts`.
- `fixtures/llm/<promptId>.v1.json`: fake answers, one entry per normalized question.
- `eval/`: `golden.v1.json` (golden questions), `attacks.v1.json` (matrix), `thresholds.json` (thresholds).
- `src/sql/`: lexer, validator, read-only connection, authorizer and the executor in a child process with a deadline (`query-runner.ts`). `src/guardrails/`: rules, classifier and output guard.
- `specs/`: constitution and specs with EARS criteria. `docs/incidents/` and `docs/adr/`: recorded decisions.
- Composition: `src/app-context.ts` is the only place that does `new` on dependencies; tests use `tests/helpers/context.ts`.

## How to add a question

1. Add the item to the `test` split of `eval/golden.v1.json` with `category` and `expected` (route, status, `blockedBy`, `chunkIds` or `sql`).
2. Write the fixtures for each prompt on the expected path (`router`, then `rag-answer` or `sql-generate`/`sql-correct`/`sql-answer`). A `data` item with no correction uses `"responseFromGolden": "<id>"`. Numbers in `sql-answer` come from actually running the SQL on the seed.
3. In `rag-answer`, cite only chunks that `hash-v1` retrieves in the top 3.
4. Run `tests/unit/fixtures-contract.unit.test.ts` and `tests/unit/golden-schema.unit.test.ts`: the contract runs each item through the graph and reports a missing or orphan fixture.
5. Run `npm run eval` and check that the composition in spec 005 is still valid.

## Prohibitions

- Do not edit golden questions or fixtures to make a metric pass. Fix the mechanism or recalibrate on the `calibration` split and record it in `docs/incidents/`.
- Do not relax the SQL policy (lexer, allowlist, risk list, `query_only`, authorizer, `limits.length` cap). A policy violation blocks; it does not become a correction.
- Do not run model-generated SQL on the main thread: use the `QueryRunner` (child process with `SQL_TIMEOUT_MS`). A `Worker` does not work, because `terminate()` does not interrupt `node:sqlite`.
- Do not use `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in `src/web/`; no inline script or style.
- Do not add a dependency (runtime or dev). The 7 in `package.json` are exact and the only ones.
- Do not `git commit`, `git push`, publish or create a repository without an explicit request from the human.
- Do not read, print or copy `.env`. Tests never use the network or a real key.
- Do not copy course material (transcript, slide, lesson example). Lessons only by ID and topic.

## SDD workflow

1. Spec first: an EARS criterion with an ID in `specs/00N-*/spec.md` (or a change to an existing criterion).
2. Failing test first, with the ID at the start of its name: `test('SQL-05 exhausts 3 corrections and answers error', ...)`. The ID marks the test that proves the criterion; a complementary test or a test on another subject has no ID.
3. Minimal implementation until it passes.
4. Verification: `npm run typecheck && npm test && npm run eval && npm run layers`, all with exit code 0. `tests/unit/ears-coverage.unit.test.ts` reports an ID without a test.

## Pre-commit hook

`npm run hooks:install` points Git to `.githooks/`; the `pre-commit` hook runs `npm run typecheck` and `npm test` and stops the commit if either fails.
