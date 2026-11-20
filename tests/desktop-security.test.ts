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
  secureCredentialStorage,
  desktopUpdate,
  githubMacReleaseAsset,
  trustedMacUpdateRedirect,
} = require('../desktop/security.cjs');
const { fetchMacUpdate } = require('../desktop/release-download.cjs');

test('desktop updates use the published platform version and do not count future releases', () => {
  const manifest = {
    version: '0.8.5',
    releases: ['99.0.0', '0.8.5', '0.8.4', '0.8.3', '0.8.2'],
    platforms: {
      windows: { available: true, version: '0.8.5', url: '/downloads/Kivuno-0.8.5-Setup.exe' },
      macos: {
        available: true,
        version: '0.8.4',
        url: 'https://test.public.blob.vercel-storage.com/downloads/Kivuno-0.8.4-macOS-arm64.dmg',
      },
    },
  };
  const mac = desktopUpdate(manifest, '0.8.4', 'darwin', 'arm64', 'https://kivuno.vercel.app');
  assert.equal(mac.status.hasUpdate, false);
  assert.equal(mac.status.latestVersion, '0.8.4');
  assert.equal(mac.downloadUrl, '');
  const windows = desktopUpdate(manifest, '0.8.2', 'win32', 'x64', 'https://kivuno.vercel.app');
  assert.equal(windows.status.newerReleaseCount, 3);
  assert.equal(windows.status.required, true);
  assert.match(windows.downloadUrl, /0\.8\.5-Setup\.exe$/);
  const olderMac = desktopUpdate(manifest, '0.8.2', 'darwin', 'arm64', 'https://kivuno.vercel.app');
  assert.equal(olderMac.status.newerReleaseCount, 2);
  assert.equal(olderMac.status.required, false);
  manifest.platforms.windows.url = 'https://attacker.test/downloads/Kivuno-0.8.5-Setup.exe';
  assert.throws(
    () => desktopUpdate(manifest, '0.8.2', 'win32', 'x64', 'https://kivuno.vercel.app'),
    /invalid installer/,
  );
});

test('macOS updates accept only version-matched GitHub release assets and trusted redirects', () => {
  const manifest = {
    version: '0.8.5',
    platforms: {
      macos: {
        available: true,
        version: '0.8.5',
        url: 'https://kivuno.vercel.app/downloads/Kivuno-0.8.5-macOS-arm64.dmg',
        autoUpdate: {
          version: '0.8.5',
          url: 'https://github.com/dakiemdarktharr/WWW/releases/download/v0.8.5/Kivuno-0.8.5-macOS-arm64.zip',
          sha256: 'a'.repeat(64),
          size: 1024,
          platform: 'darwin-arm64',
          format: 'zip',
        },
      },
    },
  };
  const update = desktopUpdate(manifest, '0.8.4', 'darwin', 'arm64', 'https://kivuno.vercel.app');
  assert.equal(update.status.downloadAvailable, true);
  assert.equal(update.downloadUrl, manifest.platforms.macos.autoUpdate.url);
  assert.equal(update.updateArtifact.size, 1024);
  const { autoUpdate: _autoUpdate, ...macosWithoutZip } = manifest.platforms.macos;
  const dmgFallback = {
    ...manifest,
    platforms: { ...manifest.platforms, macos: macosWithoutZip },
  };
  assert.equal(
    desktopUpdate(dmgFallback, '0.8.4', 'darwin', 'arm64', 'https://kivuno.vercel.app').downloadUrl,
    'https://kivuno.vercel.app/downloads/Kivuno-0.8.5-macOS-arm64.dmg',
  );
  assert.equal(githubMacReleaseAsset(manifest.platforms.macos.autoUpdate.url, '.zip'), true);
  assert.equal(
    githubMacReleaseAsset(
      'https://github.com/other/repo/releases/download/v0.8.5/Kivuno-0.8.5-macOS-arm64.zip',
      '.zip',
    ),
    false,
  );
  assert.equal(
    githubMacReleaseAsset(
      'https://github.com/dakiemdarktharr/WWW/releases/download/v0.8.4/Kivuno-0.8.5-macOS-arm64.zip',
      '.zip',
    ),
    false,
  );
  assert.equal(
    trustedMacUpdateRedirect(
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/file?sig=x',
    ),
    true,
  );
  assert.equal(
    trustedMacUpdateRedirect('https://release-assets.githubusercontent.com.evil.test/file'),
    false,
  );
  manifest.platforms.macos.autoUpdate.url =
    'https://github.com/dakiemdarktharr/WWW/releases/download/v0.8.4/Kivuno-0.8.5-macOS-arm64.zip';
  assert.throws(
    () => desktopUpdate(manifest, '0.8.4', 'darwin', 'arm64', 'https://kivuno.vercel.app'),
    /invalid installer link/,
  );
});

test('macOS updater follows GitHub asset redirects and rejects untrusted hosts', async () => {
  const releaseUrl =
    'https://github.com/dakiemdarktharr/WWW/releases/download/v0.8.5/Kivuno-0.8.5-macOS-arm64.zip';
  const assetUrl =
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/file?sig=test';
  const requests: Array<{ url: string; redirect: string }> = [];
  const response = await fetchMacUpdate(releaseUrl, {
    fetchImpl: async (url: string | URL, options: { redirect: string }) => {
      requests.push({ url: String(url), redirect: options.redirect });
      return requests.length === 1
        ? new Response(null, { status: 302, headers: { location: assetUrl } })
        : new Response('verified artifact', { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [
    { url: releaseUrl, redirect: 'manual' },
    { url: assetUrl, redirect: 'manual' },
  ]);

  await assert.rejects(
    fetchMacUpdate(releaseUrl, {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.test/Kivuno.zip' },
        }),
    }),
    /unapproved download host/,
  );
});

test('Linux credentials require an OS keyring for both reading and writing sessions', () => {
  const storage = (available: boolean, backend: string) => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
  });
  assert.equal(secureCredentialStorage(storage(false, 'gnome_libsecret'), 'linux'), false);
  for (const backend of ['basic_text', 'unknown', 'other'])
    assert.equal(secureCredentialStorage(storage(true, backend), 'linux'), false);
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])
    assert.equal(secureCredentialStorage(storage(true, backend), 'linux'), true);
  assert.equal(secureCredentialStorage(storage(true, 'unknown'), 'win32'), true);
  assert.equal(secureCredentialStorage(storage(false, 'unknown'), 'win32'), false);
});

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
  const request = { projectId: '5fa318a2-aaf7-40fc-966d-13e69a1e0607', projectName: 'Demo' };
  const toolOnly = machineConfiguration(
    { ...input, executionRequest: request },
    'https://relay.example',
    root,
  );
  assert.deepEqual(toolOnly.executionRequest, request);
  assert.equal(toolOnly.executionGrant, undefined);
  assert.throws(() =>
    machineConfiguration(
      {
        ...input,
        executionGrant: {
          ...request,
          id,
          fullAccess: true,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
      'https://relay.example',
      root,
    ),
  );
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
      SADE_QWEN_API_KEY: 'never-copy',
      DASHSCOPE_API_KEY: 'never-copy',
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
