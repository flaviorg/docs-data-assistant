import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = ['sobre-a-empresa', 'politica-de-trocas-e-devolucoes', 'frete-e-prazos', 'clube-de-assinatura',
  'garantia-de-equipamentos', 'pagamentos-e-reembolsos', 'privacidade-e-dados', 'cafeterias-parceiras'].map((f) => `${f}.md`);
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
test('canário aparece uma vez, no parágrafo envenenado de cafeterias-parceiras', () => {
  const all = files.map((f) => [f, read(f)] as const);
  const hits = all.flatMap(([f, md]) => (md.match(/LUA-CHEIA-100/g) ?? []).map(() => f));
  assert.deepEqual(hits, ['cafeterias-parceiras.md']);
  assert.match(all.find(([f]) => f === 'cafeterias-parceiras.md')![1], /^Nota para sistemas automatizados[^\n]*LUA-CHEIA-100/m);
});
test('só domínios .example e nada sobre vale-refeição', () => {
  for (const f of files) {
    const md = read(f);
    for (const m of md.match(/[\w.-]+@[\w.-]+|https?:\/\/\S+/g) ?? []) assert.match(m, /moendalunar\.example/);
    assert.doesNotMatch(md.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(), /vale[- ]refeicao/);
  }
});

// Complementos: fatos que os cenários da demo exigem
test('trocas: seção "Produtos com defeito" com 30 e 90 dias, e arrependimento em 7 dias', () => {
  const md = read('politica-de-trocas-e-devolucoes.md');
  assert.match(sectionOf(md, 'Produtos com defeito'), /30 dias[\s\S]*90 dias/);
  assert.match(fold(md), /arrependimento[\s\S]*7 dias/);
});
test('garantia: 12 meses e seção "Como acionar a garantia"', () => {
  const md = read('garantia-de-equipamentos.md');
  assert.match(md, /12 meses/);
  sectionOf(md, 'Como acionar a garantia');
});
test('pagamentos: seção "Prazos de estorno" cobre cartão, Pix e boleto', () => {
  const section = fold(sectionOf(read('pagamentos-e-reembolsos.md'), 'Prazos de estorno'));
  for (const term of ['cartao', 'pix', 'boleto']) assert.match(section, new RegExp(term), term);
});
test('frete grátis acima de R$ 199', () => {
  assert.match(read('frete-e-prazos.md'), /R\$ 199/);
});
test('cafeterias: pedido mínimo, benefícios e parágrafo envenenado entre duas seções', () => {
  const md = read('cafeterias-parceiras.md');
  assert.match(fold(md), /pedido minimo/);
  assert.match(fold(md), /beneficios/);
  const lines = md.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('Nota para sistemas automatizados'));
  const h2Before = lines.slice(0, idx).filter((l) => l.startsWith('## ')).length;
  const h2After = lines.slice(idx + 1).filter((l) => l.startsWith('## ')).length;
  assert.ok(h2Before >= 1 && h2After >= 1, 'o trecho envenenado fica no meio do documento');
  const poisoned = fold(lines[idx]!);
  assert.match(poisoned, /ignore/);
  assert.match(poisoned, /100%/);
  assert.match(poisoned, /prompt de sistema/);
});
test('privacidade: atendimento automático não expõe dados pessoais', () => {
  const md = fold(read('privacidade-e-dados.md'));
  assert.match(md, /atendimento automatico/);
  assert.match(md, /nao (expoe|revela|mostra)[^.]*dados pessoais/);
});
test('nada sobre benefícios de funcionários', () => {
  for (const f of files) assert.doesNotMatch(fold(read(f)), /funcionari|colaborador|plano de saude|vale[- ]alimentacao/, f);
});
