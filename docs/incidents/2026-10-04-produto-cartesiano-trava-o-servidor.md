# 2026-10-04: Produto cartesiano passava pela política e travava o servidor

## Contexto

Revisão adversarial antes da publicação. O README e a spec 003 diziam que o risco de consulta pesada estava "mitigado por regras": sem `RECURSIVE`, sem junção por vírgula, até 6 referências a tabela e lista de risco de funções. A única regra contra produto cartesiano era a `comma_join`.

## Sintoma

- `validate('SELECT COUNT(*) FROM orders a JOIN orders b JOIN orders c')` devolvia `ok: true`, com o plano `SCAN a`, `SCAN b`, `SCAN c`. `CROSS JOIN` e `JOIN ... ON 1=1` também passavam.
- Com dois self-joins, a execução lê 16.000.000 linhas em uns 55 ms. Com três (4.000³ linhas), o processo não terminou em 10 s e foi morto.
- Pelo `AskService`, com `ASK_TIMEOUT_MS=1000` e um provedor roteirizado devolvendo essa SQL, a pergunta não terminou em 12 s, e nenhum 504 saiu. Um `setInterval` de 100 ms não disparou nenhuma vez.

## Causa

- A política estática só reconhecia a junção por vírgula. `JOIN` sem `ON`/`USING`, `CROSS JOIN` e `NATURAL JOIN` produzem o mesmo produto cartesiano.
- O `node:sqlite` é síncrono e rodava na thread principal. Uma consulta longa prende o event loop inteiro: as outras requisições, o `/health` e o próprio timer do `ASK_TIMEOUT_MS`, que só dispara quando o event loop volta. O `node:sqlite` não expõe *progress handler* nem `sqlite3_interrupt`.
- Nenhuma regra estática resolve o caso geral: `ON 1=1`, ou uma junção sem igualdade (`ON a.id <> b.id`), é sintaticamente uma junção com condição.

## Correção

- Nova regra de política `cross_join` no validador: `CROSS JOIN`, `NATURAL JOIN` e `JOIN` sem `ON`/`USING` antes do próximo `JOIN`, da próxima cláusula ou do fim do nível. É `policy`: bloqueia e não volta ao modelo.
- A SQL gerada passa a rodar num **processo filho** (`src/sql/query-runner.ts` e `src/sql/query-process.ts`), com a própria conexão somente leitura (mesmo `query_only` e mesmo authorizer). Se passar de `SQL_TIMEOUT_MS` (padrão 5000), o filho leva `SIGKILL` e a resposta é `status: error` com o aviso `sql_timeout`, sem pedido de correção. Abort da requisição também mata o filho, e o 504 sai no prazo. A primeira tentativa usou um Worker e não funcionou ([incidente](2026-10-04-terminate-nao-interrompe-sqlite.md)).
- Novo critério EARS `SQL-11` na spec 003. O README e a spec deixaram de dizer "mitigado": agora descrevem a regra, o prazo e o que continua passando pelas camadas estáticas (`ON 1=1`).
- Não mudou: a validação (`EXPLAIN QUERY PLAN`) continua na thread principal, porque só compila a consulta. A SQL das perguntas-ouro, que o eval executa como referência, também continua lá: é texto do autor, não do modelo.

## Teste que impede a volta

- `tests/unit/sql-validator.unit.test.ts`: casos `policy:cross_join` (JOIN sem ON, CROSS, NATURAL, LEFT JOIN sem ON, junção sem condição dentro de subconsulta) e os casos `ok` com `ON` e `USING`.
- `tests/unit/query-runner.unit.test.ts`, `SQL-11 consulta pesada: o processo filho morre no prazo, o event loop segue livre e a próxima consulta usa um filho novo`.
- `tests/int/sql-branch.int.test.ts`, `SQL-11 consulta pesada é cortada por SQL_TIMEOUT_MS...` e `API-02 com ASK_TIMEOUT_MS menor que SQL_TIMEOUT_MS, a consulta pesada dá 504 no prazo da requisição`.
- `tests/e2e/ask-api.e2e.test.ts`, `SQL-11 /health responde enquanto uma consulta pesada roda...`.
- `npm run layers`: o ataque `sql-cross-join` aparece barrado só pelo lexer.
