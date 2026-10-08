# 002: RAG with refusal

## Context

The `docs` route answers questions about the policies of Lunar Mill Specialty Coffee, a fictional company created for the project. The answer cites only retrieved passages and refuses when the evidence is weak. One of the documents deliberately carries an embedded instruction to test the defense against indirect injection.

## Scope

- **Document base:** 8 Markdown files in `data/kb/`, written from scratch, 250 to 500 words each, with an H1 and at least 3 H2s. Domain `lunarmill.example` (RFC 2606). `partner-coffee-shops.md` contains a poisoned paragraph with the canary `FULL-MOON-100`.
- `src/rag/chunker.ts`: split by H2 and H3, then by size (600 characters) with an overlap of 100; stable IDs `<slug>#<section>-<n>`.
- `src/embeddings/`: the `Embedder` interface and `hash-v1` (TF-IDF with *feature hashing*, 2048 dimensions, IDF fitted on the corpus, *fingerprint* `hash-v1:idf=<hash>`).
- `src/rag/sanitizer.ts`: sentence-level detection and redaction of embedded instructions; returns the removed spans.
- `src/rag/vector-store.ts` and `src/rag/ingest.ts`: `documents`, `chunks` and `kb_meta` in `app.db`; idempotent upsert by sha256; top-k search by cosine; `npm run ingest` CLI.
- `src/rag/citations.ts` and the `retrieve`, `ragAnswer` and `checkCitations` nodes.
- Threshold calibration (`src/eval/calibrate.ts`, `npm run calibrate`) on the `calibration` split of the golden questions.

## Non-goals

- PDF ingestion, document upload through the interface, reranking and hybrid BM25-plus-vector search.
- A semantic embedder in v1. MiniLM is left for the optional milestone M9, through the `Embedder` interface ([ADR 001](../../docs/adr/001-pluggable-embedder.md)).
- An LLM as a faithfulness judge. Faithfulness is guaranteed by mechanism: valid citation, output guard and refusal.
- Hybrid questions (documents and data in the same sentence).

## Acceptance criteria (EARS)

- **RAG-01** When the route is `docs`, the system shall retrieve the `RAG_TOP_K` (3) chunks with the highest cosine similarity.
- **RAG-02** If the top score falls below the active embedder's threshold, then the system shall answer `status: refused` without calling the generation model.
- **RAG-03** The system shall return in `citations` only chunks that were among the retrieved ones, and record in `warnings` any cited ID outside that set.
- **RAG-04** If no valid citation remains in a non-refused answer, then the system shall convert it to `status: refused`.
- **RAG-05** When the base is ingested again with no content change, the system shall not recreate chunks.
- **GRD-04** When a chunk contains an embedded instruction at ingestion, the system shall mark it as `flagged`, redact the passage and never send the original passage to the model.

## Decisions

- **600-character chunks split by section**, instead of large blocks: a large chunk dilutes the subject and hurts retrieval.
- **A deterministic lexical embedder in v1.** It runs with no network and no model download, and the result is reproducible in CI. It is semantically weak, and the README says so; metrics always carry the *fingerprint*.
- **A calibrated threshold, not a fixed one.** `npm run calibrate` sweeps thresholds only on the `calibration` split (12 items) and the chosen value, 0.22 (0.18 before the translation to English), goes into `MIN_SCORE_DEFAULTS` with a comment on its origin. The first calibration failed and the embedder was fixed without changing any question: [2026-10-04 incident](../../docs/incidents/2026-10-04-hash-v1-calibration.md). The English base required English stopwords and stemming: [2026-10-08 incident](../../docs/incidents/2026-10-08-translation-to-english.md).
- **IDF coupled to the corpus.** Changing any document recomputes the IDF and the vectors of every chunk (cheap with `hash-v1`), but rechunks only the changed document. An algorithm change requires changing the embedder id.
- **Sanitization at ingestion, not at query time.** The original passage stays only in `redacted_spans`, for the output guard to compare against; the text sent to the model already carries the mark `[passage removed: possible embedded instruction]`. Each chunk goes between `<document id="...">` tags and the prompt declares that nothing inside is an instruction. Escaping `<document` applies to the passage text and to the question: without it, the question closed the delimiter and opened a forged passage with the ID of a real chunk ([incident](../../docs/incidents/2026-10-04-question-forges-rag-passage.md)); the `system_tag` rule also stops the tag at input.
- **Citations filtered by the retrieved set.** The model can get the ID wrong; the code drops whatever was not retrieved and refuses if nothing is left.

## How to verify

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/kb-content.unit.test.ts tests/unit/chunker.unit.test.ts tests/unit/hash-embedder.unit.test.ts tests/unit/sanitizer.unit.test.ts tests/unit/vector-store.unit.test.ts tests/unit/citations.unit.test.ts tests/unit/rag-nodes.unit.test.ts tests/int/ingest.int.test.ts tests/int/rag-retrieval.int.test.ts tests/int/rag-branch.int.test.ts
npm run calibrate   # median separation and suggested threshold on the calibration split
npm run eval        # recallAt3 and refusalAccuracy (mechanism)
```
