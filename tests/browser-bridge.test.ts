import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bridgeRequest, runnerOrigin } from '../shared/browser-bridge.ts';

test('browser bridge rejects URLs, bootstrap access, path traversal and caller headers', () => {
  const request = { type: 'request', id: randomUUID(), path: '/state', method: 'GET' };
  assert.equal(bridgeRequest.safeParse(request).success, true);
  for (const path of [
    'https://attacker.example',
    '//attacker.example',
    '/api/../session',
    '/%2e%2e/session',
    '/session',
    '/events',
    '/state?token=x',
    '/state#x',
    '/state\\x',
  ])
    assert.equal(bridgeRequest.safeParse({ ...request, path }).success, false, path);
  assert.equal(
    bridgeRequest.safeParse({ ...request, headers: { Authorization: 'x' } }).success,
    false,
  );
  assert.equal(bridgeRequest.safeParse({ ...request, method: 'CONNECT' }).success, false);
  assert.equal(runnerOrigin('4317'), 'http://127.0.0.1:4317');
  for (const port of [
    '80',
    '65536',
    '4317/evil',
    '4317@attacker.example',
    'https://attacker.example',
  ])
    assert.throws(() => runnerOrigin(port));
});
