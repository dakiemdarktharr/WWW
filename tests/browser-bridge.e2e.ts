// Production assets at a controlled HTTPS origin + real loopback HTTP/SQLite.
// No Codex process, account login, model turn or production data is used.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { hostedOrigin } from '../shared/browser-bridge.ts';
import type { CodexSession } from '../shared/types.ts';

const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-browser-bridge-'));
const repo = path.join(dir, 'repo');
await mkdir(repo);
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'pipe' });
await writeFile(path.join(repo, 'README.md'), 'Isolated browser test repository\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync(
  'git',
  [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'test fixture',
  ],
  { stdio: 'pipe' },
);
const dataDir = path.join(dir, 'private');
await mkdir(dataDir);
const store = new Store(path.join(dataDir, 'state.db'));
const workspace = new Workspace(store, dataDir, dir);
const port = Number(process.env.BRIDGE_TEST_PORT || 4321);
const localOrigin = `http://127.0.0.1:${port}`;
const app = await buildApp(workspace, { port, distDir: path.resolve('dist') });
await app.listen({ host: '127.0.0.1', port });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(12000);
const errors: string[] = [];
const forbiddenRequests: string[] = [];
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const headers = Object.fromEntries(
  config.headers[0].headers.map((item: { key: string; value: string }) => [item.key, item.value]),
);
const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
await context.addInitScript(() => {
  try {
    for (const key of [
      'hosted:intro',
      'local:intro',
      ...['hosted', 'mesh', 'sessions', 'team', 'settings', 'workroom', 'tasks', 'reviews'].map(
        (stage) => `stage:${stage}`,
      ),
    ])
      sessionStorage.setItem(`relay-guide-v2:${key}`, 'seen');
  } catch {
    /* about:blank has no storage. */
  }
});
await context.route(`${hostedOrigin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    forbiddenRequests.push(url.href);
    await route.fulfill({ status: 500, body: 'Cloud API must not be called' });
    return;
  }
  const file = path.join(path.resolve('dist'), url.pathname === '/' ? 'index.html' : url.pathname);
  await route.fulfill({
    body: await readFile(file),
    headers,
    contentType: types[path.extname(file)] || 'application/octet-stream',
  });
});
context.on('page', (page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (page.url().startsWith(hostedOrigin) && request.url().startsWith(`${localOrigin}/api/`))
      forbiddenRequests.push(request.url());
  });
});
const page = await context.newPage();
const nav = (name: string) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true });
async function connect() {
  await page.getByLabel('Port', { exact: true }).fill(String(port));
  const promise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Kết nối runner', exact: true }).click();
  const popup = await promise;
  await popup.getByRole('button', { name: 'Cho phép kết nối', exact: true }).waitFor();
  assert.equal(popup.url(), `${localOrigin}/#connect`);
  return popup;
}
try {
  await page.goto(`${hostedOrigin}/#mesh`);
  await page.getByRole('heading', { name: 'MESH', exact: true }).waitFor();
  await nav('Sessions').click();
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor();
  assert.equal(page.url(), `${hostedOrigin}/#sessions`);
  assert.equal(await page.locator('a[href^="http://127.0.0.1"]').count(), 0);
  assert.equal(store.members().length, 0);
  await page.getByLabel('Port', { exact: true }).fill('abc');
  assert.equal(
    await page.getByRole('button', { name: 'Kết nối runner', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('Port', { exact: true }).fill(String(port));
  await page.evaluate(() => {
    (window as any).__open = window.open;
    window.open = () => null;
  });
  await page.getByRole('button', { name: 'Kết nối runner', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'chặn cửa sổ' }).waitFor();
  await page.evaluate(() => {
    window.open = (window as any).__open;
  });

  let apiBeforeConsent = 0;
  const observe = (request: import('@playwright/test').Request) => {
    if (request.url().startsWith(`${localOrigin}/api/`)) apiBeforeConsent++;
  };
  context.on('request', observe);
  const rejected = await connect();
  assert.equal(apiBeforeConsent, 0);
  await rejected.getByRole('button', { name: 'Từ chối', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'từ chối' }).waitFor();
  const runner = await connect();
  assert.equal(apiBeforeConsent, 0);
  context.off('request', observe);
  await runner.getByRole('button', { name: 'Cho phép kết nối', exact: true }).click();
  await runner.getByRole('heading', { name: 'Runner đã kết nối', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New session', exact: true }).waitFor();
  assert.equal(page.url(), `${hostedOrigin}/#sessions`);
  await nav('Team').click();
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByLabel('Agent name', { exact: true }).fill('Browser regression');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser regression', exact: true }).waitFor();
  assert.equal(store.members()[0]?.name, 'Browser regression');
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Bridge test');
  await dialog.getByLabel('Repository path', { exact: true }).fill(repo);
  await dialog
    .getByLabel('Shared goal', { exact: true })
    .fill('Verify browser bridge without using a model');
  await dialog.getByRole('button', { name: 'Connect project', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(store.projects()[0]?.name, 'Bridge test');
  await nav('MESH').click();
  await page.getByRole('heading', { name: 'Bridge test', exact: true }).waitFor();
  await page.getByLabel('Message the project team', { exact: true }).fill('Browser bridge message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Browser bridge message', { exact: true }).waitFor();
  assert.equal(
    workspace.snapshot().messages.some((message) => message.content === 'Browser bridge message'),
    true,
  );
  assert.equal(store.sessions().length, 0);
  if (process.env.BRIDGE_SCREENSHOT_DIR) {
    await mkdir(process.env.BRIDGE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.BRIDGE_SCREENSHOT_DIR, 'mesh.png'),
      fullPage: true,
    });
  }

  // An inert fixture exercises the actual popout button, not a model execution.
  const session: CodexSession = {
    id: randomUUID(),
    memberId: store.members()[0].id,
    projectId: store.projects()[0].id,
    taskId: randomUUID(),
    title: 'Paused UI fixture',
    status: 'paused',
    readOnly: true,
    threadId: null,
    turnId: null,
    pid: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.put('session', session);
  await nav('Sessions').click();
  const childPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: `Pop out ${session.title}`, exact: true }).click();
  const child = await childPromise;
  await child.getByRole('heading', { name: session.title, exact: true, level: 1 }).waitFor();
  assert.equal(child.url(), `${hostedOrigin}/#session=${session.id}`);
  if (process.env.BRIDGE_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(process.env.BRIDGE_SCREENSHOT_DIR, 'sessions.png'),
      fullPage: true,
    });
  await runner.getByRole('button', { name: 'Ngắt kết nối', exact: true }).click();
  await page.getByRole('button', { name: 'Kết nối runner', exact: true }).waitFor();
  await child.getByRole('button', { name: 'Kết nối runner', exact: true }).waitFor();
  assert.equal(await page.locator('.session-console').count(), 0);
  await child.close();
  await runner.close();
  const second = await connect();
  await second.getByRole('button', { name: 'Cho phép kết nối', exact: true }).click();
  await page.getByRole('button', { name: `Pop out ${session.title}`, exact: true }).waitFor();
  await second.close();
  await page
    .getByRole('alert')
    .filter({ hasText: /đã (đóng|ngắt)/ })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  // A different site cannot obtain a consent button or read the local API.
  await context.route('https://attacker.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<button id="connect">Connect</button><script>connect.onclick=()=>{const p=open("' +
        localOrigin +
        '/#connect");setInterval(()=>p.postMessage({type:"relay:connect",nonce:"' +
        randomUUID() +
        '"},"' +
        localOrigin +
        '"),200)}</script>',
    }),
  );
  const attacker = await context.newPage();
  await attacker.goto('https://attacker.example');
  const attackPopup = context.waitForEvent('page');
  await attacker.getByRole('button', { name: 'Connect', exact: true }).click();
  const denied = await attackPopup;
  await denied.getByRole('heading', { name: 'Cho phép kết nối workspace?', exact: true }).waitFor();
  await denied.waitForTimeout(700);
  assert.equal(
    await denied.getByRole('button', { name: 'Cho phép kết nối', exact: true }).count(),
    0,
  );
  assert.deepEqual(forbiddenRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      hostedNavigation: true,
      blockedPopup: true,
      consentRequired: true,
      realHTTPAndSQLite: true,
      meshMessage: true,
      sessionPopout: true,
      revokeAndReconnect: true,
      closedRunnerDetected: true,
      foreignOriginRejected: true,
      pageErrors: 0,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}
