'use strict';

const { createHash, randomBytes } = require('node:crypto');
const path = require('node:path');

function cloudOrigin(value, testing = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.origin !== value ||
    (url.protocol !== 'https:' &&
      !(testing && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
  )
    throw new Error('Kivuno identity must use an exact HTTPS origin.');
  return url.origin;
}

function sameOrigin(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

function externalUrl(value, identityOrigin) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid external link.');
  const url = new URL(value);
  const domains = [
    'openai.com',
    'chatgpt.com',
    'github.com',
    'docs.github.com',
    'build.avax.network',
    'docs.avax.network',
    'explorer.avax.network',
    'explorer-test.avax.network',
    'core.app',
    'team1vn.xyz',
  ];
  const known =
    url.hostname === 'testnet.snowtrace.io' ||
    domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
  if (
    url.username ||
    url.password ||
    (url.origin !== identityOrigin && (url.protocol !== 'https:' || !known))
  )
    throw new Error('This link is outside Kivuno’s approved sign-in and documentation sites.');
  return url.href;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

function previewUrl(value, backendOrigin) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid demo link.');
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const backend = new URL(backendOrigin);
  if (
    url.username ||
    url.password ||
    url.origin === backendOrigin ||
    (loopback && url.port === backend.port) ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback && url.port))
  )
    throw new Error('Demos must use HTTPS or a separate local preview port.');
  return url.href;
}

function validIdentity(value, pinnedOwner) {
  if (
    !value ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length < 32 ||
    value.accessToken.length > 4096 ||
    !value.owner ||
    typeof value.owner.id !== 'string' ||
    !value.owner.id ||
    typeof value.owner.name !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.now()
  )
    throw new Error('The identity server returned an invalid desktop session.');
  if (pinnedOwner && value.owner.id !== pinnedOwner)
    throw new Error('This local workspace belongs to a different Kivuno owner.');
  return value;
}

function secureCredentialStorage(storage, platform) {
  if (!storage.isEncryptionAvailable()) return false;
  return (
    platform !== 'linux' ||
    ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
      storage.getSelectedStorageBackend(),
    )
  );
}

function runtimeEnvironment(source, additions) {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'APPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'SHELL',
    'SSH_AUTH_SOCK',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]);
  const environment = Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())),
  );
  for (const key of Object.keys(additions))
    for (const existing of Object.keys(environment))
      if (existing.toUpperCase() === key.toUpperCase()) delete environment[existing];
  return { ...environment, ...additions };
}

function machineConfiguration(value, identityOrigin, privateRoot) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose a Kivuno private machine configuration.');
  const fields = new Set([
    'origin',
    'id',
    'token',
    'name',
    'dataDir',
    'slots',
    'maxLoad',
    'minFreeMB',
    'exchangeUrl',
    'bridgeKey',
  ]);
  if (Object.keys(value).some((key) => !fields.has(key)))
    throw new Error('The machine configuration contains unsupported settings.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id || ''))
    throw new Error('The machine identity is invalid.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.token || ''))
    throw new Error('The private machine credential is invalid.');
  const origin = cloudOrigin(value.origin);
  if (origin !== identityOrigin)
    throw new Error('This machine configuration belongs to another Kivuno website.');
  const exchange = new URL(value.exchangeUrl || `${origin}/api/runner/exchange`);
  if (
    exchange.origin !== origin ||
    exchange.username ||
    exchange.password ||
    exchange.hash ||
    !['/api/runner/exchange', '/api/desktop/bridge/exchange'].includes(exchange.pathname)
  )
    throw new Error('The machine exchange address is invalid.');
  if (exchange.pathname === '/api/desktop/bridge/exchange') {
    if (
      !/^[0-9a-f-]{36}$/i.test(exchange.searchParams.get('host') || '') ||
      [...exchange.searchParams.keys()].some((key) => key !== 'host') ||
      exchange.searchParams.getAll('host').length !== 1 ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(value.bridgeKey || '')
    )
      throw new Error('The private desktop bridge configuration is incomplete.');
  } else if (exchange.search || value.bridgeKey)
    throw new Error('The direct machine exchange contains unexpected settings.');
  const slots = value.slots === undefined ? 1 : value.slots;
  const maxLoad = value.maxLoad === undefined ? 3 : value.maxLoad;
  const minFreeMB = value.minFreeMB === undefined ? 2048 : value.minFreeMB;
  if (
    !Number.isInteger(slots) ||
    slots < 1 ||
    slots > 4 ||
    !Number.isFinite(maxLoad) ||
    maxLoad < 0.1 ||
    maxLoad > 64 ||
    !Number.isInteger(minFreeMB) ||
    minFreeMB < 512 ||
    minFreeMB > 65536
  )
    throw new Error('Machine resource limits are outside the supported range.');
  if (!path.isAbsolute(privateRoot))
    throw new Error('Machine storage must use the desktop private directory.');
  return {
    id: value.id.toLowerCase(),
    origin,
    token: value.token,
    dataDir: path.join(privateRoot, value.id.toLowerCase(), 'state'),
    slots,
    maxLoad,
    minFreeMB,
    ...(value.exchangeUrl ? { exchangeUrl: exchange.href } : {}),
    ...(value.bridgeKey ? { bridgeKey: value.bridgeKey } : {}),
  };
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function releaseForThisPlatform(manifest, platform, arch) {
  if (platform === 'win32' && arch === 'x64')
    return { key: 'windows', suffix: '.exe', item: manifest.platforms?.windows || manifest };
  if (platform === 'darwin' && arch === 'arm64')
    return { key: 'macos', suffix: '.dmg', item: manifest.platforms?.macos };
  if (platform === 'linux' && arch === 'x64')
    return { key: 'linux', suffix: '.tar.gz', item: manifest.platforms?.linux };
  return null;
}

function validatedReleaseUrl(item, suffix, identityOrigin) {
  if (!item || item.available !== true || typeof item.url !== 'string') return '';
  const url = new URL(item.url, identityOrigin);
  const trustedOrigin =
    url.origin === identityOrigin ||
    (url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com'));
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !trustedOrigin ||
    !/^\/downloads\/Kivuno-[a-zA-Z0-9._-]+$/.test(url.pathname) ||
    !url.pathname.toLowerCase().endsWith(suffix)
  )
    throw new Error('Kivuno returned an invalid installer link.');
  return url.href;
}

function validatedMacAutoUpdate(item, expectedVersion, identityOrigin) {
  const artifact = item?.autoUpdate;
  if (artifact === undefined) return null;
  if (
    !artifact ||
    typeof artifact.url !== 'string' ||
    artifact.version !== expectedVersion ||
    artifact.platform !== 'darwin-arm64' ||
    artifact.format !== 'zip' ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    artifact.size > 4 * 1024 * 1024 * 1024
  )
    throw new Error('Kivuno returned invalid macOS update metadata.');
  const url = validatedReleaseUrl({ available: true, url: artifact.url }, '.zip', identityOrigin);
  return { url, sha256: artifact.sha256.toLowerCase(), size: artifact.size };
}

function desktopUpdate(body, currentVersion, platform, arch, identityOrigin) {
  const platformRelease = releaseForThisPlatform(body, platform, arch);
  const latestVersion = platformRelease?.item?.version || body.version;
  if (!versionParts(currentVersion) || !versionParts(latestVersion))
    throw new Error('Kivuno returned an invalid release version.');
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  const versions = Array.isArray(platformRelease?.item?.releases)
    ? platformRelease.item.releases
    : Array.isArray(body.releases)
      ? body.releases
      : [latestVersion];
  const newerReleaseCount = new Set(
    [latestVersion, ...versions].filter(
      (version) =>
        typeof version === 'string' &&
        compareVersions(version, currentVersion) > 0 &&
        compareVersions(version, latestVersion) <= 0,
    ),
  ).size;
  const macAutoUpdate =
    hasUpdate && platformRelease?.key === 'macos'
      ? validatedMacAutoUpdate(platformRelease.item, latestVersion, identityOrigin)
      : null;
  const downloadUrl = hasUpdate
    ? platformRelease?.key === 'macos'
      ? macAutoUpdate?.url || ''
      : validatedReleaseUrl(platformRelease?.item, platformRelease?.suffix, identityOrigin)
    : '';
  return {
    status: {
      currentVersion,
      latestVersion,
      hasUpdate,
      downloadAvailable: Boolean(downloadUrl),
      newerReleaseCount,
      required: Boolean(downloadUrl) && newerReleaseCount >= 3,
    },
    downloadUrl,
    updateArtifact: macAutoUpdate,
  };
}

module.exports = {
  desktopUpdate,
  cloudOrigin,
  sameOrigin,
  externalUrl,
  pkce,
  validIdentity,
  runtimeEnvironment,
  machineConfiguration,
  previewUrl,
  secureCredentialStorage,
};
