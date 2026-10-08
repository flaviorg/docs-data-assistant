# 001: Cliente de LLM e observabilidade

## Contexto

Todo acesso ao modelo passa por uma interface `LlmProvider` (fake por fixtures ou OpenRouter pelo SDK `openai`) e por um `LlmClient` próprio. O cliente é a única peça que conhece retry, fallback, teto de chamadas, parse com Zod, tokens e custo. A observabilidade é um ledger em SQLite com um `/stats` enxuto, mais logs JSON em stderr.

## Escopo

- `src/llm/provider.ts`: contrato do provider e `LlmErrorKind` (`timeout`, `rate_limit`, `server_error`, `auth`, `bad_request`, `truncated`).
- `src/llm/fake-provider.ts` e `src/llm/fixtures.ts`: respostas por fixture, chave normalizada, `calls` registradas (só as últimas 1.000, para um `npm start` sem chave não crescer sem teto), caos (`primary-timeout-once`, `primary-down`, `all-down`).
- `src/llm/openrouter-provider.ts`: SDK `openai` com `baseURL`, `maxRetries: 0`, `fetch` injetável e `response_format` com JSON Schema sem `$schema`.
- `src/llm/llm-client.ts` e `src/llm/budget.ts`: `generateStructured` e `generateText`, retry com backoff, fallback, 1 retry de parse, `CallBudget` por requisição.
- `src/llm/tokens.ts`, `src/llm/pricing.ts` e `config/model-prices.json`: tokens estimados (`ceil(chars / 4)`) e custo por 1M tokens.
- `src/obs/ledger.ts`, `src/obs/stats.ts` e `src/obs/logger.ts`: tabelas `requests` e `llm_calls`, P50 e P95 por *nearest rank*, logger com mascaramento de chaves.

## Non-goals

- LangSmith, Langfuse, OpenTelemetry ou `/stats` detalhado por modelo com percentis.
- Streaming de tokens.
- Cache de respostas do modelo.
- Retry feito pelo SDK (fica desligado; o retry é do `LlmClient`).

## Critérios de aceite (EARS)

- **LLM-01** Quando uma chamada falhar por timeout, limite de taxa ou erro 5xx, o sistema deve tentar de novo até `LLM_MAX_RETRIES` vezes com backoff exponencial.
- **LLM-02** Se o modelo principal esgotar as tentativas, então o sistema deve usar `OPENROUTER_MODEL_FALLBACK` e devolver `fallbackUsed: true`.
- **LLM-03** Se todos os modelos falharem, então o sistema deve responder HTTP 503 com `requestId`.
- **LLM-04** O sistema deve registrar em cada execução lógica: `promptId`, versão, modelo, tentativas, retries, fallback, latência, tokens (reais ou estimados, marcados) e custo estimado.
- **LLM-05** Quando o provedor fake receber entrada sem fixture, o sistema deve falhar com erro que nomeia `promptId` e a chave normalizada, e a API deve responder 422.
- **LLM-06** Se uma requisição ultrapassar `LLM_MAX_CALLS_PER_REQUEST` execuções lógicas de prompt, então o sistema deve interromper o fluxo com `status: error` e o aviso `llm_budget_exceeded`.
- **LLM-07** Se o provedor indicar saída truncada (`finish_reason=length`), então o sistema não deve repetir a chamada nem usar o fallback, e o nó deve aplicar o seu fallback determinístico.
- **OBS-01** Quando `GET /stats?since=24h` for chamado, o sistema deve devolver total de requisições, taxa de erro, P50 e P95 de latência, tokens, custo, retries e fallbacks.
- **OBS-02** O sistema deve propagar o `X-Request-Id` recebido quando ele casar `^[A-Za-z0-9._-]{8,64}$`, ou gerar um UUID e avisar `request_id_replaced`, na resposta, nos logs e no ledger.

## Decisões

- **SDK `openai` direto, não `@langchain/openai`.** Com `maxRetries: 0`, o retry, o fallback e a contagem ficam num lugar só, testável com `fetch` injetado e sem rede (`tests/unit/openrouter-provider.unit.test.ts`).
- **Backoff de 250 ms × 2^n com jitter de ±20%**, com relógio e `sleep` injetáveis; nos testes o `sleep` é zero.
- **O teto conta execuções lógicas, não tentativas de transporte.** Cada `generateStructured` ou `generateText` consome 1. O máximo legítimo é 7 (data com 3 correções e classificador por modelo); o padrão 8 é rede de segurança. Retry de parse e retries de transporte não consomem.
- **`truncated` não tem retry nem fallback.** Repetir a mesma chamada com o mesmo `maxTokens` daria o mesmo corte. Cada nó tem o seu fallback (router vira `out_of_scope` com `router_fallback`, `ragAnswer` recusa, correção consumida no ramo SQL, `sqlAnswer` responde com a tabela).
- **O ledger registra o modelo pedido**, não o nome devolvido pelo provedor, porque a tabela de preços é indexada pelo id pedido.
- **Custo sempre rotulado.** Modelos `fake/*` têm `"fictional": true` e o custo sai como "US$ (fictício)"; modelo sem preço dá `costUsd: null`. `config/model-prices.json` tem `updatedAt`.
- **Logs só em stderr**, JSON de uma linha, com `sk-or-...` e `Bearer ...` mascarados e a pergunta cortada em 200 caracteres. Linhas de SQL e o contexto completo não vão para o log.
- Assinaturas das bibliotecas conferidas no `node_modules`: [`docs/notas-de-api.md`](../../docs/notas-de-api.md).

## Como verificar

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/llm-client.unit.test.ts tests/unit/openrouter-provider.unit.test.ts tests/unit/fake-provider.unit.test.ts tests/unit/fixtures-loader.unit.test.ts tests/unit/tokens-pricing.unit.test.ts tests/unit/stats.unit.test.ts tests/unit/logger.unit.test.ts tests/int/resilience.int.test.ts tests/int/ask-service.int.test.ts tests/e2e/stats-api.e2e.test.ts
npm run demo   # cenário 13: 4 retries e 2 fallbacks com primary-down
```
