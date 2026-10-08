import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

test('ENV-03 fetch lança NETWORK_BLOCKED', async () => {
  await assert.rejects(fetch('http://127.0.0.1:65000'), /NETWORK_BLOCKED/);
});
test('ENV-03 http.get lança NETWORK_BLOCKED', () => {
  assert.throws(() => http.get('http://127.0.0.1:65000'), /NETWORK_BLOCKED/);
});
test('ENV-03 processo filho herda o bloqueio por NODE_OPTIONS', () => {
  const r = spawnSync(process.execPath, ['-e',
    "fetch('http://127.0.0.1:65000').then(()=>process.exit(0),e=>{console.log(e.message);process.exit(3)})"],
    { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /NETWORK_BLOCKED/);
});
