// Validador SQL (spec 003, camadas 1, 2 e a classificação da camada 4). Ordem em validate: lexer, ponto e vírgula
// final, política estática, reescrita do LIMIT, EXPLAIN QUERY PLAN sob o authorizer e classificação das negações.
// Violação de política nunca vira correção (spec 003, decisões).
import type { AuthorizerDenial, SalesConnection } from './readonly-connection.ts';
import { ALLOWED_FUNCTIONS } from './sql-functions.ts';
import { SqlLexError, countTableRefs, stripTrailingSemicolon, tokenize } from './sql-lexer.ts';
import type { Token } from './sql-lexer.ts';

export type PolicyRule =
  | 'multiple_statements' | 'not_select' | 'forbidden_keyword' | 'recursive_cte'
  | 'comma_join' | 'cross_join' | 'too_many_tables' | 'non_literal_limit' | 'authorizer';
export type SqlValidation =
  | { ok: true; sql: string; limitApplied: boolean; plan: string[] }
  | { ok: false; kind: 'policy'; rule: PolicyRule; message: string }
  | { ok: false; kind: 'correctable'; message: string };       // sintaxe, tabela/coluna inexistente, função não permitida

export type PolicyCheck = { ok: true; sql: string } | { ok: false; rule: PolicyRule; message: string };

export interface SqlValidator {
  validate(sql: string): SqlValidation;
  /** Só a camada léxica (sem banco). Lança SqlLexError se a SQL não tokenizar. */
  checkPolicy(sql: string): PolicyCheck;
  rewriteLimit(sql: string): { sql: string; limitApplied: boolean };
}

export const MAX_TABLE_REFS = 6;

// Palavras-chave de instrução que nunca aparecem numa consulta de leitura. REPLACE ficou de fora (replace() é permitida),
// mas INTO entra: o SQLite não tem SELECT INTO, então INTO fora de string só aparece em escrita (REPLACE INTO, INSERT INTO).
const FORBIDDEN_KEYWORDS: ReadonlySet<string> = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE', 'TRIGGER',
  'INTO',
]);
// Palavras que encerram a lista de tabelas de um FROM no mesmo nível.
const FROM_LIST_END: ReadonlySet<string> = new Set([
  'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'RETURNING',
]);

const ALLOWLIST_TEXT = [...ALLOWED_FUNCTIONS].sort().join(', ');

const isWord = (t: Token | undefined, upper: string): boolean => t?.kind === 'word' && t.upper === upper;
const isPunct = (t: Token | undefined, value: string): boolean => t?.kind === 'punct' && t.value === value;
const isIntLiteral = (t: Token | undefined): t is Token => t?.kind === 'number' && /^\d+$/.test(t.value);

/** Junção por vírgula: `,` no mesmo nível de um FROM, antes da próxima cláusula ou do fim do nível. */
function hasCommaJoin(tokens: readonly Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'FROM')) continue;
    const depth = tokens[i]!.depth;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.depth < depth) break;
      if (t.depth > depth) continue;
      if (t.kind === 'word' && FROM_LIST_END.has(t.upper)) break;
      if (isPunct(t, ';')) break;
      if (isPunct(t, ',')) return true;
    }
  }
  return false;
}

/**
 * Junção sem condição: CROSS JOIN, NATURAL JOIN ou JOIN sem ON/USING antes do próximo JOIN, da próxima cláusula ou do fim
 * do nível. É o produto cartesiano que o comma_join não pega. `ON 1=1` passa por aqui; o prazo de execução no Worker
 * (query-runner.ts) é a defesa contra ele.
 */
function hasJoinWithoutCondition(tokens: readonly Token[]): boolean {
  if (tokens.some((t) => isWord(t, 'CROSS') || isWord(t, 'NATURAL'))) return true;
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'JOIN')) continue;
    const depth = tokens[i]!.depth;
    let conditioned = false;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.depth < depth) break;
      if (t.depth > depth) continue;
      if (isWord(t, 'ON') || isWord(t, 'USING')) { conditioned = true; break; }
      if (isWord(t, 'JOIN') || (t.kind === 'word' && FROM_LIST_END.has(t.upper)) || isPunct(t, ',') || isPunct(t, ';')) break;
    }
    if (!conditioned) return true;
  }
  return false;
}

/** LIMIT n, LIMIT n OFFSET m e LIMIT m, n só com inteiros literais, sem expressão em seguida. */
function hasNonLiteralLimit(tokens: readonly Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isWord(t, 'LIMIT') && !isWord(t, 'OFFSET')) continue;
    if (!isIntLiteral(tokens[i + 1])) return true;
    let next = i + 2;
    if (isWord(t, 'LIMIT') && (isPunct(tokens[next], ',') || isWord(tokens[next], 'OFFSET'))) {
      if (!isIntLiteral(tokens[next + 1])) return true;
      next += 2;
    }
    const after = tokens[next];
    // Depois da cláusula só cabe fim, `)`, `;` ou outra palavra (OFFSET, UNION...); operador ou número é expressão.
    if (after && after.kind !== 'word' && !isPunct(after, ')') && !isPunct(after, ';')) return true;
  }
  return false;
}

function policyOf(tokens: readonly Token[]): { rule: PolicyRule; message: string } | null {
  if (tokens.some((t) => isPunct(t, ';'))) {
    return { rule: 'multiple_statements', message: 'the SQL has more than one statement; send a single query' };
  }
  const first = tokens[0]!;
  if (first.kind !== 'word' || (first.upper !== 'SELECT' && first.upper !== 'WITH')) {
    return { rule: 'not_select', message: `the query must start with SELECT or WITH (it starts with "${first.value}")` };
  }
  const forbidden = tokens.find((t) => t.kind === 'word' && FORBIDDEN_KEYWORDS.has(t.upper));
  if (forbidden) return { rule: 'forbidden_keyword', message: `forbidden keyword: ${forbidden.upper}` };
  if (tokens.some((t) => isWord(t, 'RECURSIVE'))) return { rule: 'recursive_cte', message: 'a recursive CTE is not allowed' };
  if (hasCommaJoin(tokens)) return { rule: 'comma_join', message: 'a comma join in FROM is not allowed; use JOIN ... ON' };
  if (hasJoinWithoutCondition(tokens)) {
    return { rule: 'cross_join', message: 'a join without a condition (CROSS JOIN, NATURAL JOIN or JOIN without ON/USING) is not allowed; use JOIN ... ON with the join key' };
  }
  const refs = countTableRefs(tokens);
  if (refs > MAX_TABLE_REFS) {
    return { rule: 'too_many_tables', message: `the query has ${refs} table references; the maximum is ${MAX_TABLE_REFS}` };
  }
  if (hasNonLiteralLimit(tokens)) return { rule: 'non_literal_limit', message: 'LIMIT and OFFSET must be integer literals' };
  return null;
}

function describeDenial(d: AuthorizerDenial): string {
  if (d.kind === 'table') return d.column ? `column ${d.table}.${d.column}` : `table ${d.table}`;
  if (d.kind === 'function') return `risky function ${d.name}`;
  return `action ${d.code}`;
}

/**
 * Classifica as negações registradas pelo authorizer (spec 003): tabela, coluna, ação ou função de risco é política;
 * só funções fora da allowlist que não são de risco é corrigível, com a allowlist na mensagem (SQL-10).
 */
export function classifyDenials(denials: readonly AuthorizerDenial[]): { kind: 'policy' | 'correctable'; message: string } | null {
  if (denials.length === 0) return null;
  const blocking = denials.filter((d) => d.kind !== 'function' || d.dangerous);
  if (blocking.length > 0) {
    const what = [...new Set(blocking.map(describeDenial))].join(', ');
    return { kind: 'policy', message: `access denied by the authorizer: ${what}` };
  }
  const names = [...new Set(denials.map((d) => (d.kind === 'function' ? d.name : '')))];
  return { kind: 'correctable', message: `function not allowed: ${names.join(', ')}. Use only: ${ALLOWLIST_TEXT}` };
}

export function createSqlValidator(deps: { conn: SalesConnection; maxRows: number }): SqlValidator {
  const { conn, maxRows } = deps;

  function rewriteLimit(sql: string): { sql: string; limitApplied: boolean } {
    const s = stripTrailingSemicolon(sql);
    const tokens = tokenize(s);
    const last = tokens.at(-1);
    if (!last) return { sql: s, limitApplied: false };
    // Alvo: o LIMIT de profundidade 0 depois do último SELECT do nível superior (numa UNION, vale para o conjunto).
    let lastSelect = -1;
    tokens.forEach((t, i) => { if (t.depth === 0 && isWord(t, 'SELECT')) lastSelect = i; });
    const limitIdx = tokens.findIndex((t, i) => i > lastSelect && t.depth === 0 && isWord(t, 'LIMIT'));
    if (limitIdx === -1) {
      // Corta no fim do último token: um comentário de linha final engoliria o LIMIT acrescentado.
      return { sql: `${s.slice(0, last.end)} LIMIT ${maxRows}`, limitApplied: true };
    }
    const a = tokens[limitIdx + 1];
    if (!isIntLiteral(a)) return { sql: s, limitApplied: false };
    if (isPunct(tokens[limitIdx + 2], ',')) {
      const n = tokens[limitIdx + 3];
      if (!isIntLiteral(n) || Number(n.value) <= maxRows) return { sql: s, limitApplied: false };
      return { sql: `${s.slice(0, a.start)}${maxRows} OFFSET ${a.value}${s.slice(n.end)}`, limitApplied: true };
    }
    if (Number(a.value) <= maxRows) return { sql: s, limitApplied: false };
    return { sql: `${s.slice(0, a.start)}${maxRows}${s.slice(a.end)}`, limitApplied: true };
  }

  function checkPolicy(sql: string): PolicyCheck {
    const stripped = stripTrailingSemicolon(sql);
    const tokens = tokenize(stripped);
    if (tokens.length === 0) return { ok: true, sql: stripped };
    const violation = policyOf(tokens);
    return violation ? { ok: false, ...violation } : { ok: true, sql: stripped };
  }

  function validate(sql: string): SqlValidation {
    let policy: PolicyCheck;
    try {
      if (tokenize(sql).length === 0) return { ok: false, kind: 'correctable', message: 'the SQL is empty; return a SELECT query' };
      policy = checkPolicy(sql);
    } catch (err) {
      if (err instanceof SqlLexError) return { ok: false, kind: 'correctable', message: `syntax error: ${err.message}` };
      throw err;
    }
    if (!policy.ok) return { ok: false, kind: 'policy', rule: policy.rule, message: policy.message };

    const rewritten = rewriteLimit(policy.sql);
    const explained = conn.explain(rewritten.sql);
    if (explained.ok) return { ok: true, sql: rewritten.sql, limitApplied: rewritten.limitApplied, plan: explained.plan };
    const denial = classifyDenials(explained.denials);
    if (denial?.kind === 'policy') return { ok: false, kind: 'policy', rule: 'authorizer', message: denial.message };
    return { ok: false, kind: 'correctable', message: denial?.message ?? explained.message };
  }

  return { validate, checkPolicy, rewriteLimit };
}
