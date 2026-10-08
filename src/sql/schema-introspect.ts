// Introspecção do schema para o prompt SQL (SQL-01, SQL-09): o DDL vem de sqlite_master, só das tabelas
// da allowlist e sem as colunas negadas, seguido do glossário de negócio.
// Recebe um handle sem authorizer (o authorizer nega sqlite_master).
import type { DatabaseSync } from 'node:sqlite';
import { BUSINESS_GLOSSARY, DENIED_COLUMNS, SALES_ALLOWLIST } from './sales-schema.ts';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isColumnLine(line: string, column: string): boolean {
  const c = escapeRe(column);
  return new RegExp(`^\\s*(?:${c}|"${c}"|\`${c}\`|\\[${c}\\])\\s`, 'i').test(line);
}

const isClosingLine = (line: string) => /^\s*\)/.test(line);
const stripTrailingComma = (line: string) => line.replace(/,(\s*(?:--.*)?)$/, '$1');

function withoutColumns(ddl: string, columns: readonly string[]): string {
  if (columns.length === 0) return ddl;
  const kept: string[] = [];
  let removedBeforeClose = false;
  for (const line of ddl.split('\n')) {
    if (columns.some((c) => isColumnLine(line, c))) {
      removedBeforeClose = true;
      continue;
    }
    if (isClosingLine(line) && removedBeforeClose && kept.length > 0) {
      // a coluna removida era a última: a linha anterior perde a vírgula
      kept[kept.length - 1] = stripTrailingComma(kept[kept.length - 1]!);
    }
    if (line.trim() !== '') removedBeforeClose = false;
    kept.push(line);
  }
  return kept.join('\n');
}

export function describeSchema(db: DatabaseSync): string {
  const stmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`);
  const tables = SALES_ALLOWLIST.map((table) => {
    const row = stmt.get(table) as { sql: string | null } | undefined;
    if (!row?.sql) throw new Error(`Table ${table} not found in the sales database`);
    return `${withoutColumns(row.sql.trim(), DENIED_COLUMNS[table] ?? [])};`;
  });
  return `${tables.join('\n\n')}\n\n${BUSINESS_GLOSSARY}\n`;
}
