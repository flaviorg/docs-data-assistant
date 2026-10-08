# 2026-10-08: refusal threshold recalibrated after translating the product to English

## Context

The knowledge base (`data/kb/`), the golden questions (`eval/golden.v1.json`), the attacks (`eval/attacks.v1.json`), the model fixtures (`fixtures/llm/`), the prompts, the seed data shown to users and every CLI, eval and web message were translated from Brazilian Portuguese to English. The fictional company was renamed from Moenda Lunar Cafés Especiais to Lunar Mill Specialty Coffee, and the canary from `LUA-CHEIA-100` to `FULL-MOON-100`. The `hash-v1` embedder is lexical, so its stopwords and its plural and stem rules were written for Portuguese and had to be rewritten for English. Any change to the base or the embedder requires recalibrating the refusal threshold (spec 002, EVL-03).

The file names in `data/kb/` were kept, so chunk IDs still start with the original slugs (for example `politica-de-trocas-e-devolucoes#defective-products-1`); the section part of every ID comes from the new English headings.

## Symptom

With English stopwords, an English singularizer and an English suffix stemmer, the first `npm run calibrate` gave:

- median separation **0.120** (the EVL-03 target is at least 0.15);
- best refusal accuracy on the `calibration` split **0.833** (10 of 12), with no threshold able to separate `cal-004` (answerable, 0.192) from `cal-012` (unanswerable, 0.191), and `cal-010` (unanswerable) at 0.261, above four of the seven answerable items.

`tests/int/rag-retrieval.int.test.ts` (`EVL-03 ... separa ≥ 0,15 e o limiar do config acerta ≥ 0,90`) failed.

## Cause

Item-by-item vocabulary check (which question words exist in the base, exactly or by stem):

1. **Irregular verbs.** Answerable questions used past forms that no suffix rule reaches: "bought" (base: "buy"), "kept"/"keep" (`cal-004`: "How long do you keep the data from my orders?" against "Order data is kept for 5 years"), "breaks"/"broke".
2. **Missing function words.** "until" and "within" were not stopwords, while their Portuguese counterpart ("até") was. "within" appears in almost every policy sentence, and "until" only added norm to `cal-003`.
3. **A translation artifact in one hard negative.** The original partner document said "com CNPJ ativo" and `cal-010` asked "Qual é o CNPJ da Moenda Lunar?": the only rare word they shared was the acronym. The first English draft translated CNPJ as "company registration number" in both places, which created a three-word exact overlap (`company`, `registration`, `number`) that the Portuguese pair never had, and lifted the unanswerable `cal-010` to 0.261.

## Correction

| Where | Change |
|---|---|
| `src/embeddings/text-features.ts` | English stopword list (200 words, including question scaffolding such as "want", "need", "know", "happens", and the prepositions "until", "within", "upon") |
| `src/embeddings/text-features.ts` | English singular rules (`-ies` → `-y`, `-xes`/`-ches`/`-shes` → stem, final `-s`) and an English suffix stemmer that also undoes a doubled final consonant ("shipping"/"shipped" → `ship`, "cancelled" → `cancel`) |
| `src/embeddings/text-features.ts` | A table of common irregular verbs mapped to the infinitive ("bought" → `buy`, "kept" → `keep`, "fell" → `fall`) |
| `data/kb/cafeterias-parceiras.md` and `cal-010` | CNPJ kept as the acronym, as in the original, with a gloss in the document ("an active CNPJ (the Brazilian company tax ID)"); the question became "What is Lunar Mill's CNPJ?" |
| `src/config.ts` | `MIN_SCORE_DEFAULTS['hash-v1']` from 0.18 to **0.22**, the value suggested by `npm run calibrate` |

Feature weights (word and stem 1, bigram and character trigram 0.3), the IDF formula, the 2048 dimensions, the duplicated section in the embedded text, the chunk size (600) and the overlap (100) did not change. A sweep of the bigram and trigram weights was tried first and did not reach the target (best separation 0.137), so it was dropped.

One fixture changed for a reason other than wording: in Portuguese, scenario 1 ("What is the deadline to return a defective grinder?") retrieved the warranty section in the top 3 and the scripted answer cited it. In English the top 3 is `defective-products-1`, `defective-products-2` and `how-to-request-an-exchange-or-a-return-1`, and `defective-products-2` already carries the sentence about the 12-month warranty. The fixture now cites the two "Defective products" chunks, which is what a model that only sees the retrieved passages could cite.

## Result

| Measure | Portuguese (2026-10-04) | English, first draft | English, final |
|---|---|---|---|
| `calibration`: median separation | 0.176 | 0.120 | **0.157** |
| `calibration`: suggested threshold | 0.18 (plateau 0.18–0.19) | 0.18 | **0.22** (only point at the maximum) |
| `calibration`: refusal accuracy at the threshold | 0.917 (11 of 12) | 0.833 (10 of 12) | **1.000** (12 of 12) |
| `calibration`: `recall@3` | 0.86 (6 of 7) | 1.00 | **1.00** (7 of 7) |
| `test`: `recall@3` of `docs_answerable` | 1.00 (8 of 8) | 1.00 | **1.00** (8 of 8) |
| `test`: refusal accuracy at the calibrated threshold | 1.00 (12 of 12) | 1.00 | **1.00** (12 of 12) |

`npm run eval` (fake profile) passes with the same values as before the translation: the three contracts at 1.00, `recallAt3` 1.00, `refusalAccuracy` 1.00, `injectionBlockRate` 1.00 and `falseBlockRate` 0.04 (`docs-003`, the simulated compliant model). `npm run layers` gives the same matrix: 19 attacks, all stopped, SQL writes stopped by 3, 2, 3 and 3 layers.

## Honest caveats

- **The margin is thin.** 0.22 is the only grid point with accuracy 1.000. The closest answerable item is `cal-007` at 0.227 and the closest unanswerable is `cal-010` at 0.213. A different wording of a single calibration question can move the threshold by 0.01 or 0.02.
- **`cal-010` was reworded after a measurement.** The change restores the lexical relationship of the original Portuguese pair (one shared acronym) and was applied to the document and the question together, but it was made after seeing the first scores. It is recorded here for that reason.
- **The irregular-verb table and the stopwords were chosen after reading the calibration questions.** Each entry is a general English rule, independent of any golden question, and it applies equally to documents and questions; still, the 12 calibration items were also used to judge the change. The `test` split was checked afterwards and confirmed the result, but it was seen too.
- `cal-012` ("Is there a points or cashback program for purchases?") stays close to the threshold (0.195) because "program", "points" and "purchases" exist in the base. It is the same expected lexical false positive as in Portuguese.

## Test that prevents regression

- `tests/int/rag-retrieval.int.test.ts`: `EVL-03 calibração usa só o split calibration, separa ≥ 0,15 e o limiar do config acerta ≥ 0,90` and `RAG-01 recallAt3 do hash-v1 ≥ 0,90 nos docs_answerable do split test`.
- `tests/unit/hash-embedder.unit.test.ts`: English stopwords, singular rules, stems and irregular verbs.
- `tests/e2e/eval.e2e.test.ts`: `split all` gives `recallAt3` 15/15 and `refusalAccuracy` 24/24.
- `npm run calibrate` and `npm run eval`.
