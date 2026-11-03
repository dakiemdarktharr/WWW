import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  cloudOrigin,
  sameOrigin,
  externalUrl,
  pkce,
  validIdentity,
  runtimeEnvironment,
  machineConfiguration,
  previewUrl,
} = require('../desktop/security.cjs');

test('desktop identity origins reject credentials, paths and insecure production origins', () => {
  assert.equal(cloudOrigin('https://relay.example'), 'https://relay.example');
  for (const value of [
    'http://relay.example',
    'https://relay.example/path',
    'https://user:pass@relay.example',
    'file:///C:/state',
  ])
    assert.throws(() => cloudOrigin(value));
  assert.equal(cloudOrigin('http://127.0.0.1:8123', true), 'http://127.0.0.1:8123');
  assert.throws(() => cloudOrigin('http://localhost:8123', true));
});

test('native machine import pins the HTTPS coordinator and owns its storage path', () => {
  const root =
    process.platform === 'win32' ? 'C:\\RELAY\\machine-links' : '/tmp/relay-machine-links';
  const id = 'a12472b0-c442-4a79-b1d4-4f170b7341b7';
  const input = {
    id,
    origin: 'https://relay.example',
    token: 'a'.repeat(43),
    dataDir: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc',
    slots: 2,
    maxLoad: 3,
    minFreeMB: 2048,
    exchangeUrl:
      'https://relay.example/api/desktop/bridge/exchange?host=bc41a9de-9e07-4fa7-943c-3f24c50e1913',
    bridgeKey: 'b'.repeat(64),
  };
  const config = machineConfiguration(input, 'https://relay.example', root);
  assert.equal(config.dataDir, require('node:path').join(root, id, 'state'));
  assert.notEqual(config.dataDir, input.dataDir);
  assert.throws(() =>
    machineConfiguration(
      { ...input, origin: 'https://attacker.example' },
      'https://relay.example',
      root,
    ),
  );
  assert.throws(() =>
    machineConfiguration(
      { ...input, origin: 'http://relay.example' },
      'https://relay.example',
      root,
    ),
  );
  assert.throws(() =>
    machineConfiguration(
      { ...input, exchangeUrl: 'https://attacker.example/api/runner/exchange' },
      'https://relay.example',
      root,
    ),
  );
  assert.throws(() =>
    machineConfiguration(
      { ...input, exchangeUrl: 'https://relay.example/api/auth/sign-in/email' },
      'https://relay.example',
      root,
    ),
  );
  assert.throws(() =>
    machineConfiguration(
      { ...input, exchangeUrl: input.exchangeUrl + '&host=bad' },
      'https://relay.example',
      root,
    ),
  );
  assert.throws(() =>
    machineConfiguration({ ...input, bridgeKey: '' }, 'https://relay.example', root),
  );
  assert.throws(() =>
    machineConfiguration({ ...input, token: 'short' }, 'https://relay.example', root),
  );
  assert.throws(() =>
    machineConfiguration({ ...input, id: '../../state' }, 'https://relay.example', root),
  );
  assert.throws(() => machineConfiguration({ ...input, slots: 5 }, 'https://relay.example', root));
  assert.throws(() =>
    machineConfiguration({ ...input, command: 'powershell' }, 'https://relay.example', root),
  );
});

test('desktop external navigation only opens approved HTTPS sites or the configured identity origin', () => {
  const identity = 'https://relay.example';
  assert.equal(
    externalUrl('https://auth.openai.com/codex/device', identity),
    'https://auth.openai.com/codex/device',
  );
  assert.equal(
    externalUrl('https://relay.example/activate?code=TEST', identity),
    'https://relay.example/activate?code=TEST',
  );
  for (const value of [
    'javascript:alert(1)',
    'file:///C:/Windows',
    'https://openai.com.attacker.invalid',
    'https://openai.com@attacker.invalid',
    'http://127.0.0.1:4317/api/session',
    'https://user:password@github.com',
  ])
    assert.throws(() => externalUrl(value, identity));
  assert.equal(sameOrigin('https://relay.example/activate', identity), true);
  assert.equal(sameOrigin('https://user:password@relay.example', identity), false);
});

test('desktop proof challenges are random S256 values and do not disclose their verifier', () => {
  const first = pkce(),
    second = pkce();
  assert.notEqual(first.verifier, second.verifier);
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.challenge, createHash('sha256').update(first.verifier).digest('base64url'));
  assert.notEqual(first.challenge, first.verifier);
});

test('explicit demo navigation permits project sites but cannot open the privileged app or OS protocols', () => {
  const origin = 'http://127.0.0.1:4317';
  assert.equal(previewUrl('https://project.example/demo', origin), 'https://project.example/demo');
  assert.equal(previewUrl('http://localhost:3000/', origin), 'http://localhost:3000/');
  for (const url of [
    'http://localhost:4317/',
    origin,
    'http://example.com/',
    'http://localhost/',
    'file:///C:/Windows',
    'javascript:alert(1)',
    'https://name:secret@project.example',
  ])
    assert.throws(() => previewUrl(url, origin));
});

test('desktop sessions reject expired or cross-owner credentials', () => {
  const session = {
    accessToken: 'x'.repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    owner: { id: 'owner-a', name: 'Owner A' },
  };
  assert.equal(validIdentity(session, 'owner-a'), session);
  assert.throws(() => validIdentity(session, 'owner-b'));
  assert.throws(() => validIdentity({ ...session, expiresAt: new Date(0).toISOString() }));
  assert.throws(() => validIdentity({ ...session, accessToken: 'short' }));
});

test('desktop runtime strips inherited provider and cloud secrets', () => {
  const env = runtimeEnvironment(
    {
      PATH: 'safe',
      SYSTEMROOT: 'C:/Windows',
      OPENAI_API_KEY: 'never-copy',
      RELAY_OWNER_PASSWORD: 'never-copy',
      GITHUB_TOKEN: 'never-copy',
      AWS_SECRET_ACCESS_KEY: 'never-copy',
    },
    { NODE_ENV: 'production', RELAY_PORT: '12345' },
  );
  assert.deepEqual(env, {
    PATH: 'safe',
    SYSTEMROOT: 'C:/Windows',
    NODE_ENV: 'production',
    RELAY_PORT: '12345',
  });
  assert.deepEqual(
    runtimeEnvironment(
      { Path: 'system', PATH: 'old', USERPROFILE: 'owner' },
      { PATH: 'bundled;system' },
    ),
    { USERPROFILE: 'owner', PATH: 'bundled;system' },
  );
});
