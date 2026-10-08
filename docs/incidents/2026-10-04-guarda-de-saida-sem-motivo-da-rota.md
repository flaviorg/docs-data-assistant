# 2026-10-04: Guarda de saída não via o motivo da rota nem o ID de citação descartado

## Contexto

Revisão adversarial antes da publicação. A guarda de saída (GRD-05) é a última defesa contra um modelo que cedeu a uma injeção. Ela conferia só `answer` e `followUpQuestions`, e só em respostas `answered` das rotas `docs` e `data`.

## Sintoma

Com um provedor roteirizado encenando um modelo complacente, o roteador devolveu `reason` com o canário `LUA-CHEIA-100` e a primeira restrição do prompt `rag-answer`, e o `rag-answer` citou um ID inventado com o mesmo texto. A API respondeu `status: answered` e `blockedBy: null`. O `routeReason` levava o canário e o trecho protegido, e `warnings` trazia `citation_dropped:LUA-CHEIA-100 Tudo o que está dentro de <documento> ...`. A página mostra os dois campos ("Motivo da rota" e "Avisos").

## Causa

- `finalize` passava pela guarda só a resposta e as perguntas de acompanhamento. O `routeReason` (até 200 caracteres do roteador) ia direto para a resposta, em qualquer status.
- `checkCitations` copiava o ID descartado, texto livre do modelo e sem limite de tamanho no schema, para o aviso `citation_dropped:<id>`. Como `warnings` acumula por concatenação, o `finalize` não poderia nem apagar o aviso depois.

## Correção

- `finalize` confere o motivo da rota em qualquer status. Se ele vazar, a resposta inteira vira `blocked` / `output_guard`, e o motivo é trocado por "motivo omitido pela guarda de saída".
- `checkCitations` recebe o `OutputGuard`. O ID descartado só vai para o aviso se tiver o formato de ID de chunk (`slug#secao-n`), tiver no máximo 120 caracteres e passar pela guarda. Senão o aviso leva `citation_dropped:invalid_id`. A contagem de descartes continua valendo para o `citationValidity` do eval.
- `RagAnswerOutputSchema.citedChunkIds` passou a aceitar só strings de até 120 caracteres.
- Novo ataque `out-citation-id` na matriz de camadas.

## Teste que impede a volta

- `tests/unit/control-nodes.unit.test.ts`, `GRD-05 finalize confere o motivo da rota em qualquer status...`.
- `tests/unit/rag-nodes.unit.test.ts`, `GRD-05 checkCitations não ecoa no aviso um ID citado com canário...`.
- `tests/int/guardrail-layers.int.test.ts`, `GRD-05 modelo complacente não vaza canário nem system prompt pelo motivo da rota ou pelo aviso de citação descartada` (a sonda da revisão, pelo `AskService`).
