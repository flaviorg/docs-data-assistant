# 005: Interfaces e eval

## Contexto

O mesmo `AskService` atende a API Fastify, a página web, as CLIs, a demo e o eval. O projeto precisa rodar com um comando, sem chave, sem Docker e sem rede depois do `npm install`, e provar a qualidade com um eval gate no CI e uma matriz ataque × camada.

## Escopo

- **Ambiente:** `src/config.ts` (`loadConfig` com Zod, fail-fast, `ENV_KEYS` na ordem do `.env.example`), `tests/helpers/no-network.ts` (bloqueio de rede em `npm test`, propagado aos processos filhos) e `src/ensure-data.ts` (seed e ingestão no modo `file` quando faltam ou estão desatualizados).
- **API:** `src/server.ts` e `src/index.ts`: `POST /ask`, `GET /stats`, `GET /health`, `GET /demo/questions`, `GET /` com `/app.js` e `/app.css`; `bodyLimit` de 16 KiB; corpo de erro do contrato; header `X-Request-Id`.
- **Página:** `src/web/index.html`, `app.js` e `app.css`, sem build, sem CDN e sem script ou estilo inline.
- **CLIs:** `ask`, `seed`, `ingest`, `demo`, `eval`, `calibrate` e `layers` (`src/cli/`, `src/eval/`).
- **Eval:** `eval/golden.v1.json` (34 itens no split `test`, 12 no `calibration`), `eval/thresholds.json` (perfis `fake` e `live`), `src/eval/metrics.ts`, `report.ts` e `run-eval.ts`.
- **Matriz de camadas:** `eval/attacks.v1.json` (19 ataques escritos do zero; 14 na primeira versão, mais `sql-replace-into`, `sql-cross-join` e `out-citation-id` na primeira revisão final e `dir-forged-document` e `out-sql-literal` na segunda) e `src/eval/layers.ts`.

## Non-goals

- Streaming SSE, autenticação, rate limit e multiusuário (a API é local e de demonstração).
- Frontend com framework ou build; deploy hospedado ou GitHub Pages.
- Servidor MCP (o projeto não depende do SDK MCP).
- Docker, Ollama e Python.

## Critérios de aceite (EARS)

- **ENV-01** O sistema deve usar `LLM_PROVIDER=fake` e `EMBEDDER=hash` quando nenhuma variável estiver definida.
- **ENV-02** Se `LLM_PROVIDER=openrouter` e `OPENROUTER_API_KEY` estiver ausente, então o sistema deve falhar na inicialização com mensagem que nomeia a variável.
- **ENV-03** Enquanto `npm test` executa, o sistema não deve abrir conexão de rede externa.
- **ENV-04** Quando `npm run demo` for executado num clone novo, depois de `npm install`, o sistema deve semear o banco e indexar a base em memória e rodar os 13 cenários sem chave, sem rede, sem ler `.env` e sem gravar em `data/`.
- **API-01** Quando `POST /ask` receber corpo inválido, o sistema deve responder 400 com as `issues` do Zod.
- **API-02** Se a execução passar de `ASK_TIMEOUT_MS`, então o sistema deve responder 504.
- **API-03** O sistema deve validar toda resposta de `/ask` contra `AskResponseSchema` antes de enviá-la.
- **API-04** Se o corpo não for JSON válido, o tipo de conteúdo não for suportado ou a rota não existir, então o sistema deve responder com o corpo de erro do contrato e o header `X-Request-Id`.
- **WEB-01** O sistema deve servir a página com CSP sem `'unsafe-inline'`, e a página deve montar conteúdo vindo da API só com `textContent` e `createElement`.
- **EVL-01** Quando `npm run eval` terminar, o sistema deve imprimir o relatório e sair com código 1 se qualquer métrica ficar abaixo do limiar do perfil ativo.
- **EVL-02** O sistema deve rotular o relatório com perfil (`FAKE` ou `LIVE`), provedor, embedder, modelos, modo do guardrail, split e data, e marcar cada métrica como `mecanismo` ou `contrato (fixture)` no perfil fake.
- **EVL-03** Quando `npm run calibrate` for executado, o sistema deve usar só o split `calibration` e imprimir a tabela limiar × acurácia de recusa, a separação das medianas e o limiar que maximiza a acurácia nesse split.
- **EVL-04** Quando `npm run layers` for executado, o sistema deve imprimir a matriz ataque × camada e sair com código 1 se algum ataque não for barrado por nenhuma camada ou alguma escrita via SQL for barrada por menos de duas.

## Decisões

- **Demo e eval em memória, com config explícita.** `loadConfig({ env: {}, overrides })` não lê `.env` nem o shell: uma `OPENROUTER_API_KEY` exportada não muda a demo, e nada é gravado em `data/`.
- **Bloqueio de rede no ponto único.** `net.Socket.prototype.connect` cobre `net`, `tls`, `http`, `https` e o `fetch` do undici; o hook se propaga por `NODE_OPTIONS`, inclusive num caminho com espaço.
- **Página sem HTML cru.** Ela mostra trechos de documentos (inclusive o envenenado) e respostas do modelo; com `innerHTML`, um documento com `<img onerror=...>` executaria script. O CSP é `default-src 'none'` com `'self'` só onde precisa.
- **Métricas com natureza.** No perfil fake, `routeAccuracy`, `citationValidity` e `sqlExecutionAccuracy` são *contrato (fixture)*: a fixture escrita pelo autor já codifica a rota, as citações e a SQL. Elas reprovam o CI se quebrarem, mas não são vendidas como qualidade. `recallAt3`, `refusalAccuracy`, `injectionBlockRate` e `falseBlockRate` são *mecanismo*. Só o perfil `live` mede a geração.
- **A matriz de camadas não usa LLM.** Cada ataque passa por cada camada determinística isoladamente (regras de entrada, sanitizador, lexer, authorizer sem lexer, `query_only` sem authorizer, guarda de saída). Isso mostra redundância real: uma escrita via SQL é barrada por mais de uma camada sozinha, e a leitura de dado pessoal passa pelo `query_only` e é barrada pelo authorizer.
- **CI com actions fixadas por SHA**, `permissions: contents: read`, Node `24.x` e o relatório do eval como artefato mesmo em falha.

## Como verificar

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/config.unit.test.ts tests/unit/env-example.unit.test.ts tests/unit/no-network.unit.test.ts tests/unit/schemas.unit.test.ts tests/unit/web-assets.unit.test.ts tests/unit/golden-schema.unit.test.ts tests/unit/fixtures-contract.unit.test.ts tests/unit/metrics.unit.test.ts tests/unit/layers.unit.test.ts tests/unit/retrieval-metrics.unit.test.ts tests/e2e/ask-api.e2e.test.ts tests/e2e/web.e2e.test.ts tests/e2e/cli.e2e.test.ts tests/e2e/eval.e2e.test.ts
npm run demo && npm run eval && npm run layers && npm run calibrate
```
