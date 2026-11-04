// Production portal and CSP against real public/owner auth and desktop authorization.
// No Codex login, model usage, wallet funding or blockchain transaction.
import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { gatewayTarget } from '../api/gateway.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'relay-portal-browser-'));
const data = path.join(root, 'state');
await mkdir(data);
const store = new Store(path.join(data, 'workspace.db'));
const workspace = new Workspace(store, data, root);
const origin = 'https://relay.example';
const password = randomBytes(24).toString('hex');
const memberPassword = randomBytes(24).toString('hex');
const memberEmail = `ari-${randomBytes(5).toString('hex')}@example.com`;
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
let signupRequests = 0;
let approvalRequests = 0;
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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
async function routePortal(context: BrowserContext, available = false) {
  context.setDefaultTimeout(15000);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/state' || url.pathname === '/api/events')
      workspaceCalls.push(url.pathname);
    if (url.pathname === '/api/auth/sign-up/email') signupRequests++;
    if (url.pathname === '/api/desktop/approve') approvalRequests++;
    if (url.pathname === '/api/desktop/release') {
      // An unpublished release must render honestly, never as a working download.
      await route.fulfill({
        json: {
          version: '0.5.0',
          available,
          platform: 'win32-x64',
          signed: false,
          ...(available ? { url: '/downloads/Kivuno-Setup.exe' } : {}),
          platforms: {
            windows: {
              available,
              ...(available ? { url: '/downloads/Kivuno-Setup.exe', sha256: 'a'.repeat(64) } : {}),
            },
            linux: {
              available,
              ...(available ? { url: '/downloads/Kivuno.AppImage', sha256: 'b'.repeat(64) } : {}),
            },
            macos: { available: false },
          },
        },
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = await request.allHeaders();
      // Vercel's named catch-all adds path alongside the destination query.
      const rewritten = new URL('/api/gateway', origin);
      rewritten.search = url.search;
      rewritten.searchParams.set('relay_path', url.pathname.slice('/api/'.length));
      rewritten.searchParams.set('path', url.pathname.slice('/api/'.length));
      const target = gatewayTarget(rewritten.href);
      const response = await app.inject({
        method: request.method() as 'GET' | 'POST',
        url: target.pathname + target.search,
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
}
async function exchange(deviceCode: string, proof = verifier) {
  return app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode, verifier: proof },
  });
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await routePortal(context);
  const page = await context.newPage();
  await page.goto(origin);
  const heading = page.getByRole('heading', { name: 'Kivuno', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Windows chưa có bản tải' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Linux chưa có bản tải' })).toBeDisabled();
  await expect(page.getByRole('link', { name: /Tải Kivuno/ })).toHaveCount(0);
  await expect(page.getByText(/macos/i)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/kivuno-portal-desktop.png', fullPage: true });
  const messages = page.getByLabel('Tin nhắn minh họa, không phải hoạt động thật');
  await page
    .getByRole('heading', { name: 'Neralu · Chat dự án', exact: true })
    .scrollIntoViewIfNeeded();
  const menu = page.getByRole('navigation', { name: 'Menu Kivuno' });
  await expect(menu).toHaveClass(/is-docked/);
  await expect
    .poll(
      async () => {
        const dock = await menu.boundingBox();
        return Boolean(dock && dock.y < 80 && Math.abs(dock.x + dock.width / 2 - 720) < 4);
      },
      { message: 'Scrolled navigation stays at the top, centered.' },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByLabel('Graph session minh họa')).toBeVisible();
  await page.getByRole('button', { name: 'Session Tests của Ari' }).click();
  await expect(page.locator('.kp-session-selected')).toContainText('Tests · Ari');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Đã hiểu', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Đã hiểu', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Bàn giao', exact: true }).click();
  await expect(messages.getByText('Usage còn 49%. Mình đã dừng nhận việc mới.')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(messages.getByText(/route admin thiếu kiểm tra quyền/)).toBeVisible();
  await page.getByRole('button', { name: 'Phát demo', exact: true }).click();
  await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Phát demo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chia việc', exact: true }).click();
  await expect(messages.getByText('@Nova mình nhận backend. Bạn làm giao diện nhé?')).toBeVisible();
  const guide = page.getByRole('tablist', { name: 'Cách dùng Kivuno' });
  await guide.getByRole('tab', { name: '2 Tạo dự án' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Một mục tiêu chung.');
  await page.keyboard.press('ArrowRight');
  await expect(guide.getByRole('tab', { name: '3 Dẫn đội' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Chờ bạn duyệt');
  const downloadOpener = menu.getByRole('button', { name: 'Tải app', exact: true });
  await downloadOpener.click();
  const downloads = page.getByRole('dialog', { name: 'Tải Kivuno' });
  await expect(downloads.getByRole('button', { name: 'Windows chưa có bản tải' })).toBeDisabled();
  await expect(downloads.getByText(/macos/i)).toHaveCount(0);
  await downloads.getByText('Thông tin bản cài', { exact: true }).click();
  await expect(downloads.getByText('Windows x64 · Chưa ký chứng chỉ')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(downloads).toHaveCount(0);
  await expect(downloadOpener).toBeFocused();
  await menu.getByRole('button', { name: 'Kivuno — về màn hình đầu' }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(heading).toBeFocused();
  await expect(page.locator('.kp-pixel-curtain')).toHaveCount(0);
  const loginOpener = menu.getByRole('button', { name: 'Đăng nhập', exact: true });
  await loginOpener.click();
  const keyboardDialog = page.getByRole('dialog');
  await keyboardDialog.getByLabel('Email', { exact: true }).waitFor();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await keyboardDialog.getByRole('button', { name: 'Đóng đăng nhập' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(keyboardDialog.getByRole('button', { name: 'Chủ workspace cũ' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(keyboardDialog.getByRole('button', { name: 'Đóng đăng nhập' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(keyboardDialog).toHaveCount(0);
  await expect(loginOpener).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['.kp-hero', '#neralu', '#workflow', '.kp-footer']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await expect
    .poll(() =>
      page
        .locator('.kp-hivemind-art')
        .evaluate(
          (img) =>
            (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 1536,
        ),
    )
    .toBe(true);
  await page.screenshot({ path: '.local/kivuno-portal-mobile.png', fullPage: true });

  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await routePortal(reduced, true);
  const accountPage = await reduced.newPage();
  await accountPage.goto(`${origin}/?activate=${grant.userCode}`);
  const dialog = accountPage.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await dialog.getByLabel('Tên của bạn').fill('Ari Test');
  await dialog.getByLabel('Email', { exact: true }).fill(memberEmail.toUpperCase());
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill('short');
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  assert.equal(signupRequests, 0, 'Short passwords must not reach signup.');
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill(memberPassword);
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await dialog.getByText('Browser test desktop', { exact: true }).waitFor();
  assert.equal(signupRequests, 1);
  assert.equal(approvalRequests, 0, 'Signup must not automatically approve the desktop.');
  assert.equal((await exchange(grant.deviceCode)).statusCode, 202);
  await dialog.getByRole('button', { name: 'Xác nhận kết nối', exact: true }).click();
  await dialog.getByText('Quay lại Kivuno để bắt đầu làm việc.').waitFor();
  const memberToken = await exchange(grant.deviceCode);
  assert.equal(memberToken.statusCode, 200, memberToken.body);
  assert.equal(memberToken.json().owner.name, 'Ari Test');
  assert.notEqual(memberToken.json().owner.id, 'workspace-owner');
  assert.equal(typeof memberToken.json().accessToken, 'string');
  assert.equal((await exchange(grant.deviceCode)).statusCode, 400);
  await dialog.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await dialog.getByLabel('Email', { exact: true }).fill(memberEmail);
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill(memberPassword);
  await dialog.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await dialog.getByText('Ari Test', { exact: true }).waitFor();
  const current = await accountPage.evaluate(async () =>
    (await fetch('/api/auth/get-session')).json(),
  );
  assert.equal(current.user.email, memberEmail);
  assert.equal(current.user.emailVerified, false);
  assert.equal(approvalRequests, 1);
  await dialog.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await dialog.getByRole('button', { name: 'Chủ workspace cũ', exact: true }).click();
  await dialog.getByLabel('Mật khẩu chủ workspace').fill(password);
  await dialog.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const ownerStart = await app.inject({
    method: 'POST',
    url: '/api/desktop/authorize',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: {
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      name: 'Owner desktop',
    },
  });
  assert.equal(ownerStart.statusCode, 200, ownerStart.body);
  const ownerGrant = ownerStart.json();
  await dialog.getByLabel('Mã từ app desktop').fill(ownerGrant.userCode);
  await dialog.getByText('Owner desktop', { exact: true }).waitFor();
  assert.equal(approvalRequests, 1, 'Legacy login also requires explicit consent.');
  // Merely visiting the activation URL never authorizes the app.
  const waiting = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: ownerGrant.deviceCode, verifier },
  });
  assert.equal(waiting.statusCode, 202);
  await dialog.getByRole('button', { name: 'Xác nhận kết nối', exact: true }).click();
  await dialog.getByText('Quay lại Kivuno để bắt đầu làm việc.').waitFor();
  const token = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: ownerGrant.deviceCode, verifier },
  });
  assert.equal(token.statusCode, 200, token.body);
  assert.equal(typeof token.json().accessToken, 'string');
  assert.equal(token.json().owner.id, 'workspace-owner');
  const replay = await app.inject({
    method: 'POST',
    url: '/api/desktop/token',
    headers: { 'x-relay-gateway': gatewaySecret, origin, 'content-type': 'application/json' },
    payload: { deviceCode: ownerGrant.deviceCode, verifier },
  });
  assert.equal(replay.statusCode, 400);
  await dialog.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await dialog.getByLabel('Email', { exact: true }).waitFor();
  await accountPage.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(accountPage.getByRole('link', { name: 'Tải Kivuno cho Windows' })).toHaveAttribute(
    'href',
    '/downloads/Kivuno-Setup.exe',
  );
  await expect(accountPage.getByRole('link', { name: 'Tải Kivuno cho Linux' })).toHaveAttribute(
    'href',
    '/downloads/Kivuno.AppImage',
  );
  await expect(accountPage.getByText(/macos/i)).toHaveCount(0);
  await accountPage.locator('#workflow').scrollIntoViewIfNeeded();
  await accountPage.getByRole('button', { name: 'Kivuno — về màn hình đầu' }).click();
  await expect.poll(() => accountPage.evaluate(() => scrollY)).toBe(0);
  await expect(accountPage.locator('.kp-pixel-curtain')).toHaveCount(0);
  await expect(accountPage.getByRole('heading', { name: 'Kivuno', exact: true })).toHaveText(
    'Kivuno',
  );
  assert.deepEqual(workspaceCalls, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      portalOnly: true,
      responsive: true,
      honestReleaseState: true,
      platformDownloads: true,
      hiddenMacOS: true,
      interactiveDemos: true,
      dockAndLogoReturn: true,
      keyboardFocus: true,
      reducedMotion: true,
      realSignupAndLogin: true,
      realOwnerLogin: true,
      separateDesktopOwners: true,
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
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('relay-portal-browser-'));
  await rm(root, { recursive: true, force: true });
}
