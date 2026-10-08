# Notas de API

Assinaturas das bibliotecas conferidas no próprio projeto antes de escrever o código, com as versões exatas do `package.json`, sob Node 24.21.0 e `tsc` 7.0.2. As sondas foram scripts descartáveis, fora do versionamento: o que cada uma observou está na coluna "Observado no projeto", e o comportamento de que o código depende é coberto pelos testes de cada módulo (por exemplo, `tests/unit/readonly-connection.unit.test.ts` para o `node:sqlite` e `tests/unit/openrouter-provider.unit.test.ts` para o SDK `openai`).

Versões instaladas (`npm ls --depth=0`): `@langchain/core@1.2.14`, `@langchain/langgraph@1.4.19`, `fastify@5.12.5`, `openai@7.27.0`, `zod@4.6.5`, `typescript@7.0.2`, `@types/node@24.19.1`. `npm install` terminou com `found 0 vulnerabilities`.

| API | Assinatura confirmada | Observado no projeto | Conferido no projeto em |
|---|---|---|---|
| LangGraph | `new StateGraph(zodObject)`; `.addNode(name, fn)`; `.addEdge(START, 'a')`; `.addConditionalEdges(src, (s) => target, [targets])`; `.compile()`; `graph.invoke(input, { recursionLimit, signal, configurable })` | Nó recebe `(state, config: LangGraphRunnableConfig)`; `config.configurable.callContext.requestId` chegou como `r-12345678`; `config.signal` presente | 2026-10-04 |
| LangGraph reducers | `withLangGraph(z.array(x), { reducer: { fn: (a, b) => a.concat(b) }, default: () => [] })` de `@langchain/langgraph/zod` | Campo `z.array(z.string()).default([])` terminou `["b"]` (*LastValue*); os dois campos com reducer terminaram `["a","b"]` | 2026-10-04 |
| LangGraph erros | `GraphRecursionError` exportado de `@langchain/langgraph` | Laço `x → x` com `recursionLimit: 5` lançou `GraphRecursionError` (`instanceof` verdadeiro); sinal já abortado lançou `AbortError` ("This operation was aborted") | 2026-10-04 |
| Zod 4.6.5 | `z.strictObject`, `z.toJSONSchema`, `z.prettifyError`, `issues[i].{code,path}`, `z.uuid()` | Chave extra: `success: false`, issue `unrecognized_keys` com `path: []`; `prettifyError` imprime `✖ Unrecognized key: "extra"`; `toJSONSchema` traz `$schema` (draft 2020-12), `additionalProperties: false`; `z.uuid()` aceita UUID v4 | 2026-10-04 |
| `openai` 7.27.0 | `new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout, fetch })`; `chat.completions.create({ ..., response_format: { type: 'json_schema', json_schema: { name, strict, schema } } }, { signal })` | 200: `finish_reason = 'length'`, `usage.prompt_tokens = 11`, `usage.completion_tokens = 7`, `model` lido. 429 → `RateLimitError`; 500 → `InternalServerError`; 401 → `AuthenticationError`; 400 → `BadRequestError` (todas com `status` e subclasses de `APIError`); `timeout: 50` com `fetch` pendente → `APIConnectionTimeoutError`; `signal` abortado → `APIUserAbortError` (as duas sem `status`) | 2026-10-04 |
| Fastify 5.12.5 | `Fastify({ logger: false, bodyLimit, genReqId(req) })`; `addHook('onRequest')`; `setErrorHandler`; `setNotFoundHandler`; `app.inject` | `'{'` → 400 `FST_ERR_CTP_INVALID_JSON_BODY`; corpo vazio → 400 `FST_ERR_CTP_EMPTY_JSON_BODY`; `application/xml` → 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`; `text/plain` aceito como string (200); header `abc-12345` ecoado; header `abc` trocado por UUID; rota inexistente → 404 do `setNotFoundHandler`; `X-Request-Id` presente em todas as respostas, inclusive de erro. Tipo das opções do `inject`: `import type { InjectOptions } from 'fastify'` | 2026-10-04 |
| `node:sqlite` (SQLite do Node 24.21) | `new DatabaseSync(path, { readOnly })`; `setAuthorizer((action, arg1, arg2, dbName, triggerOrView) => number)`; `constants`; `serialize()`; `deserialize()`; `iterate()`; `columns()`; `setReturnArrays(true)` | Constantes: `SQLITE_OK=0`, `SQLITE_DENY=1`, `SQLITE_READ=20`, `SQLITE_SELECT=21`, `SQLITE_FUNCTION=31`, `SQLITE_RECURSIVE=33`. `LIKE` chega como função `like`; `COUNT(*)` chega como `SQLITE_READ` com coluna `''`; `SELECT *` e `SELECT name` → `access to customers.name is prohibited` (errcode 23); `printf` → `not authorized to use function: printf` (errcode 1); CTE recursiva → ação 33, `not authorized` (errcode 23); `sqlite_master` → `access to sqlite_master.type is prohibited`; `select 1; drop table t` compila e roda só a primeira instrução; `columns()` devolve nomes numa consulta de zero linhas; `serialize()` devolve `Uint8Array` e `deserialize()` restaura num `:memory:` novo | 2026-10-04 |
| `node:sqlite` limites | `db.limits.length = n` (`sqlite3_limit`, desde o Node 24.15); `new DatabaseSync(path, { limits })` | Padrão `length: 1000000000`. Com `length = 100000`, três `replace()` aninhados sobre 64 caracteres falham com `string or blob too big` em 0,1 ms, contra 16 MB montados sem o limite. `PRAGMA hard_heap_limit` lê 0 e não é aplicado: o SQLite do Node é compilado com `SQLITE_DEFAULT_MEMSTATUS=0` | 2026-10-04 |
| TypeScript 7.0.2 | `tsc --noEmit` com o `tsconfig.json` do projeto | Sondas compilam sem erro (`TSC-OK`). Sem fallback para `~5.9` | 2026-10-04 |
| Bloqueio de rede | `net.Socket.prototype.connect` intercepta `net.connect`, `tls.connect`, `http.get` e o `fetch` do undici | Conferido pelo teste `tests/unit/no-network.unit.test.ts`, inclusive o filho herdando o bloqueio por `NODE_OPTIONS` num caminho com espaço | 2026-10-04 |
| MCP SDK | não se aplica | `@modelcontextprotocol/sdk` não instalado (MCP fica fora do escopo) | 2026-10-04 |

## Catálogo do OpenRouter

Consulta pública a `https://openrouter.ai/api/v1/models` em 2026-10-04. Preços em US$ por 1M tokens (o catálogo publica por token; multiplicado por 1.000.000). Usados em `config/model-prices.json`.

| Modelo | Entrada (US$/1M) | Saída (US$/1M) | `response_format` e `structured_outputs` |
|---|---|---|---|
| `openai/gpt-oss-120b` | 0,037 | 0,17 | sim |
| `google/gemini-2.5-flash` | 0,30 | 2,50 | sim |
| `openai/gpt-oss-safeguard-20b` | 0,075 | 0,30 | sim |

## Nome da empresa

Busca na web por "Moenda Lunar" café e por "Moenda Lunar Cafés Especiais" em 2026-10-04: nenhuma empresa real com esse nome (só cafés com "Lunar" no nome em outros países). Nome mantido, com aviso de ficção e domínio `moendalunar.example`.

## Divergências

Nenhuma divergência em relação às assinaturas esperadas. Detalhe de tipagem anotado acima: a sonda do Fastify precisou de `InjectOptions` importado de `fastify` (`Parameters<typeof app.inject>[0]` não resolve por causa das sobrecargas).
