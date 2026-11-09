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
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { randomBytes } = require('node:crypto');
const { mkdir, readFile, writeFile, unlink, rename, lstat } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { ProjectBrowser } = require('./browser.cjs');
const { workspaceDirectory } = require('./workspaces.cjs');
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

async function cloudRequest(route, body, token) {
  const response = await fetch(identityOrigin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: identityOrigin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
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
    if (secureCredentialStorage(safeStorage, process.platform)) {
      const previous = JSON.parse(safeStorage.decryptString(await readFile(identityFile)));
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

function registerIpc() {
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
      ].includes(input.action) ||
      Buffer.byteLength(JSON.stringify(input)) > 64 * 1024
    )
      throw new Error('Invalid group request.');
    const generation = signInGeneration;
    const { response, body } = await cloudRequest('/api/desktop/groups', input, owner.accessToken);
    if (identity !== owner || generation !== signInGeneration)
      throw new Error('Account changed. Open your current workspace.');
    if (response.status === 401) {
      void signOutWorkspace();
      throw new Error('Your Kivuno session expired. Sign in again.');
    }
    if (!response.ok) throw new Error(body.error || 'Group request failed. Try again.');
    return body;
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
    await ensureMachineDirectory(config.id);
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
  const binPath = [
    path.dirname(node),
    ...(app.isPackaged && process.platform === 'win32'
      ? [path.join(process.resourcesPath, 'runtime', 'git', 'cmd')]
      : []),
    inheritedPath,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  return { root, node, binPath };
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
  const { root, node, binPath } = runtimePaths();
  const child = spawn(
    node,
    ['--import', 'tsx', path.join(root, 'server', 'runner-agent.ts'), configFile],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: runtimeEnvironment(process.env, {
        NODE_ENV: 'production',
        PATH: binPath,
        RELAY_CODEX_COMMAND: path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
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
  const { root, node, binPath } = runtimePaths();
  const port = await freePort();
  backendOrigin = `http://127.0.0.1:${port}`;
  backend = spawn(node, ['--import', 'tsx', path.join(root, 'server', 'index.ts')], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: runtimeEnvironment(process.env, {
      NODE_ENV: testing ? 'test' : 'production',
      PATH: binPath,
      RELAY_DATA_DIR: workspacePath,
      RELAY_PORT: String(port),
      RELAY_DESKTOP_SECRET: desktopSecret,
      RELAY_DESKTOP_LOCKED: identity ? '0' : '1',
      RELAY_CODEX_COMMAND: path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
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
