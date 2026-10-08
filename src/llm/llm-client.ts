// LlmClient (spec 001): monta as mensagens do PromptDef, consome o CallBudget, aplica timeout, retry com
// backoff, fallback de modelo, parse com Zod (1 retry de parse), conta tokens, calcula custo e grava no ledger.
import { z } from 'zod';
import {
  AskAbortedError, FixtureMissingError, LlmError, LlmUnavailableError, ParseError,
} from '../domain/errors.ts';
import type { UsageLedger } from '../obs/ledger.ts';
import { renderSystem } from '../prompts/prompt.ts';
import type { PromptDef } from '../prompts/prompt.ts';
import type { CallContext } from './budget.ts';
import { costUsd } from './pricing.ts';
import type { PriceTable } from './pricing.ts';
import type { LlmProvider, ProviderRequest, ProviderResponse } from './provider.ts';

export type { CallBudget, CallContext } from './budget.ts';
export { createCallBudget } from './budget.ts';

export interface CallInfo {
  model: string; attempts: number; retries: number; fallbackUsed: boolean; parseRetried: boolean;
  latencyMs: number; promptTokens: number; completionTokens: number; estimated: boolean; costUsd: number | null;
}

export type Result<T> =
  | { success: true; data: T; call: CallInfo }
  | { success: false; error: LlmError | ParseError; call: CallInfo };

export interface LlmClient {
  generateStructured<V, T>(p: PromptDef<V, T>, vars: V, ctx: CallContext): Promise<Result<T>>;
  generateText<V>(p: PromptDef<V, null>, vars: V, ctx: CallContext): Promise<Result<string>>;
}

export interface LlmClientDeps {
  provider: LlmProvider;
  models: { primary: string; fallback: string | null; guardrail: string };
  ledger: UsageLedger;
  prices: PriceTable;
  timeoutMs: number;
  maxRetries: number;
  structuredMode: 'json_schema' | 'json_object';
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

/** Espera `ms`; rejeita com AskAbortedError se o sinal da requisição abortar antes. */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AskAbortedError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(new AskAbortedError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

type Parsed<T> = { ok: true; data: T } | { ok: false; issues: string };

const MAX_ISSUES_CHARS = 600;

/** Remove uma cerca Markdown que envolva o JSON inteiro (comum no modo json_object). */
function unfence(text: string): string {
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

function parseWith<T>(schema: z.ZodType<T>, content: string): Parsed<T> {
  let value: unknown;
  try {
    value = JSON.parse(unfence(content));
  } catch (err) {
    return { ok: false, issues: `JSON inválido (${err instanceof Error ? err.message : String(err)})` };
  }
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: z.prettifyError(r.error).slice(0, MAX_ISSUES_CHARS) };
}

interface Tally {
  model: string; attempts: number; retries: number; fallbackUsed: boolean; parseRetried: boolean;
  promptTokens: number; completionTokens: number; estimated: boolean; cost: number | null; fictional: boolean;
}

export function createLlmClient(deps: LlmClientDeps): LlmClient {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const schemaCache = new WeakMap<object, Record<string, unknown>>();

  const jsonSchemaOf = (schema: z.ZodType<unknown>): Record<string, unknown> => {
    let js = schemaCache.get(schema);
    if (!js) {
      js = z.toJSONSchema(schema) as Record<string, unknown>;
      schemaCache.set(schema, js);
    }
    return js;
  };

  const backoffMs = (attempt: number): number => Math.round(250 * 2 ** attempt * (0.8 + 0.4 * random()));

  async function transport(models: readonly string[], base: Omit<ProviderRequest, 'model'>, ctx: CallContext, t: Tally): Promise<ProviderResponse> {
    let lastKind = 'server_error';
    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      for (let attempt = 0; attempt <= deps.maxRetries; attempt++) {
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(deps.timeoutMs)]);
        t.attempts++;
        try {
          const resp = await deps.provider.chat({ ...base, model }, signal);
          t.model = model;
          t.fallbackUsed = i > 0;
          return resp;
        } catch (err) {
          if (ctx.signal.aborted) throw new AskAbortedError();
          if (err instanceof FixtureMissingError || !(err instanceof LlmError)) throw err;
          lastKind = err.kind;
          if (err.kind === 'truncated' || err.kind === 'fixture_missing') {
            t.model = model;
            t.fallbackUsed = i > 0;
            throw err;
          }
          if (err.kind === 'auth' || err.kind === 'bad_request') break;   // sem retry: próximo modelo
          if (attempt < deps.maxRetries) {
            await sleep(backoffMs(attempt), ctx.signal);
            t.retries++;
          }
        }
      }
    }
    throw new LlmUnavailableError(`todos os modelos falharam (${models.join(', ')}); último erro: ${lastKind}`, lastKind);
  }

  async function run<V, T>(p: PromptDef<V, unknown>, vars: V, ctx: CallContext, parse: (content: string) => Parsed<T>): Promise<Result<T>> {
    if (ctx.signal.aborted) throw new AskAbortedError();
    ctx.budget.consume(p.id);
    const started = now();
    const models = p.modelRole === 'guardrail'
      ? [deps.models.guardrail]
      : [deps.models.primary, ...(deps.models.fallback ? [deps.models.fallback] : [])];
    const t: Tally = {
      model: models[0]!, attempts: 0, retries: 0, fallbackUsed: false, parseRetried: false,
      promptTokens: 0, completionTokens: 0, estimated: false, cost: 0, fictional: false,
    };
    const info = (): CallInfo => ({
      model: t.model, attempts: t.attempts, retries: t.retries, fallbackUsed: t.fallbackUsed, parseRetried: t.parseRetried,
      latencyMs: now() - started, promptTokens: t.promptTokens, completionTokens: t.completionTokens,
      estimated: t.estimated, costUsd: t.cost,
    });
    const record = (ok: boolean, errorKind: string | null): CallInfo => {
      const c = info();
      deps.ledger.recordCall({
        requestId: ctx.requestId, ts: started, promptId: p.id, promptVersion: p.version, model: c.model,
        attempts: c.attempts, retries: c.retries, fallbackUsed: c.fallbackUsed, parseRetried: c.parseRetried,
        latencyMs: c.latencyMs, promptTokens: c.promptTokens, completionTokens: c.completionTokens, estimated: c.estimated,
        costUsd: c.costUsd, costIsFictional: t.fictional, ok, errorKind,
      });
      return c;
    };

    const jsonSchema = p.schema ? jsonSchemaOf(p.schema) : null;
    let system = renderSystem(p.system);
    if (jsonSchema && deps.structuredMode === 'json_object') {
      const { $schema: _drop, ...plain } = jsonSchema;
      system += `\n\nResponda só com um objeto JSON que valide este JSON Schema:\n${JSON.stringify(plain)}`;
    }
    const meta = { promptId: p.id, promptVersion: p.version, fixtureKey: p.fixtureKey(vars), requestId: ctx.requestId };

    try {
      let issues = '';
      for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
        if (parseAttempt === 1) t.parseRetried = true;
        const user = parseAttempt === 0
          ? p.buildUser(vars)
          : `${p.buildUser(vars)}\n\nSua resposta anterior não validou: ${issues}\nResponda de novo, só no formato pedido.`;
        const base: Omit<ProviderRequest, 'model'> = {
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: p.temperature,
          maxTokens: p.maxTokens,
          ...(jsonSchema ? { responseFormat: { name: p.id, jsonSchema } } : {}),
          meta,
        };
        let resp: ProviderResponse;
        try {
          resp = await transport(models, base, ctx, t);
        } catch (err) {
          if (err instanceof LlmError && err.kind === 'truncated') {
            return { success: false, error: err, call: record(false, 'truncated') };
          }
          throw err;
        }
        t.promptTokens += resp.usage.promptTokens;
        t.completionTokens += resp.usage.completionTokens;
        t.estimated ||= resp.usage.estimated;
        const cost = costUsd(deps.prices, t.model, resp.usage.promptTokens, resp.usage.completionTokens);
        t.cost = t.cost === null || cost.usd === null ? null : t.cost + cost.usd;
        t.fictional ||= cost.fictional;

        const parsed = parse(resp.content);
        if (parsed.ok) return { success: true, data: parsed.data, call: record(true, null) };
        issues = parsed.issues;
      }
      const error = new ParseError(`a saída do prompt ${p.id} não validou depois do retry de parse`, issues);
      return { success: false, error, call: record(false, 'parse') };
    } catch (err) {
      const kind = err instanceof LlmUnavailableError ? 'llm_unavailable'
        : err instanceof AskAbortedError ? 'aborted'
          : err instanceof FixtureMissingError || (err instanceof LlmError && err.kind === 'fixture_missing') ? 'fixture_missing'
            : 'internal';
      record(false, kind);
      throw err;
    }
  }

  return {
    generateStructured(p, vars, ctx) {
      const schema = p.schema;
      if (!schema) throw new Error(`o prompt ${p.id} não tem schema; use generateText`);
      return run(p, vars, ctx, (content) => parseWith(schema, content));
    },
    generateText(p, vars, ctx) {
      return run(p, vars, ctx, (content) => ({ ok: true, data: content.trim() }));
    },
  };
}
