import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import releaseDownload from '../desktop/release-download.cjs';
import desktopSecurity from '../desktop/security.cjs';

export const releaseManifestName = 'kivuno-desktop-release.json';
const repository = 'dakiemdarktharr/WWW';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256 = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const legacyVersion = '0.9.11';
const portal = 'https://kivuno.vercel.app';

export function compareVersions(left, right) {
  if (!stableVersion.test(left) || !stableVersion.test(right))
    throw new Error('Invalid release version.');
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  return (
    leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2]
  );
}

export const isAutomatedRelease = (version) => compareVersions(version, legacyVersion) > 0;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function readDesktopReleaseSource(root) {
  const [pkg, desktop, history] = await Promise.all(
    ['package.json', 'desktop/package.json', 'release-history.json'].map((file) =>
      readJson(path.join(root, file)),
    ),
  );
  const { version } = pkg;
  if (
    typeof version !== 'string' ||
    !stableVersion.test(version) ||
    desktop.version !== version ||
    !Array.isArray(history) ||
    history[0] !== version ||
    history.some((entry) => typeof entry !== 'string' || !stableVersion.test(entry)) ||
    new Set(history).size !== history.length
  )
    throw new Error(
      'The root package, desktop package and release history must agree on the version.',
    );
  return { version, history };
}

const githubAssetUrl = (version, filename) =>
  `https://github.com/${repository}/releases/download/v${version}/${filename}`;

export function desktopReleaseFiles(version) {
  if (!stableVersion.test(version)) throw new Error('Invalid release version.');
  return {
    windows: { filename: `Kivuno-${version}-Setup.exe`, platform: 'win32-x64' },
    linux: { filename: `Kivuno-${version}-linux-x64.tar.gz`, platform: 'linux-x64' },
    macos: { filename: `Kivuno-${version}-macOS-arm64.dmg`, platform: 'darwin-arm64' },
    macosUpdate: { filename: `Kivuno-${version}-macOS-arm64.zip`, platform: 'darwin-arm64' },
  };
}

export function validateReleaseManifest(manifest, version) {
  if (manifest?.version !== version || !sha.test(manifest.commit ?? ''))
    throw new Error(`Release manifest does not identify Kivuno ${version} and its source commit.`);
  const files = Object.entries(desktopReleaseFiles(version));
  if (Object.keys(manifest.artifacts ?? {}).length !== files.length)
    throw new Error('The release manifest must contain exactly four desktop artifacts.');
  for (const [name, expected] of files) {
    const item = manifest.artifacts?.[name];
    if (
      item?.version !== version ||
      item.filename !== expected.filename ||
      item.platform !== expected.platform ||
      !sha256.test(item.sha256 ?? '') ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1
    )
      throw new Error(`Missing or inconsistent ${name} release asset for ${version}.`);
  }
  return manifest;
}

export async function verifyLocalReleaseAssets(directory, manifest) {
  validateReleaseManifest(manifest, manifest.version);
  await Promise.all(
    Object.values(manifest.artifacts).map(async ({ filename, size, sha256: digest }) => {
      const file = path.join(directory, filename);
      const checksum = await readFile(file + '.sha256', 'utf8');
      const info = await stat(file);
      if (!info.isFile() || info.size !== size || checksum.trim() !== `${digest}  ${filename}`)
        throw new Error(`Size or checksum file does not match ${filename}.`);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== digest) throw new Error(`SHA-256 does not match ${filename}.`);
    }),
  );
}

export async function assembleDesktopRelease(root, directory, commit) {
  const { version } = await readDesktopReleaseSource(root);
  const [pc, macos] = await Promise.all(
    ['pc-release.json', 'macos-arm64.json'].map((file) => readJson(path.join(directory, file))),
  );
  const { windows, linux } = pc.platforms ?? {};
  const expected = desktopReleaseFiles(version);
  if (
    pc.version !== version ||
    !windows?.available ||
    !linux?.available ||
    windows.url !== `/downloads/${expected.windows.filename}` ||
    linux.url !== `/downloads/${expected.linux.filename}` ||
    macos.autoUpdate?.format !== 'zip'
  )
    throw new Error(`Packagers did not produce all Kivuno ${version} candidates.`);

  const manifest = validateReleaseManifest(
    {
      version,
      commit,
      artifacts: {
        windows: { ...windows, filename: expected.windows.filename },
        linux: { ...linux, filename: expected.linux.filename },
        macos: { ...macos, size: macos.bytes },
        macosUpdate: macos.autoUpdate,
      },
    },
    version,
  );
  // Keep the published contract limited to data shared by the four artifacts.
  for (const [key, item] of Object.entries(manifest.artifacts)) {
    const { version, filename, platform, size, sha256 } = item;
    manifest.artifacts[key] = { version, filename, platform, size, sha256 };
  }
  await verifyLocalReleaseAssets(directory, manifest);
  await writeJson(path.join(directory, releaseManifestName), manifest);
  return manifest;
}

export function verifyGitHubReleaseAssets(release, manifest) {
  if (release.tag_name !== `v${manifest.version}` || release.target_commitish !== manifest.commit)
    throw new Error('The GitHub Release does not target the verified desktop source.');
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const item of Object.values(manifest.artifacts)) {
    const asset = assets.get(item.filename);
    if (
      asset?.state !== 'uploaded' ||
      asset.size !== item.size ||
      asset.digest !== `sha256:${item.sha256}` ||
      (!release.draft &&
        asset.browser_download_url !== githubAssetUrl(manifest.version, item.filename)) ||
      assets.get(item.filename + '.sha256')?.state !== 'uploaded'
    )
      throw new Error(
        `GitHub did not receive the verified package and checksum for ${item.filename}.`,
      );
  }
  const metadata = assets.get(releaseManifestName);
  if (
    metadata?.state !== 'uploaded' ||
    metadata.size < 1 ||
    metadata.size > 16_384 ||
    !/^sha256:[a-f0-9]{64}$/.test(metadata.digest ?? '') ||
    (!release.draft &&
      metadata.browser_download_url !== githubAssetUrl(manifest.version, releaseManifestName))
  )
    throw new Error('GitHub did not receive the verified desktop release manifest.');
  return metadata;
}

async function fetchGitHubAsset(url, { signal, fetchAsset = fetch } = {}) {
  const response = await fetchAsset(url, { redirect: 'manual', signal });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  const next = new URL(response.headers.get('location') || '', url);
  await response.body?.cancel();
  if (!desktopSecurity.trustedMacUpdateRedirect(next.href))
    throw new Error('The GitHub release file redirected to an unexpected host.');
  return fetchAsset(next, { redirect: 'error', signal });
}

export async function waitForPublishedDesktopRelease(
  version,
  { timeout = 0, fetchAsset = fetch } = {},
) {
  const deadline = Date.now() + timeout;
  const url = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
  while (true) {
    const response = await fetchAsset(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      const release = await response.json();
      if (!release.draft && !release.prerelease) {
        const reference = release.assets.find((asset) => asset.name === releaseManifestName);
        if (!reference || reference.size < 1 || reference.size > 16_384)
          throw new Error(`The published v${version} release lacks its verified desktop manifest.`);
        const download = await fetchGitHubAsset(githubAssetUrl(version, releaseManifestName), {
          fetchAsset,
          signal: AbortSignal.timeout(20000),
        });
        if (!download.ok) throw new Error(`Cannot download the v${version} release manifest.`);
        const bytes = Buffer.from(await download.arrayBuffer());
        const manifest = validateReleaseManifest(JSON.parse(bytes.toString('utf8')), version);
        const asset = verifyGitHubReleaseAssets(release, manifest);
        if (
          bytes.length !== asset.size ||
          `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest
        )
          throw new Error('The downloaded GitHub release manifest failed integrity verification.');
        return manifest;
      }
    } else if (response.status !== 404) {
      throw new Error(
        `Cannot look up the GitHub Release for v${version} (HTTP ${response.status}).`,
      );
    }
    if (Date.now() >= deadline)
      throw new Error(`The verified GitHub Release v${version} is pending.`);
    await wait(Math.min(45_000, Math.max(0, deadline - Date.now())));
  }
}

export async function mirrorDesktopRelease(downloads, manifest, history, fetchAsset = fetch) {
  validateReleaseManifest(manifest, history[0]);
  const { version, artifacts } = manifest;
  await mkdir(downloads, { recursive: true });
  for (const [name, item] of Object.entries(artifacts)) {
    if (name === 'macos') continue; // The installer DMG is downloaded directly from GitHub.
    const destination = path.join(downloads, item.filename);
    await releaseDownload.downloadUpdate(
      { ...item, url: githubAssetUrl(version, item.filename) },
      destination,
      () => {},
      { fetchImpl: (url, { signal }) => fetchGitHubAsset(url, { signal, fetchAsset }) },
    );
    await writeFile(destination + '.sha256', `${item.sha256}  ${item.filename}\n`);
    console.log(`Mirrored verified GitHub release asset: ${item.filename}`);
  }
  const entry = ({ version, platform, size, sha256 }, url) => ({
    available: true,
    version,
    platform,
    size,
    sha256,
    url,
    signed: false,
  });
  const windows = entry(artifacts.windows, `/downloads/${artifacts.windows.filename}`);
  const linux = entry(artifacts.linux, `/downloads/${artifacts.linux.filename}`);
  const macos = entry(artifacts.macos, githubAssetUrl(version, artifacts.macos.filename));
  const update = artifacts.macosUpdate;
  const autoUpdate = {
    version,
    platform: update.platform,
    sha256: update.sha256,
    size: update.size,
    url: `${portal}/downloads/${update.filename}`,
    format: 'zip',
  };
  await writeJson(path.join(downloads, 'release.json'), {
    ...windows,
    releases: history,
    platforms: {
      windows: { ...windows, stagedUpdate: true },
      linux,
      macos: { ...macos, notarized: false, autoUpdate },
    },
  });
}
