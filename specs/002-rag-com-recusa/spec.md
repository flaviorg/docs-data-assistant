# 002: RAG com recusa

## Contexto

A rota `docs` responde perguntas sobre as políticas da Moenda Lunar Cafés Especiais, uma empresa fictícia criada para o projeto. A resposta cita só trechos recuperados e recusa quando a evidência é fraca. Um dos documentos traz, de propósito, uma instrução embutida para testar a defesa contra injeção indireta.

## Escopo

- **Base de documentos:** 8 arquivos Markdown em `data/kb/`, escritos do zero, de 250 a 500 palavras, com H1 e ao menos 3 H2. Domínio `moendalunar.example` (RFC 2606). `cafeterias-parceiras.md` contém um parágrafo envenenado com o canário `LUA-CHEIA-100`.
- `src/rag/chunker.ts`: corte por H2 e H3, depois por tamanho (600 caracteres) com overlap de 100; IDs estáveis `<slug>#<seção>-<n>`.
- `src/embeddings/`: interface `Embedder` e o `hash-v1` (TF-IDF com *feature hashing*, 2048 dimensões, IDF ajustado no corpus, *fingerprint* `hash-v1:idf=<hash>`).
- `src/rag/sanitizer.ts`: detecção e redação, por frase, de instruções embutidas; devolve os spans removidos.
- `src/rag/vector-store.ts` e `src/rag/ingest.ts`: `documents`, `chunks` e `kb_meta` em `app.db`; upsert idempotente por sha256; busca top-k por cosseno; CLI `npm run ingest`.
- `src/rag/citations.ts` e os nós `retrieve`, `ragAnswer` e `checkCitations`.
- Calibração do limiar (`src/eval/calibrate.ts`, `npm run calibrate`) no split `calibration` das perguntas-ouro.

## Non-goals

- Ingestão de PDF, upload de documentos pela interface, reranking e busca híbrida BM25 com vetor.
- Embedder semântico no v1. O MiniLM fica para o marco opcional M9, pela interface `Embedder` ([ADR 001](../../docs/adr/001-embedder-plugavel.md)).
- LLM como juiz de fidelidade. A fidelidade é garantida por mecanismo: citação válida, guarda de saída e recusa.
- Perguntas híbridas (documentos e dados na mesma frase).

## Critérios de aceite (EARS)

- **RAG-01** Quando a rota for `docs`, o sistema deve recuperar os `RAG_TOP_K` (3) chunks de maior similaridade de cosseno.
- **RAG-02** Se o maior score ficar abaixo do limiar do embedder ativo, então o sistema deve responder `status: refused` sem chamar o modelo de geração.
- **RAG-03** O sistema deve devolver em `citations` apenas chunks que estavam entre os recuperados, e registrar em `warnings` qualquer ID citado fora desse conjunto.
- **RAG-04** Se nenhuma citação válida restar numa resposta não recusada, então o sistema deve convertê-la em `status: refused`.
- **RAG-05** Quando a base for ingerida de novo sem mudança de conteúdo, o sistema não deve recriar chunks.
- **GRD-04** Quando um chunk contiver instrução embutida na ingestão, o sistema deve marcá-lo como `flagged`, redigir o trecho e nunca enviar o trecho original ao modelo.

## Decisões

- **Chunks de 600 caracteres cortados por seção**, em vez de blocos grandes: um chunk grande dilui o assunto e piora a recuperação.
- **Embedder lexical determinístico no v1.** Roda sem rede e sem download de modelo, e o resultado é reprodutível no CI. É fraco semanticamente, e o README diz isso; as métricas sempre levam o *fingerprint*.
- **Limiar calibrado, não fixo.** `npm run calibrate` varre limiares só no split `calibration` (12 itens) e o valor escolhido, 0,18, fica em `MIN_SCORE_DEFAULTS` com comentário da origem. A primeira calibração reprovou e o embedder foi corrigido sem mudar nenhuma pergunta: [incidente de 2026-10-04](../../docs/incidents/2026-10-04-calibracao-hash-v1.md).
- **IDF acoplado ao corpus.** Mudar qualquer documento recalcula o IDF e os vetores de todos os chunks (barato no `hash-v1`), mas só rechunka o documento alterado. Mudança de algoritmo exige trocar o id do embedder.
- **Sanitização na ingestão, não na consulta.** O trecho original fica só em `redacted_spans`, para a guarda de saída comparar; o texto enviado ao modelo já tem a marca `[trecho removido: possível instrução embutida]`. Cada chunk vai entre `<documento id="...">` e o prompt declara que nada ali é instrução. O escape de `<documento` vale para o texto dos trechos e para a pergunta: sem ele, a pergunta fechava o delimitador e abria um trecho forjado com o ID de um chunk real ([incidente](../../docs/incidents/2026-10-04-pergunta-forja-trecho-do-rag.md)); a regra `system_tag` também barra a tag na entrada.
- **Citações filtradas pelo conjunto recuperado.** O modelo pode errar o ID; o código descarta o que não foi recuperado e recusa se não sobrar nada.

## Como verificar

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/kb-content.unit.test.ts tests/unit/chunker.unit.test.ts tests/unit/hash-embedder.unit.test.ts tests/unit/sanitizer.unit.test.ts tests/unit/vector-store.unit.test.ts tests/unit/citations.unit.test.ts tests/unit/rag-nodes.unit.test.ts tests/int/ingest.int.test.ts tests/int/rag-retrieval.int.test.ts tests/int/rag-branch.int.test.ts
npm run calibrate   # separação das medianas e limiar sugerido no split calibration
npm run eval        # recallAt3 e refusalAccuracy (mecanismo)
```
