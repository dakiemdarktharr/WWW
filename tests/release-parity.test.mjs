import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  verifyPublishedDesktopFeed,
  verifyReleaseParity,
} from '../scripts/verify-release-parity.mjs';

function macMetadata(version) {
  const prefix = `Kivuno-${version}-macOS-arm64`;
  const downloads = 'https://kivuno.vercel.app/downloads/';
  return {
    version,
    platform: 'darwin-arm64',
    url: downloads + prefix + '.dmg',
    sha256: 'a'.repeat(64),
    size: 100,
    autoUpdate: {
      version,
      platform: 'darwin-arm64',
      format: 'zip',
      url: downloads + prefix + '.zip',
      assetSource:
        `https://github.com/dakiemdarktharr/WWW/releases/download/v${version}-macos/` +
        prefix +
        '.zip',
      sha256: 'b'.repeat(64),
      size: 90,
    },
  };
}

async function releaseRepo(t, version, mac, { includeDmgRedirect = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-release-parity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'release-artifacts'));
  const dmgPath = new URL(mac.url).pathname;
  const dmgSource = `https://github.com/dakiemdarktharr/WWW/releases/download/v${mac.version}-macos/${path.basename(dmgPath)}`;
  const files = {
    'package.json': { version },
    'release-history.json': [version],
    'release-artifacts/macos-stable.json': { version: mac.version },
    [`release-artifacts/macos-${mac.version}.json`]: mac,
    'vercel.json': {
      redirects: includeDmgRedirect ? [{ source: dmgPath, destination: dmgSource }] : [],
    },
  };
  await Promise.all(
    Object.entries(files).map(([file, value]) =>
      writeFile(path.join(root, file), JSON.stringify(value)),
    ),
  );
  return { root, dmgSource };
}

test('a new Windows/Linux version cannot ship with an older Mac version', async (t) => {
  const { root } = await releaseRepo(t, '0.9.10', macMetadata('0.9.8'));
  await assert.rejects(verifyReleaseParity(root), /0\.9\.10 requires the same macOS version/);
});

test('the already published 0.9.9 and 0.9.8 pair can still be redeployed', async (t) => {
  const { root } = await releaseRepo(t, '0.9.9', macMetadata('0.9.8'));
  const result = await verifyReleaseParity(root, () => assert.fail('No new release to check'));
  assert.equal(result.existingRelease, true);
});

test('matching Mac version requires the update ZIP and a public DMG route', async (t) => {
  const mac = macMetadata('0.9.10');
  const noZip = await releaseRepo(t, '0.9.10', { ...mac, autoUpdate: undefined });
  await assert.rejects(verifyReleaseParity(noZip.root), /DMG and update ZIP metadata/);

  const noRedirect = await releaseRepo(t, '0.9.10', mac, { includeDmgRedirect: false });
  await assert.rejects(verifyReleaseParity(noRedirect.root), /macOS-arm64\.dmg/);
});

test('an unavailable or truncated Mac artifact prevents release', async (t) => {
  const mac = macMetadata('0.9.10');
  const { root, dmgSource } = await releaseRepo(t, '0.9.10', mac);
  const fetchAsset = async (url) =>
    new Response(null, {
      status: url.href === dmgSource ? 404 : 200,
      headers: { 'content-length': mac.autoUpdate.size - 1 },
    });
  await assert.rejects(verifyReleaseParity(root, fetchAsset), /unavailable or has the wrong size/);
});

test('publication requires verified artifacts and all three versions in the update feed', async (t) => {
  const version = '0.9.10';
  const mac = macMetadata(version);
  const { root, dmgSource } = await releaseRepo(t, version, mac);
  const assets = new Map([
    [dmgSource, mac.size],
    [mac.autoUpdate.assetSource, mac.autoUpdate.size],
  ]);
  const fetched = [];
  const parity = await verifyReleaseParity(root, async (url, { method }) => {
    assert.equal(method, 'HEAD');
    assert.ok(assets.has(url.href));
    fetched.push(url.href);
    return new Response(null, { headers: { 'content-length': assets.get(url.href) } });
  });
  assert.deepEqual(fetched.sort(), [...assets.keys()].sort());

  const release = {
    version,
    platforms: {
      windows: { version, available: true },
      linux: { version, available: true },
      macos: { ...mac, available: true },
    },
  };
  assert.doesNotThrow(() => verifyPublishedDesktopFeed(release, parity));
  release.platforms.linux.available = false;
  assert.throws(() => verifyPublishedDesktopFeed(release, parity), /lacks the linux package/);
  release.platforms.macos.autoUpdate = { ...mac.autoUpdate, sha256: 'f'.repeat(64) };
  assert.throws(() => verifyPublishedDesktopFeed(release, parity), /verified macOS/);
});
