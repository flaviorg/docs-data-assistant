import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Rastreabilidade (AGENTS.md, fluxo SDD): todo critério EARS escrito em specs/*/spec.md
// precisa de ao menos um teste com o ID no nome.

function specIds(): string[] {
  return fs.readdirSync('specs', { recursive: true }).filter((f) => String(f).endsWith('spec.md'))
    .flatMap((f) => [...fs.readFileSync(path.join('specs', String(f)), 'utf8').matchAll(/\*\*([A-Z]+-\d{2})\*\*/g)].map((m) => m[1]!));
}

function testNameIds(): string[] {
  return fs.readdirSync('tests', { recursive: true }).filter((f) => String(f).endsWith('.test.ts'))
    .flatMap((f) => [...fs.readFileSync(path.join('tests', String(f)), 'utf8').matchAll(/test\(\s*(['"`])(.*?)\1/g)])
    .flatMap((m) => m[2]!.match(/\b[A-Z]+-\d{2}\b/g) ?? []);
}

test('todo ID EARS das specs aparece em ao menos um nome de teste', () => {
  const ids = new Set(specIds());
  assert.ok(ids.size >= 45);
  // todo ID citado no título do teste conta (ex.: 'LLM-05 ... LLM-03 ...'), não só o primeiro
  const names = testNameIds();
  const missing = [...ids].filter((id) => !names.includes(id));
  assert.deepEqual(missing, []);
});

// O ID no começo do nome marca o teste que prova o critério; um ID citado no meio do título (ou um teste
// complementar) não basta sozinho. Revisão final: testes que só usavam o ID como etiqueta perderam o ID.
test('todo ID EARS tem um teste cujo nome começa pelo ID', () => {
  const leading = new Set(fs.readdirSync('tests', { recursive: true }).filter((f) => String(f).endsWith('.test.ts'))
    .flatMap((f) => [...fs.readFileSync(path.join('tests', String(f)), 'utf8').matchAll(/test\(\s*(['"`])([A-Z]+-\d{2})\b/g)].map((m) => m[2]!)));
  assert.deepEqual([...new Set(specIds())].filter((id) => !leading.has(id)), []);
});

// Complementos
test('cada ID EARS aparece em exatamente uma spec, e as 5 specs seguem a distribuição por assunto', () => {
  const owner: Record<string, RegExp> = {
    '001-llm-client-and-observability': /^(LLM|OBS)-/,
    '002-rag-with-refusal': /^(RAG-|GRD-04$)/,
    '003-safe-text-to-sql': /^(DATA-01$|SQL-)/,
    '004-guardrails-and-graph': /^(GRD-0[1235]$|RTE-)/,
    '005-interfaces-and-eval': /^(ENV|API|WEB|EVL)-/,
  };
  const seen = new Map<string, string>();
  for (const [dir, rule] of Object.entries(owner)) {
    const text = fs.readFileSync(path.join('specs', dir, 'spec.md'), 'utf8');
    const ids = [...text.matchAll(/\*\*([A-Z]+-\d{2})\*\*/g)].map((m) => m[1]!);
    assert.ok(ids.length > 0, `${dir} sem critérios`);
    for (const id of ids) {
      assert.match(id, rule, `${id} não pertence a ${dir}`);
      assert.equal(seen.get(id), undefined, `${id} repetido em ${seen.get(id)} e ${dir}`);
      seen.set(id, dir);
    }
    for (const heading of ['## Context', '## Scope', '## Non-goals', '## Acceptance criteria (EARS)', '## Decisions', '## How to verify']) {
      assert.ok(text.includes(heading), `${dir} sem a seção "${heading}"`);
    }
  }
  assert.equal(seen.size, 49);   // 47 originais, SQL-11 (prazo de execução da SQL) e SQL-12 (teto por valor), das revisões finais
});

test('constitution.md tem os princípios, a regra de integridade e a regra de publicação', () => {
  const text = fs.readFileSync('specs/constitution.md', 'utf8');
  for (const needle of ['Refusing is a feature', 'schema', 'validated before it runs', 'cap', 'firewall', 'measured',
    'golden questions', 'fake', 'course material', 'commit']) {
    assert.ok(text.includes(needle), `constitution.md sem "${needle}"`);
  }
});
