// Carrega e valida fixtures/llm/<promptId>.<version>.json (spec 001) e resolve responseFromGolden.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { normalizeText } from '../domain/normalize.ts';
import type { PromptId } from '../prompts/prompt.ts';

export interface FixtureEntry {
  promptId: PromptId;
  version: string;
  key: string;
  response: unknown;
  usage?: { promptTokens: number; completionTokens: number };
  scenario?: string;
  note?: string;
  file: string;
}

export interface FixtureIndex {
  lookup(promptId: PromptId, version: string, key: string): FixtureEntry | undefined;
  all(): FixtureEntry[];
}

const PROMPT_IDS = ['router', 'rag-answer', 'sql-generate', 'sql-correct', 'sql-answer', 'safeguard'] as const;

const EntrySchema = z.strictObject({
  key: z.string().min(1),
  response: z.unknown().optional(),
  responseFromGolden: z.string().min(1).optional(),
  usage: z.strictObject({ promptTokens: z.number().int().min(0), completionTokens: z.number().int().min(0) }).optional(),
  scenario: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

const FileSchema = z.strictObject({
  promptId: z.enum(PROMPT_IDS),
  version: z.string().regex(/^v\d+$/),
  embedder: z.string().min(1).optional(),
  entries: z.array(z.unknown()),
});

function checkKey(promptId: PromptId, key: string, where: string): void {
  if (promptId === 'sql-correct') {
    const m = /^(.*)#([1-9])$/.exec(key);
    if (!m) throw new Error(`${where}: sql-correct key "${key}" must end with #<attempt>`);
    if (normalizeText(m[1]!) !== m[1]) throw new Error(`${where}: key "${key}" is not normalized`);
    return;
  }
  if (normalizeText(key) !== key) throw new Error(`${where}: key "${key}" is not normalized (expected "${normalizeText(key)}")`);
}

export function loadFixtures(
  dir: string,
  opts: { activeEmbedderId: string; resolveGoldenSql?: (goldenId: string) => string | undefined },
): FixtureIndex {
  const byPrompt = new Map<string, Map<string, FixtureEntry>>();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  for (const name of files) {
    const file = path.join(dir, name);
    const parsed = FileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!parsed.success) throw new Error(`Invalid fixture in ${file}: ${z.prettifyError(parsed.error)}`);
    const { promptId, version, embedder, entries } = parsed.data;
    const expectedName = `${promptId}.${version}.json`;
    if (name !== expectedName) throw new Error(`${file}: the header requires the name ${expectedName}`);
    if (promptId === 'rag-answer' && embedder !== opts.activeEmbedderId) {
      throw new Error(`${file}: header embedder "${embedder ?? '(missing)'}" differs from the active embedder "${opts.activeEmbedderId}"`);
    }

    const slot = `${promptId}.${version}`;
    const map = byPrompt.get(slot) ?? new Map<string, FixtureEntry>();
    byPrompt.set(slot, map);
    entries.forEach((raw, i) => {
      const where = `${file} (entry ${i})`;
      const e = EntrySchema.safeParse(raw);
      if (!e.success) throw new Error(`${where}: ${z.prettifyError(e.error)}`);
      const hasResponse = typeof raw === 'object' && raw !== null && 'response' in raw;
      const golden = e.data.responseFromGolden;
      if (hasResponse === (golden !== undefined)) {
        throw new Error(`${where}: use exactly one of response and responseFromGolden`);
      }
      checkKey(promptId, e.data.key, where);
      if (map.has(e.data.key)) throw new Error(`${where}: chave duplicada "${e.data.key}"`);

      let response: unknown = e.data.response;
      if (golden !== undefined) {
        if (promptId !== 'sql-generate') throw new Error(`${where}: responseFromGolden is only valid in sql-generate`);
        const sql = opts.resolveGoldenSql?.(golden);
        if (sql === undefined) throw new Error(`${where}: responseFromGolden points to "${golden}", which does not exist or has no expected.sql`);
        response = { sql, rationale: 'reference query' };
      }
      map.set(e.data.key, {
        promptId, version, key: e.data.key, response, file,
        ...(e.data.usage ? { usage: e.data.usage } : {}),
        ...(e.data.scenario ? { scenario: e.data.scenario } : {}),
        ...(e.data.note ? { note: e.data.note } : {}),
      });
    });
  }

  return {
    lookup: (promptId, version, key) => byPrompt.get(`${promptId}.${version}`)?.get(key),
    all: () => [...byPrompt.values()].flatMap((m) => [...m.values()]),
  };
}
