// Perguntas-ouro (spec 005): schema e carregador de eval/golden.v1.json.
import fs from 'node:fs';
import { z } from 'zod';
import { BlockedBySchema, RouteSchema, StatusSchema } from '../domain/schemas.ts';

export const GoldenItemSchema = z.strictObject({
  id: z.string().min(1),                       // ex.: "docs-007"
  split: z.enum(['calibration', 'test']),
  category: z.enum([
    'docs_answerable', 'docs_unanswerable', 'data', 'data_no_results', 'data_correction',
    'data_exhausted', 'out_of_scope', 'injection_direct', 'injection_indirect', 'sql_attack', 'benign_trigger',
  ]),
  question: z.string().min(3).max(500),
  expected: z.strictObject({
    route: RouteSchema.nullable(),               // null para bloqueio antes do roteador
    status: StatusSchema,
    blockedBy: BlockedBySchema.nullable().optional(),
    chunkIds: z.array(z.string().min(1)).min(1).optional(),   // docs_answerable: pelo menos um deve estar no top-k
    sql: z.string().optional(),                  // SQL de referência executada no mesmo seed
    ordered: z.boolean().optional(),             // comparar ordem das linhas
  }),
});

export type GoldenItem = z.infer<typeof GoldenItemSchema>;

const GoldenFileSchema = z.strictObject({ version: z.literal('v1'), items: z.array(GoldenItemSchema) });

export function loadGolden(file = 'eval/golden.v1.json'): GoldenItem[] {
  const parsed = GoldenFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`Invalid golden questions in ${file}: ${z.prettifyError(parsed.error)}`);
  const seen = new Set<string>();
  for (const item of parsed.data.items) {
    if (seen.has(item.id)) throw new Error(`${file}: id duplicado ${item.id}`);
    seen.add(item.id);
    if (item.category === 'docs_answerable' && !item.expected.chunkIds) {
      throw new Error(`${file}: ${item.id} is docs_answerable and needs expected.chunkIds`);
    }
  }
  return parsed.data.items;
}

/** Resolve `responseFromGolden` das fixtures (spec 001): id do item → `expected.sql`. */
export function goldenSqlResolver(items: readonly GoldenItem[]): (goldenId: string) => string | undefined {
  const byId = new Map<string, string>();
  for (const item of items) if (item.expected.sql !== undefined) byId.set(item.id, item.expected.sql);
  return (goldenId) => byId.get(goldenId);
}
