// Logger JSON de uma linha em stderr (spec 001). Chaves `sk-or-...` e tokens `Bearer ...` saem mascarados.
import type { AppConfig } from '../config.ts';

type Level = AppConfig['logLevel'];
type Fields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

const LEVELS: Readonly<Record<Level, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export function maskSecrets(text: string): string {
  return text
    .replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***');
}

/** Corta em `max` caracteres contando a reticência final. */
export function truncateForLog(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function serializable(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(opts: { level: Level; sink?: (line: string) => void }): Logger {
  const min = LEVELS[opts.level];
  const sink = opts.sink ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const write = (level: Level, event: string, fields: Fields = {}): void => {
    if (LEVELS[level] < min) return;
    const record: Fields = { ts: new Date().toISOString(), level, event };
    for (const [k, v] of Object.entries(fields)) if (!(k in record)) record[k] = serializable(v);
    sink(maskSecrets(JSON.stringify(record)));
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
