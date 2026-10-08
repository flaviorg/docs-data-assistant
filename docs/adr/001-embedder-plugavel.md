# ADR 001: embedder plugável, com o `hash-v1` no v1

- **Status:** aceito (2026-10-04)
- **Spec relacionada:** [`specs/002-rag-com-recusa/spec.md`](../../specs/002-rag-com-recusa/spec.md)

## Contexto

O ramo `docs` precisa transformar texto em vetor para buscar os 3 chunks mais parecidos com a pergunta. O caminho óbvio é um modelo de *sentence embeddings* local, como o MiniLM via `@huggingface/transformers`. No v1, isso esbarra em três restrições do projeto:

1. **Rodar sem rede depois do `npm install`.** O modelo é baixado na primeira execução (dezenas de MB) e o CI teria de baixar ou guardar em cache esse arquivo.
2. **Determinismo.** Fixtures de `rag-answer` citam IDs de chunk que dependem do que o embedder recupera, e o teste de contrato exige `citedChunkIds ⊆ top-3`. Um embedder com resultado variável por versão de runtime quebraria o contrato sem mudança de código.
3. **Dependências mínimas.** O projeto fixa 7 pacotes exatos; o `@huggingface/transformers` traz um runtime de inferência inteiro.

Ao mesmo tempo, um embedder lexical é fraco semanticamente: perguntas com vocabulário diferente do documento recuperam pior. Isso precisa ficar visível e ter caminho de evolução.

## Decisão

- O código de RAG depende só da interface `Embedder` (`src/embeddings/embedder.ts`): `id`, `dim`, `fingerprint` e `embed(texts)`, com vetores de norma 1.
- O v1 tem uma única implementação, o `hash-v1` (`src/embeddings/hash-embedder.ts`): TF-IDF com *feature hashing* com sinal, 2048 dimensões, IDF ajustado no corpus na ingestão. É determinístico, roda em milissegundos e não tem dependência.
- Todo índice grava o *fingerprint* do embedder em `kb_meta`. O `VectorStore` recusa buscar com um embedder de *fingerprint* diferente (`ReindexRequiredError`), e o `ensureData()` reindexa no modo `file`.
- O limiar de recusa é **por embedder** (`MIN_SCORE_DEFAULTS` em `src/config.ts`), calibrado com `npm run calibrate` no split `calibration`. O `hash-v1` usa 0,22 (0,18 antes da tradução da base para o inglês).
- As fixtures de `rag-answer` declaram o embedder no cabeçalho (`"embedder": "hash-v1"`), e o carregador recusa o arquivo se o embedder ativo for outro.
- Toda métrica do eval sai rotulada com o *fingerprint*. O README diz que o `hash-v1` é lexical.

## Consequências

- O projeto roda e testa sem rede, e o contrato das fixtures é estável.
- `recallAt3` e a separação das medianas medem um embedder lexical; os números não se transferem para um embedder semântico. O incidente [`2026-10-04-calibracao-hash-v1`](../incidents/2026-10-04-calibracao-hash-v1.md) registra os limites conhecidos (`cal-007` fora do top-3, `cal-012` falso positivo lexical).
- Mudar o **algoritmo** do `hash-v1` sem mudar o IDF não muda o *fingerprint*. Qualquer mudança de algoritmo exige um id novo (`hash-v2`) ou reindexação forçada.

## Como plugar o MiniLM (marco opcional M9)

1. **Dependência opcional, carregada por `import()` com nome em variável.** Criar `src/embeddings/minilm-embedder.ts` com algo como `const mod = 'some-package'; const { pipeline } = await import(mod);`. Com o especificador numa variável, o `tsc` não tenta resolver o pacote e o projeto continua compilando sem ele instalado; não é preciso declaração ambiente (`declare module`). O pacote entra em `optionalDependencies` só no M9.
2. **Novo id e `fingerprint`.** `EmbedderId` passa a `'hash-v1' | 'minilm-v1'`; o *fingerprint* inclui o nome e a revisão do modelo (por exemplo `minilm-v1:all-MiniLM-L6-v2@<revisão>`), para uma troca de pesos invalidar o índice.
3. **Config.** `EMBEDDER=minilm` deixa de ser recusado no `loadConfig` (hoje ele falha com mensagem que aponta o M9). `MIN_SCORE_DEFAULTS` ganha a chave `minilm-v1`, com valor vindo de `npm run calibrate` no mesmo split `calibration`, nunca reaproveitando o 0,18 do `hash-v1`.
4. **Fixtures por embedder.** `rag-answer` ganha um arquivo por embedder (por exemplo `fixtures/llm/rag-answer.v1.minilm-v1.json`), com `citedChunkIds` conferidos contra o top-3 do MiniLM. O teste de contrato roda uma vez por embedder disponível. As perguntas-ouro não mudam.
5. **Índices coexistindo por *fingerprint*.** Em vez de um único conjunto de vetores em `app.db`, a tabela de vetores passa a ter a chave `(chunk_id, fingerprint)`. Trocar de embedder não apaga o índice do outro, e `assertEmbedder` verifica se existe índice para o *fingerprint* ativo.
6. **Eval comparativo.** Rodar `npm run eval` com cada embedder e publicar os dois relatórios lado a lado, com os mesmos itens.

Nenhum desses passos foi implementado no v1. Eles só entram depois da validação do v1 pelo autor.
