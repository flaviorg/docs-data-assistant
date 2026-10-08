# 003: Text-to-SQL seguro

## Contexto

A rota `data` transforma uma pergunta sobre vendas em SQL, valida a consulta antes de rodar, executa numa conexão que não consegue escrever e responde com uma análise curta e perguntas de acompanhamento. A SQL vem de um modelo e é tratada como entrada não confiável: cinco camadas independentes decidem se ela roda, e um prazo de execução decide até quando.

## Escopo

- **Banco de vendas:** `src/sql/sales-schema.ts`, `src/sql/prng.ts` (mulberry32) e `src/sql/seed.ts`, com semente fixa 20251. Cinco tabelas (`customers`, `products`, `orders`, `order_items`, `customer_contacts`), valores em centavos inteiros, pedidos só de 2025. `customer_contacts` fica fora da allowlist e `customers.name` é coluna negada. CLI `npm run seed`.
- `src/sql/readonly-connection.ts` e `src/sql/sql-functions.ts`: conexão somente leitura (`readOnly` no arquivo, snapshot desserializado na memória), teto de 100.000 bytes por texto ou blob (`DatabaseSync.limits.length`), `PRAGMA query_only = ON` e authorizer com allowlist de tabela, coluna e função, registrando cada negação.
- `src/sql/schema-introspect.ts`: DDL real das tabelas permitidas, sem colunas negadas, mais um glossário de negócio.
- `src/sql/sql-lexer.ts` e `src/sql/validator.ts`: lexer que entende strings e comentários, política estática, reescrita do `LIMIT`, `EXPLAIN QUERY PLAN` e classificação do erro em `policy` ou `correctable`.
- `src/sql/executor.ts`: `iterate()` com corte em `SQL_MAX_ROWS + 1`, células cortadas em 200 caracteres, detecção de "sem resultados". O corte de linhas é defesa em profundidade: a SQL que passou pelo `sqlValidate` já tem `LIMIT` menor ou igual a `SQL_MAX_ROWS`, então `truncated` não fica verdadeiro nesse caminho; o sinal que a API mostra é `limitApplied`.
- `src/sql/query-runner.ts` e `src/sql/query-process.ts`: a SQL gerada roda num processo filho com a própria conexão somente leitura; passando de `SQL_TIMEOUT_MS` (padrão 5000), ou se a requisição abortar, o filho leva `SIGKILL`.
- Prompts `sql-generate`, `sql-correct` e `sql-answer` (`src/prompts/v1/`) e os nós `sqlGenerate`, `sqlValidate`, `sqlCorrect`, `sqlExecute` e `sqlAnswer`, com as funções de roteamento puras de `src/graph/routing.ts`.

## Non-goals

- Qualquer escrita no banco de vendas pelo assistente (faixa 4 da Matriz de Autonomia, proibida por construção).
- Planner multi-step: uma pergunta gera uma consulta. CTEs não recursivas cobrem as perguntas compostas.
- Limite de memória total por consulta: o teto por valor (SQL-12) segura as funções de texto, e o cache de páginas e os *sorters* do SQLite têm teto próprio, mas o processo filho não tem limite de RSS. `PRAGMA hard_heap_limit` não serve: o SQLite do Node é compilado com `SQLITE_DEFAULT_MEMSTATUS=0`, e sem contabilidade de memória o limite não é aplicado.
- Correção de violação de política: o que viola a política bloqueia.

## Critérios de aceite (EARS)

- **DATA-01** Quando o seed rodar com a mesma semente, o sistema deve produzir o mesmo fingerprint e `total_cents` igual à soma dos itens em todo pedido.
- **SQL-01** Quando a rota for `data`, o sistema deve incluir no prompt o DDL obtido por introspecção do banco de vendas, restrito às tabelas e colunas permitidas.
- **SQL-02** Se a SQL gerada tiver mais de uma instrução, não começar por `SELECT` ou `WITH`, contiver palavra-chave proibida, ou acessar tabela, coluna ou função de risco fora da allowlist, então o sistema deve responder `status: blocked` sem executar e sem pedir correção.
- **SQL-03** Quando a SQL não tiver `LIMIT` literal menor ou igual a `SQL_MAX_ROWS`, o sistema deve aplicar `LIMIT SQL_MAX_ROWS` antes de executar, preservando `OFFSET`.
- **SQL-04** Quando `EXPLAIN QUERY PLAN` ou a execução falharem por erro de sintaxe, tabela ou coluna inexistente, o sistema deve pedir correção ao modelo com a query, o erro e a pergunta, até `SQL_MAX_CORRECTIONS` (3) vezes.
- **SQL-05** Se as correções se esgotarem, então o sistema deve responder `status: error` com mensagem determinística, `corrections: 3` e `lastError`, sem nova chamada ao modelo.
- **SQL-06** Quando a consulta válida não retornar resultados (zero linhas, ou todas as linhas com todas as células `NULL`), o sistema deve responder `status: no_results`, distinto de `error`.
- **SQL-07** Quando a consulta retornar linhas, o sistema deve responder com `answer` e de 1 a 3 `followUpQuestions`, enviando ao modelo no máximo `SQL_ROWS_TO_LLM` (50) linhas.
- **SQL-08** O sistema deve executar SQL gerada apenas numa conexão com `query_only` ativo e authorizer que nega toda ação diferente de leitura nas tabelas da allowlist.
- **SQL-09** O sistema deve negar a leitura da coluna `customers.name` e omiti-la do schema enviado ao modelo.
- **SQL-10** Se a SQL usar função fora da allowlist que não esteja na lista de risco, então o sistema deve tratá-la como erro corrigível e anexar a lista de funções permitidas ao pedido de correção.
- **SQL-11** Se a execução da SQL passar de `SQL_TIMEOUT_MS`, então o sistema deve interromper a consulta sem travar as outras requisições e responder `status: error` com o aviso `sql_timeout`, sem pedir correção.
- **SQL-12** O sistema deve abrir a conexão que valida e executa SQL gerada com teto de 100.000 bytes por texto ou blob (`SQLITE_LIMIT_LENGTH`), de modo que uma consulta que monte um valor maior falhe com erro de execução antes de alocar além do teto.

## Decisões

- **O lexer rejeita qualquer segunda instrução.** `StatementSync.prepare()` compila só a primeira e descarta o resto em silêncio (`select 1; drop table t` vira `select 1`). Sem essa regra, um `DROP` escondido nunca apareceria no erro. Um único `;` final é aceito.
- **`readOnly` não basta na memória.** Num banco em memória com cache compartilhado, `readOnly: true` não impede escrita. O modo memória usa um snapshot (`serialize()` e `deserialize()` numa conexão separada), e `query_only` vale nos dois modos.
- **O authorizer decide pela lista de negações, não pelo texto do erro.** Tabela, coluna, ação ou função de risco negada vira `policy` (`blockedBy: sql_authorizer`); só função fora da allowlist que não é de risco vira `correctable` (SQL-10). O authorizer age na compilação do `EXPLAIN QUERY PLAN`, antes de executar.
- **Teto de tamanho por valor (SQL-12).** O prazo de execução não limita memória: três `replace()` aninhados sobre 64 caracteres montavam 16 MB, quatro passavam de 1 GB de RSS em cerca de 100 ms, e `group_concat()` sobre uma junção `ON 1=1` devolvia 75 MB, tudo dentro do prazo. O limite interno do SQLite (1 GB) só agia depois da alocação. Desde o Node 24.15 o `node:sqlite` expõe `sqlite3_limit` como `DatabaseSync.limits`; a conexão abre com `limits.length = 100000`, e a mesma consulta falha com `string or blob too big` em menos de 1 ms. Erro de execução segue a regra de SQL-04 (vai para correção), porque falha na hora e não gasta o prazo. Por isso o `engines` pede Node 24.15+.
- **`printf` e `format` estão na lista de risco.** Um especificador de largura alocava centenas de MB numa chamada; com o teto de SQL-12 isso também esbarra em 100.000 bytes, mas as duas continuam fora porque formatar números é trabalho do `sqlAnswer`. `load_extension`, `zeroblob`, `randomblob` e `fts3_tokenizer` também estão na lista.
- **Política violada não volta ao modelo.** Mandar para correção daria ao atacante novas tentativas de contornar a regra.
- **`SELECT *` em `customers` continua política.** A expansão do `*` lê `customers.name`, e o authorizer nega a leitura como em `SELECT name`. Tratar esse caso como corrigível exigiria adivinhar, pelo texto da SQL, se a coluna veio do `*`; o projeto preferiu manter a regra simples e avisar no glossário enviado ao modelo para listar as colunas de `customers`. Um modelo real que escreva `c.*` recebe `blocked`, e nenhuma pergunta-ouro mede quantas vezes isso acontece no perfil live.
- **Bancos separados.** `sales.db` não contém tabelas internas; documentos, vetores e ledger ficam em `app.db`.
- **"Sem resultados" é distinto de erro.** `SUM` sobre conjunto vazio devolve uma linha com `NULL`; o executor trata zero linhas e linhas só de `NULL` como `no_results`, e `COUNT` sobre vazio (uma linha com 0) como resultado válido.
- **Junção sem condição é política.** Além da vírgula no `FROM` (`comma_join`), a regra `cross_join` barra `CROSS JOIN`, `NATURAL JOIN` e `JOIN` sem `ON`/`USING`. `ON 1=1`, ou uma junção sem igualdade, continua passando pelas camadas estáticas: é sintaticamente uma junção com condição.
- **`INTO` é palavra-chave proibida.** `REPLACE INTO` é um `INSERT`, e `REPLACE` não pode entrar na lista porque `replace()` é função permitida. O SQLite não tem `SELECT INTO`, então `INTO` fora de string só aparece em escrita.
- **Prazo de execução num processo filho (SQL-11).** O `node:sqlite` é síncrono e não expõe *progress handler* nem `sqlite3_interrupt`: na thread principal, uma consulta pesada prendia o event loop, o `/health` parava de responder e o 504 nunca saía ([incidente](../../docs/incidents/2026-10-04-produto-cartesiano-trava-o-servidor.md)). Um Worker não resolve, porque `terminate()` não interrompe código nativo ([incidente](../../docs/incidents/2026-10-04-terminate-nao-interrompe-sqlite.md)). O filho é criado na primeira consulta, roda um pedido por vez e tem uma thread de vigia que o encerra se o pai morrer. Estourar o prazo não vira correção: o modelo não ganha novas tentativas de consulta pesada.
- **Validação continua na thread principal.** O `EXPLAIN QUERY PLAN` só compila a consulta. A SQL de referência das perguntas-ouro, que o eval executa direto na conexão principal, é texto do autor, não do modelo.

## Como verificar

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/seed.unit.test.ts tests/unit/readonly-connection.unit.test.ts tests/unit/query-runner.unit.test.ts tests/unit/schema-introspect.unit.test.ts tests/unit/sql-lexer.unit.test.ts tests/unit/sql-validator.unit.test.ts tests/unit/executor.unit.test.ts tests/unit/sql-routing.unit.test.ts tests/unit/sql-nodes.unit.test.ts tests/int/sql-branch.int.test.ts
npm run seed -- --out .cache/sales-check.db   # contagens e fingerprint
npm run layers                                # escrita via SQL barrada por mais de uma camada
node --import ./tests/helpers/no-network.ts --test tests/unit/query-runner.unit.test.ts   # prazo de execução (SQL-11) e teto por valor no filho (SQL-12)
```
