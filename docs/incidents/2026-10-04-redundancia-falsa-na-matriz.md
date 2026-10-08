# 2026-10-04: redundância falsa do `query_only` na matriz de camadas

## Contexto

Construção do `npm run layers`. A matriz passa cada ataque de `eval/attacks.v1.json` por cada camada determinística **isoladamente**. Para a coluna `query_only`, o desenho inicial dizia: abrir uma conexão só com `PRAGMA query_only = ON` (sem authorizer), rodar o payload e contar qualquer falha como `bloqueia`.

## Sintoma

Com essa regra, o ataque `sql-loadext` (`SELECT load_extension(...)`) aparecia barrado pelo `query_only`. O erro era `not authorized` (errcode 1), não uma recusa de escrita, e saía igual numa conexão sem `query_only`. A matriz mostraria duas camadas independentes contra `load_extension` (authorizer e `query_only`), mas o `query_only` não tem nada a ver com extensões.

## Causa

O `node:sqlite` cria toda conexão com o carregamento de extensões desligado. Por isso `load_extension` falha em qualquer conexão, com ou sem `query_only`. A regra "falha = bloqueia" confundia o padrão seguro do driver com o mérito da camada. O mesmo risco existia na coluna do authorizer: uma consulta pode falhar por outro motivo (tabela inexistente, sintaxe) sem que o authorizer tenha negado nada.

## Correção

- `query_only` só conta como `bloqueia` quando o erro é `SQLITE_READONLY` (errcode 8), a recusa de escrita que é a função dessa camada (`src/eval/layers.ts`).
- O authorizer só conta como `bloqueia` quando registra ao menos uma negação ao compilar o `EXPLAIN QUERY PLAN`.
- Resultado na matriz: `sql-loadext`, `sql-contacts` e `sql-names` passam pelo lexer e pelo `query_only` e são barrados só pelo authorizer. As três escritas continuam barradas por 3, 2 e 3 camadas (o `sql-multi` passa pelo authorizer porque o `prepare()` descarta o `DROP`; ver [incidente](2026-10-04-prepare-descarta-instrucoes.md)).

## Teste que impede a volta

- `tests/unit/layers.unit.test.ts`, `EVL-04 leitura de dado pessoal e função de risco são barradas só pelo authorizer; o lexer não vê tabela nem função`.
- `tests/unit/layers.unit.test.ts`, `a matriz mostra a redundância e as lacunas reais de cada camada`.
- `tests/unit/layers.unit.test.ts`, `EVL-04 todo ataque é barrado por ao menos uma camada e toda escrita por duas`.
