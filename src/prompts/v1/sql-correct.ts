// Prompt sql-correct v1 (SQL-04, SQL-10): recebe a SQL que falhou, o erro do banco, a pergunta e o schema.
// A chave da fixture inclui a tentativa: normalize(pergunta) + '#' + tentativa.
import { SqlCorrectionOutputSchema } from '../../domain/schemas.ts';
import type { SqlCorrectionOutput } from '../../domain/schemas.ts';
import { normalizeText } from '../../domain/normalize.ts';
import type { PromptDef } from '../prompt.ts';

export interface SqlCorrectVars { question: string; schemaText: string; failedSql: string; error: string; attempt: 1 | 2 | 3 }

export const sqlCorrectPrompt: PromptDef<SqlCorrectVars, SqlCorrectionOutput> = {
  id: 'sql-correct',
  version: 'v1',
  system: {
    meta: {
      id: 'sql-correct',
      version: 'v1',
      description: 'Fixes a SQLite query that failed validation or execution, based on the error returned by the database.',
    },
    role: 'You are a data analyst at Lunar Mill Specialty Coffee and review read-only SQLite queries that failed.',
    context: 'The user message contains the DDL of the allowed tables, the original question, the query that failed, the database error message and the correction attempt number. '
      + 'When the error is about a function, the error message itself lists the allowed functions.',
    task: 'Write a corrected version of the query that answers the same question and fixes the cause of the error, and say in one sentence what changed.',
    constraints: [
      'Return a single statement starting with SELECT or WITH, with no command that changes data or the database.',
      'Use only tables, columns and functions that exist in the DDL and in the list of allowed functions; never make up a table or column.',
      'Never select customer names or contact details; to identify customers, use city, state or segment.',
      'Keep the intent of the original question and change only what is needed to fix the error.',
    ],
    output: 'JSON object with correctedSql (the corrected query, 6 to 2000 characters) and fix (up to 300 characters).',
  },
  allowedEchoes: [],
  buildUser: (v) => [
    `Sales database schema (SQLite):\n${v.schemaText}`,
    `Question: ${v.question}`,
    `Query that failed:\n${v.failedSql || '(the model did not return a valid SQL query)'}`,
    `Error: ${v.error}`,
    `Correction attempt: ${v.attempt}`,
  ].join('\n\n'),
  schema: SqlCorrectionOutputSchema,
  fixtureKey: (v) => `${normalizeText(v.question)}#${v.attempt}`,
  temperature: 0,
  // Maior saída das fixtures ≈ 100 tokens estimados; × 1,5 fica abaixo do mínimo de 300.
  maxTokens: 300,
};
