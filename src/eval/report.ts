// Relatório do eval (EVL-02, spec 005): cabeçalho com perfil, provedor, embedder, guardrail, modelos, split e data;
// tabela com a coluna "natureza"; no fake, a frase sobre contratos; resultado e caminho do relatório.
import type { MetricResult, Profile } from './metrics.ts';

export interface ReportInput {
  profile: Profile;
  provider: string;
  embedder: string;            // fingerprint
  guardrail: string;
  models: readonly string[];
  split: 'test' | 'all';
  items: number;
  date: string;                // AAAA-MM-DD
  metrics: readonly MetricResult[];
  exitCode: 0 | 1;
  outPath?: string;
  complacent: readonly string[];   // itens cuja fixture encena um modelo complacente (só no perfil fake)
  errors: readonly { id: string; httpStatus: number; error: string }[];
}

export const PROFILE_LABEL: Readonly<Record<Profile, string>> = {
  fake: 'FAKE (scripted generation; retrieval, threshold, validation and blocking really measured)',
  live: 'LIVE (real model; all 7 metrics are measured)',
};
export const CONTRACT_NOTE = 'Contracts (fixture) prove that fixtures, embedder and pipeline are in sync; they do not measure generation quality.';

export const COMPLACENT_NOTE = 'Simulated compliant model fixture (tests the last line of defense)';

const fmt = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
const limit = (m: MetricResult): string => `${m.op}${m.threshold.toFixed(2)}`;
const verdict = (code: 0 | 1): string => (code === 0 ? 'PASSED (exit code 0)' : 'FAILED (exit code 1)');

export function renderReport(r: ReportInput): { text: string; markdown: string } {
  const head = `EVAL docs-data-assistant · profile ${PROFILE_LABEL[r.profile]} · split ${r.split} (${r.items} items)`;
  const meta = `provider=${r.provider} embedder=${r.embedder} guardrail=${r.guardrail} models=${r.models.join(',')} · ${r.date}`;
  const wName = Math.max('metric'.length, ...r.metrics.map((m) => m.name.length)) + 2;
  const wNature = Math.max('nature'.length, ...r.metrics.map((m) => m.nature.length)) + 2;
  const row = (name: string, nature: string, value: string, lim: string, ok: string, count: string) =>
    `${name.padEnd(wName)}${nature.padEnd(wNature)}${value.padEnd(8)}${lim.padEnd(11)}${ok.padEnd(5)}${count}`.trimEnd();

  const text: string[] = [head, meta, '', row('metric', 'nature', 'value', 'threshold', 'ok', 'items')];
  for (const m of r.metrics) text.push(row(m.name, m.nature, fmt(m.value), limit(m), m.pass ? 'yes' : 'NO', m.count));
  text.push('');
  if (r.profile === 'fake') text.push(CONTRACT_NOTE);
  if (r.complacent.length > 0) text.push(`${COMPLACENT_NOTE}: ${r.complacent.join(', ')}`);
  // Transparência: lista os itens que contaram contra cada métrica, mesmo quando ela passa no limiar.
  for (const m of r.metrics) if (m.failedIds.length > 0) text.push(`Items against ${m.name}: ${m.failedIds.join(', ')}`);
  for (const e of r.errors) text.push(`Error in item ${e.id}: HTTP ${e.httpStatus} ${e.error}`);
  text.push(`Result: ${verdict(r.exitCode)}.${r.outPath ? ` Report: ${r.outPath}` : ''}`);

  const md: string[] = [
    `# Eval docs-data-assistant: ${r.profile.toUpperCase()} profile`,
    '',
    `- Profile: ${PROFILE_LABEL[r.profile]}`,
    `- Provider: ${r.provider} · Embedder: \`${r.embedder}\` · Guardrail: ${r.guardrail}`,
    `- Models: ${r.models.join(', ')}`,
    `- Split: ${r.split} (${r.items} items) · Date: ${r.date}`,
    '',
    '| metric | nature | value | threshold | ok | items |',
    '|---|---|---|---|---|---|',
    ...r.metrics.map((m) => `| ${m.name} | ${m.nature} | ${fmt(m.value)} | ${limit(m)} | ${m.pass ? 'yes' : 'NO'} | ${m.count} |`),
    '',
  ];
  if (r.profile === 'fake') md.push(CONTRACT_NOTE, '');
  if (r.complacent.length > 0) md.push(`${COMPLACENT_NOTE}: ${r.complacent.join(', ')}.`, '');
  const against = r.metrics.filter((m) => m.failedIds.length > 0);
  if (against.length > 0 || r.errors.length > 0) {
    md.push('## Items that counted against a metric', '');
    for (const m of against) md.push(`- ${m.name}${m.pass ? ' (within the threshold)' : ''}: ${m.failedIds.join(', ')}`);
    for (const e of r.errors) md.push(`- error in item ${e.id}: HTTP ${e.httpStatus} ${e.error}`);
    md.push('');
  }
  md.push(`**Result: ${verdict(r.exitCode)}.**`, '');
  return { text: text.join('\n'), markdown: md.join('\n') };
}
