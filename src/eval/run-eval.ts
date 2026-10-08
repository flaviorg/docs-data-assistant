// npm run eval -- [--live] [--guardrail rules|rules+model] [--split test|all] [--out <arquivo.md>]
// Eval gate (EVL-01, EVL-02, spec 005): roda cada pergunta-ouro pelo AskService (modo memory) e mede as 7 métricas
// contra o perfil ativo. Sem --live, perfil FAKE: não lê .env nem o ambiente (provedor fake, embedder hash). Com --live,
// lê a configuração do ambiente e exige OPENROUTER_API_KEY. Itens do split calibration só passam pela recuperação.
// Códigos: 0 todas as métricas no limiar; 1 alguma abaixo; 2 erro de execução (configuração, argumentos, exceção).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createAppContext } from '../app-context.ts';
import type { AppContext } from '../app-context.ts';
import { loadConfig } from '../config.ts';
import { normalizeText } from '../domain/normalize.ts';
import { CANARY } from '../guardrails/output-guard.ts';
import type { AskState } from '../graph/state.ts';
import { createLogger } from '../obs/logger.ts';
import type { Logger } from '../obs/logger.ts';
import { executeReadOnly } from '../sql/executor.ts';
import { createSqlValidator } from '../sql/validator.ts';
import { loadGolden } from './golden.ts';
import type { GoldenItem } from './golden.ts';
import { computeMetrics, loadThresholds } from './metrics.ts';
import type { EvalItemResult, MetricResult, Profile, Thresholds } from './metrics.ts';
import { renderReport } from './report.ts';

export interface RunEvalOptions {
  live: boolean;
  guardrail?: 'rules' | 'rules+model';
  split: 'test' | 'all';
  thresholdsOverride?: Partial<Thresholds['fake']>;
  outPath?: string;            // só aparece no texto do relatório; quem grava o arquivo é a CLI
  logger?: Logger;
  goldenFile?: string;
}

export interface RunEvalResult {
  metrics: MetricResult[];
  exitCode: 0 | 1;
  text: string;
  markdown: string;
  results: EvalItemResult[];
}

const DOCS_CATEGORIES: ReadonlySet<GoldenItem['category']> = new Set(['docs_answerable', 'docs_unanswerable']);

/** Recuperação direta (embedder + store), igual à do nó retrieve: usada nos itens docs que não passaram pelo grafo. */
async function directRetrieval(ctx: AppContext, question: string): Promise<{ ids: string[]; topScore: number; decision: 'refuse' | 'pass' }> {
  const [vector] = await ctx.embedder.embed([question]);
  const hits = ctx.store.search(vector!, ctx.config.rag.topK);
  const topScore = hits[0]?.score ?? 0;
  return { ids: hits.map((h) => h.chunk.id), topScore, decision: hits.length === 0 || topScore < ctx.config.rag.minScore ? 'refuse' : 'pass' };
}

/** IDs citados antes do checkCitations: os que ficaram no draft mais os descartados (aviso citation_dropped:<id>). */
function citedBeforeFilter(state: AskState): string[] {
  if (!state.draft) return [];
  const dropped = state.warnings.filter((w) => w.startsWith('citation_dropped:')).map((w) => w.slice('citation_dropped:'.length));
  return [...state.draft.citedChunkIds, ...dropped];
}

async function evaluateItem(ctx: AppContext, item: GoldenItem, referenceRows: unknown[][] | null): Promise<EvalItemResult> {
  const base: EvalItemResult = {
    item, response: null, error: null, state: null, retrievedIds: [], topScore: null, thresholdDecision: null,
    citedBeforeFilter: [], contextHadPoison: false, poisonLeakedToContext: false, referenceRows, actualRows: null,
  };
  if (item.split === 'calibration') {
    const d = await directRetrieval(ctx, item.question);
    return { ...base, retrievedIds: d.ids, topScore: d.topScore, thresholdDecision: d.decision };
  }

  const outcome = await ctx.askService.ask({ question: item.question }, { includeState: true });
  if (!outcome.ok) {
    const d = DOCS_CATEGORIES.has(item.category) ? await directRetrieval(ctx, item.question) : null;
    return {
      ...base, error: { httpStatus: outcome.httpStatus, error: outcome.body.error },
      ...(d ? { retrievedIds: d.ids, topScore: d.topScore, thresholdDecision: d.decision } : {}),
    };
  }
  const state = outcome.state ?? null;
  let retrievedIds: string[] = [];
  let topScore: number | null = null;
  let thresholdDecision: EvalItemResult['thresholdDecision'] = null;
  if (state?.retrieval) {
    retrievedIds = state.retrieval.hits.map((h) => h.chunkId);
    topScore = state.retrieval.topScore;
    thresholdDecision = state.retrieval.hits.length === 0 || topScore < state.retrieval.threshold ? 'refuse' : 'pass';
  } else if (DOCS_CATEGORIES.has(item.category)) {
    const d = await directRetrieval(ctx, item.question);
    retrievedIds = d.ids; topScore = d.topScore; thresholdDecision = d.decision;
  }

  // O contexto só chega ao modelo quando o nó ragAnswer roda; os chunks dele são os recuperados.
  const sentToModel = state?.trace.some((t) => t.node === 'ragAnswer') ?? false;
  const contextChunks = sentToModel ? (state?.retrieval?.hits ?? []).map((h) => ctx.getChunk(h.chunkId)).filter((c) => c !== undefined) : [];
  return {
    ...base,
    response: outcome.response,
    state,
    retrievedIds,
    topScore,
    thresholdDecision,
    citedBeforeFilter: state ? citedBeforeFilter(state) : [],
    contextHadPoison: contextChunks.some((c) => c.flagged),
    poisonLeakedToContext: contextChunks.some((c) => c.text.includes(CANARY) || c.redactedSpans.some((span) => c.text.includes(span))),
    actualRows: state?.sql?.result?.rows ?? null,
  };
}

/** Itens cuja fixture (de qualquer prompt) encena um modelo que cedeu: explica, por exemplo, o docs-003 bloqueado no fake. */
function complacentItems(ctx: AppContext, items: readonly GoldenItem[]): string[] {
  if (!ctx.fixtures) return [];
  const keys = new Set(ctx.fixtures.all().filter((e) => e.note?.includes('simulated compliant model')).map((e) => e.key.replace(/#\d$/, '')));
  return items.filter((i) => keys.has(normalizeText(i.question))).map((i) => i.id);
}

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const profile: Profile = opts.live ? 'live' : 'fake';
  const config = opts.live
    ? loadConfig({ overrides: { LLM_PROVIDER: 'openrouter', ...(opts.guardrail ? { GUARDRAIL_MODE: opts.guardrail } : {}) } })
    : loadConfig({ env: {}, overrides: { LLM_PROVIDER: 'fake', EMBEDDER: 'hash', GUARDRAIL_MODE: opts.guardrail ?? 'rules' } });
  const base = loadThresholds();
  const thresholds: Thresholds = { ...base, [profile]: { ...base[profile], ...opts.thresholdsOverride } };
  const items = loadGolden(opts.goldenFile).filter((i) => opts.split === 'all' || i.split === 'test');

  const ctx = await createAppContext(config, { dataMode: 'memory', logger: opts.logger ?? createLogger({ level: 'warn' }) });
  try {
    const validator = createSqlValidator({ conn: ctx.sales, maxRows: config.sql.maxRows });
    const reference = (item: GoldenItem): unknown[][] | null => {
      if (item.expected.sql === undefined) return null;
      const v = validator.validate(item.expected.sql);
      if (!v.ok) throw new Error(`${item.id}: the reference SQL does not pass the validator (${v.message})`);
      return executeReadOnly(ctx.sales, v.sql, config.sql.maxRows).rows;
    };
    const results: EvalItemResult[] = [];
    for (const item of items) results.push(await evaluateItem(ctx, item, reference(item)));

    const metrics = computeMetrics(results, profile, thresholds);
    const exitCode: 0 | 1 = metrics.every((m) => m.pass) ? 0 : 1;
    const models = [ctx.models.primary, ctx.models.fallback, ...(config.guardrailMode === 'rules+model' ? [ctx.models.guardrail] : [])];
    const { text, markdown } = renderReport({
      profile, provider: ctx.provider.name, embedder: ctx.embedder.fingerprint, guardrail: config.guardrailMode, models,
      split: opts.split, items: items.length, date: new Date().toISOString().slice(0, 10), metrics, exitCode,
      ...(opts.outPath ? { outPath: opts.outPath } : {}),
      complacent: complacentItems(ctx, items),
      errors: results.flatMap((r) => (r.error ? [{ id: r.item.id, httpStatus: r.error.httpStatus, error: r.error.error }] : [])),
    });
    return { metrics, exitCode, text, markdown, results };
  } finally {
    ctx.close();
  }
}

const USAGE = 'usage: npm run eval -- [--live] [--guardrail rules|rules+model] [--split test|all] [--out <file.md>]';

export async function main(argv: string[]): Promise<number> {
  let values: { live?: boolean; guardrail?: string; split?: string; out?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        live: { type: 'boolean', default: false }, guardrail: { type: 'string' }, split: { type: 'string', default: 'test' },
        out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  if (values.help) { console.log(USAGE); return 0; }
  if (values.guardrail !== undefined && values.guardrail !== 'rules' && values.guardrail !== 'rules+model') {
    console.error(`--guardrail accepts rules or rules+model (received: ${values.guardrail})\n${USAGE}`);
    return 2;
  }
  if (values.split !== 'test' && values.split !== 'all') {
    console.error(`--split accepts test or all (received: ${values.split})\n${USAGE}`);
    return 2;
  }
  const profile = values.live ? 'live' : 'fake';
  const outPath = values.out ?? path.join('eval', 'reports', `${profile}-${new Date().toISOString().slice(0, 10)}.md`);
  try {
    const r = await runEval({
      live: values.live ?? false, split: values.split, outPath,
      ...(values.guardrail ? { guardrail: values.guardrail as 'rules' | 'rules+model' } : {}),
    });
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, r.markdown);
    console.log(r.text);
    return r.exitCode;
  } catch (err) {
    console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
