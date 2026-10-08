# 2026-10-04: Funções de texto permitidas alocavam centenas de MB dentro do prazo

## Contexto

Segunda revisão adversarial antes da publicação. `printf` e `format` estavam na lista de risco porque um especificador de largura aloca centenas de MB numa chamada. A spec 003 e o README diziam que o `node:sqlite` não expõe `sqlite3_limit` e que o que segura uma consulta que aloca demais é o prazo de execução e o limite interno do SQLite.

## Sintoma

- `WITH s(t) AS (SELECT 'a'×64) SELECT length(replace(replace(replace(t,'a',t),'a',t),'a',t))` passava pelo validador e devolvia 16.777.216.
- Com quatro níveis, o SQLite respondia `string or blob too big` em cerca de 100 ms (88 e 110 ms em duas sondas), mas o RSS do processo já tinha chegado a 1.059 MB.
- `SELECT length(group_concat(a.id)) FROM orders a JOIN orders b ON 1=1` devolvia 75.571.999.

O prazo de 5 s não ajuda: tudo acontece em menos de um segundo. O processo filho isola o servidor, mas a máquina paga a memória.

## Causa

`replace()`, `group_concat()`, `concat()`, `hex()` e `char()` estão na allowlist e multiplicam o tamanho de um valor do mesmo jeito que o `printf`. O limite interno do SQLite é de 1 GB por valor e só age depois da alocação.

A premissa da spec estava desatualizada: desde o Node 24.15, o `node:sqlite` expõe `sqlite3_limit` como `DatabaseSync.limits`. A tentativa com `PRAGMA hard_heap_limit` não serviu: o SQLite do Node é compilado com `SQLITE_DEFAULT_MEMSTATUS=0`, e sem contabilidade de memória o limite fica em 0 e não é aplicado.

## Correção

- `openSalesConnection` define `db.limits.length = 100000` (`SQL_MAX_VALUE_BYTES`) em toda conexão analítica: a do validador, a do processo filho e as variações da matriz de camadas. As mesmas consultas falham com `string or blob too big` em menos de 1 ms (o `group_concat` sobre `ON 1=1`, em 183 ms), com o RSS estável.
- O maior valor legítimo fica longe do teto: as células saem cortadas em 200 caracteres e um `group_concat` de todos os IDs de pedido tem cerca de 20 KB.
- Erro de tamanho segue a regra de SQL-04 (vai para correção), porque falha na hora e não gasta o prazo.
- `engines` passou a `>=24.15`, e `assertSqliteFeatures` pede Node 24.15+ quando `DatabaseSync.limits` não existe.
- Novo critério EARS `SQL-12`.

## Teste que impede a volta

- `tests/unit/readonly-connection.unit.test.ts`, `SQL-12 texto e blob limitados a SQL_MAX_VALUE_BYTES...`.
- `tests/unit/query-runner.unit.test.ts`, `SQL-12 o processo filho abre a conexão com o mesmo limite de tamanho...`.
- `tests/unit/env-example.unit.test.ts`, os dois testes de Node 24.15+.
