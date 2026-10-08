// Mensagens determinísticas do próprio sistema (não vêm do modelo). Os testes as comparam por igualdade.

export const SQL_EXHAUSTED_MESSAGE = 'Não consegui montar uma consulta válida para essa pergunta depois de 3 correções. Tente reformular.';
export const NO_RESULTS_MESSAGE = 'A consulta rodou, mas não encontrou dados para esse recorte. O banco cobre pedidos de 2025.';
export const SQL_TIMEOUT_MESSAGE = 'A consulta gerada demorou demais e foi interrompida antes de terminar. Tente uma pergunta mais específica.';
export const POLICY_BLOCK_MESSAGE = 'A consulta gerada foi bloqueada pela política de segurança do banco e não foi executada.';
export const OUT_OF_SCOPE_MESSAGE = 'Posso ajudar com as políticas da Moenda Lunar (trocas, frete, garantia, pagamentos, assinatura, parcerias) e com números de vendas de 2025. Essa pergunta está fora desse escopo.';
export const BLOCKED_INPUT_MESSAGE = 'Não posso atender a esse pedido: ele tenta alterar as instruções do assistente.';
// Falha fechada do classificador por modelo (resposta fora do formato ou truncada): não é veredito sobre o usuário.
export const GUARDRAIL_CHECK_FAILED_MESSAGE = 'Não consegui confirmar a segurança desse pedido, então ele não foi atendido. Tente de novo em instantes.';
// Substitui o motivo do roteador quando ele mesmo vaza o canário ou um trecho de system prompt.
export const ROUTE_REASON_BLOCKED = 'motivo omitido pela guarda de saída';
export const OUTPUT_BLOCKED_MESSAGE = 'A resposta gerada foi bloqueada pela verificação de segurança e não será exibida.';
// Substitui a consulta quando o bloco SQL (consulta, consulta original, último erro, colunas ou linhas) vaza o canário ou um
// trecho de system prompt; as linhas, as colunas e o erro saem vazios.
export const SQL_QUERY_BLOCKED = 'consulta omitida pela guarda de saída';
