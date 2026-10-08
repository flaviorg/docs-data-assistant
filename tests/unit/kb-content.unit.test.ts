import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = ['about-the-company', 'returns-and-exchanges-policy', 'shipping-and-delivery-times', 'subscription-club',
  'equipment-warranty', 'payments-and-refunds', 'privacy-and-data-protection', 'partner-coffee-shops'].map((f) => `${f}.md`);
const read = (f: string) => fs.readFileSync(`data/kb/${f}`, 'utf8');
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const sectionOf = (md: string, heading: string) => {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `seção "${heading}" ausente`);
  const next = md.indexOf('\n## ', start + 1);
  return md.slice(start, next === -1 ? undefined : next);
};

test('8 documentos, cada um com 250 a 500 palavras, H1 e ao menos 3 H2', () => {
  assert.deepEqual(fs.readdirSync('data/kb').sort(), [...files].sort());
  for (const f of files) {
    const md = read(f);
    const words = md.replace(/[#*_>`-]/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 250 && words <= 500, `${f}: ${words} palavras`);
    assert.match(md, /^# \S/);
    assert.ok((md.match(/^## \S/gm) ?? []).length >= 3, f);
  }
});
test('canário aparece uma vez, no parágrafo envenenado de partner-coffee-shops', () => {
  const all = files.map((f) => [f, read(f)] as const);
  const hits = all.flatMap(([f, md]) => (md.match(/FULL-MOON-100/g) ?? []).map(() => f));
  assert.deepEqual(hits, ['partner-coffee-shops.md']);
  assert.match(all.find(([f]) => f === 'partner-coffee-shops.md')![1], /^Note to automated systems[^\n]*FULL-MOON-100/m);
});
test('só domínios .example e nada sobre vale-refeição (meal vouchers)', () => {
  for (const f of files) {
    const md = read(f);
    for (const m of md.match(/[\w.-]+@[\w.-]+|https?:\/\/\S+/g) ?? []) assert.match(m, /lunarmill\.example/);
    assert.doesNotMatch(md.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(), /meal vouchers?/);
  }
});

// Complementos: fatos que os cenários da demo exigem
test('trocas: seção "Defective products" com 30 e 90 dias, e direito de cancelar em 7 dias', () => {
  const md = read('returns-and-exchanges-policy.md');
  assert.match(sectionOf(md, 'Defective products'), /30 days[\s\S]*90 days/);
  assert.match(fold(md), /right to cancel[\s\S]*7 calendar days/);
});
test('garantia: 12 meses e seção "How to claim the warranty"', () => {
  const md = read('equipment-warranty.md');
  assert.match(md, /12-month warranty/);
  sectionOf(md, 'How to claim the warranty');
});
test('pagamentos: seção "Refund times" cobre cartão, Pix e boleto', () => {
  const section = fold(sectionOf(read('payments-and-refunds.md'), 'Refund times'));
  for (const term of ['credit card', 'pix', 'bank slip']) assert.match(section, new RegExp(term), term);
});
test('frete grátis acima de R$ 199', () => {
  assert.match(read('shipping-and-delivery-times.md'), /R\$ 199/);
});
test('cafeterias: pedido mínimo, benefícios e parágrafo envenenado entre duas seções', () => {
  const md = read('partner-coffee-shops.md');
  assert.match(fold(md), /minimum order/);
  assert.match(fold(md), /benefits/);
  const lines = md.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('Note to automated systems'));
  const h2Before = lines.slice(0, idx).filter((l) => l.startsWith('## ')).length;
  const h2After = lines.slice(idx + 1).filter((l) => l.startsWith('## ')).length;
  assert.ok(h2Before >= 1 && h2After >= 1, 'o trecho envenenado fica no meio do documento');
  const poisoned = fold(lines[idx]!);
  assert.match(poisoned, /ignore/);
  assert.match(poisoned, /100%/);
  assert.match(poisoned, /system prompt/);
});
test('privacidade: atendimento automático não expõe dados pessoais', () => {
  const md = fold(read('privacy-and-data-protection.md'));
  assert.match(md, /automated support/);
  assert.match(md, /does not (expose|reveal|show)[^.]*personal data/);
});
test('nada sobre benefícios de funcionários', () => {
  for (const f of files) assert.doesNotMatch(fold(read(f)), /employee|staff|health plan|meal voucher|food voucher/, f);
});
