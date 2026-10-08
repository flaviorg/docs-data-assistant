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
      description: 'Corrige uma consulta SQLite que falhou na validação ou na execução, a partir do erro devolvido pelo banco.',
    },
    role: 'Você é analista de dados da Moenda Lunar Cafés Especiais e revisa consultas SQLite de leitura que falharam.',
    context: 'A mensagem do usuário traz o DDL das tabelas permitidas, a pergunta original, a consulta que falhou, a mensagem de erro do banco e o número da tentativa de correção. '
      + 'Quando o erro é de função, a própria mensagem de erro lista as funções permitidas.',
    task: 'Escreva uma versão corrigida da consulta que responda à mesma pergunta e resolva a causa do erro, e diga em uma frase o que mudou.',
    constraints: [
      'Devolva uma única instrução começando por SELECT ou WITH, sem nenhum comando que altere dados ou o banco.',
      'Use só tabelas, colunas e funções que existem no DDL e na lista de funções permitidas; nunca invente tabela ou coluna.',
      'Nunca selecione nomes de clientes nem dados de contato; para identificar clientes, use cidade, estado ou segmento.',
      'Mantenha a intenção da pergunta original e mude só o necessário para resolver o erro.',
    ],
    output: 'Objeto JSON com correctedSql (a consulta corrigida, de 6 a 2000 caracteres) e fix (até 300 caracteres).',
  },
  allowedEchoes: [],
  buildUser: (v) => [
    `Schema do banco de vendas (SQLite):\n${v.schemaText}`,
    `Pergunta: ${v.question}`,
    `Consulta que falhou:\n${v.failedSql || '(o modelo não devolveu uma SQL válida)'}`,
    `Erro: ${v.error}`,
    `Tentativa de correção: ${v.attempt}`,
  ].join('\n\n'),
  schema: SqlCorrectionOutputSchema,
  fixtureKey: (v) => `${normalizeText(v.question)}#${v.attempt}`,
  temperature: 0,
  // Maior saída das fixtures ≈ 100 tokens estimados; × 1,5 fica abaixo do mínimo de 300.
  maxTokens: 300,
};
