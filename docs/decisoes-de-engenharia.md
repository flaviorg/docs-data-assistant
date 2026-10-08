# Decisões de engenharia

Decisões que moldam o desenho do `docs-data-assistant`, cada uma com a spec ou o incidente que a registra. O [README](../README.md) traz o resumo; aqui fica o porquê.

## Dados e SQL

- **Bancos separados:** `sales.db` só tem as tabelas de vendas; documentos, vetores e ledger ficam em `app.db`. A SQL gerada nunca enxerga tabelas internas ([spec 003](../specs/003-text-to-sql-seguro/spec.md)).
- **Política SQL não vai para correção:** violação bloqueia na hora. Mandar de volta ao modelo daria ao atacante novas tentativas; só erro de sintaxe, tabela ou coluna inexistente e função comum fora da allowlist são corrigíveis ([spec 003](../specs/003-text-to-sql-seguro/spec.md)).
- **Teto de 100.000 bytes por valor na conexão SQL:** sem ele, três `replace()` aninhados montavam 16 MB e `group_concat()` sobre uma junção `ON 1=1` devolvia 75 MB, dentro do prazo de execução. Com `DatabaseSync.limits.length` (Node 24.15+), a consulta falha na hora com `string or blob too big`. `printf` e `format` continuam na lista de risco, porque formatar números é trabalho do `sqlAnswer` ([spec 003](../specs/003-text-to-sql-seguro/spec.md), [incidente](incidents/2026-10-04-funcoes-de-texto-sem-teto.md)).
- **SQL gerada roda num processo filho com prazo:** o `node:sqlite` é síncrono e não tem como interromper uma consulta; na thread principal, um produto cartesiano travava o servidor inteiro. Um Worker não resolve, porque `terminate()` não interrompe código nativo; o processo filho leva `SIGKILL` ([incidente](incidents/2026-10-04-terminate-nao-interrompe-sqlite.md)).
- **`readOnly` não basta:** em memória compartilhada ele não impede escrita; o projeto usa snapshot desserializado, `query_only` e authorizer ([incidente](incidents/2026-10-04-readonly-nao-vale-em-memoria-compartilhada.md)).

## Avaliação

- **A matriz testa cada camada sozinha**, para mostrar redundância real e não somar a mesma defesa duas vezes ([spec 005](../specs/005-interfaces-e-eval/spec.md), [incidente](incidents/2026-10-04-redundancia-falsa-na-matriz.md)).

## Guardrails e modelo

- **Classificador por modelo falha fechado:** resposta fora do formato ou truncada bloqueia, com mensagem que diz que a verificação falhou (e não que o usuário tentou injeção); falso bloqueio é medido pelo `falseBlockRate`. Se o modelo de segurança cair, a requisição responde 503, como qualquer modelo fora do ar, e a queda aparece em `errorRate` ([spec 004](../specs/004-guardrails-e-grafo/spec.md)).
- **Retry é do cliente, não do SDK:** `maxRetries: 0` no SDK `openai`; o `LlmClient` faz retry com backoff, fallback de modelo e conta execuções lógicas contra um teto por requisição; saída truncada não tem retry ([spec 001](../specs/001-cliente-llm-e-observabilidade/spec.md)).

## Interface

- **Página sem HTML cru:** só `textContent` e `createElement`, com CSP `default-src 'none'`, porque ela mostra texto de documentos (inclusive o envenenado) e do modelo ([spec 005](../specs/005-interfaces-e-eval/spec.md)).
