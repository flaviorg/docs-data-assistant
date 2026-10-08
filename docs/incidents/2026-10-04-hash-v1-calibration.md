# 2026-10-04: hash-v1 separation below target on the first calibration

This incident concerns the original Portuguese knowledge base. The English base was recalibrated on 2026-10-08 ([incident](2026-10-08-translation-to-english.md)); the current threshold is 0.22.

## Summary

The first calibration of the lexical `hash-v1` embedder gave a **median separation of 0.047** on the `calibration` split. The target (EVL-03) is at least 0.15. The `recallAt3` of the `test` split was already 1.00 (8 of 8). Following the project rule, the embedder and the chunker were fixed; the golden questions did not change. After the fix, the separation was **0.176**, the calibrated threshold **0.18** and the refusal accuracy 0.917 on the `calibration` split.

## Impact

None for users, because nothing had been published. Without the fix, the refusal threshold would have been 0.09, right at the noise level. With it, answerable questions whose vocabulary differs from the document would score about the same as unanswerable ones, and the docs branch would refuse or answer almost at random.

## Timeline

1. The docs golden questions (12 in `test`, 12 in `calibration`) and the expected `chunkIds` were written by reading the documents, before running the search.
2. `npm run calibrate` with the initial `hash-v1` design (word and bigram with weight 1, character trigram with weight 0.3, embedded text `title — section\npassage`) gave a separation of 0.047, a threshold of 0.09 and an accuracy of 0.833.
3. Item-by-item diagnosis (vocabulary inside and outside the base, per question) and a prototype outside `src` comparing variations on `recall@3`, separation and accuracy on both splits.
4. The chosen variation went into `src`, with tests, and the calibration was rerun.

## Cause

Three effects added up:

1. **Inflection.** In the answerable questions, the words missing from the base were almost all inflections of words present in it: Portuguese pairs equivalent to "I bought" and "purchases", "regretted" and "regret", "they keep" and "kept", "Saturday" and "Saturdays", "they receive" and "to receive". Without matching, they only increased the norm of the question vector.
2. **Question scaffolding.** Verbs that frame the doubt (the Portuguese for "can I", "is there", "does it work", "happens", "takes long", "would like") almost never appear in the documents and had the maximum IDF. They pulled down the cosine of answerable questions.
3. **Dilution by bigrams.** In a chunk of about 500 characters, almost every bigram is unique (high IDF). With weight 1, bigrams held about half of the chunk vector's mass, and a question rarely repeats an exact pair. Matching single words lost weight.

In the unanswerable questions, the words outside the base are content words ("salary", "interns", "cashback", "certification"). That is the difference the embedder needs to preserve.

## What changed

| Where | Before (initial design) | After |
|---|---|---|
| `text-features.ts`: word feature | `w:<token>` | `w:<singular of the token>` (Portuguese plural rules, no dictionary) |
| `text-features.ts`: new feature | none | `s:<stem>` with weight 1: singular plus removal of one inflectional or derivational suffix, leaving at least 3 letters |
| `text-features.ts`: bigram | weight 1 | weight 0.3 (a complement, like the trigram) |
| `text-features.ts`: stopwords | 189 function words | 45 more: topic-free adverbs and question scaffolding |
| `ingest.ts`: embedded text | `title — section\npassage` | `title — section — section\npassage` (the section counts twice and reinforces the chunk's topic) |

The IDF formula, sublinear TF, signed *feature hashing*, 2048 dimensions, character trigrams with weight 0.3, chunk size (600) and overlap (100) did not change.

## Result

| Measure | Before | After |
|---|---|---|
| `calibration`: median separation | 0.047 | 0.176 |
| `calibration`: suggested threshold | 0.09 | 0.18 (plateau 0.18–0.19) |
| `calibration`: refusal accuracy at the threshold | 0.833 | 0.917 (11 of 12) |
| `calibration`: `recall@3` | 1.00 | 0.86 (6 of 7) |
| `test`: `recall@3` of `docs_answerable` | 1.00 | 1.00 (8 of 8) |
| `test`: refusal accuracy at the calibration threshold | 0.83 (threshold 0.09) | 1.00 (12 of 12, threshold 0.18) |

The error left in calibration is `cal-012` (today "Is there a points or cashback program for purchases?"). The question has no answer, but "program", "points" and "purchases" exist in the base (in the partnership program, in "84 points" and in several sections), and the top-1 sits at 0.213. It is an expected lexical false positive of an embedder with no semantics. What decides afterwards is `checkCitations` and the model itself, which can refuse.

The calibration `recall@3` dropped from 7 to 6. `cal-007` (today "What happens if nobody is home to receive the delivery?") shared no word with the "Failed delivery" section other than "delivery". The `calibration` split has no recall target (it measures the threshold), but the case is recorded as a known limit of `hash-v1`. In the English base it is back in the top 3 (recall 7 of 7).

## Honest caveats

- **Risk of overfitting.** The prototype compared about 190 parameter combinations, in six rounds, and the main criterion was the separation on the `calibration` split, which has only 12 items. The `test` split was consulted as a check and confirmed the result (separation 0.175, accuracy 1.00, recall 1.00), but it was also seen. The defense is that each change has a linguistic reason, independent of the questions, and applies equally to documents and questions. Even so, these numbers do not replace a measurement with new questions.
- The stem is heuristic and also creates false matches (the Portuguese for "they hire" and "contract"). They show up in the scores of the unanswerable questions and are counted in the result above.
- The prototype stayed in `.cache/` (out of version control). The final decisions are in the tests `hash-embedder.unit.test.ts`, `ingest.int.test.ts` and `rag-retrieval.int.test.ts`.

## Actions

- [x] Threshold `MIN_SCORE_DEFAULTS['hash-v1'] = 0.18` recorded in `src/config.ts`, with its origin (0.22 since 2026-10-08).
- [x] Tests of the new behavior (singular, stem, weights, scaffolding stopwords, duplicated section).
- [x] Recalibrate if the base, the chunker or the embedder change (spec 002); done on 2026-10-08 for the English base.
- [ ] In the optional M9, compare with MiniLM on the same questions.

## Test that prevents regression

- `tests/int/rag-retrieval.int.test.ts`: the `EVL-03` test (calibration uses only the `calibration` split, separates by at least 0.15, and the config threshold gets at least 0.90 right) and the `RAG-01` test (`hash-v1` `recallAt3` of at least 0.90 on the `docs_answerable` items of the `test` split).
- `tests/unit/hash-embedder.unit.test.ts`: singular, stem, weights and scaffolding stopwords. `tests/int/ingest.int.test.ts`: duplicated section in the embedded text (`embeddingText`).
- `npm run calibrate` and `npm run eval` (`recallAt3` and `refusalAccuracy`, both *mechanism*).
