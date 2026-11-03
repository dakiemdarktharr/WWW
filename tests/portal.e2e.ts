// Browser portal against real owner authentication and desktop authorization.
// No Codex login, model usage, wallet funding or blockchain transaction.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'relay-portal-browser-'));
const data = path.join(root, 'state');
await mkdir(data);
const store = new Store(path.join(data, 'workspace.db'));
const workspace = new Workspace(store, data, root);
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
const errors: string[] = [];
const workspaceCalls: string[] = [];
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const verifier = randomBytes(32).toString('base64url');
const start = await app.inject({
  method: 'POST',
  url: '/api/desktop/authorize',
  headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
  payload: {
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    name: 'Browser test desktop',
  },
});
assert.equal(start.statusCode, 200, start.body);
const grant = start.json();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(15000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/state' || url.pathname === '/api/events')
      workspaceCalls.push(url.pathname);
    if (url.pathname === '/api/desktop/release') {
      // An unpublished release must render honestly, never as a working download.
      await route.fulfill({
        json: { version: '0.3.0', available: false, platform: 'win32-x64', signed: false },
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = await request.allHeaders();
      const response = await app.inject({
        method: request.method() as 'GET' | 'POST',
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
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Một nơi cho cả đội Codex.' }).waitFor();
  await page.getByText('Bản cài đặt chưa được phát hành.').waitFor();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/relay-portal-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.goto(`${origin}/?activate=${grant.userCode}`);
  const dialog = page.getByRole('dialog', { name: 'Đăng nhập RELAY' });
  await dialog.getByLabel('Mật khẩu chủ workspace').fill(password);
  await dialog.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await dialog.getByText('Browser test desktop', { exact: true }).waitFor();
  // Merely visiting the activation URL never authorizes the app.
  const waiting = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: grant.deviceCode, verifier },
  });
  assert.equal(waiting.statusCode, 202);
  await dialog.getByRole('button', { name: 'Kết nối desktop này', exact: true }).click();
  await page.getByText('Quay lại app RELAY để bắt đầu làm việc.').waitFor();
  const token = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: grant.deviceCode, verifier },
  });
  assert.equal(token.statusCode, 200, token.body);
  assert.equal(typeof token.json().accessToken, 'string');
  const replay = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: grant.deviceCode, verifier },
  });
  assert.equal(replay.statusCode, 400);
  await page.getByRole('button', { name: 'Đăng xuất web', exact: true }).click();
  await page.getByLabel('Mật khẩu chủ workspace').waitFor();
  assert.deepEqual(workspaceCalls, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      portalOnly: true,
      responsive: true,
      honestReleaseState: true,
      realOwnerLogin: true,
      explicitDesktopConsent: true,
      oneUseExchange: true,
      noModelUsage: true,
      pageErrors: 0,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(root, { recursive: true, force: true });
}
