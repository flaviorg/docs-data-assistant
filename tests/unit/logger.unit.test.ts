import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, maskSecrets, truncateForLog } from '../../src/obs/logger.ts';

test('logger escreve JSON de uma linha e mascara segredos', () => {
  const lines: string[] = []; const log = createLogger({ level: 'info', sink: (l) => lines.push(l) });
  log.info('llm_call', { key: 'sk-or-v1-abc123', auth: 'Bearer xyz.789' }); log.debug('hidden');
  assert.equal(lines.length, 1);
  const o = JSON.parse(lines[0]!); assert.equal(o.event, 'llm_call'); assert.ok(o.ts && o.level === 'info');
  assert.doesNotMatch(lines[0]!, /abc123|xyz\.789/);
  assert.equal(truncateForLog('a'.repeat(300)).length, 200);
});

// Complementos
test('filtro de nível: warn deixa passar warn e error', () => {
  const lines: string[] = []; const log = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
  log.debug('a'); log.info('b'); log.warn('c', { requestId: 'r-12345678' }); log.error('d');
  assert.deepEqual(lines.map((l) => JSON.parse(l).event), ['c', 'd']);
  assert.equal(JSON.parse(lines[0]!).requestId, 'r-12345678');
  for (const l of lines) assert.doesNotMatch(l, /\n/);
});

test('maskSecrets cobre chave dentro de texto e mantém o resto', () => {
  assert.equal(maskSecrets('chave sk-or-v1-0123456789abcdef usada'), 'chave sk-or-*** usada');
  assert.equal(maskSecrets('Authorization: Bearer abc.def-ghi'), 'Authorization: Bearer ***');
  assert.equal(maskSecrets('texto comum'), 'texto comum');
});

test('truncateForLog mantém texto curto e marca o corte', () => {
  assert.equal(truncateForLog('curto'), 'curto');
  assert.ok(truncateForLog('b'.repeat(250)).endsWith('…'));
  assert.equal(truncateForLog('c'.repeat(50), 10).length, 10);
});

test('pergunta longa é cortada em 200 caracteres no log', () => {
  const lines: string[] = []; const log = createLogger({ level: 'info', sink: (l) => lines.push(l) });
  log.info('ask', { question: truncateForLog('p'.repeat(500)) });
  assert.equal(JSON.parse(lines[0]!).question.length, 200);
});
