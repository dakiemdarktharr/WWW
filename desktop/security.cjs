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
    throw new Error('RELAY identity must use an exact HTTPS origin.');
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
    throw new Error('This link is outside RELAY’s approved sign-in and documentation sites.');
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
    throw new Error('This local workspace belongs to a different RELAY owner.');
  return value;
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
    throw new Error('Choose a RELAY private machine configuration.');
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
    throw new Error('This machine configuration belongs to another RELAY website.');
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

module.exports = {
  cloudOrigin,
  sameOrigin,
  externalUrl,
  pkce,
  validIdentity,
  runtimeEnvironment,
  machineConfiguration,
  previewUrl,
};
