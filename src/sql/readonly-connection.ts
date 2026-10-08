// Conexão analítica somente leitura (spec 003, camadas 3 e 4): readOnly no arquivo ou snapshot desserializado,
// teto de tamanho por valor (SQL-12), PRAGMA query_only e authorizer com registro de negações.
import { DatabaseSync, constants } from 'node:sqlite';
import { DENIED_COLUMNS, SALES_ALLOWLIST } from './sales-schema.ts';
import { ALLOWED_FUNCTIONS, DANGEROUS_FUNCTIONS } from './sql-functions.ts';

export type AuthorizerDenial =
  | { kind: 'table'; table: string | null; column: string | null }
  | { kind: 'function'; name: string; dangerous: boolean }
  | { kind: 'action'; code: number };
export type ExplainResult =
  | { ok: true; plan: string[] }
  | { ok: false; message: string; denials: AuthorizerDenial[] };
export type SalesSource = { kind: 'file'; path: string } | { kind: 'snapshot'; bytes: Uint8Array };
export interface SalesConnection {
  readonly db: DatabaseSync;                                // handle com query_only e authorizer, se pedidos
  explain(sql: string): ExplainResult;                      // EXPLAIN QUERY PLAN sob o authorizer
  takeDenials(): AuthorizerDenial[];                        // devolve e limpa o registro de negações
  close(): void;
}

const ALLOWED_TABLES: ReadonlySet<string> = new Set(SALES_ALLOWLIST);

/**
 * Teto de tamanho de qualquer texto ou blob, intermediário ou final (SQLITE_LIMIT_LENGTH, SQL-12). Sem ele, funções de
 * texto permitidas multiplicam um valor: três replace() aninhados sobre 64 caracteres montam 16 MB, quatro passam de 1 GB
 * de RSS em cerca de 100 ms, e group_concat() sobre uma junção ON 1=1 devolve 75 MB, tudo antes do prazo de execução.
 * Nenhuma consulta legítima chega perto: as células saem cortadas em 200 caracteres e o maior group_concat útil (todos
 * os IDs de pedido) tem cerca de 20 KB. Acima do teto o SQLite falha com "string or blob too big" antes de alocar mais.
 */
export const SQL_MAX_VALUE_BYTES = 100_000;

/**
 * O authorizer (camada 4) só existe no node:sqlite do Node 24.10+ e `DatabaseSync.limits`, no 24.15+. Em Node mais antigo
 * o erro seria um críptico "setAuthorizer is not a function" ou "Cannot set properties of undefined"; aqui os dois viram
 * uma mensagem que diz o que fazer (o .npmrc já barra o npm ci).
 */
export function assertSqliteFeatures(db: object): void {
  if (typeof (db as { setAuthorizer?: unknown }).setAuthorizer !== 'function') {
    throw new Error(`Node 24.15 ou mais novo é necessário (DatabaseSync.setAuthorizer ausente; rodando ${process.version}).`);
  }
  const limits = (db as { limits?: unknown }).limits;
  if (typeof limits !== 'object' || limits === null) {
    throw new Error(`Node 24.15 ou mais novo é necessário (DatabaseSync.limits ausente; rodando ${process.version}).`);
  }
}

function isDeniedColumn(table: string, column: string | null): boolean {
  return column !== null && (DENIED_COLUMNS[table] ?? []).includes(column);
}

/**
 * Abre a conexão analítica. Padrão `{ queryOnly: true, authorizer: true }`; as variações existem para a
 * matriz de camadas testar cada camada sozinha. O teto de tamanho vale em todas. Ordem: abrir, `limits.length`,
 * `PRAGMA query_only = ON`, `setAuthorizer`.
 */
export function openSalesConnection(source: SalesSource, opts: { queryOnly?: boolean; authorizer?: boolean } = {}): SalesConnection {
  const queryOnly = opts.queryOnly ?? true;
  const useAuthorizer = opts.authorizer ?? true;

  let db: DatabaseSync;
  if (source.kind === 'file') {
    db = new DatabaseSync(source.path, { readOnly: true });
  } else {
    // readOnly não vale para memória: cada conexão recebe uma cópia própria do snapshot.
    db = new DatabaseSync(':memory:');
    db.deserialize(source.bytes);
  }
  assertSqliteFeatures(db);
  db.limits.length = SQL_MAX_VALUE_BYTES;
  if (queryOnly) db.exec('PRAGMA query_only = ON');

  let denials: AuthorizerDenial[] = [];
  const deny = (d: AuthorizerDenial) => {
    denials.push(d);
    return constants.SQLITE_DENY;
  };

  if (useAuthorizer) {
    db.setAuthorizer((action, arg1, arg2) => {
      switch (action) {
        case constants.SQLITE_SELECT:
          return constants.SQLITE_OK;
        case constants.SQLITE_READ: {
          // arg1 = tabela, arg2 = coluna ('' em COUNT(*))
          if (arg1 !== null && ALLOWED_TABLES.has(arg1) && !isDeniedColumn(arg1, arg2)) return constants.SQLITE_OK;
          return deny({ kind: 'table', table: arg1, column: arg2 });
        }
        case constants.SQLITE_FUNCTION: {
          const name = (arg2 ?? '').toLowerCase();
          if (ALLOWED_FUNCTIONS.has(name)) return constants.SQLITE_OK;
          return deny({ kind: 'function', name, dangerous: DANGEROUS_FUNCTIONS.has(name) });
        }
        default:
          // SQLITE_RECURSIVE e qualquer outra ação (escrita, PRAGMA, ATTACH...) são negadas.
          return deny({ kind: 'action', code: action });
      }
    });
  }

  const takeDenials = (): AuthorizerDenial[] => {
    const out = denials;
    denials = [];
    return out;
  };

  return {
    db,
    explain(sql: string): ExplainResult {
      denials = [];
      try {
        const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
        takeDenials();
        return { ok: true, plan: rows.map((r) => String(r.detail)) };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err), denials: takeDenials() };
      }
    },
    takeDenials,
    close() {
      db.close();
    },
  };
}
