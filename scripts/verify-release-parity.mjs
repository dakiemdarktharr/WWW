import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import desktopSecurity from '../desktop/security.cjs';
import { isAutomatedRelease, readDesktopReleaseSource } from './desktop-release-assets.mjs';

const portalOrigin = 'https://kivuno.vercel.app';
const macPlatform = 'darwin-arm64';
const sha256 = /^[a-f0-9]{64}$/i;
const stableVersion = /^\d+\.\d+\.\d+$/;

function artifactUrl(artifact, filename) {
  if (
    !URL.canParse(artifact?.url) ||
    !sha256.test(artifact.sha256 ?? '') ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0
  )
    throw new Error(`Missing URL, SHA-256 or size for ${filename}.`);
  const url = new URL(artifact.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(`/${filename}`)
  )
    throw new Error(`Use a stable, versioned HTTPS URL for ${filename}.`);
  return url;
}

async function verifyPublicAsset(url, artifact, fetchAsset) {
  const response = await fetchAsset(url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) !== artifact.size)
    throw new Error(`macOS artifact is unavailable or has the wrong size: ${url}`);
}

export async function verifyReleaseParity(root, fetchAsset = fetch) {
  const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
  const [{ version }, history, macosPointer] = await Promise.all([
    readJson('package.json'),
    readJson('release-history.json'),
    readJson('release-artifacts/macos-stable.json'),
  ]);
  if (!stableVersion.test(version ?? '') || history?.[0] !== version)
    throw new Error('package.json and release-history.json must agree on the desktop version.');

  const macVersion = macosPointer?.version;
  // Permit web redeployments of the existing feed until macOS catches up.
  const existingRelease = version === '0.9.9' && macVersion === '0.9.8';
  if (macVersion !== version && !existingRelease)
    throw new Error(`Kivuno ${version} requires the same macOS version (found ${macVersion}).`);

  const metadata = await readJson(`release-artifacts/macos-${macVersion}.json`);
  const update = metadata.autoUpdate;
  if (
    metadata.version !== macVersion ||
    metadata.platform !== macPlatform ||
    update?.version !== macVersion ||
    update.platform !== macPlatform ||
    update.format !== 'zip'
  )
    throw new Error(
      `Kivuno ${macVersion} requires matching Apple Silicon DMG and update ZIP metadata.`,
    );

  const dmgName = `Kivuno-${macVersion}-macOS-arm64.dmg`;
  const zipName = `Kivuno-${macVersion}-macOS-arm64.zip`;
  let dmgSource = artifactUrl(metadata, dmgName);
  let zipSource = artifactUrl(update, zipName);
  if (!existingRelease) {
    if (dmgSource.origin === portalOrigin) {
      const { redirects } = await readJson('vercel.json');
      const destination = redirects?.find(
        (rule) => rule.source === dmgSource.pathname,
      )?.destination;
      dmgSource = artifactUrl({ ...metadata, url: destination }, dmgName);
      if (dmgSource.origin === portalOrigin)
        throw new Error(`Point the portal's macOS DMG redirect at its public release asset.`);
    }
    if (zipSource.origin === portalOrigin) {
      zipSource = artifactUrl({ ...update, url: update.assetSource }, zipName);
      if (!desktopSecurity.githubMacReleaseAsset(zipSource.href, '.zip'))
        throw new Error('Set the portal update ZIP source to its GitHub release asset.');
    }
    await Promise.all([
      verifyPublicAsset(dmgSource, metadata, fetchAsset),
      verifyPublicAsset(zipSource, update, fetchAsset),
    ]);
  }
  return { version, metadata, existingRelease };
}

export function verifyPublishedDesktopFeed(release, { version, metadata, existingRelease }) {
  const macos = release.platforms?.macos;
  const matches = (artifact, expected) =>
    artifact?.version === expected.version &&
    artifact.platform === expected.platform &&
    artifact.url === expected.url &&
    artifact.size === expected.size &&
    artifact.sha256 === expected.sha256.toLowerCase();
  if (
    release.version !== version ||
    !macos?.available ||
    !matches(macos, metadata) ||
    !matches(macos.autoUpdate, metadata.autoUpdate) ||
    macos.autoUpdate.format !== 'zip'
  )
    throw new Error(
      'The generated update feed does not match the verified macOS release metadata.',
    );
  if (!existingRelease) {
    for (const platform of ['windows', 'linux']) {
      const artifact = release.platforms?.[platform];
      if (!artifact?.available || artifact.version !== version)
        throw new Error(`The generated update feed lacks the ${platform} package for ${version}.`);
    }
  }
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { version } = await readDesktopReleaseSource(root);
  if (isAutomatedRelease(version)) {
    console.log(
      `Kivuno ${version} version files agree. Desktop Release will check the built artifacts.`,
    );
  } else {
    const { metadata, existingRelease } = await verifyReleaseParity(root);
    console.log(
      existingRelease
        ? `Existing desktop feed allowed: Windows/Linux ${version}, macOS ${metadata.version}.`
        : `Kivuno ${version} has both macOS release artifacts.`,
    );
  }
}
