import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';

type Config = {
  origin: string;
  id: string;
  token: string;
  bridgeKey: string;
  exchangeUrl: string;
  projectId: string;
};

type DialogProgress = typeof globalThis & { kivunoPairFixtureDialog?: 'cancel' | 'allow' };

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function installFixtureIdentity(desktop: ElectronApplication, origin: string) {
  const owner = { id: 'paired-test-mac-owner', name: 'Mac fixture owner' };
  const deviceId = randomUUID();
  const accessToken = randomBytes(32).toString('base64url');
  const deviceCode = randomBytes(32).toString('base64url');
  await desktop.evaluate(
    (_electron, { origin, owner, deviceId, accessToken, deviceCode }) => {
      const fetchOriginal = globalThis.fetch;
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      let challenge = '';
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== origin) return fetchOriginal(input, init);
        const method = init?.method || 'GET';
        if (method === 'POST' && url.pathname === '/api/desktop/authorize') {
          challenge = JSON.parse(String(init?.body)).challenge;
          return Response.json({
            deviceCode,
            userCode: 'MAC-FIXTURE',
            verificationUri: origin + '/activate?code=MAC-FIXTURE',
            expiresAt,
            interval: 1,
          });
        }
        if (method === 'POST' && url.pathname === '/api/desktop/token') {
          const { deviceCode: suppliedCode, verifier } = JSON.parse(String(init?.body));
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
          if (suppliedCode !== deviceCode || Buffer.from(hash).toString('base64url') !== challenge)
            return Response.json({ error: 'Test desktop proof did not match.' }, { status: 403 });
          return Response.json({ accessToken, owner, deviceId, expiresAt });
        }
        if (new Headers(init?.headers).get('Authorization') !== `Bearer ${accessToken}`)
          return Response.json(
            { error: 'Test desktop authorization is required.' },
            { status: 401 },
          );
        if (method === 'GET' && url.pathname === '/api/desktop/me')
          return Response.json({ owner, deviceId });
        if (method === 'POST' && url.pathname === '/api/desktop/bridge/poll')
          return Response.json({ requests: [], ack: [] });
        if (method === 'POST' && url.pathname === '/api/desktop/revoke') return Response.json({});
        return Response.json({ error: 'Unavailable in the test identity.' }, { status: 404 });
      };
    },
    { origin, owner, deviceId, accessToken, deviceCode },
  );
  return owner.id;
}

async function answerMachineDialogs(
  desktop: ElectronApplication,
  filename: string,
  answer: 'cancel' | 'allow',
) {
  await desktop.evaluate(
    ({ dialog }, { filename, answer }) => {
      const progress = globalThis as DialogProgress;
      delete progress.kivunoPairFixtureDialog;
      const open = dialog.showOpenDialog;
      const consent = dialog.showMessageBox;
      dialog.showOpenDialog = ((...args: unknown[]) => {
        dialog.showOpenDialog = open;
        const options = args.at(-1) as { title?: string; properties?: string[] };
        if (
          options.title !== 'Connect this computer to a Kivuno project' ||
          !options.properties?.includes('openFile')
        )
          throw new Error('The desktop did not request a private machine configuration.');
        return Promise.resolve({ canceled: false, filePaths: [filename] });
      }) as typeof open;
      dialog.showMessageBox = ((...args: unknown[]) => {
        dialog.showMessageBox = consent;
        const options = args.at(-1) as {
          title?: string;
          buttons?: string[];
          defaultId?: number;
          cancelId?: number;
          checkboxChecked?: boolean;
          checkboxLabel?: string;
        };
        if (
          options.title !== 'Allow this project to use your computer?' ||
          options.buttons?.[0] !== 'Cancel' ||
          options.buttons?.[1] !== 'Allow connection' ||
          options.defaultId !== 0 ||
          options.cancelId !== 0 ||
          options.checkboxChecked !== false ||
          options.checkboxLabel !== 'Allow full-access commands and file changes for 30 minutes'
        )
          throw new Error('The machine consent prompt must default to Cancel and no full access.');
        progress.kivunoPairFixtureDialog = answer;
        return Promise.resolve({
          response: answer === 'allow' ? 1 : 0,
          checkboxChecked: answer === 'allow',
        });
      }) as typeof consent;
    },
    { filename, answer },
  );
}

export async function joinCrossHostMacDesktop(config: Config) {
  assert.equal(process.platform, 'darwin');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-mac-owner-fixture-'));
  let app: ElectronApplication | undefined;
  const close = async () => {
    try {
      await app?.close();
    } finally {
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  try {
    const machineName = 'Shared Sade Mac fixture';
    const filename = path.join(directory, 'pair.private.json');
    const { projectId, ...connection } = config;
    await writeFile(
      filename,
      JSON.stringify({
        ...connection,
        name: machineName,
        maxLoad: 64,
        minFreeMB: 512,
        executionRequest: { projectId, projectName: 'Shared Sade verification' },
      }),
      { mode: 0o600 },
    );
    const env: Record<string, string | undefined> = {
      ...process.env,
      RELAY_DESKTOP_TESTING: '1',
      RELAY_DESKTOP_DATA_DIR: directory,
      RELAY_NODE_BINARY: process.execPath,
      RELAY_CLOUD_ORIGIN: config.origin,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const desktop = (app = await electron.launch({
      args: [path.resolve('desktop')],
      env: env as Record<string, string>,
      timeout: 60_000,
    }));
    const page = await desktop.firstWindow();
    await page.waitForFunction(() => Boolean(window.relayDesktop));
    const ownerId = await installFixtureIdentity(desktop, config.origin);
    const lockedOrigin = new URL(page.url()).origin;
    await page.evaluate(() => window.relayDesktop!.beginSignIn());
    await page.waitForURL((url) => url.origin !== lockedOrigin);
    await expect
      .poll(() => page.evaluate(async () => (await window.relayDesktop!.getStatus()).owner?.id))
      .toBe(ownerId);
    await page
      .getByRole('dialog', { name: 'Bắt đầu với Kivuno' })
      .getByRole('button', { name: 'Đóng hướng dẫn' })
      .click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Team', exact: true })
      .click();

    const workspace = await realpath(
      await page.evaluate(async () => {
        const { token } = await (await fetch('/api/session')).json();
        const response = await fetch('/api/state', { headers: { 'X-Relay-Token': token } });
        return (await response.json()).runtime.dataDir as string;
      }),
    );
    const relative = path.relative(await realpath(directory), workspace);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const machineDirectory = path.join(workspace, 'machine-links', config.id);
    const grantFile = path.join(machineDirectory, 'execution-grant.local.json');
    const marker = path.join(machineDirectory, 'state', 'runner-active.json');
    const join = page.getByRole('button', { name: 'Join as machine', exact: true });
    const joinedMachine = page.locator('.joined-machine').filter({ hasText: machineName });
    const dialogAnswer = () =>
      desktop.evaluate(() => (globalThis as DialogProgress).kivunoPairFixtureDialog);
    await answerMachineDialogs(desktop, filename, 'cancel');
    await join.click();
    await expect.poll(dialogAnswer).toBe('cancel');
    await expect(join).toBeEnabled();
    await assert.rejects(lstat(machineDirectory), { code: 'ENOENT' });
    await expect(joinedMachine).toHaveCount(0);

    const started = Date.now();
    await answerMachineDialogs(desktop, filename, 'allow');
    await join.click();
    await expect.poll(dialogAnswer).toBe('allow');
    await expect(joinedMachine.getByText('Running', { exact: true })).toBeVisible();
    const grant = JSON.parse(await readFile(grantFile, 'utf8'));
    assert.equal(grant.projectId, projectId);
    assert.equal(grant.fullAccess, true);
    assert.match(grant.id, /^[0-9a-f-]{36}$/);
    const expires = Date.parse(grant.expiresAt);
    assert.ok(expires >= started + 30 * 60_000 && expires <= Date.now() + 30 * 60_000);
    assert.equal((await lstat(grantFile)).mode & 0o777, 0o600);

    return {
      async stopDuringDiagnostic(probeId: string, naturalExitDelay: number) {
        const probe = path.join(machineDirectory, 'state', 'execution-home', probeId);
        const startedFile = probe + '.started.json';
        await expect
          .poll(
            () =>
              lstat(startedFile).then(
                (entry) => entry.isFile(),
                (error: NodeJS.ErrnoException) => {
                  if (error.code === 'ENOENT') return false;
                  throw error;
                },
              ),
            { timeout: 25_000 },
          )
          .toBe(true);
        const { pid, startedAt } = JSON.parse(await readFile(startedFile, 'utf8'));
        assert.ok(Number.isSafeInteger(pid) && pid > 1);
        assert.ok(
          Number.isSafeInteger(startedAt) && Date.now() - startedAt < naturalExitDelay,
          'the diagnostic must still be within its natural runtime before revocation',
        );
        assert.equal(processExists(pid), true, 'the diagnostic must be running before revocation');
        await assert.rejects(lstat(probe + '.completed'), { code: 'ENOENT' });
        await joinedMachine.getByRole('button', { name: 'Stop connection', exact: true }).click();
        await expect(joinedMachine.getByText('Stopped', { exact: true })).toBeVisible({
          timeout: 45_000,
        });
        assert.equal(processExists(pid), false, 'the owner stop must terminate the diagnostic');
        assert.ok(Date.now() - startedAt < naturalExitDelay, 'the diagnostic stopped early');
        await assert.rejects(lstat(probe + '.completed'), { code: 'ENOENT' });
        await assert.rejects(lstat(grantFile), { code: 'ENOENT' });
        await assert.rejects(lstat(marker), { code: 'ENOENT' });
        const connections = JSON.parse(
          await readFile(path.join(workspace, 'machine-links', 'connections.json'), 'utf8'),
        );
        assert.deepEqual(connections, [{ id: config.id, name: machineName, enabled: false }]);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
