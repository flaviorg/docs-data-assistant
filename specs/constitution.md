# Constituição do projeto

Regras que valem para todo o código, toda spec e todo agente que trabalhe neste repositório. Uma spec de feature pode detalhar, mas não contrariar, o que está aqui.

## Princípios de engenharia

1. **Recusar é recurso.** Sem evidência suficiente, o assistente responde com a recusa canônica. Uma resposta inventada é defeito; uma recusa correta é sucesso. O limiar de recusa é calibrado e versionado (`src/config.ts`).
2. **Toda saída do LLM passa por schema.** Nada que o modelo devolve é usado sem `safeParse` do Zod (`src/llm/llm-client.ts`). Saída fora do schema tem um retry de parse e, se persistir, um fallback determinístico por nó.
3. **Código gerado é validado antes de executar.** A SQL do modelo passa por lexer, política estática, `EXPLAIN QUERY PLAN` e authorizer, e roda numa conexão somente leitura. Violação de política bloqueia e nunca volta ao modelo para "correção".
4. **Todo laço tem teto.** Correções de SQL (3), execuções lógicas de prompt por requisição (8), tentativas por modelo, passos do grafo (`recursionLimit` 25), linhas, células, tempo de requisição. Cada teto tem teste.
5. **O system prompt não é firewall.** A segurança fica em código determinístico: regras de entrada, sanitização dos documentos, delimitação de contexto, authorizer, `query_only` e guarda de saída. O classificador por modelo é opcional e falha fechado.
6. **A qualidade é medida, não presumida.** O eval gate (`npm run eval`) roda no CI e reprova abaixo do limiar. Cada métrica diz se é *mecanismo* (medida de verdade) ou *contrato (fixture)*.

## Regra de integridade das perguntas-ouro

É proibido reescrever perguntas-ouro (`eval/golden.v1.json`) ou fixtures (`fixtures/llm/`) para fazer uma métrica passar. Quando uma métrica falha, corrige-se o mecanismo (embedder, chunker, regra, prompt) ou recalibra-se o limiar só no split `calibration`, e a decisão fica registrada na spec da feature ou em `docs/incidents/`.

## Fake honesto

O provedor `fake` substitui **só a chamada ao modelo**. Recuperação, limiar, sanitização, validação e execução de SQL, authorizer, guardrails, retry, fallback, ledger e `/stats` rodam de verdade. Pergunta sem fixture falha com `FixtureMissingError`; nunca há resposta genérica. Fixtures que encenam um modelo que cedeu levam a nota "modelo complacente simulado", e a demo e o README dizem isso. O modo fake aparece em toda saída (`meta.provider`, faixa MODO DEMO, rótulo FAKE).

## Material do curso

Nenhum material do curso entra no repositório: transcrição, slide, texto autoral ou exemplo de aula. Aulas são citadas só por ID e tema. Documentos da empresa fictícia, dataset, corpus de ataques, prompts e perguntas-ouro são escritos do zero.

## Humano no controle

Nenhum commit, push, publicação ou criação de repositório remoto acontece sem pedido explícito do humano responsável. Agentes preparam a mudança, rodam `npm run typecheck` e `npm test`, e entregam para validação.

## Fluxo de trabalho (SDD)

1. A spec da feature (`specs/00N-*/spec.md`) vem antes do código e traz critérios EARS com ID.
2. O teste do critério é escrito primeiro, com o ID no nome, e falha pelo motivo certo.
3. Implementação mínima até o teste passar.
4. Verificação: `npm run typecheck`, `npm test`, `npm run eval` e `npm run layers` com código 0. O teste `tests/unit/ears-coverage.unit.test.ts` garante que todo ID das specs tem teste.
