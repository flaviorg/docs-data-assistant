# 2026-10-04: `LIKE` negado pelo authorizer

## Contexto

Revisão do desenho da camada SQL, antes do código. A primeira versão do authorizer liberava em `SQLITE_FUNCTION` só uma allowlist curta (agregações e poucas funções de texto e data) e tratava qualquer outra função como violação de política. A revisão adversarial do desenho perguntou como operadores como `LIKE` chegam ao authorizer.

## Sintoma

Numa sonda com `db.setAuthorizer()` no Node 24.21 (SQLite 3.53.4), `SELECT city FROM customers WHERE city LIKE 'Cur%'` chega ao authorizer como `SQLITE_FUNCTION` com nome `like` (e `GLOB` como `glob`). Negando a função, o `prepare()` falha com `not authorized to use function: like` (errcode 1). Com a allowlist curta, a pergunta legítima "clientes de Curitiba" viraria bloqueio `sql_authorizer`, contado como falso bloqueio.

## Causa

No SQLite, `LIKE` e `GLOB` são implementados como funções SQL (`like(padrão, valor)`), e o authorizer recebe a chamada da função, não o operador. A lista curta foi escrita pensando em "funções que o usuário escreve", não no que o SQLite gera por baixo.

## Correção

- A allowlist de `src/sql/sql-functions.ts` foi ampliada para funções puras de texto, número, data e janela, incluindo `like` e `glob` (49 funções no total).
- Função fora da allowlist que **não** está na lista de risco (por exemplo `random()`) deixou de ser política: vira erro corrigível, com a lista de funções permitidas anexada ao pedido de correção (critério SQL-10). Só a lista de risco (`load_extension`, `printf`, `format`, `zeroblob`, `randomblob`, `fts3_tokenizer`) bloqueia.
- A classificação usa o registro de negações do authorizer (tipo e nome), não o texto da mensagem.

## Teste que impede a volta

- `tests/unit/readonly-connection.unit.test.ts`, `SQL-08 LIKE permitido; printf de risco; random fora da allowlist; CTE recursiva negada`.
- `tests/unit/sql-validator.unit.test.ts`, `SQL-02 tabela de política e classificação cobre todas as regras` (caso `WHERE city LIKE 'Cur%'` permitido) e `SQL-10 função fora da allowlist e fora da lista de risco é corrigível com a allowlist na mensagem`.
