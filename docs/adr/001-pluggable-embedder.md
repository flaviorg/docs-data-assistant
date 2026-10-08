# ADR 001: pluggable embedder, with `hash-v1` in v1

- **Status:** accepted (2026-10-04)
- **Related spec:** [`specs/002-rag-with-refusal/spec.md`](../../specs/002-rag-with-refusal/spec.md)

## Context

The `docs` branch needs to turn text into a vector to find the 3 chunks most similar to the question. The obvious path is a local *sentence embeddings* model, such as MiniLM via `@huggingface/transformers`. In v1, that runs into three project constraints:

1. **Run with no network after `npm install`.** The model is downloaded on the first run (tens of MB), and CI would have to download or cache that file.
2. **Determinism.** `rag-answer` fixtures cite chunk IDs that depend on what the embedder retrieves, and the contract test requires `citedChunkIds ⊆ top-3`. An embedder whose results vary by runtime version would break the contract with no code change.
3. **Minimal dependencies.** The project pins 7 exact packages; `@huggingface/transformers` brings a whole inference runtime.

At the same time, a lexical embedder is semantically weak: questions whose vocabulary differs from the document retrieve worse. That has to be visible and have a path forward.

## Decision

- The RAG code depends only on the `Embedder` interface (`src/embeddings/embedder.ts`): `id`, `dim`, `fingerprint` and `embed(texts)`, with unit-norm vectors.
- v1 has a single implementation, `hash-v1` (`src/embeddings/hash-embedder.ts`): TF-IDF with signed *feature hashing*, 2048 dimensions, IDF fitted on the corpus at ingestion. It is deterministic, runs in milliseconds and has no dependency.
- Every index records the embedder's *fingerprint* in `kb_meta`. The `VectorStore` refuses to search with an embedder whose *fingerprint* differs (`ReindexRequiredError`), and `ensureData()` reindexes in `file` mode.
- The refusal threshold is **per embedder** (`MIN_SCORE_DEFAULTS` in `src/config.ts`), calibrated with `npm run calibrate` on the `calibration` split. `hash-v1` uses 0.22 (0.18 before the base was translated to English).
- `rag-answer` fixtures declare the embedder in their header (`"embedder": "hash-v1"`), and the loader refuses the file if the active embedder is a different one.
- Every eval metric is labeled with the *fingerprint*. The README says `hash-v1` is lexical.

## Consequences

- The project runs and is tested with no network, and the fixture contract is stable.
- `recallAt3` and the median separation measure a lexical embedder; the numbers do not transfer to a semantic embedder. The incident [`2026-10-04-hash-v1-calibration`](../incidents/2026-10-04-hash-v1-calibration.md) records the known limits of the original Portuguese base (`cal-007` outside the top 3, `cal-012` a lexical false positive), and [`2026-10-08-translation-to-english`](../incidents/2026-10-08-translation-to-english.md) records those of the English base.
- Changing the `hash-v1` **algorithm** without changing the IDF does not change the *fingerprint*. Any algorithm change requires a new id (`hash-v2`) or a forced reindex.

## How to plug in MiniLM (optional milestone M9)

1. **Optional dependency, loaded by `import()` with the name in a variable.** Create `src/embeddings/minilm-embedder.ts` with something like `const mod = 'some-package'; const { pipeline } = await import(mod);`. With the specifier in a variable, `tsc` does not try to resolve the package and the project still compiles without it installed; no ambient declaration (`declare module`) is needed. The package goes into `optionalDependencies` only in M9.
2. **New id and `fingerprint`.** `EmbedderId` becomes `'hash-v1' | 'minilm-v1'`; the *fingerprint* includes the model name and revision (for example `minilm-v1:all-MiniLM-L6-v2@<revision>`), so a change of weights invalidates the index.
3. **Config.** `EMBEDDER=minilm` is no longer refused by `loadConfig` (today it fails with a message that points to M9). `MIN_SCORE_DEFAULTS` gets a `minilm-v1` key, with a value from `npm run calibrate` on the same `calibration` split, never reusing `hash-v1`'s 0.22.
4. **Fixtures per embedder.** `rag-answer` gets one file per embedder (for example `fixtures/llm/rag-answer.v1.minilm-v1.json`), with `citedChunkIds` checked against MiniLM's top 3. The contract test runs once per available embedder. The golden questions do not change.
5. **Indexes coexisting by *fingerprint*.** Instead of a single set of vectors in `app.db`, the vector table gets the key `(chunk_id, fingerprint)`. Switching embedders does not delete the other one's index, and `assertEmbedder` checks that an index exists for the active *fingerprint*.
6. **Comparative eval.** Run `npm run eval` with each embedder and publish the two reports side by side, over the same items.

None of these steps was implemented in v1. They come in only after the author validates v1.
