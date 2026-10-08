// Tabela de preços por modelo (USD por 1M tokens) e cálculo do custo estimado de uma chamada.
import fs from 'node:fs';
import { z } from 'zod';

export interface PriceTable {
  updatedAt: string;
  models: Record<string, { prompt: number; completion: number; fictional?: boolean }>;
}

const PriceTableSchema = z.strictObject({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'updatedAt precisa estar em YYYY-MM-DD'),
  models: z.record(z.string().min(1), z.strictObject({
    prompt: z.number().min(0),
    completion: z.number().min(0),
    fictional: z.boolean().optional(),
  })),
});

export function loadPrices(file = 'config/model-prices.json'): PriceTable {
  const parsed = PriceTableSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid price table in ${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Custo em USD. Modelo fora da tabela devolve `usd: null` (o chamador avisa); modelos fake são fictícios. */
export function costUsd(t: PriceTable, model: string, promptTokens: number, completionTokens: number): { usd: number | null; fictional: boolean } {
  const price = t.models[model];
  if (!price) return { usd: null, fictional: false };
  const usd = (promptTokens / 1_000_000) * price.prompt + (completionTokens / 1_000_000) * price.completion;
  return { usd, fictional: price.fictional === true };
}
