// npm run demo (ENV-04): os 13 cenários de src/demo-scenarios.ts com o provedor fake, embedder hash e guardrail por regras, tudo em
// memória. Não lê .env nem o ambiente do shell (uma OPENROUTER_API_KEY exportada não muda nada) e não grava em data/.
// Usa o relógio real: o cenário 13 (caos primary-down) espera o backoff de verdade. Código 0 só com 13/13.
import { createAppContext } from '../app-context.ts';
import type { AppContext } from '../app-context.ts';
import { loadConfig } from '../config.ts';
import { DEMO_SCENARIOS } from '../demo-scenarios.ts';
import type { DemoScenario } from '../demo-scenarios.ts';
import type { AskResponse } from '../domain/schemas.ts';
import type { AskState } from '../graph/state.ts';
import type { FakeProvider } from '../llm/fake-provider.ts';
import type { LlmCallEvent } from '../obs/ledger.ts';
import { createLogger } from '../obs/logger.ts';
import { formatCost, plural } from './format.ts';

const DAY_MS = 24 * 60 * 60_000;
const OUTPUT_GUARD_REASON: Readonly<Record<string, string>> = {
  canary: 'canary', redacted_span: 'redacted passage', system_prompt_leak: 'prompt leak',
};

interface Row { scenario: DemoScenario; label: string; route: string; status: string; detail: string; ok: boolean; expected: string }

const warningValue = (r: AskResponse, prefix: string): string | undefined =>
  r.warnings.find((w) => w.startsWith(`${prefix}:`))?.slice(prefix.length + 1);

/** Coluna "detalhe" montada a partir da resposta, do estado final e do ledger, sem texto fixo por cenário. */
function detailFor(r: AskResponse, state: AskState | undefined, calls: readonly LlmCallEvent[], maxCorrections: number): string {
  const parts: string[] = [];
  if (r.status === 'blocked') {
    if (r.blockedBy === 'input_rules' || r.blockedBy === 'input_model') parts.push(`${r.blockedBy}: ${r.guardrail.reasons.join(', ')}`);
    else if (r.blockedBy === 'output_guard') {
      const reason = warningValue(r, 'output_guard') ?? '';
      parts.push(`output_guard: ${OUTPUT_GUARD_REASON[reason] ?? reason}`);
    } else if (r.blockedBy === 'sql_policy') parts.push(`sql_policy: ${warningValue(r, 'sql_policy') ?? ''}`);
    else if (r.blockedBy === 'sql_authorizer') parts.push(`sql_authorizer: ${(r.sql?.lastError ?? '').replace(/^access denied by the authorizer: /, '')}`);
  } else if (r.status === 'refused') {
    const ret = state?.retrieval;
    if (r.route === 'out_of_scope') parts.push('fixed message');
    else if (ret && r.warnings.includes('below_threshold')) parts.push(`top ${ret.topScore.toFixed(2)} < threshold ${ret.threshold.toFixed(2)}`);
    else parts.push('refusal without a valid citation');
  } else if (r.status === 'error') {
    if (r.sql) parts.push(`${r.sql.corrections}/${maxCorrections} corrections exhausted (${(r.sql.lastError ?? '').split(':')[0]})`);
    else parts.push(r.warnings.join(', ') || 'error');
  } else if (r.status === 'no_results') {
    const rows = r.sql?.rows ?? [];
    parts.push(rows.length > 0 ? 'aggregate over an empty set (row with only NULL)' : 'zero rows');
  } else if (r.route === 'docs') {
    parts.push(`${plural(r.citations.length, 'source', 'sources')} · top ${(state?.retrieval?.topScore ?? 0).toFixed(2)}`);
    const neutralized = r.warnings.filter((w) => w.startsWith('chunk_neutralized:')).length;
    if (neutralized > 0) parts.push(plural(neutralized, 'passage neutralized', 'passages neutralized'));
  } else if (r.route === 'data' && r.sql) {
    parts.push(`${plural(r.sql.rowCount, 'row', 'rows')} · ${r.followUpQuestions.length} follow-ups`);
    if (r.sql.corrections > 0) parts.push(plural(r.sql.corrections, 'correction', 'corrections'));
  }
  const retries = calls.reduce((n, c) => n + c.retries, 0);
  const fallbacks = calls.filter((c) => c.fallbackUsed).length;
  if (retries > 0 || fallbacks > 0) {
    const fallbackModels = [...new Set(calls.filter((c) => c.fallbackUsed).map((c) => c.model))];
    parts.push(`${retries} retries · ${fallbacks} fallbacks${fallbackModels.length > 0 ? ` → ${fallbackModels.join(', ')}` : ''}`);
  }
  return parts.join(' · ');
}

function labelFor(s: DemoScenario): string {
  const base = s.label.replace(/\s*\(fixture:[^)]*\)/, '');
  return s.complacentFixture ? `${base}*` : base;
}

async function runScenario(ctx: AppContext, s: DemoScenario): Promise<Row> {
  const fake = ctx.provider as FakeProvider;
  if (s.chaos) fake.setChaos(s.chaos);
  let outcome;
  try {
    outcome = await ctx.askService.ask({ question: s.question }, { includeState: true });
  } finally {
    if (s.chaos) fake.setChaos('none');
  }
  const expectedBlocked = s.expected.blockedBy ?? null;
  const expected = `${s.expected.route ?? '-'}/${s.expected.status}${expectedBlocked ? `/${expectedBlocked}` : ''}`;
  if (!outcome.ok) {
    return { scenario: s, label: labelFor(s), route: '-', status: `HTTP ${outcome.httpStatus}`, detail: outcome.body.error, ok: false, expected };
  }
  const r = outcome.response;
  const ok = r.route === s.expected.route && r.status === s.expected.status && r.blockedBy === expectedBlocked;
  const detail = detailFor(r, outcome.state, ctx.ledger.callsFor(r.requestId), ctx.config.sql.maxCorrections);
  return { scenario: s, label: labelFor(s), route: r.route ?? '-', status: r.status, detail, ok, expected };
}

export async function runDemo(opts: { write?: (s: string) => void } = {}): Promise<number> {
  const write = opts.write ?? ((s: string) => { process.stdout.write(`${s}\n`); });
  const config = loadConfig({ env: {}, overrides: { LLM_PROVIDER: 'fake', EMBEDDER: 'hash', GUARDRAIL_MODE: 'rules' } });
  const ctx = await createAppContext(config, { dataMode: 'memory', logger: createLogger({ level: 'warn' }) });
  try {
    const rows: Row[] = [];
    for (const s of DEMO_SCENARIOS) rows.push(await runScenario(ctx, s));

    write('Lunar Mill · docs-data-assistant · scripted demo');
    write(`Provider: ${ctx.provider.name} (model answers come from fixtures). Embedder: ${ctx.embedder.id}. In-memory data.`);
    write('Retrieval, threshold, SQL validation, authorizer, guardrails, retry and fallback run for real.');
    write('');
    const wLabel = Math.max('scenario'.length, ...rows.map((r) => r.label.length));
    const wRoute = Math.max('route'.length, ...rows.map((r) => r.route.length));
    const wStatus = Math.max('status'.length, ...rows.map((r) => r.status.length));
    const line = (id: string, label: string, route: string, status: string, detail: string) =>
      `${id.padStart(2)}  ${label.padEnd(wLabel)}  ${route.padEnd(wRoute)}  ${status.padEnd(wStatus)}  ${detail}`.trimEnd();
    write(line('#', 'scenario', 'route', 'status', 'detail'));
    for (const r of rows) {
      write(line(String(r.scenario.id), r.label, r.route, r.status, r.ok ? r.detail : `${r.detail}  ✗ expected ${r.expected}`));
    }
    write('');
    if (rows.some((r) => r.scenario.complacentFixture)) {
      write('* fixture: simulated compliant model. Tests the last line of defense: in 10, a real model does not even receive');
      write('  the poisoned passage, already redacted at ingestion; in 11, the SQL policy stops the write without asking for a correction.');
      write('');
    }
    const passed = rows.filter((r) => r.ok).length;
    write(`${passed}/${rows.length} scenarios with the expected outcome.`);
    const st = ctx.ledger.stats(DAY_MS);
    const ms = (v: number | null) => (v === null ? '-' : String(Math.round(v)));
    write(`/stats: ${st.requests.total} req · P50 ${ms(st.requests.latencyMs.p50)} ms · P95 ${ms(st.requests.latencyMs.p95)} ms · `
      + `${st.llm.calls} LLM calls · ${st.llm.retries} retries · ${st.llm.fallbacks} fallbacks · ${formatCost(st.llm.costUsd, st.llm.costIsFictional)}`);
    return passed === rows.length ? 0 : 1;
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runDemo();
  } catch (err) {
    console.error(`demo failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
