// Estado do grafo (spec 004). Os nós devolvem estado parcial. Campos que mais de um nó escreve
// e que precisam acumular usam reducer explícito: `.default([])` sozinho vira canal LastValue.
import { z } from 'zod';
import { withLangGraph } from '@langchain/langgraph/zod';
import {
  BlockedBySchema, GuardrailVerdictSchema, RagAnswerOutputSchema, RouteSchema, StatusSchema, TraceEntrySchema,
} from '../domain/schemas.ts';
import type { TraceEntry } from '../domain/schemas.ts';

// Um helper genérico `appendList = <T>(item: z.ZodType<T>) => withLangGraph(...)` seria o natural, mas
// com T genérico o tsc 7 não resolve `InteropZodType<T[]>` nas sobrecargas de withLangGraph, então cada
// lista acumulável é declarada com o tipo concreto. O comportamento em runtime é o mesmo.
const appendStrings = () =>
  withLangGraph(z.array(z.string()), { reducer: { fn: (a: string[], b: string[]) => a.concat(b) }, default: () => [] });
const appendTrace = () =>
  withLangGraph(z.array(TraceEntrySchema), { reducer: { fn: (a: TraceEntry[], b: TraceEntry[]) => a.concat(b) }, default: () => [] });

export const AskStateSchema = z.object({
  requestId: z.string(),
  question: z.string(),
  forceRoute: z.enum(['docs', 'data']).optional(),
  guardrail: GuardrailVerdictSchema.optional(),
  route: z.object({ intent: RouteSchema, reason: z.string(), overridden: z.boolean() }).optional(),
  retrieval: z.object({
    hits: z.array(z.object({ chunkId: z.string(), score: z.number(), sanitized: z.boolean() })),
    topScore: z.number(),
    threshold: z.number(),
  }).optional(),
  draft: RagAnswerOutputSchema.optional(),
  sql: z.object({
    query: z.string(),
    originalQuery: z.string().nullable(),
    corrections: z.number().int(),
    pendingError: z.object({ kind: z.enum(['policy', 'correctable', 'runtime']), message: z.string(), rule: z.string().optional() }).nullable(),
    // Gravado pelo sqlValidate (SQL-03) e levado pelo sqlExecute para result.limitApplied; o estado não tinha outro lugar para ele.
    limitApplied: z.boolean().optional(),
    result: z.object({
      columns: z.array(z.string()),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
      truncated: z.boolean(),
      limitApplied: z.boolean(),
      noResults: z.boolean(),
    }).nullable(),
  }).optional(),
  outcome: z.object({
    status: StatusSchema,
    blockedBy: BlockedBySchema.nullable(),
    answer: z.string(),
    followUpQuestions: z.array(z.string()),
  }).optional(),
  redactedSpans: appendStrings(),   // usados pelo OutputGuard
  warnings: appendStrings(),
  trace: appendTrace(),
});

export type AskState = z.infer<typeof AskStateSchema>;
export type AskStateUpdate = Partial<AskState>;
