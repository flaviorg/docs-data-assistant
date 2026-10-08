// Lexer SQL (spec 003, camada 1): entende 'strings', "identificadores", `identificadores`, [identificadores]
// e comentários -- e /* */, para que a política estática nunca confunda conteúdo de string com instrução.

export interface Token {
  kind: 'word' | 'number' | 'string' | 'quoted_ident' | 'punct' | 'op';
  value: string;   // texto exato do token no SQL original
  upper: string;   // value em maiúsculas (útil para palavras-chave)
  depth: number;   // profundidade de parênteses; o próprio parêntese fica na profundidade de fora
  start: number;   // índice no SQL original
  end: number;     // índice logo depois do token
}

export class SqlLexError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'SqlLexError';
    this.position = position;
  }
}

// Operadores de dois ou três caracteres primeiro, para casar o mais longo.
const OPERATORS = ['->>', '||', '<=', '>=', '<>', '!=', '==', '<<', '>>', '->', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '~', '?'];
const PUNCT = new Set(['(', ')', ',', ';', '.']);

const isSpace = (c: string): boolean => /\s/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isWordStart = (c: string): boolean => /[\p{L}_$:@]/u.test(c);
const isWordPart = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_$]/u.test(c);

/** Lê até o fechamento `close`; um `close` dobrado (`''`, `""`, ` `` `) é escape quando `doubled` é true. */
function readQuoted(sql: string, start: number, close: string, doubled: boolean, what: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (doubled && sql[i + 1] === close) { i += 2; continue; }
      return i + 1;
    }
    i++;
  }
  throw new SqlLexError(`unterminated ${what} (position ${start})`, start);
}

function readNumber(sql: string, start: number): number {
  let i = start;
  if (sql[i] === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
    i += 2;
    while (i < sql.length && /[0-9a-fA-F]/.test(sql[i]!)) i++;
    return i;
  }
  while (isDigit(sql[i])) i++;
  if (sql[i] === '.') { i++; while (isDigit(sql[i])) i++; }
  if ((sql[i] === 'e' || sql[i] === 'E') && (isDigit(sql[i + 1]) || ((sql[i + 1] === '+' || sql[i + 1] === '-') && isDigit(sql[i + 2])))) {
    i += 2;
    while (isDigit(sql[i])) i++;
  }
  return i;
}

/** Tokeniza o SQL descartando espaços e comentários. Lança SqlLexError em string, identificador ou comentário sem fim. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  const push = (kind: Token['kind'], start: number, end: number, tokenDepth = depth): void => {
    const value = sql.slice(start, end);
    tokens.push({ kind, value, upper: value.toUpperCase(), depth: tokenDepth, start, end });
  };

  while (i < sql.length) {
    const c = sql[i]!;
    if (isSpace(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) throw new SqlLexError(`unterminated /* comment (position ${i})`, i);
      i = close + 2;
      continue;
    }
    if (c === "'") { const end = readQuoted(sql, i, "'", true, 'string'); push('string', i, end); i = end; continue; }
    if (c === '"') { const end = readQuoted(sql, i, '"', true, 'identificador entre aspas'); push('quoted_ident', i, end); i = end; continue; }
    if (c === '`') { const end = readQuoted(sql, i, '`', true, 'identificador entre crases'); push('quoted_ident', i, end); i = end; continue; }
    if (c === '[') { const end = readQuoted(sql, i, ']', false, 'identificador entre colchetes'); push('quoted_ident', i, end); i = end; continue; }
    if (isDigit(c) || (c === '.' && isDigit(sql[i + 1]))) { const end = readNumber(sql, i); push('number', i, end); i = end; continue; }
    if (c === '(') { push('punct', i, i + 1); depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); push('punct', i, i + 1); i++; continue; }
    if (PUNCT.has(c)) { push('punct', i, i + 1); i++; continue; }
    if (isWordStart(c)) {
      let end = i + 1;
      while (isWordPart(sql[end])) end++;
      push('word', i, end);
      i = end;
      continue;
    }
    const op = OPERATORS.find((o) => sql.startsWith(o, i));
    if (op) { push('op', i, i + op.length); i += op.length; continue; }
    // Caractere que o SQLite não reconhece: vira operador de um caractere e o EXPLAIN reclama da sintaxe.
    push('op', i, i + 1);
    i++;
  }
  return tokens;
}

/** Remove um único `;` final seguido só de espaço ou comentário. SQL que não tokeniza volta sem mudança. */
export function stripTrailingSemicolon(sql: string): string {
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch {
    return sql;
  }
  const last = tokens.at(-1);
  if (!last || last.kind !== 'punct' || last.value !== ';') return sql;
  return sql.slice(0, last.start).trimEnd();
}

/** Remove uma cerca Markdown (```` ``` ```` ou ```` ```sql ````) que envolva o texto inteiro; senão devolve `text.trim()`. */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const block = /^```[ \t]*[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```$/.exec(t);
  if (block) return block[1]!.trim();
  const inline = /^```([^`][\s\S]*?)```$/.exec(t);
  if (inline) return inline[1]!.replace(/^sql\s+/i, '').trim();
  return t;
}

/**
 * Referências a tabela: palavra ou identificador entre aspas logo depois de FROM ou JOIN, em qualquer profundidade.
 * `(` depois de FROM/JOIN não conta: a subconsulta conta pelo próprio FROM.
 */
export function countTableRefs(tokens: readonly Token[]): number {
  let n = 0;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'word' || (t.upper !== 'FROM' && t.upper !== 'JOIN')) continue;
    const next = tokens[i + 1]!;
    if (next.kind === 'word' || next.kind === 'quoted_ident') n++;
  }
  return n;
}
