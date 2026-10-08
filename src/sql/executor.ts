// Executor somente leitura (spec 003, camada 5; SQL-06): iterate() com corte em maxRows + 1, células de texto
// cortadas em 200 caracteres e detecção de "sem resultados" (zero linhas ou só células NULL). A SQL gerada pelo modelo
// chega aqui pelo processo filho de query-runner.ts, nunca na thread principal. O corte em maxRows é defesa em
// profundidade: a SQL validada já traz LIMIT <= SQL_MAX_ROWS, então truncated só fica true para SQL que não passou
// pelo validador (a de referência do eval, por exemplo).
import { SqlRuntimeError } from '../domain/errors.ts';
import type { SalesConnection } from './readonly-connection.ts';

export const CELL_MAX_CHARS = 200;

export type Cell = string | number | null;
export interface QueryResult { columns: string[]; rows: Cell[][]; truncated: boolean; noResults: boolean }

export function isNoResults(rows: readonly (readonly Cell[])[]): boolean {
  return rows.length === 0 || rows.every((row) => row.every((cell) => cell === null));
}

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  const text = value instanceof Uint8Array ? `<blob of ${value.byteLength} bytes>` : String(value);
  return text.length > CELL_MAX_CHARS ? `${text.slice(0, CELL_MAX_CHARS)}…` : text;
}

/** Executa sob o authorizer. Erro de compilação ou execução vira SqlRuntimeError com as negações registradas. */
export function executeReadOnly(conn: SalesConnection, sql: string, maxRows: number): QueryResult {
  conn.takeDenials();   // descarta negações de uma execução anterior
  try {
    const stmt = conn.db.prepare(sql);
    stmt.setReturnArrays(true);
    const columns = stmt.columns().map((c) => c.name);
    const rows: Cell[][] = [];
    let truncated = false;
    for (const raw of stmt.iterate()) {
      if (rows.length === maxRows) { truncated = true; break; }   // a linha maxRows + 1 só prova o truncamento
      rows.push((raw as unknown as unknown[]).map(toCell));
    }
    conn.takeDenials();
    return { columns, rows, truncated, noResults: isNoResults(rows) };
  } catch (err) {
    const denials = conn.takeDenials();
    throw new SqlRuntimeError(err instanceof Error ? err.message : String(err), denials);
  }
}
