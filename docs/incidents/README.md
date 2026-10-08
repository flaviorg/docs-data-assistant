# Incidentes

Registro de problemas reais encontrados durante a construção: comportamento de API diferente do esperado, métrica reprovada, teste que pegou um desenho errado. Nada aqui afetou usuários (o projeto não tinha sido publicado). O objetivo é deixar a causa e o teste que impede a volta à vista de quem mexer no código depois.

Regra do projeto (`specs/constitution.md`): quando uma métrica do eval falha, corrige-se o mecanismo ou recalibra-se o limiar no split `calibration`, e a decisão é registrada aqui. Perguntas-ouro e fixtures não são reescritas para passar.

## Modelo

Copie para `docs/incidents/AAAA-MM-DD-<assunto-curto>.md`:

```markdown
# AAAA-MM-DD: <título em uma linha>

## Contexto
Onde estávamos (tarefa, componente, versão da biblioteca) e o que se esperava.

## Sintoma
O que foi observado, com a mensagem ou o número exato.

## Causa
Por que aconteceu. Se for comportamento de biblioteca, como foi confirmado.

## Correção
O que mudou no código ou no desenho, e o que deliberadamente não mudou.

## Teste que impede a volta
Arquivo e nome do teste (ou comando) que falha se o problema voltar.
```

## Registro

| Data | Incidente | Área |
|---|---|---|
| 2026-10-04 | [`prepare()` descarta instruções extras em silêncio](2026-10-04-prepare-descarta-instrucoes.md) | SQL |
| 2026-10-04 | [`readOnly` não vale em memória compartilhada](2026-10-04-readonly-nao-vale-em-memoria-compartilhada.md) | SQL |
| 2026-10-04 | [`LIKE` negado pelo authorizer](2026-10-04-like-negado-pelo-authorizer.md) | SQL |
| 2026-10-04 | [Separação do `hash-v1` abaixo da meta na primeira calibração](2026-10-04-calibracao-hash-v1.md) | RAG |
| 2026-10-04 | [Estado de caos compartilhado entre requisições](2026-10-04-caos-compartilhado-entre-requisicoes.md) | Cliente de LLM |
| 2026-10-04 | [Redundância falsa do `query_only` na matriz de camadas](2026-10-04-redundancia-falsa-na-matriz.md) | Eval |
| 2026-10-04 | [Item legítimo bloqueado no eval fake (`docs-003`)](2026-10-04-falso-bloqueio-docs-003-no-eval-fake.md) | Eval |
| 2026-10-04 | [Produto cartesiano passava pela política e travava o servidor](2026-10-04-produto-cartesiano-trava-o-servidor.md) | SQL |
| 2026-10-04 | [`Worker.terminate()` não interrompe uma consulta do `node:sqlite`](2026-10-04-terminate-nao-interrompe-sqlite.md) | SQL |
| 2026-10-04 | [Guarda de saída não via o motivo da rota nem o ID de citação descartado](2026-10-04-guarda-de-saida-sem-motivo-da-rota.md) | Guardrails |
| 2026-10-04 | [Bloco SQL da resposta passava ao largo da guarda de saída](2026-10-04-bloco-sql-fora-da-guarda-de-saida.md) | Guardrails |
| 2026-10-04 | [A pergunta podia forjar um trecho no prompt do RAG](2026-10-04-pergunta-forja-trecho-do-rag.md) | Guardrails |
| 2026-10-04 | [Funções de texto permitidas alocavam centenas de MB dentro do prazo](2026-10-04-funcoes-de-texto-sem-teto.md) | SQL |
