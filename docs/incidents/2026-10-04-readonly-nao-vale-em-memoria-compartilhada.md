# 2026-10-04: `readOnly` não vale em memória compartilhada

## Contexto

Conferência do `node:sqlite` (Node 24.21, SQLite 3.53.4) antes de escrever o desenho da conexão analítica. Testes, demo e eval precisam rodar com o banco de vendas em memória, sem arquivo. O desenho inicial abria a mesma base em memória duas vezes, com cache compartilhado (`file:sales?mode=memory&cache=shared`): uma conexão gravável para o seed e outra com `new DatabaseSync(uri, { readOnly: true })` para o assistente.

## Sintoma

Na conexão aberta com `readOnly: true` sobre o banco em memória compartilhado, um `INSERT` e um `DELETE` passaram sem erro (a contagem foi de 1 para 2 linhas e depois para 0). A mesma abertura sobre um **arquivo** recusou a escrita com `attempt to write a readonly database` (errcode 8, `SQLITE_READONLY`). A sonda foi repetida no fechamento do projeto, com o mesmo resultado.

## Causa

Com cache compartilhado, as duas conexões usam o mesmo banco em memória, e a flag de somente leitura da segunda abertura não impediu a escrita. Não fomos atrás da linha exata no SQLite; o que importa para o projeto é o comportamento observado: a proteção de `readOnly` só é confiável quando o banco vem de um arquivo.

## Correção

- **Modo memória:** nada de cache compartilhado. O seed roda num `:memory:` gravável, o banco é serializado (`db.serialize()`) e o assistente recebe uma conexão **separada**, criada com `deserialize()` desse snapshot (`src/sql/readonly-connection.ts`, `createSalesSnapshot` em `src/sql/seed.ts`). Alterar a cópia não altera o snapshot.
- **Modo arquivo:** `new DatabaseSync(SALES_DB_PATH, { readOnly: true })`, como planejado.
- **Nos dois modos:** `PRAGMA query_only = ON` antes do authorizer, e o authorizer nega toda ação diferente de leitura. Somente leitura deixou de depender de uma única flag.

## Teste que impede a volta

- `tests/unit/readonly-connection.unit.test.ts`:
  - `SQL-08 escrita falha por query_only sem authorizer e pelo authorizer`;
  - `SQL-08 arquivo aberto com readOnly recusa escrita mesmo sem query_only e authorizer`;
  - `snapshot desserializado não altera o original`.
- `npm run layers`: as três escritas via SQL são barradas pelo `query_only` sozinho, sem o authorizer.
