import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chunkMarkdown, slugify } from '../../src/rag/chunker.ts';

const md = `# Política\n\nIntro curta.\n\n## Produtos com defeito\n\n${'Frase de teste com várias palavras. '.repeat(45)}\n\n## Devoluções\n\nTexto.`;

test('corta por título e gera IDs estáveis', () => {
  const a = chunkMarkdown({ slug: 'politica', markdown: md }, { size: 600, overlap: 100 });
  assert.deepEqual([...new Set(a.map((c) => c.heading))], ['Política', 'Produtos com defeito', 'Devoluções']);
  assert.equal(a.find((c) => c.heading === 'Devoluções')!.id, 'politica#devolucoes-1');
  assert.deepEqual(a, chunkMarkdown({ slug: 'politica', markdown: md }, { size: 600, overlap: 100 }));
});
test('respeita o tamanho e mantém overlap entre chunks da mesma seção', () => {
  const s = chunkMarkdown({ slug: 'politica', markdown: md }, { size: 600, overlap: 100 }).filter((c) => c.heading === 'Produtos com defeito');
  assert.ok(s.length >= 3);
  for (const c of s) assert.ok(c.text.length <= 600);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1]!.text.includes(s[i]!.text.slice(0, 40)));
});
test('slugify remove acentos', () => { assert.equal(slugify('Devoluções e Trocas'), 'devolucoes-e-trocas'); });

// Complementos
test('docTitle vem do H1, ordinal é global e ids numeram por seção a partir de 1', () => {
  const a = chunkMarkdown({ slug: 'politica', markdown: md }, { size: 600, overlap: 100 });
  assert.ok(a.every((c) => c.docTitle === 'Política' && c.docSlug === 'politica'));
  assert.deepEqual(a.map((c) => c.ordinal), a.map((_, i) => i));
  assert.deepEqual(a.filter((c) => c.heading === 'Produtos com defeito').map((c) => c.id),
    a.filter((c) => c.heading === 'Produtos com defeito').map((_, i) => `politica#produtos-com-defeito-${i + 1}`));
  assert.equal(a[0]!.id, 'politica#politica-1'); assert.equal(a[0]!.text, 'Intro curta.');
});
test('H3 também corta; seção vazia não gera chunk; título repetido não colide', () => {
  const m = '# Doc\n\n## A\n\nUm.\n\n### Sub\n\nDois.\n\n## Vazia\n\n## A\n\nTrês.';
  const a = chunkMarkdown({ slug: 'doc', markdown: m }, { size: 600, overlap: 100 });
  assert.deepEqual(a.map((c) => [c.id, c.text]), [['doc#a-1', 'Um.'], ['doc#sub-1', 'Dois.'], ['doc#a-2', 'Três.']]);
});
test('corte cai em fim de frase quando possível e todo o texto da seção aparece', () => {
  const s = chunkMarkdown({ slug: 'politica', markdown: md }, { size: 600, overlap: 100 }).filter((c) => c.heading === 'Produtos com defeito');
  for (const c of s.slice(0, -1)) assert.match(c.text, /\.$/);
  const body = 'Frase de teste com várias palavras. '.repeat(45).trim();
  assert.ok(body.endsWith(s.at(-1)!.text.slice(-60)));
  assert.ok(body.startsWith(s[0]!.text));
});
test('texto sem espaço é cortado à força sem passar do tamanho', () => {
  const a = chunkMarkdown({ slug: 'x', markdown: `# X\n\n${'a'.repeat(1500)}` }, { size: 600, overlap: 100 });
  assert.ok(a.length >= 3);
  for (const c of a) assert.ok(c.text.length <= 600 && c.text.length > 0);
});
test('na base real, o trecho envenenado fica no mesmo chunk do pedido mínimo', () => {
  const a = chunkMarkdown({ slug: 'cafeterias-parceiras', markdown: fs.readFileSync('data/kb/cafeterias-parceiras.md', 'utf8') }, { size: 600, overlap: 100 });
  const c = a.find((x) => x.text.includes('FULL-MOON-100'))!;
  assert.equal(c.id, 'cafeterias-parceiras#minimum-order-and-terms-1');
  assert.match(c.text, /minimum order is 5 kg/);
});
