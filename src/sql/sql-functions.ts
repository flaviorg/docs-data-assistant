// Funções SQL que o authorizer permite (allowlist) e as que ele nega como risco (spec 003). Nomes em minúsculas.

export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // agregação
  'count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat', 'string_agg',
  // janela
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead',
  'first_value', 'last_value', 'nth_value',
  // texto
  'lower', 'upper', 'substr', 'substring', 'length', 'trim', 'ltrim', 'rtrim', 'replace', 'instr',
  'like', 'glob', 'hex', 'char', 'unicode', 'concat', 'concat_ws',
  // números e nulos
  'abs', 'round', 'coalesce', 'ifnull', 'nullif', 'iif', 'typeof',
  // datas
  'date', 'time', 'datetime', 'julianday', 'strftime', 'unixepoch',
]);

// printf e format: um especificador de largura alocava centenas de MB numa chamada. O teto por valor da conexão
// (SQL_MAX_VALUE_BYTES, SQL-12) segura isso e também replace() aninhado e group_concat(); as duas continuam fora porque
// formatar números é trabalho do sqlAnswer.
export const DANGEROUS_FUNCTIONS: ReadonlySet<string> = new Set([
  'load_extension', 'printf', 'format', 'zeroblob', 'randomblob', 'fts3_tokenizer',
]);
