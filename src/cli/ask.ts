// npm run ask -- [--json] [--route docs|data] "<pergunta>"
// Faz uma pergunta pelo mesmo AskService da API, no modo file (data/sales.db e data/app.db, criados se faltarem).
// Saída legível e códigos de saída (spec 005): 0 qualquer desfecho do grafo, 2 fixture_missing,
// 3 llm_unavailable, 4 timeout, 1 inesperado ou argumentos inválidos.
import { parseArgs } from 'node:util';
import { createAppContext } from '../app-context.ts';
import type { AppContext } from '../app-context.ts';
import { loadConfig } from '../config.ts';
import type { AskResponse, ErrorBody } from '../domain/schemas.ts';
import { createLogger } from '../obs/logger.ts';
import { formatCost, formatInt, plural, profileTag, table, wrap } from './format.ts';

const USAGE = 'usage: npm run ask -- [--json] [--route docs|data] "<question>"';
const TABLE_ROWS = 20;

export function exitCodeFor(httpStatus: number): number {
  switch (httpStatus) {
    case 200: return 0;
    case 422: return 2;
    case 503: return 3;
    case 504: return 4;
    default: return 1;
  }
}

/** Resposta legível: cabeçalho, resposta, fontes ou SQL, perguntas para continuar e a linha de meta. */
export function formatResponse(r: AskResponse): string {
  const out: string[] = [];
  const reason = r.routeReason ? ` (${r.routeReason.replace(/\.$/, '')})` : '';
  const blocked = r.blockedBy ? ` · blocked=${r.blockedBy}` : '';
  out.push(`${profileTag(r.meta)} route=${r.route ?? '-'}${reason} · status=${r.status}${blocked}`, '');

  if (r.sql) {
    const corr = r.sql.corrections === 0 ? 'no correction' : plural(r.sql.corrections, 'correction', 'corrections');
    out.push(`SQL (${corr}${r.sql.limitApplied ? '; LIMIT applied' : ''})`);
    out.push(...wrap(r.sql.query, 88, '  '));
    if (r.sql.originalQuery) out.push('  original query:', ...wrap(r.sql.originalQuery, 88, '    '));
    if (r.sql.lastError) out.push(...wrap(`last error: ${r.sql.lastError}`, 88, '  '));
    if (r.sql.columns.length > 0 && r.sql.rows.length > 0) {
      out.push('', ...table(r.sql.columns, r.sql.rows.slice(0, TABLE_ROWS)));
      if (r.sql.rowCount > TABLE_ROWS) out.push(`  … ${formatInt(r.sql.rowCount)} rows in total`);
    }
    out.push('');
  }

  out.push(...wrap(r.answer));

  if (r.citations.length > 0) {
    out.push('', 'Sources');
    const labels = r.citations.map((c, i) => `  [${i + 1}] ${c.docTitle} › ${c.heading}`);
    const width = Math.max(...labels.map((l) => l.length)) + 3;
    r.citations.forEach((c, i) => {
      out.push(`${labels[i]!.padEnd(width)}score ${c.score.toFixed(2)}${c.sanitized ? ' · passage neutralized' : ''}`);
    });
  }
  if (r.followUpQuestions.length > 0) {
    out.push('Follow-up questions:', ...r.followUpQuestions.map((q) => `  - ${q}`));
  }
  if (r.warnings.length > 0) out.push('', `Warnings: ${r.warnings.join(', ')}`);

  const m = r.meta;
  const facts = [
    plural(m.llmCalls, 'LLM call', 'LLM calls'),
    `${formatInt(m.tokens.prompt + m.tokens.completion)} tokens${m.tokens.estimated ? ' (estimated)' : ''}`,
    formatCost(m.costUsd, m.costIsFictional),
  ];
  if (r.sql && r.sql.corrections > 0) facts.push(plural(r.sql.corrections, 'correction', 'corrections'));
  if (m.fallbackUsed) facts.push(`fallback used (models: ${m.models.join(', ')})`);
  facts.push(`${Math.round(m.latencyMs)} ms`, `req ${r.requestId.slice(0, 8)}`);
  out.push('', facts.join(' · '));
  return out.join('\n');
}

function formatError(httpStatus: number, body: ErrorBody): string {
  const lines = [`error ${httpStatus} (${body.error}): ${body.message}`];
  if (body.suggestions?.length) lines.push('Available scripted questions:', ...body.suggestions.map((s) => `  - ${s}`));
  lines.push(`req ${body.requestId}`);
  return lines.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  let values: { json?: boolean; route?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: { json: { type: 'boolean', default: false }, route: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: true,
    }));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 1;
  }
  if (values.help) { console.log(USAGE); return 0; }
  const question = positionals.join(' ').trim();
  if (!question) { console.error(`missing question\n${USAGE}`); return 1; }
  if (values.route !== undefined && values.route !== 'docs' && values.route !== 'data') {
    console.error(`--route accepts docs or data (received: ${values.route})\n${USAGE}`);
    return 1;
  }

  let ctx: AppContext | null = null;
  try {
    const config = loadConfig();
    // Sem LOG_LEVEL explícito, a CLI só registra avisos e erros: a resposta já sai no terminal.
    const logger = createLogger({ level: process.env.LOG_LEVEL ? config.logLevel : 'warn' });
    ctx = await createAppContext(config, { dataMode: 'file', logger });
    const outcome = await ctx.askService.ask({ question, ...(values.route ? { forceRoute: values.route } : {}) });
    if (!outcome.ok) {
      console.error(formatError(outcome.httpStatus, outcome.body));
      return exitCodeFor(outcome.httpStatus);
    }
    console.log(values.json ? JSON.stringify(outcome.response, null, 2) : formatResponse(outcome.response));
    return 0;
  } catch (err) {
    console.error(`ask failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    ctx?.close();
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
