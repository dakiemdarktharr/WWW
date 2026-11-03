// Production UI, real Fastify/SQLite/owner auth. No Codex login or model turns.
import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';

const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-cloud-browser-'));
const data = path.join(directory, 'state');
await mkdir(data);
const store = new Store(path.join(data, 'workspace.db'));
const workspace = new Workspace(store, data, directory);
workspace.login = async () => ({
  type: 'chatgptDeviceCode',
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'TEST-ONLY',
});
workspace.client = async () => {
  throw new Error('Sign in to this Codex account to read its available models.');
};
workspace.runtime.deployment = 'cloud';
const origin = 'https://relay.example';
const password = randomBytes(24).toString('hex');
const gatewaySecret = randomBytes(32).toString('hex');
const auth = await createCloudIdentity({
  directory: data,
  origin,
  secret: randomBytes(32).toString('hex'),
  bootstrapPassword: password,
});
const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth } });
const browser = await chromium.launch();
const errors: string[] = [],
  forbidden: string[] = [];
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
async function device() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  context.setDefaultTimeout(12000);
  await context.addInitScript(() => {
    try {
      for (const key of [
        'local:intro',
        'cloud:intro',
        ...['mesh', 'sessions', 'team', 'settings', 'workroom', 'tasks', 'reviews'].map(
          (stage) => `stage:${stage}`,
        ),
      ])
        sessionStorage.setItem(`relay-guide-v2:${key}`, 'seen');
    } catch {
      /* about:blank has no storage */
    }
  });
  context.on('request', (req) => {
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(req.url())) forbidden.push(req.url());
  });
  context.on('page', (page) => page.on('pageerror', (e) => errors.push(e.message)));
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/events') {
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = await request.allHeaders();
      const response = await app.inject({
        method: request.method() as 'GET' | 'POST' | 'PATCH',
        url: url.pathname + url.search,
        headers: { ...headers, 'x-relay-gateway': gatewaySecret },
        ...(request.postData() ? { payload: request.postData()! } : {}),
      });
      await route.fulfill({
        status: response.statusCode,
        body: response.body,
        headers: Object.fromEntries(
          Object.entries(response.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
        ),
      });
      return;
    }
    await route.fulfill({
      body: await readFile(path.join('dist', url.pathname === '/' ? 'index.html' : url.pathname)),
      contentType: mime[path.extname(url.pathname)] || 'text/html',
      headers: Object.fromEntries(
        config.headers[0].headers.map((header: { key: string; value: string }) => [
          header.key,
          header.value,
        ]),
      ),
    });
  });
  return context;
}
async function login(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${origin}/#mesh`);
  await page.getByLabel('Mật khẩu chủ workspace').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
  return page;
}
try {
  const first = await device(),
    second = await device();
  const page = await login(first);
  const nav = (name: string) =>
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true });
  await nav('Team').click();
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByText('TEST-ONLY', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('heading', { name: 'Atlas', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New project', exact: true });
  await project.getByLabel('Project name', { exact: true }).fill('Cloud project');
  await project.getByLabel('Codex owner', { exact: true }).selectOption({ label: 'Atlas' });
  await project.getByLabel('Competition', { exact: true }).fill('Browser challenge');
  await project
    .getByLabel('Competition URL', { exact: true })
    .fill('https://example.com/challenge');
  await project
    .getByLabel('Shared goal', { exact: true })
    .fill('Verify real cloud workspace interactions');
  await project.getByRole('button', { name: 'Create project', exact: true }).click();
  await project.waitFor({ state: 'hidden' });
  assert.equal(store.projects()[0].repositoryName, 'NoSleepClub_Browser-challenge_Cloud-project');
  await nav('MESH').click();
  await page.getByLabel('Message the project team').fill('Shared across devices');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Shared across devices', { exact: true }).waitFor();
  const other = await login(second);
  await other.getByText('Shared across devices', { exact: true }).waitFor();
  await nav('Sessions').click();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const session = page.getByRole('dialog', { name: 'New Codex session' });
  await session.getByLabel('Session title').fill('Saved conversation');
  await session.getByRole('button', { name: 'Create session', exact: true }).click();
  await session.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Saved conversation', exact: true }).waitFor();
  assert.equal(store.sessions()[0].threadId, null);
  assert.equal(first.pages().length, 1); // All work happens inline, no runner popup.
  await other.reload();
  await other
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Sessions', exact: true })
    .click();
  await other.getByRole('heading', { name: 'Saved conversation', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ownerLogin: true,
      projectGit: true,
      meshAcrossDevices: true,
      savedConversation: true,
      noLocalhost: true,
      noPopup: true,
      noModelUsage: true,
      pageErrors: 0,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
