# Aulas do curso aplicadas

Só IDs e temas; nenhum trecho ou exemplo de aula está neste repositório. A tabela liga cada tema ao lugar do código onde ele aparece.

| Aulas | Tema | Onde está no código |
|---|---|---|
| 198068, 198069, 198082 | Prompt como configuração versionada; contrato anti-alucinação | `src/prompts/v1/` (JSON de 6 blocos com `meta.version`) |
| 198077, 198078, 198079 | Provedor OpenAI-compatível, OpenRouter, troca de modelo por configuração | `src/llm/openrouter-provider.ts`, `src/config.ts` |
| 198080, 198081, 198082 | RAG com chunking, top-k, score mínimo e recusa | `src/rag/`, `src/graph/nodes/retrieve.ts` |
| 198062 | Calibrar limiar por experimento | `src/eval/calibrate.ts`, `MIN_SCORE_DEFAULTS` |
| 200953, 200954 | Config fail-fast, serviço injetável, `app.inject` | `src/config.ts`, `src/server.ts`, `tests/e2e/` |
| 200955 a 200959 | `StateGraph`, arestas condicionais, rota de fallback | `src/graph/graph.ts`, `src/graph/routing.ts` |
| 200960 a 200963 | Saída estruturada com `safeParse`; "o LLM extrai, o código decide" | `src/llm/llm-client.ts`, nós do grafo |
| 200969 a 200972 | Guardrail antes do roteador; system prompt não é firewall | `src/guardrails/`, `src/graph/nodes/guardrail-input.ts` |
| 200973 a 200978 | Text-to-query com schema real, validação, correção com teto, `no_results` | `src/sql/`, `src/graph/nodes/sql-*.ts` |
| 200968, 200980 | Avaliador com limiar no CI; asserção de estrutura | `src/eval/`, `.github/workflows/ci.yml` |
| 221503 a 221507 | SDD com constituição, specs EARS, instruções curtas, pre-commit | `specs/`, `AGENTS.md`, `.githooks/pre-commit` |
| 221514 | Contrato HTTP estável (400, 422, 504) | `src/server.ts`, `src/ask-service.ts` |
| 221515, 221516 | `node:sqlite`, `:memory:` nos testes, seed idempotente | `src/sql/seed.ts`, `tests/helpers/context.ts` |
| 221519, 221521 | Interface de embedder, cosseno, corte de relevância | `src/embeddings/`, `src/rag/vector-store.ts` |
| 221522 | Estimar tokens antes de enviar | `src/llm/tokens.ts` |
| 221524 | Roteador com motivo e override; retry, fallback e 503 | `src/graph/nodes/router.ts`, `src/llm/llm-client.ts` |
| 221525 | `requestId`, logger JSON, `/stats`; escrita como faixa 4 de autonomia | `src/obs/`, conexão somente leitura |

A vitrine de observabilidade e resiliência do trio de projetos é o `incident-copilot`; aqui esses padrões aparecem de forma enxuta.
