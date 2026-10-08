// Contratos Zod compartilhados (specs 004 e 005). Zod 4.
import { z } from 'zod';

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;
export const RouteSchema = z.enum(['docs', 'data', 'out_of_scope']);
export const StatusSchema = z.enum(['answered', 'refused', 'no_results', 'blocked', 'error']);
export const BlockedBySchema = z.enum(['input_rules', 'input_model', 'sql_policy', 'sql_authorizer', 'output_guard']);

// Borda HTTP e CLI
export const AskRequestSchema = z.strictObject({
  question: z.string().trim().min(3).max(500),
  forceRoute: z.enum(['docs', 'data']).optional(),
});

export const CitationSchema = z.object({
  chunkId: z.string(),        // ex.: "returns-and-exchanges-policy#defective-products-1"
  docTitle: z.string(),
  heading: z.string(),
  score: z.number(),
  snippet: z.string().max(240),
  sanitized: z.boolean(),     // true se o chunk teve trecho redigido
});

export const SqlResultSchema = z.object({
  query: z.string(),                       // SQL final executada (com LIMIT aplicado)
  originalQuery: z.string().nullable(),    // primeira SQL gerada, se houve correção
  corrections: z.number().int().min(0).max(3),
  limitApplied: z.boolean(),
  rowCount: z.number().int().min(0),
  truncated: z.boolean(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string().max(201), z.number(), z.null()]))).max(50),
  lastError: z.string().nullable(),
});

export const GuardrailVerdictSchema = z.object({
  verdict: z.enum(['safe', 'unsafe']),
  layer: z.enum(['rules', 'model']).nullable(),
  reasons: z.array(z.string()),            // ids de regra, ex.: "instruction_override"
});

export const TraceEntrySchema = z.object({ node: z.string(), ms: z.number(), note: z.string().optional() });

export const AskResponseSchema = z.object({
  requestId: z.string().regex(REQUEST_ID_PATTERN),
  route: RouteSchema.nullable(),           // null quando bloqueado antes do roteador
  routeReason: z.string().nullable(),
  overridden: z.boolean(),
  status: StatusSchema,
  blockedBy: BlockedBySchema.nullable(),
  answer: z.string().min(1),
  citations: z.array(CitationSchema).max(3),
  sql: SqlResultSchema.nullable(),
  followUpQuestions: z.array(z.string()).max(3),
  guardrail: GuardrailVerdictSchema,
  warnings: z.array(z.string()),
  meta: z.object({
    provider: z.enum(['fake', 'openrouter', 'scripted']),
    embedder: z.string(),                  // fingerprint do embedder
    models: z.array(z.string()),
    llmCalls: z.number().int().min(0),
    fallbackUsed: z.boolean(),
    tokens: z.object({ prompt: z.number().int(), completion: z.number().int(), estimated: z.boolean() }),
    costUsd: z.number().nullable(),
    costIsFictional: z.boolean(),
    latencyMs: z.number().min(0),
    trace: z.array(TraceEntrySchema),
  }),
});

// Saídas estruturadas do LLM (uma por prompt)
export const RouterOutputSchema = z.object({
  intent: RouteSchema,
  reason: z.string().min(3).max(200),
});
export const RagAnswerOutputSchema = z.object({
  refused: z.boolean(),
  answer: z.string().min(1).max(1200),
  citedChunkIds: z.array(z.string().max(120)).max(3),   // IDs reais têm uns 60 caracteres
});
export const SqlGenerationOutputSchema = z.object({
  sql: z.string().min(6).max(2000),
  rationale: z.string().max(300),
});
export const SqlCorrectionOutputSchema = z.object({
  correctedSql: z.string().min(6).max(2000),
  fix: z.string().max(300),
});
export const SqlAnswerOutputSchema = z.object({
  answer: z.string().min(1).max(1200),
  followUpQuestions: z.array(z.string().max(160)).min(1).max(3),
});
// safeguard devolve texto: "SAFE" ou "UNSAFE: <motivo>"

// GET /stats (OBS-01)
export const StatsSnapshotSchema = z.object({
  since: z.string(),
  requests: z.object({
    total: z.number().int(),
    byRoute: z.record(z.string(), z.number().int()),
    byStatus: z.record(z.string(), z.number().int()),
    errorRate: z.number(),                              // status error ou HTTP 5xx / total
    latencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  }),
  llm: z.object({
    calls: z.number().int(),                            // execuções lógicas de prompt
    failures: z.number().int(),
    retries: z.number().int(),
    fallbacks: z.number().int(),
    tokens: z.object({ prompt: z.number().int(), completion: z.number().int(), estimated: z.boolean() }),
    costUsd: z.number(),
    costIsFictional: z.boolean(),
  }),
});

// Corpo de erro da API (spec 005)
export const ErrorBodySchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
  issues: z.array(z.unknown()).optional(),
  suggestions: z.array(z.string()).optional(),
});

export type Route = z.infer<typeof RouteSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type BlockedBy = z.infer<typeof BlockedBySchema>;
export type AskRequest = z.infer<typeof AskRequestSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type SqlResult = z.infer<typeof SqlResultSchema>;
export type GuardrailVerdict = z.infer<typeof GuardrailVerdictSchema>;
export type TraceEntry = z.infer<typeof TraceEntrySchema>;
export type AskResponse = z.infer<typeof AskResponseSchema>;
export type RouterOutput = z.infer<typeof RouterOutputSchema>;
export type RagAnswerOutput = z.infer<typeof RagAnswerOutputSchema>;
export type SqlGenerationOutput = z.infer<typeof SqlGenerationOutputSchema>;
export type SqlCorrectionOutput = z.infer<typeof SqlCorrectionOutputSchema>;
export type SqlAnswerOutput = z.infer<typeof SqlAnswerOutputSchema>;
export type StatsSnapshot = z.infer<typeof StatsSnapshotSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
