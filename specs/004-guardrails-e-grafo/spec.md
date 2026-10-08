# 004: Guardrails e grafo

## Contexto

Toda pergunta passa por um grafo LangGraph de 12 nós: guardrail de entrada, roteador `docs | data | out_of_scope`, os ramos RAG e SQL e um nó `finalize` com guarda de saída. As defesas contra injeção ficam em código determinístico, antes e depois do modelo; o classificador por modelo é uma camada opcional que falha fechado.

## Escopo

- `src/guardrails/rules.ts` e `rule-classifier.ts`: cerca de 20 padrões PT e EN com id e severidade (`high` bloqueia; `medium` só em combinação), com acentos e caixa normalizados.
- `src/guardrails/safeguard-classifier.ts` e o prompt `safeguard`: modelo de segurança sem tools, política e pergunta enviadas juntas, resposta lida por `SAFE` ou `UNSAFE` no início.
- `src/guardrails/output-guard.ts`: canário, spans redigidos e shingles de 8 palavras dos blocos protegidos dos prompts, descontados os `allowedEchoes`.
- `GUARDRAIL_MODE` `rules`, `rules+model` ou `off` (desliga só as camadas de entrada).
- O prompt `router` e os nós `guardrailInput`, `router`, `outOfScope` e `finalize`.
- `src/graph/state.ts` (reducers explícitos), `src/graph/routing.ts` (arestas condicionais puras), `src/graph/graph.ts` (`createAskGraph`), `src/app-context.ts` (composição) e `src/ask-service.ts` (serviço único usado por API, CLIs, demo e eval).

## Non-goals

- Conversa com memória ou multi-turno: cada pergunta é independente.
- Perguntas híbridas: o roteador escolhe a intenção dominante.
- LangGraph Studio (`langgraph.json`), que depende de CLI baixada por `npx` e de conta hospedada.
- Classificador por modelo com o provedor fake (o `createAppContext` recusa `rules+model` quando o provider efetivo é `fake`).

## Critérios de aceite (EARS)

- **GRD-01** Quando a pergunta casar uma regra de injeção de severidade alta, o sistema deve responder `status: blocked` com `blockedBy: input_rules`, sem chamar o roteador nem modelo de geração.
- **GRD-02** Onde `GUARDRAIL_MODE=rules+model`, quando as regras não bloquearem, o sistema deve enviar política e pergunta ao modelo de segurança e tratar resposta iniciada por `UNSAFE` como bloqueio `input_model`.
- **GRD-03** Se o classificador de segurança responder fora do formato ou com saída truncada, então o sistema deve bloquear (falha fechada) com mensagem que não acusa o usuário de injeção e registrar o motivo em `guardrail.reasons`; se o modelo de segurança estiver indisponível depois dos retries, então o sistema deve responder HTTP 503 (como LLM-03) sem chamar o roteador.
- **GRD-05** Se a resposta gerada (inclusive o motivo da rota e o bloco SQL) contiver 8 palavras seguidas de um trecho redigido, o canário do documento envenenado ou 8 palavras seguidas dos blocos `role`, `context`, `task` ou `constraints` de um system prompt (descontadas as frases que o próprio prompt manda emitir), então o sistema deve substituí-la por recusa com `status: blocked` e `blockedBy: output_guard`.
- **RTE-01** Quando a pergunta passar pelo guardrail, o sistema deve classificá-la em `docs`, `data` ou `out_of_scope` e registrar `routeReason`.
- **RTE-02** Quando `forceRoute` for informado, o sistema deve usar a rota informada sem chamar o roteador e devolver `overridden: true`.
- **RTE-03** Se a saída do roteador for inválida ou truncada depois do retry de parse, então o sistema deve seguir por `out_of_scope` com o aviso `router_fallback`.
- **RTE-04** Quando a rota for `out_of_scope`, o sistema deve responder `status: refused` com mensagem fixa, sem chamar outro prompt além do roteador.

## Decisões

- **As regras são a camada mais fraca.** Pegam a injeção direta óbvia, sem custo e sem LLM. A defesa principal é arquitetural: modelo sem ferramentas de escrita, conexão somente leitura, authorizer, sanitização na ingestão, delimitação de contexto e guarda de saída.
- **Falha fechada no classificador.** Resposta fora do formato ou saída truncada bloqueiam com `classifier_unparseable` ou `classifier_error`, e a mensagem diz que a verificação falhou, não que o usuário tentou injeção. Um falso bloqueio é visível e medido (`falseBlockRate`); uma injeção que passa não é.
- **Modelo de segurança fora do ar é 503, não bloqueio.** O `GUARDRAIL_MODEL` não tem fallback. Antes, a queda dele virava `blocked` com a mensagem de injeção, HTTP 200 e `errorRate` 0: o operador não via a queda e o usuário era acusado por uma falha de transporte. Agora o `LlmUnavailableError` propaga como em LLM-03: a requisição responde 503 `llm_unavailable`, nada passa sem veredito, e a queda entra em `errorRate` e no log `warn`. Com `rules+model`, a disponibilidade do assistente passa a depender também do modelo de segurança.
- **A guarda de saída vê todo texto do modelo que chega à resposta.** Além de `answer` e `followUpQuestions`, o `finalize` confere em qualquer status o `routeReason` (vazou, a resposta vira `blocked` e o motivo é trocado por texto fixo) e o bloco SQL: consulta, consulta original, último erro, nomes de coluna e linhas, porque um literal escrito pelo modelo (`SELECT 'LUA-CHEIA-100'`) vira célula. Vazou no bloco SQL, a consulta vira `consulta omitida pela guarda de saída` e linhas, colunas e erro saem vazios. As consultas dos exemplos do `sql-generate` entram em `allowedEchoes`; sem isso, 12 das 23 SQLs das fixtures e perguntas-ouro seriam bloqueadas como vazamento, porque repetem o JOIN dos exemplos. O `checkCitations` só copia para o aviso `citation_dropped:<id>` um ID com formato de chunk que passe pela guarda; o resto vira `citation_dropped:invalid_id` ([incidente](../../docs/incidents/2026-10-04-guarda-de-saida-sem-motivo-da-rota.md)).
- **A guarda de saída compara texto normalizado.** O bloco `output` dos prompts nunca entra (é o formato que o modelo deve seguir), e as frases que o próprio prompt manda emitir, como a recusa canônica, ficam em `allowedEchoes`, descontadas por prompt.
- **Cenários 10 e 11 usam fixtures de "modelo complacente simulado".** Um modelo real não receberia o trecho envenenado (já redigido na ingestão). A fixture encena um modelo que cedeu, para provar que a última linha de defesa barra mesmo assim.
- **Reducers explícitos no estado.** No LangGraph 1.4, `z.array(...).default([])` vira canal *LastValue* (o último nó sobrescreve). `warnings`, `trace` e `redactedSpans` usam `withLangGraph` com reducer de concatenação.
- **Todo caminho tem rota.** O caminho mais longo tem 16 passos; o `recursionLimit` de 25 é só rede de segurança, e um teste prova que não é atingido.
- **Erro tratado antes do sucesso.** Cada nó confere `outcome` e `pendingError` antes do caminho feliz.
- **`GUARDRAIL_MODE=off` existe para demonstrar o impacto.** Com ele, a injeção direta do cenário 8 chega ao roteador (fixture marcada `"scenario": "guardrail-off"`), e os cenários 9 a 12 continuam barrados pelas camadas estruturais.

## Como verificar

```bash
node --import ./tests/helpers/no-network.ts --test tests/unit/rule-classifier.unit.test.ts tests/unit/safeguard-classifier.unit.test.ts tests/unit/output-guard.unit.test.ts tests/unit/control-nodes.unit.test.ts tests/unit/graph-state.unit.test.ts tests/int/graph-routing.int.test.ts tests/int/guardrail-layers.int.test.ts tests/int/rag-branch.int.test.ts tests/int/sql-branch.int.test.ts
npm run layers   # cada camada determinística testada sozinha contra eval/attacks.v1.json
```
