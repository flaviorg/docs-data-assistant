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
  fake: 'FAKE (geração roteirizada; recuperação, limiar, validação e bloqueio medidos de verdade)',
  live: 'LIVE (modelo real; as 7 métricas são medidas)',
};
export const CONTRACT_NOTE = 'Contratos (fixture) provam que fixtures, embedder e pipeline estão em sincronia; não medem qualidade de geração.';

export const COMPLACENT_NOTE = 'Fixture de modelo complacente simulado (testa a última linha de defesa)';

const fmt = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
const limit = (m: MetricResult): string => `${m.op}${m.threshold.toFixed(2)}`;
const verdict = (code: 0 | 1): string => (code === 0 ? 'APROVADO (código 0)' : 'REPROVADO (código 1)');

export function renderReport(r: ReportInput): { text: string; markdown: string } {
  const head = `EVAL docs-data-assistant · perfil ${PROFILE_LABEL[r.profile]} · split ${r.split} (${r.items} itens)`;
  const meta = `provider=${r.provider} embedder=${r.embedder} guardrail=${r.guardrail} modelos=${r.models.join(',')} · ${r.date}`;
  const wName = Math.max('métrica'.length, ...r.metrics.map((m) => m.name.length)) + 2;
  const wNature = Math.max('natureza'.length, ...r.metrics.map((m) => m.nature.length)) + 2;
  const row = (name: string, nature: string, value: string, lim: string, ok: string, count: string) =>
    `${name.padEnd(wName)}${nature.padEnd(wNature)}${value.padEnd(8)}${lim.padEnd(9)}${ok.padEnd(5)}${count}`.trimEnd();

  const text: string[] = [head, meta, '', row('métrica', 'natureza', 'valor', 'limiar', 'ok', 'itens')];
  for (const m of r.metrics) text.push(row(m.name, m.nature, fmt(m.value), limit(m), m.pass ? 'sim' : 'NÃO', m.count));
  text.push('');
  if (r.profile === 'fake') text.push(CONTRACT_NOTE);
  if (r.complacent.length > 0) text.push(`${COMPLACENT_NOTE}: ${r.complacent.join(', ')}`);
  // Transparência: lista os itens que contaram contra cada métrica, mesmo quando ela passa no limiar.
  for (const m of r.metrics) if (m.failedIds.length > 0) text.push(`Itens contra ${m.name}: ${m.failedIds.join(', ')}`);
  for (const e of r.errors) text.push(`Erro no item ${e.id}: HTTP ${e.httpStatus} ${e.error}`);
  text.push(`Resultado: ${verdict(r.exitCode)}.${r.outPath ? ` Relatório: ${r.outPath}` : ''}`);

  const md: string[] = [
    `# Eval docs-data-assistant: perfil ${r.profile.toUpperCase()}`,
    '',
    `- Perfil: ${PROFILE_LABEL[r.profile]}`,
    `- Provedor: ${r.provider} · Embedder: \`${r.embedder}\` · Guardrail: ${r.guardrail}`,
    `- Modelos: ${r.models.join(', ')}`,
    `- Split: ${r.split} (${r.items} itens) · Data: ${r.date}`,
    '',
    '| métrica | natureza | valor | limiar | ok | itens |',
    '|---|---|---|---|---|---|',
    ...r.metrics.map((m) => `| ${m.name} | ${m.nature} | ${fmt(m.value)} | ${limit(m)} | ${m.pass ? 'sim' : 'NÃO'} | ${m.count} |`),
    '',
  ];
  if (r.profile === 'fake') md.push(CONTRACT_NOTE, '');
  if (r.complacent.length > 0) md.push(`${COMPLACENT_NOTE}: ${r.complacent.join(', ')}.`, '');
  const against = r.metrics.filter((m) => m.failedIds.length > 0);
  if (against.length > 0 || r.errors.length > 0) {
    md.push('## Itens que contaram contra uma métrica', '');
    for (const m of against) md.push(`- ${m.name}${m.pass ? ' (dentro do limiar)' : ''}: ${m.failedIds.join(', ')}`);
    for (const e of r.errors) md.push(`- erro no item ${e.id}: HTTP ${e.httpStatus} ${e.error}`);
    md.push('');
  }
  md.push(`**Resultado: ${verdict(r.exitCode)}.**`, '');
  return { text: text.join('\n'), markdown: md.join('\n') };
}
