// Actual Electron + bundled workspace server + installed Codex probe.
// The local identity fixture authorizes the test app only; it never creates a Codex login or model turn.
import assert from 'node:assert/strict';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-desktop-e2e-'));
const accessToken = 'desktop-test-session-' + '0'.repeat(64);
let challenge = '';
let approved = false;
let accountId = 'desktop-test-owner';
let tokenRequests = 0;
let revoked = false;
let bridgePolls = 0;
let bridgeRejectedInvalidMachine = false;
const expiresAt = new Date(Date.now() + 600000).toISOString();
const fixture = createServer(async (request, response) => {
  let input = '';
  for await (const chunk of request) input += chunk;
  const payload = input ? JSON.parse(input) : {};
  response.setHeader('Content-Type', 'application/json');
  const identity = {
    accessToken,
    expiresAt,
    owner: { id: accountId, name: accountId },
    deviceId: '1c62a82e-a094-43ce-b1c3-bf5df6c1387b',
  };
  if (request.url?.startsWith('/browser-fixture')) {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Project page</title><h1>Ready to review</h1><p>Public project summary</p><input type="password" value="never-share-password"><textarea>never-share-textarea</textarea><div contenteditable>never-share-editable</div><span hidden>never-share-hidden</span><div style="opacity:0"><span>never-share-transparent</span></div><script>window.secret="never-share-script"</script>',
    );
  } else if (request.url === '/api/desktop/authorize') {
    challenge = payload.challenge;
    response.end(
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'TEST-CODE',
        verificationUri: `${fixtureOrigin}/activate?code=TEST-CODE`,
        expiresAt,
      }),
    );
  } else if (request.url === '/api/desktop/token') {
    tokenRequests++;
    assert.equal(createHash('sha256').update(payload.verifier).digest('base64url'), challenge);
    response.statusCode = approved ? 200 : 202;
    response.end(JSON.stringify(approved ? identity : { error: 'authorization_pending' }));
  } else if (request.url === '/api/desktop/me') {
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    response.end(JSON.stringify(identity));
  } else if (request.url === '/api/desktop/bridge/poll') {
    bridgePolls++;
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    assert.match(payload.bridgeKey, /^[a-f0-9]{64}$/);
    response.end(
      JSON.stringify({
        requests:
          bridgePolls === 1
            ? [
                {
                  id: '71bd203f-83de-45c6-86e0-40b20d62e4ed',
                  authorization: `Bearer ${'x'.repeat(43)}`,
                  body: { epoch: '', ready: true, busy: false, version: 'bridge-test', events: [] },
                },
              ]
            : [],
        ack: payload.responses.map((item: { id: string }) => item.id),
      }),
    );
    if (payload.responses.some((item: { status: number }) => item.status === 401))
      bridgeRejectedInvalidMachine = true;
  } else if (request.url === '/api/desktop/revoke') {
    revoked = true;
    response.end('{}');
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
});
await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = (fixture.address() as { port: number }).port;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const env = { ...process.env } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
Object.assign(env, {
  RELAY_DESKTOP_TESTING: '1',
  RELAY_DESKTOP_DATA_DIR: directory,
  RELAY_NODE_BINARY: process.execPath,
  RELAY_CLOUD_ORIGIN: fixtureOrigin,
});
let desktop: ElectronApplication | undefined;
try {
  desktop = await electron.launch({ args: [path.resolve('desktop')], env, timeout: 60000 });
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).relayDesktop), { timeout: 30000 });
  const before = await page.evaluate(() => (window as any).relayDesktop.getStatus());
  assert.equal(before.signedIn, false);
  assert.equal(before.runtime, 'ready');
  assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
  const lockedOrigin = new URL(page.url()).origin;
  const unauthorized = await fetch(lockedOrigin + '/api/session');
  assert.equal(
    unauthorized.status,
    403,
    'ordinary processes cannot bootstrap a desktop browser session',
  );

  const pending = await page.evaluate(() => (window as any).relayDesktop.beginSignIn());
  assert.equal(pending.pending.userCode, 'TEST-CODE');
  assert.equal(pending.signedIn, false);
  approved = true;
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
      { timeout: 20000 },
    )
    .toBe(true);
  assert.ok(tokenRequests > 0);
  await page.waitForURL((url) => url.origin !== lockedOrigin, { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  const localOrigin = new URL(page.url()).origin;
  const state = await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/state', { headers: { 'X-Relay-Token': session.token } });
    return response.json();
  });
  assert.equal(state.members.length, 0);
  assert.equal(state.runtime.codexAvailable, true, 'real bundled Codex must pass --version');
  const publicStatus = await page.evaluate(() => (window as any).relayDesktop.getStatus());
  assert.equal(publicStatus.owner.id, 'desktop-test-owner');
  assert.equal(JSON.stringify(publicStatus).includes(accessToken), false);
  const encrypted = await readFile(path.join(directory, 'desktop-session.bin'));
  assert.equal(encrypted.includes(Buffer.from(accessToken)), false);
  await expect.poll(() => bridgePolls, { timeout: 15000 }).toBeGreaterThan(1);
  assert.equal(
    bridgeRejectedInvalidMachine,
    true,
    'the cloud bridge must forward to the authenticated local runner boundary',
  );

  const memory = async () =>
    desktop!.evaluate(({ app }) =>
      app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
    );
  const rendererCount = async () =>
    desktop!.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  const baselineRenderers = await rendererCount();
  const beforeBrowserKb = await memory();
  const bounds = { x: 200, y: 100, width: 700, height: 500 };
  await page.evaluate(
    async ({ url, bounds }) =>
      (window as any).relayDesktop.browser.open({ projectId: 'browser-project-a', url, bounds }),
    { url: fixtureOrigin + '/browser-fixture?secret=query-token', bounds },
  );
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).loading,
    )
    .toBe(false);
  assert.equal(await rendererCount(), baselineRenderers + 1, 'only one on-demand browser renderer');
  const browserCapabilities = await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    return browser.executeJavaScript(
      '({bridge:typeof window.relayDesktop,node:typeof require,inputs:document.querySelector("input").value})',
    );
  });
  assert.deepEqual(browserCapabilities, {
    bridge: 'undefined',
    node: 'undefined',
    inputs: 'never-share-password',
  });
  const snapshot = await page.evaluate(() => (window as any).relayDesktop.browser.snapshot());
  assert.match(snapshot.text, /Public project summary/);
  assert.equal(snapshot.text.includes('never-share'), false);
  assert.equal(snapshot.url, fixtureOrigin + '/browser-fixture');
  const withBrowserKb = await memory();
  await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    await browser.executeJavaScript('document.cookie="project_cookie=project_a"');
  });
  await page.evaluate(
    async ({ url, bounds }) =>
      (window as any).relayDesktop.browser.open({ projectId: 'browser-project-b', url, bounds }),
    { url: fixtureOrigin + '/browser-fixture', bounds },
  );
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).loading,
    )
    .toBe(false);
  const isolatedCookie = await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    return browser.executeJavaScript('document.cookie');
  });
  assert.equal(isolatedCookie, '', 'project browser cookies are partitioned by owner and project');
  await assert.rejects(
    page.evaluate(
      async ({ url, bounds }) =>
        (window as any).relayDesktop.browser.open({ projectId: 'browser-project-b', url, bounds }),
      { url: localOrigin, bounds },
    ),
    /cannot open/,
  );
  await page.evaluate(() => (window as any).relayDesktop.browser.close());
  await expect.poll(rendererCount).toBe(baselineRenderers);
  const afterBrowserKb = await memory();
  console.log(
    `Desktop memory (Electron working-set KB, no model workers): idle=${beforeBrowserKb}, browser=${withBrowserKb}, released=${afterBrowserKb}; browser renderer removed on close.`,
  );
  const guide = page.getByRole('button', { name: 'Đóng hướng dẫn', exact: true });
  if (await guide.isVisible()) await guide.click();
  const titlebar = page.getByRole('banner', { name: 'Điều khiển cửa sổ' });
  await expect(titlebar.getByRole('button')).toHaveCount(3);
  await titlebar.getByRole('button', { name: 'Phóng to', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).maximized,
    )
    .toBe(true);
  await titlebar.getByRole('button', { name: 'Khôi phục cửa sổ', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).maximized,
    )
    .toBe(false);
  await page.locator('body').click({ position: { x: 300, y: 150 } });
  await page.keyboard.press('F11');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).fullscreen,
    )
    .toBe(true);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(0);
  await page.mouse.move(300, 2);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(0);
  await page.mouse.move(300, 150);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(0);
  await page.keyboard.press('F10');
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(0);
  await page.keyboard.press('F11');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).fullscreen,
    )
    .toBe(false);

  // Real React panel + native view, with deterministic HTTPS content served only
  // inside this test owner's project partition. No external account or model turn.
  const post = (route: string, body: unknown) =>
    page.evaluate(
      async ({ route, body }) => {
        const { token } = await (await fetch('/api/session')).json();
        const result = await fetch(`/api${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token },
          body: JSON.stringify(body),
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        return data;
      },
      { route, body },
    );
  const member = await post('/members', { name: 'Browser fixture', role: 'researcher' });
  const project = await post('/hackathons', {
    memberId: member.id,
    name: 'Browser test project',
    competitionName: 'Browser fixture',
    competitionUrl: 'https://example.org/challenge',
    goal: 'Verify desktop browser controls without starting a model.',
  });
  const session = await post('/sessions', {
    memberId: member.id,
    projectId: project.id,
    title: 'Browser review',
    readOnly: true,
  });
  await page.evaluate(() => sessionStorage.setItem('kivuno-guide-v3', 'seen'));
  const uiFixture = { projectId: project.id, sessionId: session.id };
  const partition =
    'persist:kivuno-browser-' +
    createHash('sha256')
      .update('desktop-test-owner\0' + uiFixture.projectId)
      .digest('hex');
  await desktop.evaluate(({ session }, partition) => {
    session
      .fromPartition(partition)
      .protocol.handle(
        'https',
        () =>
          new Response(
            '<!doctype html><title>Reviewed page</title><h1>Browser integration</h1><p>Human reviewed project details.</p><input type="password" value="never-share-login">',
            { headers: { 'Content-Type': 'text/html' } },
          ),
      );
  }, partition);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Neralu', exact: true })
    .click();
  await page.getByRole('button', { name: 'Session view', exact: true }).click();
  await page
    .getByRole('button', { name: 'Browser review, Browser fixture, idle', exact: true })
    .click();
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await page
    .getByLabel('Địa chỉ website')
    .fill('https://browser.kivuno.test/project?token=private');
  await page.getByRole('button', { name: 'Mở website', exact: true }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).title,
    )
    .toBe('Reviewed page');
  await page.getByRole('button', { name: 'Chia sẻ trang', exact: true }).click();
  const reviewed = page.getByLabel('Xem lại nội dung chia sẻ');
  await expect(reviewed).toHaveValue(/Human reviewed project details\./);
  assert.equal((await reviewed.inputValue()).includes('never-share-login'), false);
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.filter((view) => !view.getVisible())
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await reviewed.fill('Reviewed and edited by the human.');
  await page.getByRole('button', { name: /Chia sẻ & tiếp tục|Gửi cho Codex/ }).click();
  await expect(reviewed).toHaveCount(0);
  const sharedPage = await page.evaluate(async ({ projectId, sessionId }) => {
    const { token } = await (await fetch('/api/session')).json();
    return (
      await fetch(`/api/projects/${projectId}/browser?sessionId=${sessionId}`, {
        headers: { 'X-Relay-Token': token },
      })
    ).json();
  }, uiFixture);
  assert.equal(sharedPage.snapshot.text, 'Reviewed and edited by the human.');
  assert.equal(sharedPage.snapshot.url, 'https://browser.kivuno.test/project');
  await page.getByRole('button', { name: 'Close context panel', exact: true }).click();
  await expect.poll(rendererCount).toBe(baselineRenderers);

  // Both real-client connection types use scoped local MCP, not native model dispatch.
  for (const provider of ['claude', 'antigravity'] as const) {
    const label = provider === 'claude' ? 'Claude' : 'Antigravity';
    const external = await post('/members', {
      name: `${label} local`,
      role: 'engineer',
      provider,
    });
    await page.evaluate(
      async ({ projectId, memberId }) => {
        const { token } = await (await fetch('/api/session')).json();
        const state = await (
          await fetch('/api/state', { headers: { 'X-Relay-Token': token } })
        ).json();
        const project = state.projects.find((entry: { id: string }) => entry.id === projectId);
        const response = await fetch(`/api/projects/${projectId}/members`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token },
          body: JSON.stringify({ memberIds: [...project.memberIds, memberId] }),
        });
        if (!response.ok) throw new Error('Could not add the external fixture member.');
      },
      { projectId: uiFixture.projectId, memberId: external.id },
    );
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Team', exact: true })
      .click();
    const externalCard = page
      .locator('.account-card-group')
      .filter({ has: page.getByRole('heading', { name: `${label} local`, exact: true }) });
    await externalCard.getByRole('button', { name: 'MESH connection', exact: true }).click();
    const externalDialog = page.getByRole('dialog', { name: `${label} · MESH connection` });
    await expect(externalDialog.getByRole('checkbox').nth(0)).not.toBeChecked();
    await expect(externalDialog.getByRole('checkbox').nth(1)).not.toBeChecked();
    await externalDialog.getByRole('button', { name: 'Generate MCP config', exact: true }).click();
    const configInput = externalDialog.getByLabel('MCP configuration');
    await expect(configInput).toBeVisible();
    const config = JSON.parse(await configInput.inputValue());
    const mcp = Object.values(config.mcpServers)[0] as {
      env: { KIVUNO_MCP_URL: string; KIVUNO_MCP_TOKEN: string };
    };
    assert.equal(mcp.env.KIVUNO_MCP_URL, localOrigin + '/api/external-agent/rpc');
    assert.match(mcp.env.KIVUNO_MCP_TOKEN, /^[A-Za-z0-9_-]{43}$/);
    await expect(externalDialog.getByRole('progressbar')).toHaveAttribute('value', '1');
    const connectedClient = await fetch(mcp.env.KIVUNO_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mcp.env.KIVUNO_MCP_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'controlled-ui-fixture', version: '1' },
        },
      }),
    });
    assert.equal(connectedClient.status, 200);
    await expect(externalDialog.getByRole('progressbar')).toHaveAttribute('value', '3', {
      timeout: 5000,
    });
    await externalDialog.getByRole('button', { name: 'Revoke connection', exact: true }).click();
    await expect(configInput).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }

  await page.evaluate(() => {
    void (window as any).relayDesktop.signOut();
  });
  await page.waitForURL((url) => url.origin !== localOrigin, { timeout: 30000 });
  await page.waitForFunction(() => Boolean((window as any).relayDesktop));
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
      { timeout: 15000 },
    )
    .toBe(false);
  await expect.poll(() => revoked).toBe(true);
  // Same OS profile, two distinct Kivuno identities; projects and AI profiles must
  // survive switching back, never follow the machine's last user.
  const switchIn = async (id: string) => {
    accountId = id;
    const oldOrigin = new URL(page.url()).origin;
    await page.evaluate(() => (window as any).relayDesktop.beginSignIn());
    await page.waitForURL((url) => url.origin !== oldOrigin, { timeout: 60000 });
    await page.waitForFunction(() => Boolean((window as any).relayDesktop));
    return page.evaluate(async () => {
      const session = await (await fetch('/api/session')).json();
      return (await fetch('/api/state', { headers: { 'X-Relay-Token': session.token } })).json();
    });
  };
  const bob = await switchIn('second-kivuno-user');
  assert.equal(bob.members.length, 0);
  assert.equal(bob.projects.length, 0);
  assert.notEqual(bob.runtime.dataDir, state.runtime.dataDir);
  await post('/members', { name: 'Only Bob', role: 'researcher' });
  const bobOrigin = new URL(page.url()).origin;
  await page.evaluate(() => {
    void (window as any).relayDesktop.signOut();
  });
  await page.waitForURL((url) => url.origin !== bobOrigin, { timeout: 30000 });
  const returned = await switchIn('desktop-test-owner');
  assert.ok(returned.projects.some((item: { id: string }) => item.id === uiFixture.projectId));
  assert.ok(!returned.members.some((item: { name: string }) => item.name === 'Only Bob'));
  // A new app launch must show sign-in even while a prior session file exists.
  await desktop.close();
  desktop = await electron.launch({ args: [path.resolve('desktop')], env, timeout: 60000 });
  const reopened = await desktop.firstWindow();
  await reopened.waitForFunction(() => Boolean((window as any).relayDesktop));
  assert.equal(
    (await reopened.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
    false,
  );
  await expect(
    reopened.getByRole('button', { name: 'Đăng nhập Kivuno', exact: true }),
  ).toBeVisible();

  console.log(
    'Desktop E2E passed: Electron/runtime/Codex probe, activation, protected local API, isolated project browser, explicit safe page snapshot, browser release, fullscreen controls, DPAPI session and sign-out.',
  );
} finally {
  if (desktop) await desktop.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  // Only this test-created absolute temporary directory is removed.
  if (
    path.dirname(directory) === os.tmpdir() &&
    path.basename(directory).startsWith('relay-desktop-e2e-')
  )
    await rm(directory, { recursive: true, force: true });
}
