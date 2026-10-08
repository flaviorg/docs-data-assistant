# AGENTS.md

Instruções para agentes de código (Claude Code, Copilot, Codex e afins) neste repositório. Leia também `specs/constitution.md`.

## O que é

Assistente em TypeScript que responde perguntas sobre uma empresa fictícia (Lunar Mill Specialty Coffee; base, perguntas e mensagens em inglês) por RAG com recusa ou por Text-to-SQL seguro, atrás de um grafo LangGraph com guardrails em camadas.
O provedor padrão é um `fake` roteirizado por fixtures; o OpenRouter entra com chave no `.env`.
Roda em Node 24.15+ sem build, sem Docker e sem rede depois do `npm install`.

## Comandos

- `npm test`: suíte inteira (unit, int, e2e) sem rede. Rodar um arquivo: `node --import ./tests/helpers/no-network.ts --test tests/unit/<arquivo>.test.ts`.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run eval`: eval gate no perfil fake; sai com 1 abaixo do limiar.
- `npm run layers`: matriz ataque × camada; sai com 1 se algum ataque passar por todas.
- `npm run demo`: os 13 cenários em memória.
- `npm run calibrate`: limiar de recusa no split `calibration`.

## TypeScript sem build (*type stripping*)

- Imports relativos com extensão `.ts`; `import type` para tipos (`verbatimModuleSyntax`).
- Proibido: `enum`, `namespace`, *parameter properties* (`constructor(public x)`) e decorators. Classes de erro declaram campos no corpo.
- Valores monetários em centavos inteiros. E-mails e sites só no domínio `.example`.

## Onde fica cada coisa

- `src/graph/nodes/`: um nó por arquivo, criado por fábrica `createXNode(deps)`; arestas puras em `src/graph/routing.ts`.
- `src/prompts/v1/`: prompts versionados (JSON de 6 blocos); registre todo prompt novo em `src/prompts/v1/index.ts`.
- `fixtures/llm/<promptId>.v1.json`: respostas do fake, uma entrada por pergunta normalizada.
- `eval/`: `golden.v1.json` (perguntas-ouro), `attacks.v1.json` (matriz), `thresholds.json` (limiares).
- `src/sql/`: lexer, validador, conexão somente leitura, authorizer e o executor em processo filho com prazo (`query-runner.ts`). `src/guardrails/`: regras, classificador e guarda de saída.
- `specs/`: constituição e specs com critérios EARS. `docs/incidents/` e `docs/adr/`: decisões registradas.
- Composição: `src/app-context.ts` é o único lugar que faz `new` das dependências; testes usam `tests/helpers/context.ts`.

## Como adicionar uma pergunta

1. Acrescente o item ao split `test` de `eval/golden.v1.json` com `category` e `expected` (rota, status, `blockedBy`, `chunkIds` ou `sql`).
2. Escreva as fixtures de cada prompt do caminho esperado (`router`, depois `rag-answer` ou `sql-generate`/`sql-correct`/`sql-answer`). Item `data` sem correção usa `"responseFromGolden": "<id>"`. Números de `sql-answer` vêm da execução real da SQL no seed.
3. Em `rag-answer`, cite só chunks que o `hash-v1` recupera no top-3.
4. Rode `tests/unit/fixtures-contract.unit.test.ts` e `tests/unit/golden-schema.unit.test.ts`: o contrato roda cada item pelo grafo e acusa fixture faltando ou órfã.
5. Rode `npm run eval` e confira que a composição da spec 005 continua válida.

## Proibições

- Não editar perguntas-ouro nem fixtures para uma métrica passar. Corrija o mecanismo ou recalibre no split `calibration` e registre em `docs/incidents/`.
- Não relaxar a política SQL (lexer, allowlist, lista de risco, `query_only`, authorizer, teto de `limits.length`). Violação de política bloqueia; não vira correção.
- Não executar SQL gerada pelo modelo na thread principal: use o `QueryRunner` (processo filho com `SQL_TIMEOUT_MS`). Um `Worker` não serve, porque `terminate()` não interrompe o `node:sqlite`.
- Não usar `innerHTML`, `outerHTML`, `insertAdjacentHTML` nem `document.write` em `src/web/`; nada de script ou estilo inline.
- Não acrescentar dependência (runtime ou dev). As 7 do `package.json` são exatas e únicas.
- Não fazer `git commit`, `git push`, publicação ou criação de repositório sem pedido explícito do humano.
- Não ler, imprimir nem copiar `.env`. Testes nunca usam rede nem chave real.
- Não copiar material do curso (transcrição, slide, exemplo de aula). Aulas só por ID e tema.

## Fluxo SDD

1. Spec antes: critério EARS com ID em `specs/00N-*/spec.md` (ou mudança no critério existente).
2. Teste falhando primeiro, com o ID no começo do nome: `test('SQL-05 esgota 3 correções e responde error', ...)`. O ID marca o teste que prova o critério; complemento ou teste de outro assunto fica sem ID.
3. Implementação mínima até passar.
4. Verificação: `npm run typecheck && npm test && npm run eval && npm run layers`, todos com código 0. `tests/unit/ears-coverage.unit.test.ts` acusa ID sem teste.

## Hook de pre-commit

`npm run hooks:install` aponta o Git para `.githooks/`; o `pre-commit` roda `npm run typecheck` e `npm test` e barra o commit se algum falhar.
