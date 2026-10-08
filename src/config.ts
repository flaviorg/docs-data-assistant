import { z } from 'zod';
import { ConfigError } from './domain/errors.ts';

// Todas as chaves de .env.example (ENV-01, spec 005), na mesma ordem.
export const ENV_KEYS = [
  'LLM_PROVIDER',
  'OPENROUTER_API_KEY',
  'LLM_BASE_URL',
  'OPENROUTER_MODEL',
  'OPENROUTER_MODEL_FALLBACK',
  'GUARDRAIL_MODEL',
  'LLM_STRUCTURED_MODE',
  'LLM_TIMEOUT_MS',
  'LLM_MAX_RETRIES',
  'LLM_MAX_CALLS_PER_REQUEST',
  'LLM_TEMPERATURE',
  'LLM_FAKE_CHAOS',
  'EMBEDDER',
  'RAG_TOP_K',
  'RAG_MIN_SCORE',
  'RAG_CHUNK_SIZE',
  'RAG_CHUNK_OVERLAP',
  'SQL_MAX_CORRECTIONS',
  'SQL_MAX_ROWS',
  'SQL_ROWS_TO_LLM',
  'SQL_TIMEOUT_MS',
  'GUARDRAIL_MODE',
  'APP_DB_PATH',
  'SALES_DB_PATH',
  'HOST',
  'PORT',
  'ASK_TIMEOUT_MS',
  'LOG_LEVEL',
] as const satisfies readonly string[];

type EnvKey = (typeof ENV_KEYS)[number];

// Limiar de recusa por embedder, escolhido com `npm run calibrate` só no split calibration (spec 002 e EVL-03).
// Mudança de chunker, embedder ou base exige recalibrar.
export const MIN_SCORE_DEFAULTS: Readonly<Record<'hash-v1', number>> = {
  // recalibrado em 2026-10-08, depois da tradução da base e das perguntas para o inglês, com 12 itens do split
  // calibration (7 respondíveis, 5 não); separação 0,157, acurácia 1,000 só em 0,22 (era 0,18 em português; ver
  // docs/incidents/2026-10-08-translation-to-english.md e docs/incidents/2026-10-04-hash-v1-calibration.md)
  'hash-v1': 0.22,
};

export type ChaosMode = 'none' | 'primary-timeout-once' | 'primary-down' | 'all-down';

export interface AppConfig {
  llm: {
    provider: 'fake' | 'openrouter';
    apiKey: string | null;
    baseUrl: string;
    model: string;
    fallbackModel: string;
    guardrailModel: string;
    structuredMode: 'json_schema' | 'json_object';
    timeoutMs: number;
    maxRetries: number;
    maxCallsPerRequest: number;
    temperature: number;
    fakeChaos: ChaosMode;
  };
  rag: { embedder: 'hash'; topK: number; minScore: number; chunkSize: number; chunkOverlap: number };
  sql: { maxCorrections: number; maxRows: number; rowsToLlm: number; timeoutMs: number };
  guardrailMode: 'rules' | 'rules+model' | 'off';
  paths: { appDb: string; salesDb: string };
  server: { host: string; port: number };
  askTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const int = (min: number, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max);

const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(['fake', 'openrouter']).optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().default('openai/gpt-oss-120b'),
  OPENROUTER_MODEL_FALLBACK: z.string().default('google/gemini-2.5-flash'),
  GUARDRAIL_MODEL: z.string().default('openai/gpt-oss-safeguard-20b'),
  LLM_STRUCTURED_MODE: z.enum(['json_schema', 'json_object']).default('json_schema'),
  LLM_TIMEOUT_MS: int(1).default(20000),
  LLM_MAX_RETRIES: int(0, 10).default(2),
  LLM_MAX_CALLS_PER_REQUEST: int(1, 100).default(8),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_FAKE_CHAOS: z.enum(['none', 'primary-timeout-once', 'primary-down', 'all-down']).default('none'),
  EMBEDDER: z.enum(['hash']).default('hash'),
  RAG_TOP_K: int(1, 20).default(3),
  RAG_MIN_SCORE: z.coerce.number().min(-1).max(1).optional(),
  RAG_CHUNK_SIZE: int(100, 10000).default(600),
  RAG_CHUNK_OVERLAP: int(0, 10000).default(100),
  SQL_MAX_CORRECTIONS: int(0, 3).default(3),
  SQL_MAX_ROWS: int(1, 10000).default(200),
  SQL_ROWS_TO_LLM: int(1, 200).default(50),
  SQL_TIMEOUT_MS: int(1).default(5000),
  GUARDRAIL_MODE: z.enum(['rules', 'rules+model', 'off']).optional(),
  APP_DB_PATH: z.string().default('data/app.db'),
  SALES_DB_PATH: z.string().default('data/sales.db'),
  HOST: z.string().default('127.0.0.1'),
  PORT: int(0, 65535).default(3000),
  ASK_TIMEOUT_MS: int(1).default(60000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Lê a configuração do ambiente (padrão `process.env`) e falha cedo com `ConfigError` nomeando a variável.
 * String vazia conta como ausente; `overrides` vencem `env`.
 * A regra "`rules+model` exige provider que não seja fake" vive em `createAppContext`.
 */
export function loadConfig(opts: {
  env?: Record<string, string | undefined>;
  overrides?: Partial<Record<string, string>>;
} = {}): AppConfig {
  const env = opts.env ?? process.env;
  const raw: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const value = present(opts.overrides?.[key]) ?? present(env[key]);
    if (value !== undefined) raw[key] = value;
  }

  if (raw.EMBEDDER !== undefined && raw.EMBEDDER.toLowerCase() === 'minilm') {
    throw new ConfigError('EMBEDDER=minilm only arrives with the optional milestone M9; in v1 use EMBEDDER=hash', 'EMBEDDER');
  }

  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const variable = String(issue?.path[0] ?? 'desconhecida');
    throw new ConfigError(`Invalid environment variable ${variable}: ${issue?.message ?? 'invalid value'}`, variable);
  }
  const e = parsed.data;

  const apiKey = e.OPENROUTER_API_KEY ?? null;
  const provider = e.LLM_PROVIDER ?? (apiKey ? 'openrouter' : 'fake');
  if (provider === 'openrouter' && !apiKey) {
    throw new ConfigError('OPENROUTER_API_KEY missing: it is required with LLM_PROVIDER=openrouter', 'OPENROUTER_API_KEY');
  }
  if (e.RAG_CHUNK_OVERLAP >= e.RAG_CHUNK_SIZE) {
    throw new ConfigError('RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE', 'RAG_CHUNK_OVERLAP');
  }

  return {
    llm: {
      provider,
      apiKey,
      baseUrl: e.LLM_BASE_URL,
      model: e.OPENROUTER_MODEL,
      fallbackModel: e.OPENROUTER_MODEL_FALLBACK,
      guardrailModel: e.GUARDRAIL_MODEL,
      structuredMode: e.LLM_STRUCTURED_MODE,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxRetries: e.LLM_MAX_RETRIES,
      maxCallsPerRequest: e.LLM_MAX_CALLS_PER_REQUEST,
      temperature: e.LLM_TEMPERATURE,
      fakeChaos: e.LLM_FAKE_CHAOS,
    },
    rag: {
      embedder: e.EMBEDDER,
      topK: e.RAG_TOP_K,
      minScore: e.RAG_MIN_SCORE ?? MIN_SCORE_DEFAULTS['hash-v1'],
      chunkSize: e.RAG_CHUNK_SIZE,
      chunkOverlap: e.RAG_CHUNK_OVERLAP,
    },
    sql: { maxCorrections: e.SQL_MAX_CORRECTIONS, maxRows: e.SQL_MAX_ROWS, rowsToLlm: e.SQL_ROWS_TO_LLM, timeoutMs: e.SQL_TIMEOUT_MS },
    guardrailMode: e.GUARDRAIL_MODE ?? (provider === 'fake' ? 'rules' : 'rules+model'),
    paths: { appDb: e.APP_DB_PATH, salesDb: e.SALES_DB_PATH },
    server: { host: e.HOST, port: e.PORT },
    askTimeoutMs: e.ASK_TIMEOUT_MS,
    logLevel: e.LOG_LEVEL,
  };
}
