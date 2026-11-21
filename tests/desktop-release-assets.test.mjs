import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import desktopSecurity from '../desktop/security.cjs';
import {
  assembleDesktopRelease,
  desktopReleaseFiles,
  mirrorDesktopRelease,
  releaseManifestName,
  verifyGitHubReleaseAssets,
  waitForPublishedDesktopRelease,
} from '../scripts/desktop-release-assets.mjs';

const version = '0.9.12';
const commit = 'b'.repeat(40);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const githubRoot = `https://github.com/dakiemdarktharr/WWW/releases/download/v${version}/`;

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = path.join(root, 'release');
  await mkdir(path.join(root, 'desktop'));
  await mkdir(release);
  const artifacts = {};
  for (const [name, file] of Object.entries(desktopReleaseFiles(version))) {
    const data = Buffer.from(`package for ${name}`);
    artifacts[name] = { ...file, size: data.length, sha256: hash(data), version };
    await writeFile(path.join(release, file.filename), data);
    await writeFile(
      path.join(release, file.filename + '.sha256'),
      `${hash(data)}  ${file.filename}\n`,
    );
  }
  const { windows, linux, macos, macosUpdate } = artifacts;
  const pc = {
    version,
    platforms: {
      windows: { ...windows, available: true, url: `/downloads/${windows.filename}` },
      linux: { ...linux, available: true, url: `/downloads/${linux.filename}` },
    },
  };
  const mac = { ...macos, bytes: macos.size, autoUpdate: { ...macosUpdate, format: 'zip' } };
  const json = {
    'package.json': { version },
    'desktop/package.json': { version },
    'release-history.json': [version, '0.9.11'],
    'release/pc-release.json': pc,
    'release/macos-arm64.json': mac,
  };
  await Promise.all(
    Object.entries(json).map(([file, value]) =>
      writeFile(path.join(root, file), JSON.stringify(value)),
    ),
  );
  return { root, release, pc, artifacts };
}

test('a failed or mismatched platform cannot produce a publishable release manifest', async (t) => {
  const { root, release, pc, artifacts } = await fixture(t);
  const manifest = await assembleDesktopRelease(root, release, commit);
  assert.deepEqual(manifest, { version, commit, artifacts });
  pc.platforms.linux.version = '0.9.11';
  await writeFile(path.join(release, 'pc-release.json'), JSON.stringify(pc));
  await assert.rejects(assembleDesktopRelease(root, release, commit), /inconsistent linux/);
  pc.platforms.linux.version = version;
  await writeFile(path.join(release, 'pc-release.json'), JSON.stringify(pc));
  await writeFile(path.join(release, artifacts.macosUpdate.filename), 'invalid data');
  await assert.rejects(assembleDesktopRelease(root, release, commit), /does not match/);
});

test('the portal consumes only a complete stable GitHub Release with matching asset digests', async (t) => {
  const { root, release } = await fixture(t);
  const manifest = await assembleDesktopRelease(root, release, commit);
  const bytes = await readFile(path.join(release, releaseManifestName));
  const asset = (name, size, digest) => ({
    name,
    size,
    digest: `sha256:${digest}`,
    state: 'uploaded',
    browser_download_url: githubRoot + name,
  });
  const github = {
    tag_name: `v${version}`,
    target_commitish: commit,
    draft: false,
    prerelease: false,
    assets: [
      ...Object.values(manifest.artifacts).flatMap(({ filename, size, sha256 }) => [
        asset(filename, size, sha256),
        asset(filename + '.sha256', 90, hash(filename)),
      ]),
      asset(releaseManifestName, bytes.length, hash(bytes)),
    ],
  };
  const fetchAsset = async (url) =>
    String(url).startsWith(githubRoot) ? new Response(bytes) : Response.json(github);
  assert.deepEqual(await waitForPublishedDesktopRelease(version, { fetchAsset }), manifest);
  github.prerelease = true;
  await assert.rejects(waitForPublishedDesktopRelease(version, { fetchAsset }), /is pending/);
  github.prerelease = false;
  github.assets[0].digest = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => verifyGitHubReleaseAssets(github, manifest), /did not receive/);
});

test('the deployed feed preserves first-party updater URLs and mirrors the verified bytes', async (t) => {
  const { root, release } = await fixture(t);
  const manifest = await assembleDesktopRelease(root, release, commit);
  const downloads = path.join(root, 'downloads');
  const requested = [];
  await mirrorDesktopRelease(downloads, manifest, [version, '0.9.11'], async (url) => {
    assert.ok(String(url).startsWith(githubRoot));
    const filename = new URL(url).pathname.split('/').at(-1);
    requested.push(filename);
    const bytes = await readFile(path.join(release, filename));
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  });
  assert.deepEqual(
    requested,
    ['windows', 'linux', 'macosUpdate'].map((name) => manifest.artifacts[name].filename),
  );
  const feed = JSON.parse(await readFile(path.join(downloads, 'release.json'), 'utf8'));
  assert.equal(feed.platforms.macos.url, githubRoot + manifest.artifacts.macos.filename);
  const portal = 'https://kivuno.vercel.app';
  for (const [os, arch, name] of [
    ['win32', 'x64', 'windows'],
    ['linux', 'x64', 'linux'],
    ['darwin', 'arm64', 'macosUpdate'],
  ]) {
    const { status, updateArtifact } = desktopSecurity.desktopUpdate(
      feed,
      '0.9.11',
      os,
      arch,
      portal,
    );
    const { filename, sha256 } = manifest.artifacts[name];
    assert.equal(status.downloadAvailable, true);
    assert.equal(updateArtifact.url, `${portal}/downloads/${filename}`);
    assert.equal(hash(await readFile(path.join(downloads, filename))), sha256);
  }
});
