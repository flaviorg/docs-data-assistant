// Mensagens determinísticas do próprio sistema (não vêm do modelo). Os testes as comparam por igualdade.

export const SQL_EXHAUSTED_MESSAGE = 'I could not build a valid query for this question after 3 corrections. Try rephrasing it.';
export const NO_RESULTS_MESSAGE = 'The query ran, but found no data for this slice. The database covers orders from 2025.';
export const SQL_TIMEOUT_MESSAGE = 'The generated query took too long and was stopped before it finished. Try a more specific question.';
export const POLICY_BLOCK_MESSAGE = 'The generated query was blocked by the database security policy and was not executed.';
export const OUT_OF_SCOPE_MESSAGE = 'I can help with Lunar Mill policies (returns, shipping, warranty, payments, subscription, partnerships) and with 2025 sales figures. This question is outside that scope.';
export const BLOCKED_INPUT_MESSAGE = 'I cannot handle this request: it tries to change the assistant instructions.';
// Falha fechada do classificador por modelo (resposta fora do formato ou truncada): não é veredito sobre o usuário.
export const GUARDRAIL_CHECK_FAILED_MESSAGE = 'I could not confirm that this request is safe, so it was not handled. Try again in a moment.';
// Substitui o motivo do roteador quando ele mesmo vaza o canário ou um trecho de system prompt.
export const ROUTE_REASON_BLOCKED = 'reason withheld by the output guard';
export const OUTPUT_BLOCKED_MESSAGE = 'The generated answer was blocked by the safety check and will not be shown.';
// Substitui a consulta quando o bloco SQL (consulta, consulta original, último erro, colunas ou linhas) vaza o canário ou um
// trecho de system prompt; as linhas, as colunas e o erro saem vazios.
export const SQL_QUERY_BLOCKED = 'query withheld by the output guard';
