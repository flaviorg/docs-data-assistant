# 2026-10-04: `prepare()` descarta instruções extras em silêncio

## Contexto

Conferência do `node:sqlite` (Node 24.21, SQLite 3.53.4) antes de escrever o desenho da camada SQL. A ideia inicial era confiar no `prepare()` para recusar SQL com mais de uma instrução, como fazem outros drivers que lançam erro de "multiple statements".

## Sintoma

`db.prepare('select 1; drop table t')` não lança erro. A instrução compilada é só `select 1;`; o `drop table t` é ignorado sem aviso, e `stmt.all()` devolve a linha do `select`.

## Causa

`StatementSync.prepare()` chama `sqlite3_prepare_v2`, que compila a primeira instrução e devolve o resto do texto num ponteiro de "cauda". O Node não confere se essa cauda tem conteúdo. Num SQL gerado por modelo, um `; DROP ...` ou `; PRAGMA query_only = OFF` ficaria invisível: não roda, mas também não aparece em erro nem em log, e a validação baseada em `EXPLAIN` nunca o veria.

## Correção

- O lexer (`src/sql/sql-lexer.ts`) tokeniza respeitando strings, identificadores entre aspas e comentários, e o validador (`src/sql/validator.ts`) remove **um único** `;` final e rejeita qualquer outro `;` fora de string ou comentário com a regra `multiple_statements`. É `policy`: bloqueia e não volta ao modelo para correção.
- A regra vem antes de qualquer `prepare()`, então nem o `EXPLAIN QUERY PLAN` chega a compilar a primeira parte.
- O `query_only` e o authorizer continuam como camadas independentes, mas não são a defesa contra este caso: o texto descartado nunca chega a eles.

## Teste que impede a volta

- `tests/unit/sql-validator.unit.test.ts`, `SQL-02 tabela de política e classificação cobre todas as regras`: `select 1; drop table orders`, `SELECT 1;;` e `SELECT 1 FROM orders WHERE 0; PRAGMA query_only = OFF` dão `policy` / `multiple_statements`.
- `tests/unit/sql-lexer.unit.test.ts`: o `;` dentro de string não conta como separador.
- `npm run layers`: o ataque `sql-multi` aparece barrado pelo lexer e passando pelo authorizer, o que documenta por que a regra do lexer é necessária.
