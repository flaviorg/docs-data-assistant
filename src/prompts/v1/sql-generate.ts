// Prompt sql-generate v1 (SQL-01): pergunta de negócio + DDL introspectado → uma consulta SQLite de leitura.
// Os exemplos few-shot usam perguntas que não estão nas perguntas-ouro (teste em prompts.unit.test.ts).
import { SqlGenerationOutputSchema } from '../../domain/schemas.ts';
import type { SqlGenerationOutput } from '../../domain/schemas.ts';
import { normalizeText } from '../../domain/normalize.ts';
import type { PromptDef } from '../prompt.ts';

export interface SqlGenerateVars { question: string; schemaText: string }

const FEW_SHOT = [
  ['How many orders were cancelled in March 2025?',
    "SELECT COUNT(*) AS cancelled_orders FROM orders WHERE status = 'cancelled' AND ordered_at >= '2025-03-01' AND ordered_at < '2025-04-01'"],
  ['What is the average order value of paid orders by customer segment?',
    "SELECT c.segment, ROUND(AVG(o.total_cents) / 100.0, 2) AS avg_order_value_brl FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'paid' GROUP BY c.segment"],
  ['Which product categories sold the most units through the app?',
    "SELECT p.category, SUM(oi.quantity) AS units FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id WHERE o.channel = 'app' AND o.status = 'paid' GROUP BY p.category ORDER BY units DESC"],
] as const;

export const sqlGeneratePrompt: PromptDef<SqlGenerateVars, SqlGenerationOutput> = {
  id: 'sql-generate',
  version: 'v1',
  system: {
    meta: {
      id: 'sql-generate',
      version: 'v1',
      description: 'Translates a business question about Lunar Mill sales into a read-only SQLite query.',
    },
    role: 'You are a data analyst at Lunar Mill Specialty Coffee, a fictional online store, and write read-only SQLite queries on the sales database.',
    context: 'The user message contains the DDL of the tables that can be queried, a business glossary and the question. Examples of a question and a query:\n\n'
      + FEW_SHOT.map(([q, sql]) => `Question: ${q}\nSQL: ${sql}`).join('\n\n'),
    task: 'Write a single SQLite query that answers the question using the DDL received and explain the logic of the query in one sentence.',
    constraints: [
      'Return a single statement starting with SELECT or WITH, with no semicolon in the middle and no command that changes data or the database.',
      'Use only the tables and columns that appear in the DDL in the message; never make up a table or column.',
      'Never select customer names or contact details; to identify customers, use city, state or segment.',
      'Do not use the printf or format functions, because formatting the values is left to the final answer.',
      'Use JOIN with an explicit ON, never a comma join, and do not use a recursive CTE.',
      'Follow the glossary: revenue counts only paid orders and values in cents are divided by 100.0.',
    ],
    output: 'JSON object with sql (the query, 6 to 2000 characters) and rationale (up to 300 characters).',
  },
  // A guarda de saída confere a SQL gerada; as consultas dos exemplos são o que o prompt manda imitar, não segredo.
  // Sem isso, toda consulta com o JOIN de order_items, products e orders dos exemplos seria bloqueada como vazamento.
  allowedEchoes: FEW_SHOT.map(([, sql]) => sql),
  buildUser: (v) => `Sales database schema (SQLite):\n${v.schemaText}\nQuestion: ${v.question}`,
  schema: SqlGenerationOutputSchema,
  fixtureKey: (v) => normalizeText(v.question),
  temperature: 0,
  // Maior saída das fixtures ≈ 105 tokens estimados (chars/4); × 1,5 fica abaixo do mínimo de 300.
  maxTokens: 300,
};
