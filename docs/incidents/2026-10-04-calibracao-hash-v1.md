# 2026-10-04: separação do hash-v1 abaixo da meta na primeira calibração

## Resumo

A primeira calibração do embedder lexical `hash-v1` deu **separação das medianas de 0,047** no split `calibration`. A meta (EVL-03) é de pelo menos 0,15. O `recallAt3` do split `test` já estava em 1,00 (8 de 8). Pela regra do projeto, o embedder e o chunker foram corrigidos; as perguntas-ouro não mudaram. Depois da correção, a separação ficou em **0,176**, o limiar calibrado em **0,18** e a acurácia de recusa em 0,917 no split `calibration`.

## Impacto

Nenhum para usuários, porque nada foi publicado. Sem a correção, o limiar de recusa ficaria em 0,09, colado no ruído. Com ele, perguntas respondíveis de vocabulário diferente do documento teriam score parecido com o de perguntas sem resposta, e o ramo docs recusaria ou responderia quase ao acaso.

## Linha do tempo

1. As perguntas-ouro de docs (12 no `test`, 12 no `calibration`) e os `chunkIds` esperados foram escritos lendo os documentos, antes de rodar a busca.
2. `npm run calibrate` com o `hash-v1` do desenho inicial (palavra e bigrama com peso 1, trigrama de caractere com peso 0,3, texto embedado `título — seção\ntrecho`) deu separação 0,047, limiar 0,09 e acurácia 0,833.
3. Diagnóstico item a item (vocabulário dentro e fora da base, por pergunta) e protótipo fora do `src` comparando variações em `recall@3`, separação e acurácia nos dois splits.
4. A variação escolhida entrou no `src`, com testes, e a calibração foi refeita.

## Causa

Três efeitos somados:

1. **Flexão.** Nas perguntas respondíveis, as palavras que não existem na base são quase todas flexões de palavras que existem: "comprei" e "compras", "arrependi" e "arrependimento", "guardam" e "guardados", "sábado" e "sábados", "recebem" e "receber". Sem casar, elas só aumentavam a norma do vetor da pergunta.
2. **Andaime de pergunta.** Verbos que enquadram a dúvida ("consigo", "existe", "funciona", "acontece", "demora", "gostaria") quase nunca aparecem nos documentos e tinham o IDF máximo. Puxavam para baixo o cosseno das perguntas respondíveis.
3. **Diluição por bigramas.** Num chunk de cerca de 500 caracteres, quase todo bigrama é único (IDF alto). Com peso 1, os bigramas ficavam com cerca de metade da massa do vetor do chunk, e uma pergunta raramente repete um par exato. O casamento de palavras isoladas perdia peso.

Nas perguntas sem resposta, as palavras fora da base são de conteúdo ("salário", "estagiários", "cashback", "certificação"). Essa é a diferença que o embedder precisa preservar.

## O que mudou

| Onde | Antes (desenho inicial) | Depois |
|---|---|---|
| `text-features.ts`: feature de palavra | `w:<token>` | `w:<singular do token>` (regras de plural do português, sem dicionário) |
| `text-features.ts`: feature nova | nenhuma | `s:<radical>` com peso 1: singular mais remoção de um sufixo de flexão ou derivação, sobrando ao menos 3 letras |
| `text-features.ts`: bigrama | peso 1 | peso 0,3 (complemento, como o trigrama) |
| `text-features.ts`: stopwords | 189 palavras funcionais | mais 45: advérbios sem tópico e andaime de pergunta |
| `ingest.ts`: texto embedado | `título — seção\ntrecho` | `título — seção — seção\ntrecho` (a seção conta duas vezes e reforça o tópico do chunk) |

Fórmula do IDF, TF sublinear, *feature hashing* com sinal, 2048 dimensões, trigramas de caractere com peso 0,3, tamanho do chunk (600) e overlap (100) não mudaram.

## Resultado

| Medida | Antes | Depois |
|---|---|---|
| `calibration`: separação das medianas | 0,047 | 0,176 |
| `calibration`: limiar sugerido | 0,09 | 0,18 (platô 0,18–0,19) |
| `calibration`: acurácia de recusa no limiar | 0,833 | 0,917 (11 de 12) |
| `calibration`: `recall@3` | 1,00 | 0,86 (6 de 7) |
| `test`: `recall@3` dos `docs_answerable` | 1,00 | 1,00 (8 de 8) |
| `test`: acurácia de recusa no limiar da calibração | 0,83 (limiar 0,09) | 1,00 (12 de 12, limiar 0,18) |

O erro que sobra na calibração é `cal-012` ("Existe programa de pontos ou cashback nas compras?"). A pergunta não tem resposta, mas "programa", "pontos" e "compras" existem na base (no programa de parceria, em "84 pontos" e em várias seções), e o top-1 fica em 0,213. É um falso positivo lexical esperado de um embedder sem semântica. Quem decide depois é o `checkCitations` e o próprio modelo, que pode recusar.

O `recall@3` da calibração caiu de 7 para 6. `cal-007` ("O que acontece se ninguém estiver em casa para receber a entrega?") não traz nenhuma palavra de "Entrega não realizada" além de "entrega". O split `calibration` não tem meta de recall (ele mede o limiar), mas o caso fica registrado como limite conhecido do `hash-v1`.

## Ressalvas honestas

- **Risco de sobreajuste.** O protótipo comparou cerca de 190 combinações de parâmetros, em seis rodadas, e o critério principal foi a separação no split `calibration`, que tem só 12 itens. O split `test` foi consultado como conferência e confirmou o resultado (separação 0,175, acurácia 1,00, recall 1,00), mas também foi visto. A defesa é que cada mudança tem motivo linguístico, independente das perguntas, e vale igual para documentos e perguntas. Ainda assim, esses números não substituem uma medição com perguntas novas.
- O radical é heurístico e também cria casamentos falsos ("contratam" e "contrato"). Eles aparecem nos scores das perguntas sem resposta e estão contados no resultado acima.
- O protótipo ficou em `.cache/` (fora do versionamento). As decisões finais estão nos testes `hash-embedder.unit.test.ts`, `ingest.int.test.ts` e `rag-retrieval.int.test.ts`.

## Ações

- [x] Limiar `MIN_SCORE_DEFAULTS['hash-v1'] = 0.18` gravado em `src/config.ts`, com a origem.
- [x] Testes do comportamento novo (singular, radical, pesos, stopwords de andaime, seção duplicada).
- [ ] Recalibrar se a base, o chunker ou o embedder mudarem (spec 002).
- [ ] No M9 opcional, comparar com o MiniLM nas mesmas perguntas.

## Teste que impede a volta

- `tests/int/rag-retrieval.int.test.ts`, `EVL-03 calibração usa só o split calibration, separa ≥ 0,15 e o limiar do config acerta ≥ 0,90`, e `RAG-01 recallAt3 do hash-v1 ≥ 0,90 nos docs_answerable do split test`.
- `tests/unit/hash-embedder.unit.test.ts`: singular, radical, pesos e stopwords de andaime. `tests/int/ingest.int.test.ts`: seção duplicada no texto embedado (`embeddingText`).
- `npm run calibrate` e `npm run eval` (`recallAt3` e `refusalAccuracy`, ambos *mecanismo*).
