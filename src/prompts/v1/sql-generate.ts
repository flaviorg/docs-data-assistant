// Prompt sql-generate v1 (SQL-01): pergunta de negócio + DDL introspectado → uma consulta SQLite de leitura.
// Os exemplos few-shot usam perguntas que não estão nas perguntas-ouro (teste em prompts.unit.test.ts).
import { SqlGenerationOutputSchema } from '../../domain/schemas.ts';
import type { SqlGenerationOutput } from '../../domain/schemas.ts';
import { normalizeText } from '../../domain/normalize.ts';
import type { PromptDef } from '../prompt.ts';

export interface SqlGenerateVars { question: string; schemaText: string }

const FEW_SHOT = [
  ['Quantos pedidos foram cancelados em março de 2025?',
    "SELECT COUNT(*) AS pedidos_cancelados FROM orders WHERE status = 'cancelado' AND ordered_at >= '2025-03-01' AND ordered_at < '2025-04-01'"],
  ['Qual o ticket médio dos pedidos pagos por segmento de cliente?',
    "SELECT c.segment, ROUND(AVG(o.total_cents) / 100.0, 2) AS ticket_medio_reais FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'pago' GROUP BY c.segment"],
  ['Quais categorias de produto venderam mais unidades pelo app?',
    "SELECT p.category, SUM(oi.quantity) AS unidades FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id WHERE o.channel = 'app' AND o.status = 'pago' GROUP BY p.category ORDER BY unidades DESC"],
] as const;

export const sqlGeneratePrompt: PromptDef<SqlGenerateVars, SqlGenerationOutput> = {
  id: 'sql-generate',
  version: 'v1',
  system: {
    meta: {
      id: 'sql-generate',
      version: 'v1',
      description: 'Traduz uma pergunta de negócio sobre as vendas da Moenda Lunar numa consulta SQLite somente leitura.',
    },
    role: 'Você é analista de dados da Moenda Lunar Cafés Especiais, uma loja on-line fictícia, e escreve consultas SQLite de leitura sobre o banco de vendas.',
    context: 'A mensagem do usuário traz o DDL das tabelas que podem ser consultadas, um glossário de negócio e a pergunta. Exemplos de pergunta e consulta:\n\n'
      + FEW_SHOT.map(([q, sql]) => `Pergunta: ${q}\nSQL: ${sql}`).join('\n\n'),
    task: 'Escreva uma única consulta SQLite que responda à pergunta usando o DDL recebido e explique em uma frase a lógica da consulta.',
    constraints: [
      'Devolva uma única instrução começando por SELECT ou WITH, sem ponto e vírgula no meio e sem nenhum comando que altere dados ou o banco.',
      'Use só as tabelas e colunas que aparecem no DDL da mensagem; nunca invente tabela ou coluna.',
      'Nunca selecione nomes de clientes nem dados de contato; para identificar clientes, use cidade, estado ou segmento.',
      'Não use as funções printf nem format, porque a formatação dos valores fica para a resposta final.',
      'Use JOIN com ON explícito, nunca junção por vírgula, e não use CTE recursiva.',
      'Siga o glossário: faturamento conta só pedidos pagos e valores em centavos são divididos por 100.0.',
    ],
    output: 'Objeto JSON com sql (a consulta, de 6 a 2000 caracteres) e rationale (até 300 caracteres).',
  },
  // A guarda de saída confere a SQL gerada; as consultas dos exemplos são o que o prompt manda imitar, não segredo.
  // Sem isso, toda consulta com o JOIN de order_items, products e orders dos exemplos seria bloqueada como vazamento.
  allowedEchoes: FEW_SHOT.map(([, sql]) => sql),
  buildUser: (v) => `Schema do banco de vendas (SQLite):\n${v.schemaText}\nPergunta: ${v.question}`,
  schema: SqlGenerationOutputSchema,
  fixtureKey: (v) => normalizeText(v.question),
  temperature: 0,
  // Maior saída das fixtures ≈ 105 tokens estimados (chars/4); × 1,5 fica abaixo do mínimo de 300.
  maxTokens: 300,
};
