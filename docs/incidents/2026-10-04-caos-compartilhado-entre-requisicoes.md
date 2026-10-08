# 2026-10-04: estado de caos compartilhado entre requisições

## Contexto

Construção do `AskService`. Um dos critérios de revisão do desenho inicial exige que duas requisições concorrentes não compartilhem budget, `requestId` nem estado de caos. O provider fake, como desenhado no início, guardava o modo `primary-timeout-once` num campo do próprio provider: a primeira chamada a `fake/primary` falhava com `timeout` e as seguintes passavam. Como o `AppContext` tem um único provider para o processo inteiro, esse estado era global.

## Sintoma

O problema apareceu no desenho do teste de concorrência, antes de virar falha em execução: com `LLM_FAKE_CHAOS=primary-timeout-once` e duas perguntas em `Promise.all` sobre o mesmo provider, só a primeira chamada a `fake/primary` do processo falharia. A outra pergunta passaria limpa, e qual das duas pegaria o timeout dependeria da ordem de agendamento. Num servidor de demonstração, o modo "falha uma vez" valeria uma vez por processo, não por pergunta. (O comportamento "uma vez por provider" continua existindo quando não há `requestId`, e é coberto por teste.)

## Causa

Estado mutável por provider, sem chave de requisição. O `ProviderRequest` não carregava nada que identificasse a requisição, então o fake não tinha como separar uma pergunta da outra.

## Correção

- `ProviderRequest.meta` ganhou `requestId?` opcional, preenchido pelo `LlmClient` a partir do `CallContext`. O provider OpenRouter não envia `meta` à API.
- O fake arma `primary-timeout-once` uma vez **por `requestId`**. Sem `requestId` (testes diretos do provider), continua valendo uma vez por provider.
- O registro de requisições já atingidas tem teto de 10.000 chaves, para não crescer sem limite num servidor longo com o caos ligado.
- `setChaos()` (usado só pela demo) zera o registro ao trocar de modo.

## Teste que impede a volta

- `tests/int/ask-service.int.test.ts`, `API-03 estado de caos não é compartilhado: primary-timeout-once vale para cada pergunta`: as duas perguntas concorrentes têm `attempts` igual a `[2, 1]` no ledger (timeout e retry no roteador, chamada limpa no nó seguinte).
- `tests/int/ask-service.int.test.ts`, `API-03 duas perguntas concorrentes têm budget e requestId independentes`.
- `tests/unit/fake-provider.unit.test.ts`, `primary-timeout-once não afeta o fallback; setChaos rearma o modo; none volta ao normal`.
