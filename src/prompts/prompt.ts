// Prompts versionados no formato JSON de 6 blocos (meta, role, context, task, constraints, output).
import type { z } from 'zod';

export type PromptId = 'router' | 'rag-answer' | 'sql-generate' | 'sql-correct' | 'sql-answer' | 'safeguard';

export interface JsonPrompt {
  meta: { id: PromptId; version: 'v1'; description: string };
  role: string;
  context: string;
  task: string;
  constraints: string[];
  output: string;
}

export interface PromptDef<Vars, Out> {
  id: PromptId;
  version: 'v1';
  system: JsonPrompt;                 // os 6 blocos, serializados como mensagem de sistema
  allowedEchoes: readonly string[];   // frases que o prompt manda emitir; a guarda de saída as desconta
  buildUser(vars: Vars): string;
  schema: z.ZodType<Out> | null;      // null: o prompt devolve texto (safeguard)
  fixtureKey(vars: Vars): string;     // chave normalizada usada pelo fake
  temperature: number;                // 0 a 0,2
  maxTokens: number;
  modelRole?: 'main' | 'guardrail';   // guardrail: usa só o GUARDRAIL_MODEL, sem fallback
}

/** JSON indentado com as chaves sempre na ordem meta, role, context, task, constraints, output. */
export function renderSystem(p: JsonPrompt): string {
  const ordered = { meta: p.meta, role: p.role, context: p.context, task: p.task, constraints: p.constraints, output: p.output };
  return JSON.stringify(ordered, null, 2);
}

/** Texto que a guarda de saída protege contra vazamento: role, context, task e constraints, nunca output. */
export function protectedText(p: JsonPrompt): string {
  return [p.role, p.context, p.task, ...p.constraints].join('\n');
}

const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === '';

/** Lança se algum bloco estiver vazio, se a versão não for v1 ou se o id do PromptDef divergir do meta. */
export function assertPromptShape(def: PromptDef<unknown, unknown>): void {
  const p = def.system;
  const where = `prompt ${def.id}`;
  if (def.version !== 'v1' || p.meta.version !== 'v1') throw new Error(`${where}: meta.version must be v1`);
  if (p.meta.id !== def.id) throw new Error(`${where}: meta.id (${p.meta.id}) differs from the PromptDef id`);
  if (blank(p.meta.description)) throw new Error(`${where}: empty meta.description block`);
  for (const block of ['role', 'context', 'task', 'output'] as const) {
    if (blank(p[block])) throw new Error(`${where}: empty ${block} block`);
  }
  if (!Array.isArray(p.constraints) || p.constraints.length === 0 || p.constraints.some(blank)) {
    throw new Error(`${where}: constraints block empty or with an empty item`);
  }
}
