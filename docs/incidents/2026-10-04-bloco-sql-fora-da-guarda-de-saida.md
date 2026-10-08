# 2026-10-04: Bloco SQL da resposta passava ao largo da guarda de saída

## Contexto

Segunda revisão adversarial antes da publicação. A spec 004 dizia que a guarda de saída (GRD-05) vê todo texto do modelo que chega à resposta. Depois do [incidente do motivo da rota](2026-10-04-guarda-de-saida-sem-motivo-da-rota.md), o `finalize` conferia `answer`, `followUpQuestions` e `routeReason`.

## Sintoma

Com um provedor roteirizado em que o `sql-generate` devolvia `SELECT 'LUA-CHEIA-100' AS cupom, '<1ª restrição do rag-answer>' AS regra`, a API respondeu `status: answered`, `blockedBy: null` e `warnings: []`. O canário e o trecho do system prompt estavam em `sql.query` e em `sql.rows`, e a página mostra os dois. Aplicada à mão aos mesmos textos, a guarda respondia `canary` e `system_prompt_leak`.

## Causa

O `finalize` não olhava o estado `sql`, e o `AskService` copiava `query`, `originalQuery`, `pendingError.message`, `columns` e `rows` direto para a resposta. Um literal escrito pelo modelo vira célula, um alias vira nome de coluna e um identificador inventado pode voltar na mensagem de erro do SQLite.

A correção óbvia tinha um efeito colateral: o contexto do prompt `sql-generate` traz três consultas de exemplo, e a guarda protege o bloco `context`. Conferir a SQL contra os blocos protegidos bloqueava 12 das 23 SQLs das fixtures e perguntas-ouro, porque elas repetem o `JOIN` de `order_items`, `products` e `orders` dos exemplos.

## Correção

- O `finalize` confere, em qualquer status, a consulta, a consulta original, o último erro, os nomes de coluna e as linhas (todas juntas, para um vazamento dividido entre células não escapar). Vazou, a resposta vira `blocked` / `output_guard`, a consulta vira `consulta omitida pela guarda de saída` e linhas, colunas e erro saem vazios.
- As três consultas de exemplo do `sql-generate` entraram em `allowedEchoes`: são o que o prompt manda imitar, não segredo. Com isso, nenhuma das 23 SQLs legítimas é bloqueada, e o eval continua com `falseBlockRate` 1/26.
- Novo ataque `out-sql-literal` na matriz de camadas.

## Teste que impede a volta

- `tests/unit/control-nodes.unit.test.ts`, `GRD-05 finalize confere o bloco SQL em qualquer status...` (literal, linhas montadas por `char()`, alias, consulta original, erro com status `error`, consulta barrada pela política e uma SQL legítima parecida com os exemplos).
- `tests/int/guardrail-layers.int.test.ts`, `GRD-05 modelo complacente não vaza canário nem system prompt pelo bloco SQL...` (a sonda da revisão, pelo `AskService`).
