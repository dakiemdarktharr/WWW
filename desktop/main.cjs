'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  shell,
  dialog,
  safeStorage,
} = require('electron');
const { spawn, spawnSync, execFile } = require('node:child_process');
const { createServer } = require('node:net');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { constants: fsConstants, createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  rename,
  lstat,
  rm,
} = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const execFileAsync = promisify(execFile);
const { ProjectBrowser } = require('./browser.cjs');
const { workspaceDirectory } = require('./workspaces.cjs');
const { fetchMacUpdate } = require('./release-download.cjs');
const { findExecutable, prepareProvider } = require('./provider-tools.cjs');
const {
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
} = require('./security.cjs');

app.setName('Kivuno');
// Keep the existing storage location across the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'RELAY'));
// Honor Electron's explicit isolated profile switch (also used by release QA).
const explicitProfile = app.commandLine.getSwitchValue('user-data-dir');
if (explicitProfile && path.isAbsolute(explicitProfile))
  app.setPath('userData', path.resolve(explicitProfile));
const testing = !app.isPackaged && process.env.RELAY_DESKTOP_TESTING === '1';
if (testing && process.env.RELAY_DESKTOP_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.RELAY_DESKTOP_DATA_DIR));
const identityOrigin = cloudOrigin(
  (!app.isPackaged && process.env.RELAY_CLOUD_ORIGIN) || 'https://kivuno.vercel.app',
  testing,
);
const dataDirectory = app.getPath('userData');
const identityFile = path.join(dataDirectory, 'desktop-session.bin');
const ownerFile = path.join(dataDirectory, 'workspace-owner.json');
let machinesDirectory = '';
let machinesIndex = '';
const machines = new Map();
let desktopSecret = randomBytes(32).toString('hex');
let window = null;
let tray = null;
let backend = null;
let backendOrigin = '';
let transitionOrigin = '';
let runtime = 'starting';
let identity = null;
let pinnedOwner = '';
let pending = null;
let lastError = '';
let quitting = false;
let signInGeneration = 0;
let bridgeGeneration = 0;
let sharedSadeConsentVersion = 0;
let pendingSharedSadeRevocations = 0;
let profileSyncQueue = Promise.resolve();
let identityTransition = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const projectBrowser = new ProjectBrowser({
  getWindow: () => window,
  getBackendOrigin: () => backendOrigin,
  getOwnerId: () => identity?.owner.id,
  testing,
});

function windowState() {
  return { maximized: Boolean(window?.isMaximized()), fullscreen: Boolean(window?.isFullScreen()) };
}

function status() {
  if (identity && Date.parse(identity.expiresAt) <= Date.now()) {
    void signOutWorkspace().catch(() => {});
  }
  return {
    signedIn: Boolean(identity),
    ...(identity ? { owner: identity.owner } : {}),
    ...(pending
      ? {
          pending: {
            userCode: pending.userCode,
            verificationUri: pending.verificationUri,
            expiresAt: pending.expiresAt,
          },
        }
      : {}),
    ...(lastError ? { error: lastError } : {}),
    runtime: identityTransition ? 'starting' : runtime,
    cloudOrigin: identityOrigin,
    machines: [...machines.values()].map(({ id, name, status, error }) => ({
      id,
      name,
      status,
      ...(error ? { error } : {}),
    })),
  };
}
function publishStatus() {
  if (window && !window.isDestroyed()) window.webContents.send('relay:status-changed', status());
}

async function cloudRequest(route, body, token, timeoutMs = 25000) {
  const response = await fetch(identityOrigin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: identityOrigin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 5 * 1024 * 1024) throw new Error('Identity response is too large.');
  let bodyValue;
  try {
    bodyValue = JSON.parse(raw);
  } catch {
    throw new Error('The Kivuno website is not ready. Try again.');
  }
  return { response, body: bodyValue };
}

async function localControlRequest(route, body, context = {}) {
  const origin = context.origin || backendOrigin;
  const secret = context.secret || desktopSecret;
  if (!origin || !secret) throw new Error('The local Kivuno workspace is not ready.');
  const response = await fetch(origin + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Relay-Desktop': secret,
      'X-Relay-Control': secret,
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('The local Kivuno workspace returned an invalid response.');
  }
  if (!response.ok)
    throw new Error(value.error || 'The local Kivuno workspace rejected the request.');
  return value;
}

async function inspectDesktopUpdate() {
  const { response, body } = await cloudRequest('/api/desktop/release');
  if (!response.ok || !body || typeof body.version !== 'string')
    throw new Error('Could not check for Kivuno updates. Try again later.');
  return desktopUpdate(body, app.getVersion(), process.platform, process.arch, identityOrigin);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appleScriptQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function canWriteDirectory(directory) {
  const probe = path.join(
    directory,
    `.kivuno-update-write-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  try {
    await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
    await unlink(probe);
    return true;
  } catch {
    await unlink(probe).catch(() => {});
    return false;
  }
}

async function prepareMacUpdate(artifact, latestVersion) {
  if (!app.isPackaged || process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('In-app updates are available only in the installed Kivuno macOS app.');
  const updateDirectory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-update-'));
  const archive = path.join(updateDirectory, 'Kivuno-update.zip');
  const extractDirectory = path.join(updateDirectory, 'unpacked');
  try {
    const signal = AbortSignal.timeout(30 * 60 * 1000);
    const response = await fetchMacUpdate(artifact.url, { signal });
    if (!response.ok || !response.body)
      throw new Error(`Could not download the Kivuno update (${response.status}).`);
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== artifact.size)
      throw new Error('The Kivuno update size does not match its release metadata.');
    const digest = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > artifact.size)
          return callback(new Error('The Kivuno update is larger than expected.'));
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      createWriteStream(archive, { flags: 'wx', mode: 0o600 }),
    );
    if (bytes !== artifact.size || digest.digest('hex') !== artifact.sha256)
      throw new Error('The downloaded Kivuno update failed its SHA-256 check.');

    await mkdir(extractDirectory, { mode: 0o700 });
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archive, extractDirectory], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    });
    const candidate = path.join(extractDirectory, 'Kivuno.app');
    const candidateInfo = await lstat(candidate);
    if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink())
      throw new Error('The Kivuno update archive does not contain the expected app.');
    const infoPlist = path.join(candidate, 'Contents', 'Info.plist');
    const { stdout: bundleId } = await execFileAsync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleIdentifier', infoPlist],
      { timeout: 10000, maxBuffer: 4096 },
    );
    const { stdout: bundleVersion } = await execFileAsync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', infoPlist],
      { timeout: 10000, maxBuffer: 4096 },
    );
    if (bundleId.trim() !== 'club.nosleep.relay' || bundleVersion.trim() !== latestVersion)
      throw new Error('The downloaded Kivuno app identity or version is incorrect.');
    await rm(extractDirectory, { recursive: true, force: true });
    return { updateDirectory, archive };
  } catch (error) {
    await rm(updateDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function startMacUpdateHelper(artifact, latestVersion, updateDirectory, archive) {
  const appPath = path.resolve(path.dirname(process.execPath), '..', '..');
  const appInfo = await lstat(appPath);
  if (path.basename(appPath) !== 'Kivuno.app' || !appInfo.isDirectory() || appInfo.isSymbolicLink())
    throw new Error('Could not find the installed Kivuno app to update.');
  const helperPath = path.join(process.resourcesPath, 'mac-update-helper.sh');
  const helperInfo = await lstat(helperPath);
  if (!helperInfo.isFile() || helperInfo.isSymbolicLink())
    throw new Error('The macOS update helper is missing from this Kivuno app.');
  const { stdout: installedBundleId } = await execFileAsync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', path.join(appPath, 'Contents', 'Info.plist')],
    { timeout: 10000, maxBuffer: 4096 },
  );
  if (installedBundleId.trim() !== 'club.nosleep.relay')
    throw new Error('The installed application is not a Kivuno app.');
  const args = [
    appPath,
    archive,
    updateDirectory,
    String(process.pid),
    latestVersion,
    artifact.sha256,
    String(artifact.size),
  ];
  const writable = await canWriteDirectory(path.dirname(appPath));
  if (writable) {
    const child = spawn('/bin/sh', [helperPath, ...args], {
      detached: true,
      stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return;
  }

  let helperIsWritable = false;
  try {
    await access(helperPath, fsConstants.W_OK);
    helperIsWritable = true;
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
  }
  if (helperIsWritable || (await canWriteDirectory(path.dirname(helperPath))))
    throw new Error('The macOS update helper is not protected from modification.');
  const shellCommand = ['/bin/sh', helperPath, ...args].map(shellQuote).join(' ');
  const launchCommand = `/bin/sh -c ${shellQuote(`${shellCommand} >/dev/null 2>&1 < /dev/null & echo $!`)}`;
  const appleScript = `do shell script ${appleScriptQuote(launchCommand)} with administrator privileges`;
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', appleScript], {
    timeout: 120000,
    maxBuffer: 4096,
  });
  if (!/^\d+\s*$/.test(stdout)) throw new Error('Could not start the macOS update helper.');
}

async function installMacUpdate(artifact, latestVersion) {
  const prepared = await prepareMacUpdate(artifact, latestVersion);
  try {
    await startMacUpdateHelper(artifact, latestVersion, prepared.updateDirectory, prepared.archive);
  } catch (error) {
    await rm(prepared.updateDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  app.quit();
}

async function persistIdentity(value) {
  const generation = signInGeneration;
  if (!secureCredentialStorage(safeStorage, process.platform))
    throw new Error(
      'Secure operating-system credential storage is unavailable. Kivuno did not save your session.',
    );
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  const temporary = identityFile + `.${generation}.tmp`;
  await writeFile(temporary, encrypted, { mode: 0o600 });
  if (generation !== signInGeneration) {
    await unlink(temporary).catch(() => {});
    return;
  }
  await rename(temporary, identityFile);
}

async function readIdentity() {
  try {
    pinnedOwner = JSON.parse(await readFile(ownerFile, 'utf8')).id || '';
  } catch {}
  // A fresh launch requires explicit Kivuno authentication. Never open the last
  // user's projects just because this OS account has an encrypted session file.
  identity = null;
  // Retire the previous launch's device lease so normal restarts cannot fill
  // the cloud's active-device limit. A failed cleanup never authenticates UI.
  try {
    // A new profile has no lease to retire and should not prompt for Keychain access.
    const saved = await readFile(identityFile);
    if (secureCredentialStorage(safeStorage, process.platform)) {
      const previous = JSON.parse(safeStorage.decryptString(saved));
      if (typeof previous.accessToken === 'string')
        void cloudRequest('/api/desktop/revoke', {}, previous.accessToken).catch(() => {});
    }
  } catch {}
}

async function clearIdentity() {
  projectBrowser.close();
  identity = null;
  pending = null;
  signInGeneration++;
  bridgeGeneration++;
  publishStatus();
  await stopMachines();
  machines.clear();
  await unlink(identityFile).catch(() => {});
}
async function signOutWorkspace() {
  if (identityTransition) return;
  identityTransition = true;
  const token = identity?.accessToken;
  try {
    await clearIdentity();
    lastError = '';
    if (token) void cloudRequest('/api/desktop/revoke', {}, token).catch(() => {});
    await stopBackend();
    await startBackend();
    await window?.loadURL(backendOrigin);
  } finally {
    identityTransition = false;
    publishStatus();
  }
}

async function beginSignIn() {
  if (identityTransition) throw new Error('Finishing account switch. Try again in a moment.');
  if (identity) return status();
  if (pending && Date.parse(pending.expiresAt) > Date.now()) {
    if (!testing) await shell.openExternal(pending.verificationUri);
    return status();
  }
  const generation = ++signInGeneration;
  lastError = '';
  const proof = pkce();
  try {
    const { response, body } = await cloudRequest('/api/desktop/authorize', {
      challenge: proof.challenge,
      name: `${app.getName()} on ${require('node:os').hostname().slice(0, 80)}`,
    });
    if (!response.ok) throw new Error(body.error || 'Cannot start desktop sign-in.');
    if (generation !== signInGeneration) return status();
    if (
      typeof body.deviceCode !== 'string' ||
      body.deviceCode.length < 24 ||
      typeof body.userCode !== 'string' ||
      body.userCode.length > 30 ||
      !sameOrigin(body.verificationUri, identityOrigin) ||
      !Number.isFinite(Date.parse(body.expiresAt)) ||
      Date.parse(body.expiresAt) <= Date.now()
    )
      throw new Error('The identity server returned an invalid sign-in request.');
    pending = { ...body, verifier: proof.verifier };
    publishStatus();
    if (!testing) await shell.openExternal(body.verificationUri);
    void pollSignIn(generation);
  } catch (error) {
    pending = null;
    lastError = error instanceof Error ? error.message : 'Cannot start desktop sign-in.';
    throw new Error(lastError);
  }
  return status();
}

async function pollSignIn(generation) {
  while (!quitting && generation === signInGeneration && pending) {
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      pending = null;
      lastError = 'The sign-in code expired. Start sign-in again.';
      return;
    }
    await pause(Math.max(1, Number(pending.interval) || 3) * 1000);
    if (!pending || generation !== signInGeneration) return;
    try {
      let exchange;
      try {
        exchange = await cloudRequest('/api/desktop/token', {
          deviceCode: pending.deviceCode,
          verifier: pending.verifier,
        });
      } catch {
        if (generation !== signInGeneration) return;
        lastError =
          'Reconnecting to Kivuno. Keep this confirmation open; your code is still valid.';
        publishStatus();
        await pause(3000);
        continue;
      }
      const { response, body } = exchange;
      if (generation !== signInGeneration) return;
      if (response.status >= 500) {
        lastError = 'Kivuno is waking up. Your confirmation will update automatically.';
        publishStatus();
        await pause(3000);
        continue;
      }
      lastError = '';
      if (response.status === 202 || body.error === 'authorization_pending') continue;
      if (response.status === 429) {
        await pause(
          Math.max(3, Math.min(60, Number(response.headers.get('Retry-After')) || 3)) * 1000,
        );
        continue;
      }
      if (!response.ok) throw new Error(body.error || 'Desktop sign-in was not approved.');
      const nextIdentity = validIdentity(body);
      nextIdentity.bridgeKey = randomBytes(32).toString('hex');
      identityTransition = true;
      await persistIdentity(nextIdentity);
      if (generation !== signInGeneration || quitting) {
        identityTransition = false;
        return;
      }
      runtime = 'starting';
      identity = nextIdentity;
      pending = null;
      lastError = '';
      publishStatus();
      await stopBackend();
      await startBackend();
      if (quitting) return;
      await window?.loadURL(backendOrigin);
      identityTransition = false;
      publishStatus();
      void bridgeLoop();
      void restoreMachines();
      window?.show();
      window?.focus();
      return;
    } catch (error) {
      identityTransition = false;
      if (generation !== signInGeneration) return;
      pending = null;
      lastError = error instanceof Error ? error.message : 'Desktop sign-in failed.';
      publishStatus();
      return;
    }
  }
}

async function bridgeLoop() {
  // The cloud broker accepts only authenticated machine-exchange packets.
  // The renderer never receives the desktop bearer or upstream machine tokens.
  const generation = ++bridgeGeneration;
  const responses = [];
  try {
    const { response, body } = await cloudRequest(
      '/api/desktop/me',
      undefined,
      identity.accessToken,
    );
    if (generation !== bridgeGeneration || !identity) return;
    if (response.status === 401) {
      await signOutWorkspace();
      lastError = 'Your desktop session expired or was revoked. Sign in again.';
      return;
    }
    if (!response.ok || !body.deviceId || body.owner?.id !== identity.owner.id)
      throw new Error('Desktop identity is not available.');
    identity.deviceId = body.deviceId;
    identity.bridgeKey ||= randomBytes(32).toString('hex');
    await persistIdentity(identity);
    const configured = await fetch(backendOrigin + '/api/desktop/bridge-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: backendOrigin,
        'X-Relay-Desktop': desktopSecret,
        'X-Relay-Control': desktopSecret,
      },
      body: JSON.stringify({
        url: `${identityOrigin}/api/desktop/bridge/exchange?host=${encodeURIComponent(body.deviceId)}`,
        key: identity.bridgeKey,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!configured.ok) throw new Error('Desktop bridge configuration failed.');
    void sharedSadeLoop(generation, identity);
  } catch {
    if (generation !== bridgeGeneration || !identity) return;
    await pause(10000);
    if (generation === bridgeGeneration && identity && !quitting) void bridgeLoop();
    return;
  }
  while (!quitting && identity && generation === bridgeGeneration) {
    try {
      const batch = [];
      let batchBytes = 256;
      for (const entry of responses) {
        let bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (bytes > 3_700_000) {
          entry.status = 503;
          entry.body = {
            error:
              'Machine response exceeds the secure transport limit. Recover preserved work on its source machine.',
          };
          bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
        }
        if (batch.length >= 8 || batchBytes + bytes > 3_800_000) break;
        batch.push(entry);
        batchBytes += bytes;
      }
      const { response, body } = await cloudRequest(
        '/api/desktop/bridge/poll',
        { bridgeKey: identity.bridgeKey, responses: batch },
        identity.accessToken,
      );
      if (generation !== bridgeGeneration || !identity) return;
      if (response.status === 401) {
        await signOutWorkspace();
        lastError = 'Your desktop session expired or was revoked. Sign in again.';
        return;
      }
      if (!response.ok) {
        await pause(10000);
        continue;
      }
      const acknowledged = new Set(Array.isArray(body.ack) ? body.ack : []);
      for (let i = responses.length - 1; i >= 0; i--)
        if (acknowledged.has(responses[i].id)) responses.splice(i, 1);
      const requests = Array.isArray(body.requests) ? body.requests.slice(0, 16) : [];
      for (const request of requests) {
        if (typeof request.id !== 'string' || typeof request.authorization !== 'string') continue;
        if (responses.some((entry) => entry.id === request.id)) continue;
        if (responses.length >= 64) break;
        try {
          const result = await fetch(backendOrigin + '/api/runner/exchange', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: backendOrigin,
              'X-Relay-Desktop': desktopSecret,
              Authorization: request.authorization,
            },
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(20000),
          });
          responses.push({ id: request.id, status: result.status, body: await result.json() });
        } catch {
          responses.push({
            id: request.id,
            status: 503,
            body: { error: 'Desktop machine exchange failed. Outcome may be uncertain.' },
          });
        }
      }
      await pause(requests.length ? 500 : 3000);
    } catch {
      await pause(10000);
    }
  }
}

async function localSharedSade(payload, context) {
  const revoking = payload.action === 'revoke';
  if (revoking) {
    ++sharedSadeConsentVersion;
    ++pendingSharedSadeRevocations;
  }
  try {
    return await localControlRequest('/api/desktop/shared-sade', payload, context);
  } finally {
    if (revoking) --pendingSharedSadeRevocations;
  }
}

async function publishSharedSadeGrant(input, owner, current, context) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!current()) throw new Error('Account changed. Open your current workspace.');
    const reply = await cloudRequest('/api/desktop/groups', input, owner.accessToken).catch(
      () => null,
    );
    if (!reply || reply.response.status === 408 || reply.response.status >= 500) continue;
    if (!reply.response.ok && attempt === 0 && current())
      await localSharedSade({ action: 'revoke', grantId: input.id }, context);
    return reply;
  }
  throw new Error('This desktop recorded your approval. Check the group before granting again.');
}

async function syncSharedSadeRevocations(revocations, owner, current, context) {
  const confirmed = await Promise.all(
    revocations.map(async ({ grantId, groupId }) => {
      if (!current()) return;
      try {
        const { response, body } = await cloudRequest(
          '/api/desktop/groups',
          { action: 'sade-revoke', grantId, groupId },
          owner.accessToken,
        );
        if (
          response.ok ||
          (response.status === 403 &&
            body?.error === 'Only this harness owner can revoke its grant.')
        )
          return grantId;
      } catch {
        // The local record remains queued for the next connection.
      }
    }),
  );
  const ids = confirmed.filter(Boolean);
  if (ids.length && current()) await localSharedSade({ action: 'ack-revocations', ids }, context);
}

async function sharedSadeLoop(generation, owner) {
  const current = () =>
    !quitting && !identityTransition && identity === owner && generation === bridgeGeneration;
  let capabilitiesKnown = false;
  let supportsReviewRevision = false;
  let supportsRosterLookup = false;
  let supportsReviewedRevisionFiles = false;
  let supportsUnchangedRevisionScopes = false;
  let supportsReferencedMessage = false;
  let supportsReadAssignment = false;
  let supportsHandoffAssignments = false;
  let supportsHandoffDeliverables = false;
  let supportsCapacityWait = false;
  let supportsMachineCheckWait = false;
  const readCapabilities = ({ response, body }) => {
    supportsReviewRevision = response.ok && body.supportsReviewRevision === true;
    supportsRosterLookup = response.ok && body.supportsRosterLookup === true;
    supportsReviewedRevisionFiles = response.ok && body.supportsReviewedRevisionFiles === true;
    supportsUnchangedRevisionScopes = response.ok && body.supportsUnchangedRevisionScopes === true;
    supportsReferencedMessage = response.ok && body.supportsReferencedMessage === true;
    supportsReadAssignment = response.ok && body.supportsReadAssignment === true;
    supportsHandoffAssignments = response.ok && body.supportsHandoffAssignments === true;
    supportsHandoffDeliverables = response.ok && body.supportsHandoffDeliverables === true;
    supportsCapacityWait = response.ok && body.supportsCapacityWait === true;
    supportsMachineCheckWait = response.ok && body.supportsMachineCheckWait === true;
    capabilitiesKnown = response.ok;
  };
  let grantCursor;
  let revocationSync;
  let nextRevocationSync = 0;
  const localContext = { origin: backendOrigin, secret: desktopSecret };
  while (current()) {
    if (pendingSharedSadeRevocations) {
      await pause(250);
      continue;
    }
    const consentVersion = sharedSadeConsentVersion;
    // A revocation can start while a snapshot or an earlier upload is in flight.
    const snapshotCurrent = () => current() && consentVersion === sharedSadeConsentVersion;
    let delay = 2500;
    try {
      const snapshot = await localSharedSade({
        action: 'snapshot',
        ...(grantCursor ? { grantCursor } : {}),
      });
      if (!snapshotCurrent()) continue;
      if (snapshot.revocations?.length && !revocationSync && Date.now() >= nextRevocationSync)
        revocationSync = syncSharedSadeRevocations(
          snapshot.revocations,
          owner,
          current,
          localContext,
        )
          .catch(() => {})
          .finally(() => {
            revocationSync = undefined;
            nextRevocationSync = Date.now() + 5000;
          });
      if (!snapshot.grants?.length && !snapshot.active?.length && !snapshot.results?.length) {
        await pause(4000);
        continue;
      }
      const acknowledged = [];
      for (const { jobId, version, result, updatesRead, grantExpiresAt } of snapshot.results.slice(
        0,
        2,
      )) {
        if (!snapshotCurrent()) break;
        if (!(grantExpiresAt > Date.now())) continue;
        const { response } = await cloudRequest(
          '/api/desktop/groups',
          { action: 'sade-finish', jobId, result, updatesRead },
          owner.accessToken,
        );
        if (response.ok || [403, 404, 409].includes(response.status))
          acknowledged.push({ jobId, version });
      }
      if (!snapshotCurrent()) continue;
      // Discover the coordinator protocol before offering grants that can claim new work.
      if (!capabilitiesKnown && !snapshot.active?.length) {
        const probe = await cloudRequest(
          '/api/desktop/groups',
          { action: 'sade-poll', grants: [], active: [] },
          owner.accessToken,
        );
        if (!snapshotCurrent()) continue;
        readCapabilities(probe);
        if (!capabilitiesKnown) throw new Error('Shared Groups capability discovery failed.');
      }
      const { response, body } = await cloudRequest(
        '/api/desktop/groups',
        {
          action: 'sade-poll',
          patchHandoff: true,
          ...(supportsReviewRevision ? { reviewRevision: true } : {}),
          ...(supportsRosterLookup ? { rosterLookup: true } : {}),
          ...(supportsReviewedRevisionFiles ? { reviewedRevisionFiles: true } : {}),
          ...(supportsUnchangedRevisionScopes ? { unchangedRevisionScopes: true } : {}),
          ...(supportsReferencedMessage ? { referencedMessage: true } : {}),
          ...(supportsReadAssignment ? { readAssignment: true } : {}),
          ...(supportsHandoffAssignments ? { handoffAssignments: true } : {}),
          ...(supportsHandoffAssignments && supportsHandoffDeliverables
            ? { handoffDeliverables: true }
            : {}),
          taskUpdates: true,
          readUpdates: snapshot.readUpdates,
          waitingForRevisions: snapshot.waitingForRevisions,
          ...(supportsCapacityWait ? { waitingForCapacity: snapshot.waitingForCapacity } : {}),
          ...(supportsMachineCheckWait
            ? { waitingForMachineChecks: snapshot.waitingForMachineChecks }
            : {}),
          grants: snapshot.grants,
          active: snapshot.active,
        },
        owner.accessToken,
      );
      if (!snapshotCurrent()) continue;
      readCapabilities({ response, body });
      if (response.ok) {
        await localSharedSade({
          action: 'exchange',
          active: body.active,
          delivery: body.delivery,
          reviews: body.reviews,
          updates: body.updates,
          revisionHandoff: body.revisionHandoff,
          ...(body.supportsUnchangedRevisionScopes === true
            ? { unchangedRevisionScopes: true }
            : {}),
          quotaFailover: body.quotaFailover,
          planQuotaFailover: body.planQuotaFailover,
          acknowledged,
        });
        if (snapshotCurrent()) grantCursor = snapshot.nextGrantCursor;
      } else delay = 5000;
    } catch {
      delay = 5000;
    }
    if (current()) await pause(delay);
  }
}

function trusted(event, statusOnly = false) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !(
      sameOrigin(event.senderFrame.url, backendOrigin) ||
      (statusOnly && sameOrigin(event.senderFrame.url, transitionOrigin))
    )
  )
    throw new Error('Untrusted desktop request.');
}

function posixQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function registerIpc() {
  ipcMain.handle('relay:update-status', async (event) => {
    trusted(event);
    const { status: update } = await inspectDesktopUpdate();
    return update;
  });
  ipcMain.handle('relay:update-install', async (event) => {
    trusted(event);
    const { status: update, downloadUrl, updateArtifact } = await inspectDesktopUpdate();
    if (!update.hasUpdate || !downloadUrl)
      throw new Error('No Kivuno update is available for this computer.');
    if (process.platform === 'darwin') {
      if (!updateArtifact)
        throw new Error('This Kivuno release has no in-app macOS update package.');
      await installMacUpdate(updateArtifact, update.latestVersion);
      return;
    }
    await shell.openExternal(downloadUrl);
  });
  ipcMain.handle('relay:prepare-provider', async (event, provider) => {
    trusted(event);
    if (!identity) throw new Error('Sign in to Kivuno before installing provider components.');
    const runtime = runtimePaths();
    return prepareProvider(provider, {
      ...runtime,
      providerHome: path.join(dataDirectory, 'provider-runtimes'),
      environment: process.env,
    });
  });
  ipcMain.handle('relay:antigravity-google-sign-in', async (event) => {
    trusted(event);
    if (!identity) throw new Error('Sign in to Kivuno first.');
    const runtime = runtimePaths();
    const providerContext = {
      ...runtime,
      providerHome: path.join(dataDirectory, 'provider-runtimes'),
      environment: process.env,
    };
    await prepareProvider('antigravity', providerContext);
    const agy = await findExecutable('antigravity', process.env);
    if (!agy) throw new Error('Antigravity CLI is not available after installation. Try again.');
    if (process.platform === 'darwin') {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-antigravity-login-'));
      const script = path.join(directory, 'Sign in with Google.command');
      const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      const cleanup = `rm -f -- ${quote(script)}; rmdir -- ${quote(directory)}`;
      const source = [
        '#!/bin/zsh',
        `agy=${posixQuote(agy)}`,
        '"$agy" acp --login',
        'result=$?',
        'if [ "$result" -eq 0 ]; then',
        '  echo "Google sign-in finished. Return to Kivuno."',
        'else',
        '  echo "Google sign-in did not finish. Check the message above and try again."',
        'fi',
        'printf "\\nPress Return to close this window..."',
        'read -r reply',
        cleanup,
        'exit "$result"',
        '',
      ].join('\n');
      try {
        await writeFile(script, source, { mode: 0o700, flag: 'wx' });
        const child = spawn('open', ['-a', 'Terminal', script], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('spawn', resolve);
        });
        child.unref();
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw new Error(`Could not open Terminal for Antigravity sign-in: ${error.message}`);
      }
      return;
    }
    if (process.platform === 'win32') {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Start-Process -FilePath $env:ComSpec -ArgumentList ${powershellQuote(`/k "${agy}" acp --login`)}`,
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('spawn', resolve);
      });
      child.unref();
      return;
    }
    for (const terminal of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      try {
        const args =
          terminal === 'gnome-terminal'
            ? ['--', agy, 'acp', '--login']
            : ['-e', agy, 'acp', '--login'];
        const child = spawn(terminal, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('spawn', resolve);
        });
        child.unref();
        return;
      } catch {}
    }
    throw new Error(
      'No terminal app was found. Run `agy acp --login` in a terminal to sign in with Google.',
    );
  });
  ipcMain.handle('relay:window-state', (event) => {
    trusted(event);
    return windowState();
  });
  ipcMain.handle('relay:window-control', (event, action) => {
    trusted(event);
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isFullScreen()) window.setFullScreen(false);
      else if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === 'fullscreen') window.setFullScreen(!window.isFullScreen());
    else if (action === 'close') window.close();
    else throw new Error('Unknown window action.');
    return windowState();
  });
  for (const [name, action] of Object.entries({
    state: () => projectBrowser.state(),
    open: (input) => projectBrowser.open(input),
    bounds: (input) => projectBrowser.setBounds(input),
    navigate: (input) => projectBrowser.navigate(input),
    snapshot: () => projectBrowser.snapshot(),
    review: (hidden) => {
      if (typeof hidden !== 'boolean') throw new Error('Invalid browser visibility.');
      projectBrowser.hideForReview(hidden);
    },
    close: () => projectBrowser.close(),
  })) {
    ipcMain.handle(`relay:browser-${name}`, (event, input) => {
      trusted(event);
      if (!identity || Date.parse(identity.expiresAt) <= Date.now())
        throw new Error('Sign in first.');
      return action(input);
    });
  }
  ipcMain.handle('relay:status', (event) => {
    trusted(event, true);
    return status();
  });
  ipcMain.handle('relay:sign-in', (event) => {
    trusted(event);
    return beginSignIn();
  });
  ipcMain.handle('relay:groups', async (event, input) => {
    trusted(event);
    const owner = identity;
    if (!owner || identityTransition || Date.parse(owner.expiresAt) <= Date.now())
      throw new Error('Sign in to Kivuno first.');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![
        'list',
        'create',
        'read',
        'invite',
        'accept',
        'decline',
        'leave',
        'remove',
        'teammates',
        'message',
        'sade-connect',
        'sade-revoke',
        'sade-cancel',
        'sade-answer',
        'sade-update-task',
      ].includes(input.action) ||
      Buffer.byteLength(JSON.stringify(input)) > 64 * 1024
    )
      throw new Error('Invalid group request.');
    const generation = signInGeneration;
    const localContext = { origin: backendOrigin, secret: desktopSecret };
    const current = () =>
      identity === owner && generation === signInGeneration && !identityTransition;
    let cloudInput = input;
    if (input.action === 'sade-connect') {
      const grant = {
        id: randomUUID(),
        groupId: input.groupId,
        projectId: input.projectId,
        teammateId: input.teammateId,
        allowWrites: input.allowWrites,
        machineId: input.machineId,
        turns: input.turns,
      };
      const preview = await localSharedSade({ action: 'preview', ...grant }, localContext);
      const room = await cloudRequest(
        '/api/desktop/groups',
        { action: 'read', groupId: grant.groupId, after: 10000 },
        owner.accessToken,
      );
      if (!room.response.ok || !room.body.group?.id || !current())
        throw new Error('This shared group is unavailable.');
      let sharingId;
      if (room.body.sadeSharingId) {
        const member = room.body.group.teammates?.find(
          (candidate) =>
            candidate.ownerId === owner.owner.id && candidate.localId === grant.teammateId,
        );
        if (!member) throw new Error('Share your own teammate in this group first.');
        sharingId = member.sharingId ?? member.localId;
      }
      const consent = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Allow Sade to use your teammate?',
        message: `${preview.teammateName} · ${preview.projectName}`,
        detail: `Members of “${room.body.group.name}” can assign up to ${preview.turns} turns for one hour, even if your provider does not report remaining quota. ${preview.allowWrites ? 'This includes proposing local file changes, sharing the diff with an independent reviewer, and passing approved patches to assigned teammates after you integrate locally. You control Git publication.' : 'The teammate can read the linked project and share a short result.'}${preview.pairedMachine ? ` The harness can send project files and run commands on ${preview.pairedMachine.name} (${preview.pairedMachine.platform}) for a matching OS request while that owner’s permission is active.` : ''} Your provider sign-in stays on this computer.`,
        buttons: ['Cancel', 'Allow'],
        defaultId: 0,
        cancelId: 0,
      });
      if (consent.response !== 1 || !current()) return null;
      const { teammateName, pairedMachine, ...approved } = await localSharedSade(
        { action: 'grant', ...grant },
        localContext,
      );
      if (
        approved.projectKey !== preview.projectKey ||
        pairedMachine?.grantId !== preview.pairedMachine?.grantId ||
        pairedMachine?.platform !== preview.pairedMachine?.platform ||
        !current()
      ) {
        if (current()) await localSharedSade({ action: 'revoke', grantId: grant.id }, localContext);
        throw new Error('The workspace changed during approval. Review the grant again.');
      }
      cloudInput = { action: 'sade-grant', ...approved, ...(sharingId ? { sharingId } : {}) };
    } else if (input.action === 'sade-revoke') {
      await localSharedSade(
        { action: 'revoke', grantId: input.grantId, groupId: input.groupId },
        localContext,
      );
    }
    if (!current()) throw new Error('Account changed. Open your current workspace.');
    const planning =
      (input.action === 'message' && Boolean(cloudInput.sade)) || input.action === 'sade-answer';
    const { response, body } =
      input.action === 'sade-connect'
        ? await publishSharedSadeGrant(cloudInput, owner, current, localContext)
        : await cloudRequest(
            '/api/desktop/groups',
            cloudInput,
            owner.accessToken,
            planning ? 1800 : undefined,
          );
    if (identity !== owner || generation !== signInGeneration)
      throw new Error('Account changed. Open your current workspace.');
    if (response.ok && input.action === 'sade-revoke' && current())
      await localSharedSade(
        { action: 'ack-revocations', ids: [input.grantId] },
        localContext,
      ).catch(() => {});
    if (response.status === 401) {
      void signOutWorkspace();
      throw new Error('Your Kivuno session expired. Sign in again.');
    }
    if (!response.ok) throw new Error(body.error || 'Group request failed. Try again.');
    return body;
  });
  ipcMain.handle('relay:profiles', async (event, input) => {
    trusted(event);
    const owner = identity;
    if (!owner || identityTransition || Date.parse(owner.expiresAt) <= Date.now())
      throw new Error('Sign in to Kivuno first.');
    const localContext = { origin: backendOrigin, secret: desktopSecret };
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid profile request.');
    const profileIdPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const providers = new Set(['codex', 'gemini', 'claude', 'antigravity']);
    const validProfile = (profile) =>
      profile &&
      typeof profile === 'object' &&
      !Array.isArray(profile) &&
      profileIdPattern.test(profile.profileId) &&
      typeof profile.name === 'string' &&
      profile.name.trim().length > 0 &&
      profile.name.length <= 100 &&
      providers.has(profile.provider);
    if (input.action === 'reserve') {
      if (!validProfile(input)) throw new Error('Invalid profile reservation.');
    } else if (input.action === 'commit') {
      if (!input || !profileIdPattern.test(input.profileId))
        throw new Error('Invalid profile confirmation.');
      if (
        (input.name !== undefined &&
          (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)) ||
        (input.provider !== undefined && !providers.has(input.provider))
      )
        throw new Error('Invalid profile confirmation.');
    } else if (input.action === 'release') {
      if (!profileIdPattern.test(input.profileId)) throw new Error('Invalid profile release.');
    } else if (input.action === 'sync') {
      if (!Array.isArray(input.profiles) || !input.profiles.every(validProfile))
        throw new Error('Invalid profile synchronization.');
      const ids = input.profiles.map((profile) => profile.profileId);
      if (new Set(ids).size !== ids.length) throw new Error('Profile IDs must be unique.');
    } else {
      throw new Error('Unknown profile request.');
    }
    if (Buffer.byteLength(JSON.stringify(input)) > 5 * 1024 * 1024)
      throw new Error('Profile request is too large.');

    const generation = signInGeneration;
    const current = () =>
      identity === owner && generation === signInGeneration && !identityTransition;
    const send = async () => {
      if (!current()) throw new Error('Account changed. Open your current workspace.');
      const { response, body } = await cloudRequest(
        '/api/desktop/profiles',
        input,
        owner.accessToken,
      );
      if (identity !== owner || generation !== signInGeneration)
        throw new Error('Account changed. Open your current workspace.');
      if (response.status === 401) {
        void signOutWorkspace();
        throw new Error('Your Kivuno session expired. Sign in again.');
      }
      if (!response.ok) throw new Error(body.error || 'Profile request failed. Try again.');
      if (!current()) throw new Error('Account changed. Open your current workspace.');
      if (input.action === 'reserve') {
        try {
          await localControlRequest(
            '/api/desktop/profile-reservation',
            {
              action: 'store',
              profileId: input.profileId,
            },
            localContext,
          );
        } catch (error) {
          await cloudRequest(
            '/api/desktop/profiles',
            { action: 'release', profileId: input.profileId },
            owner.accessToken,
          ).catch(() => {});
          throw new Error(
            `Kivuno reserved the profile but could not prepare the local workspace: ${error instanceof Error ? error.message : 'request failed'}`,
          );
        }
        return body;
      }
      if (input.action === 'release') {
        await localControlRequest(
          '/api/desktop/profile-reservation',
          {
            action: 'release',
            profileId: input.profileId,
          },
          localContext,
        );
        return body;
      }
      if (input.action === 'sync') {
        const submitted = new Set(input.profiles.map((profile) => profile.profileId));
        if (
          !body ||
          !Array.isArray(body.lockedIds) ||
          !body.lockedIds.every(
            (id) => typeof id === 'string' && profileIdPattern.test(id) && submitted.has(id),
          ) ||
          new Set(body.lockedIds).size !== body.lockedIds.length
        )
          throw new Error('Kivuno returned an invalid profile lock list.');
        await localControlRequest(
          '/api/desktop/profile-locks',
          { lockedIds: body.lockedIds },
          localContext,
        );
      }
      return body;
    };
    if (input.action !== 'sync') return send();
    const queued = profileSyncQueue.then(send, send);
    profileSyncQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  });
  ipcMain.handle('relay:cancel-sign-in', async (event) => {
    trusted(event);
    if (identityTransition) return status();
    signInGeneration++;
    pending = null;
    lastError = '';
    publishStatus();
    return status();
  });
  ipcMain.handle('relay:sign-out', async (event) => {
    trusted(event);
    await signOutWorkspace();
  });
  ipcMain.handle('relay:external', async (event, value) => {
    trusted(event);
    await shell.openExternal(externalUrl(value, identityOrigin));
  });
  ipcMain.handle('relay:preview', async (event, value) => {
    trusted(event);
    if (!identity) throw new Error('Sign in first.');
    await shell.openExternal(previewUrl(value, backendOrigin));
  });
  ipcMain.handle('relay:directory', async (event) => {
    trusted(event);
    if (!identity) throw new Error('Sign in first.');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('relay:join-machine', async (event) => {
    trusted(event);
    if (!identity) throw new Error('Sign in first.');
    const choice = await dialog.showOpenDialog(window, {
      title: 'Connect this computer to a Kivuno project',
      properties: ['openFile'],
      filters: [{ name: 'Kivuno private machine configuration', extensions: ['json'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const filename = choice.filePaths[0];
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768)
      throw new Error('Choose a regular private configuration file smaller than 32 KB.');
    const input = JSON.parse(await readFile(filename, 'utf8'));
    const config = machineConfiguration(input, identityOrigin, machinesDirectory);
    if (machines.has(config.id) && machines.get(config.id).child)
      throw new Error('This computer is already connected to that machine slot.');
    if (machines.size >= 8 && !machines.has(config.id))
      throw new Error('At most eight project machine connections are supported.');
    const consent = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Allow this project to use your computer?',
      message: config.executionRequest
        ? `Project: ${config.executionRequest.projectName}`
        : 'Connect this computer as an AI execution machine',
      detail: config.executionRequest
        ? 'Allow this project to copy source files into a separate workspace and read them for 30 minutes. AI sign-in stays on the other computer. Full access additionally permits programs to run with your OS user permissions, including access outside the workspace. Only allow full access for a project and people you trust. Stop connection revokes access.'
        : 'This connection can run Codex profiles and project tasks on this computer. Sign-in stays in a separate profile. You can stop the connection at any time.',
      buttons: ['Cancel', 'Allow connection'],
      defaultId: 0,
      cancelId: 0,
      ...(config.executionRequest
        ? {
            checkboxLabel: 'Allow full-access commands and file changes for 30 minutes',
            checkboxChecked: false,
          }
        : {}),
    });
    if (consent.response !== 1) return null;
    await ensureMachineDirectory(config.id);
    if (config.executionRequest)
      await writeFile(
        path.join(machinesDirectory, config.id, 'execution-grant.local.json'),
        JSON.stringify({
          id: randomUUID(),
          projectId: config.executionRequest.projectId,
          expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
          fullAccess: consent.checkboxChecked === true,
        }),
        { mode: 0o600 },
      );
    const privateFile = path.join(machinesDirectory, config.id, 'config.private.json');
    await writeFile(privateFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    const name =
      typeof input.name === 'string' && input.name.trim()
        ? input.name.trim().slice(0, 100)
        : `Project machine ${config.id.slice(0, 8)}`;
    const entry = { id: config.id, name, status: 'stopped', child: null, enabled: true };
    machines.set(config.id, entry);
    await saveMachines();
    await startMachine(entry);
    return {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      ...(entry.error ? { error: entry.error } : {}),
    };
  });
  ipcMain.handle('relay:stop-machine', async (event, id) => {
    trusted(event);
    if (!identity || typeof id !== 'string' || !machines.has(id))
      throw new Error('Machine connection not found.');
    const entry = machines.get(id);
    entry.enabled = false;
    await stopMachine(entry);
    await unlink(path.join(machinesDirectory, id, 'execution-grant.local.json')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await saveMachines();
  });
}

function runtimePaths() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'workspace')
    : path.resolve(__dirname, '..');
  const node = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'runtime',
        process.platform === 'win32' ? 'node.exe' : 'node',
      )
    : process.env.RELAY_NODE_BINARY;
  if (!node || !path.isAbsolute(node) || !existsSync(node))
    throw new Error('The bundled Node runtime is unavailable.');
  const inheritedPath =
    Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const gitBin = app.isPackaged ? { win32: 'cmd', darwin: 'bin' }[process.platform] : undefined;
  const binPath = [
    path.dirname(node),
    gitBin && path.join(process.resourcesPath, 'runtime', 'git', gitBin),
    inheritedPath,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  const gitRoot = gitBin === 'bin' && path.join(process.resourcesPath, 'runtime', 'git');
  const gitEnvironment = gitRoot
    ? {
        GIT_EXEC_PATH: path.join(gitRoot, 'libexec', 'git-core'),
        GIT_TEMPLATE_DIR: path.join(gitRoot, 'share', 'git-core', 'templates'),
      }
    : {};
  return { root, node, binPath, gitEnvironment };
}

function providerRuntimeEnvironment(root, node) {
  const codexCommand = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const probe = existsSync(codexCommand)
    ? spawnSync(node, [codexCommand, '--version'], {
        env: process.env,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
        timeout: 10000,
      })
    : null;
  return {
    RELAY_PROVIDER_HOME: path.join(dataDirectory, 'provider-runtimes'),
    ...(probe && !probe.error && probe.status === 0 ? { RELAY_CODEX_COMMAND: codexCommand } : {}),
  };
}

async function ensureMachineDirectory(id) {
  for (const directory of [
    path.join(dataDirectory, 'workspace'),
    machinesDirectory,
    path.join(machinesDirectory, id),
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Machine storage cannot use symbolic links.');
  }
}

async function saveMachines() {
  await mkdir(machinesDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    machinesIndex,
    JSON.stringify([...machines.values()].map(({ id, name, enabled }) => ({ id, name, enabled }))),
    { mode: 0o600 },
  );
}

async function startMachine(entry) {
  if (!identity || quitting || entry.child) return;
  await ensureMachineDirectory(entry.id);
  const configFile = path.join(machinesDirectory, entry.id, 'config.private.json');
  const config = machineConfiguration(
    JSON.parse(await readFile(configFile, 'utf8')),
    identityOrigin,
    machinesDirectory,
  );
  if (existsSync(path.join(config.dataDir, 'runner-active.json'))) {
    entry.status = 'recovery';
    entry.error =
      'A previous worker left a recovery marker. Confirm its processes stopped before recovering this machine.';
    return;
  }
  const { root, node, binPath, gitEnvironment } = runtimePaths();
  let runtimeConfigFile = configFile;
  if (config.executionRequest) {
    const grant = JSON.parse(
      await readFile(path.join(machinesDirectory, entry.id, 'execution-grant.local.json'), 'utf8'),
    );
    if (
      grant.projectId !== config.executionRequest.projectId ||
      typeof grant.fullAccess !== 'boolean' ||
      !/^[a-f0-9-]{36}$/i.test(grant.id || '') ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.now()
    )
      throw new Error(
        'This project’s machine permission expired or was revoked. Join again to review and grant access.',
      );
    runtimeConfigFile = path.join(machinesDirectory, entry.id, 'config.runtime.json');
    const { executionRequest, ...runtimeConfig } = config;
    await writeFile(
      runtimeConfigFile,
      JSON.stringify({ ...runtimeConfig, executionGrant: grant }),
      { mode: 0o600 },
    );
  }
  const child = spawn(
    node,
    ['--import', 'tsx', path.join(root, 'server', 'runner-agent.ts'), runtimeConfigFile],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: runtimeEnvironment(process.env, {
        NODE_ENV: 'production',
        PATH: binPath,
        ...gitEnvironment,
        ...providerRuntimeEnvironment(root, node),
      }),
    },
  );
  entry.child = child;
  entry.status = 'running';
  entry.error = '';
  child.once('error', () => {
    entry.error = 'The machine runtime could not start.';
    entry.status = 'stopped';
    entry.child = null;
  });
  child.once('exit', (code) => {
    entry.child = null;
    entry.status = existsSync(path.join(config.dataDir, 'runner-active.json'))
      ? 'recovery'
      : 'stopped';
    if (code && !quitting)
      entry.error = 'The machine stopped. Reconnect or inspect recovery before resuming.';
  });
}

async function restoreMachines() {
  if (!identity || quitting) return;
  try {
    const saved = JSON.parse(await readFile(machinesIndex, 'utf8'));
    if (!Array.isArray(saved) || saved.length > 8) return;
    for (const value of saved) {
      if (!/^[a-f0-9-]{36}$/.test(value.id || '') || typeof value.name !== 'string') continue;
      let entry = machines.get(value.id);
      if (!entry)
        machines.set(
          value.id,
          (entry = {
            id: value.id,
            name: value.name.slice(0, 100),
            enabled: value.enabled === true,
            status: 'stopped',
            child: null,
          }),
        );
      if (entry.enabled)
        await startMachine(entry).catch(() => {
          entry.status = 'recovery';
          entry.error = 'The saved machine connection needs inspection.';
        });
    }
  } catch {
    /* A new desktop has no saved machine connections. */
  }
}

async function stopMachine(entry) {
  const child = entry.child;
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  try {
    child.send({ type: 'relay:shutdown' });
  } catch {}
  await Promise.race([stopped, pause(40000)]);
  if (child.exitCode === null) {
    if (process.platform === 'win32')
      await new Promise((resolve) => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    else child.kill('SIGTERM');
    entry.status = 'recovery';
    entry.error = 'The worker did not stop cleanly. Its files were preserved for recovery.';
  }
}

async function stopMachines() {
  await Promise.all([...machines.values()].map(stopMachine));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startBackend() {
  runtime = 'starting';
  transitionOrigin = backendOrigin;
  desktopSecret = randomBytes(32).toString('hex');
  const workspacePath = workspaceDirectory(dataDirectory, identity?.owner.id, pinnedOwner);
  machinesDirectory = path.join(workspacePath, 'machine-links');
  machinesIndex = path.join(machinesDirectory, 'connections.json');
  const { root, node, binPath, gitEnvironment } = runtimePaths();
  const port = await freePort();
  backendOrigin = `http://127.0.0.1:${port}`;
  backend = spawn(node, ['--import', 'tsx', path.join(root, 'server', 'index.ts')], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: runtimeEnvironment(process.env, {
      NODE_ENV: testing ? 'test' : 'production',
      PATH: binPath,
      ...gitEnvironment,
      RELAY_DATA_DIR: workspacePath,
      RELAY_PORT: String(port),
      RELAY_DESKTOP_SECRET: desktopSecret,
      RELAY_DESKTOP_LOCKED: identity ? '0' : '1',
      ...providerRuntimeEnvironment(root, node),
    }),
  });
  const started = backend;
  backend.on('exit', () => {
    if (backend === started) {
      runtime = 'stopped';
      publishStatus();
    }
  });
  backend.on('error', () => {
    runtime = 'stopped';
  });
  for (let attempt = 0; attempt < 160; attempt++) {
    if (runtime === 'stopped')
      throw new Error('The local workspace could not start. Reopen Kivuno to enter recovery.');
    try {
      const response = await fetch(backendOrigin + '/api/session', {
        headers: { 'X-Relay-Desktop': desktopSecret, 'X-Relay-Control': desktopSecret },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        runtime = 'ready';
        publishStatus();
        return;
      }
    } catch {}
    await pause(250);
  }
  throw new Error('The local workspace did not become ready. Reopen Kivuno to retry.');
}

async function stopBackend() {
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  try {
    child.send({ type: 'relay:shutdown' });
  } catch {}
  await Promise.race([stopped, pause(12000)]);
  if (child.exitCode === null) {
    // A failed graceful exit is deliberately surfaced as recovery on next boot.
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    } else child.kill('SIGTERM');
  }
  runtime = 'stopped';
}

function createWindow() {
  window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 960,
    minHeight: 660,
    show: false,
    frame: false,
    title: 'Kivuno',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0b1513',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--kivuno-version=${app.getVersion()}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!sameOrigin(details.url, backendOrigin)) {
      const url = new URL(details.url);
      const preview = details.resourceType === 'subFrame' || Boolean(details.frame?.parent);
      const safe =
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
      if (!preview || !safe) return callback({ cancel: true });
      const headers = { ...details.requestHeaders };
      for (const key of Object.keys(headers))
        if (key.toLowerCase().startsWith('x-relay-')) delete headers[key];
      return callback({ requestHeaders: headers });
    }
    if (
      details.webContentsId !== window.webContents.id ||
      details.frame?.parent ||
      details.resourceType === 'subFrame'
    )
      return callback({ cancel: true });
    if (!identity && new URL(details.url).pathname.startsWith('/api/'))
      return callback({ cancel: true });
    callback({ requestHeaders: { ...details.requestHeaders, 'X-Relay-Desktop': desktopSecret } });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, backendOrigin)) {
      void window.loadURL(url);
    } else {
      try {
        void shell.openExternal(externalUrl(url, identityOrigin));
      } catch {}
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, backendOrigin)) {
      event.preventDefault();
      try {
        void shell.openExternal(externalUrl(url, identityOrigin));
      } catch {}
    }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.on(event, () => window.webContents.send('relay:window-state', windowState()));
  }
  window.on('hide', () => projectBrowser.suspendSoon());
  window.on('minimize', () => projectBrowser.suspendSoon());
  window.on('show', () => projectBrowser.resumeVisible());
  window.on('restore', () => projectBrowser.resumeVisible());
  window.once('ready-to-show', () => {
    if (!testing || process.env.RELAY_DESKTOP_SHOW === '1') window.show();
  });
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Kivuno — Codex workspace');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Kivuno',
        click: () => {
          window.show();
          window.focus();
        },
      },
      { type: 'separator' },
      { label: 'Quit Kivuno and stop agents', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', () => {
    window.show();
    window.focus();
  });
  return window.loadURL(backendOrigin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    window?.show();
    window?.focus();
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    projectBrowser.close();
    signInGeneration++;
    bridgeGeneration++;
    void Promise.all([stopBackend(), stopMachines()]).finally(() => {
      tray?.destroy();
      app.quit();
    });
  });
  void app
    .whenReady()
    .then(async () => {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      await readIdentity();
      await startBackend();
      registerIpc();
      await createWindow();
      if (identity) void bridgeLoop();
      if (identity) void restoreMachines();
    })
    .catch(async (error) => {
      if (testing)
        console.error(
          'Kivuno desktop test startup failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
      else
        dialog.showErrorBox(
          'Kivuno could not start',
          'The local runtime could not start. Reinstall the current Kivuno build, or restart to recover interrupted work. Your workspace has been kept.',
        );
      await stopBackend();
      quitting = true;
      app.quit();
    });
}
