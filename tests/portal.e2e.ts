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
const recoveryInbox: { to: string; html: string; text: string; subject: string }[] = [];
const auth = await createCloudIdentity({
  directory: data,
  origin,
  secret: randomBytes(32).toString('hex'),
  bootstrapPassword: password,
  sendMail: async (message) => {
    recoveryInbox.push(message);
  },
});
const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth } });
const errors: string[] = [];
const workspaceCalls: string[] = [];
const apiCalls: string[] = [];
let signupRequests = 0;
let approvalRequests = 0;
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const titleAsset = await readFile('dist/art/kivuno-puffy-title.glb');
assert.equal(titleAsset.toString('ascii', 0, 4), 'glTF');
const titleModel = JSON.parse(
  titleAsset.toString('utf8', 20, 20 + titleAsset.readUInt32LE(12)),
) as {
  asset: { generator: string };
  nodes: { name?: string; mesh?: number }[];
};
assert.match(titleModel.asset.generator, /Blender/);
for (let row = 1; row <= 4; row++) {
  const prefix = `SM_Row_${String(row).padStart(2, '0')}_Letter_`;
  const letters = titleModel.nodes.filter(
    (node) => node.name?.startsWith(prefix) && node.mesh !== undefined,
  );
  assert.equal(letters.length, 6, 'Each Blender row has six real letter meshes.');
  assert.equal(letters.map((node) => node.name!.slice(-1)).join(''), 'KIVUNO');
}
const browser = await chromium.launch({
  ...(process.platform === 'win32' ? { channel: 'chromium', args: ['--use-angle=d3d11'] } : {}),
});
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
    if (url.pathname.startsWith('/api/')) apiCalls.push(url.pathname);
    if (url.pathname === '/api/state' || url.pathname === '/api/events')
      workspaceCalls.push(url.pathname);
    if (url.pathname === '/api/auth/sign-up/email') signupRequests++;
    if (url.pathname === '/api/desktop/approve') approvalRequests++;
    if (url.pathname === '/api/desktop/release') {
      // An unpublished release must render honestly, never as a working download.
      await route.fulfill({
        json: {
          version: '0.8.5',
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
            macos: {
              available,
              notarized: false,
              ...(available ? { url: '/downloads/Kivuno-macOS-arm64.dmg' } : {}),
            },
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
      body: await readFile(
        path.join(
          'dist',
          ['/', '/billing', '/forgot-password', '/reset-password'].includes(url.pathname)
            ? 'index.html'
            : url.pathname,
        ),
      ),
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
  const cspViolations: string[] = [];
  await page.exposeFunction('recordPortalCspViolation', (directive: string) =>
    cspViolations.push(directive),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (
        window as unknown as { recordPortalCspViolation: (value: string) => void }
      ).recordPortalCspViolation(event.violatedDirective);
    });
  });
  await page.goto(origin + '/#updates');
  await expect
    .poll(() => page.locator('#updates').evaluate((section) => section.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => page.locator('#updates').evaluate((section) => section.getBoundingClientRect().top))
    .toBeLessThan(200);
  const latestPatch = page.locator('#updates details').first();
  await expect(latestPatch).toHaveAttribute('open', '');
  await latestPatch.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(latestPatch).not.toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(latestPatch).toHaveAttribute('open', '');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const heading = page.getByRole('heading', { name: 'Kivuno', exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText('Kivuno');
  const title = page.locator('.kp-puffy-title');
  const titleStage = page.locator('.kp-puffy-stage');
  // Leave time for Chromium to paint the final frame on software WebGL runners.
  const expectTitleReturn = expect.configure({ timeout: 10000 });
  await expect(title).toHaveAttribute('data-title-state', 'ready', { timeout: 20000 });
  await expect(titleStage.locator('canvas')).toBeVisible();
  await expect(titleStage).toHaveAttribute('data-rotation', '0.0000,0.0000');
  const titleBox = await titleStage.boundingBox();
  assert.ok(titleBox);
  await titleStage.focus();
  await expect(titleStage).toHaveCSS('outline-style', 'none');
  await expect(
    page.locator(
      '.kp-puffy-reset, .kp-puffy-hint, .kp-hero-meta, .kp-hero-caption, .kp-feature-copy > p',
    ),
  ).toHaveCount(0);
  await page.mouse.move(titleBox.x + titleBox.width * 0.29, titleBox.y + titleBox.height * 0.22);
  await page.mouse.down();
  await expect
    .poll(async () => Number(await titleStage.getAttribute('data-dent')))
    .toBeGreaterThan(0.01);
  await expect(titleStage).toHaveAttribute('data-pressed-letter', /SM_Row_01_Letter_/);
  await expect(titleStage).toHaveAttribute('data-dent-meshes', '1');
  await page.screenshot({ path: '.local/kivuno-title-local-dent.png' });
  await page.mouse.up();
  await expect.poll(async () => Number(await titleStage.getAttribute('data-dent'))).toBe(0);
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    titleBox.x + titleBox.width / 2 + 110,
    titleBox.y + titleBox.height / 2 + 45,
    { steps: 10 },
  );
  await expect
    .poll(async () =>
      Math.abs(Number((await titleStage.getAttribute('data-rotation'))?.split(',')[1])),
    )
    .toBeGreaterThan(0.15);
  await page.screenshot({ path: '.local/kivuno-title-drag.png' });
  await page.mouse.up();
  await expectTitleReturn(titleStage).toHaveAttribute('data-rotation', '0.0000,0.0000');
  await titleStage.focus();
  await page.keyboard.down('ArrowRight');
  await expect
    .poll(async () => Number((await titleStage.getAttribute('data-rotation'))?.split(',')[1]))
    .toBeGreaterThan(0.05);
  await page.keyboard.up('ArrowRight');
  await expectTitleReturn(titleStage).toHaveAttribute('data-rotation', '0.0000,0.0000');
  await page.keyboard.down('ArrowLeft');
  await expect
    .poll(async () => Number((await titleStage.getAttribute('data-rotation'))?.split(',')[1]))
    .toBeLessThan(-0.05);
  await page.keyboard.press('Home');
  await page.keyboard.up('ArrowLeft');
  await expectTitleReturn(titleStage).toHaveAttribute('data-rotation', '0.0000,0.0000');
  await expect(page.getByRole('button', { name: 'Windows chưa có bản tải' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Linux chưa có bản tải' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /macOS.*(chưa có bản tải|download not available)/i }),
  ).toBeDisabled();
  await expect(page.getByRole('link', { name: /Tải Kivuno/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const dom = await cdp.send('DOM.getDocument');
  const vietnameseHeading = await cdp.send('DOM.querySelector', {
    nodeId: dom.root.nodeId,
    selector: '#demo-plan h3',
  });
  const renderedFonts = await cdp.send('CSS.getPlatformFontsForNode', {
    nodeId: vietnameseHeading.nodeId,
  });
  assert.ok(
    renderedFonts.fonts.some((font) => /Geist/i.test(font.familyName) && font.glyphCount > 0),
    'Vietnamese heading uses real Geist glyphs.',
  );
  assert.ok(
    renderedFonts.fonts.every((font) => /Geist/i.test(font.familyName) || font.glyphCount === 0),
    'Vietnamese diacritics do not fall back to a different font.',
  );
  await cdp.detach();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/kivuno-hero-desktop.png' });
  const menu = page.getByRole('navigation', { name: 'Menu Kivuno' });
  const stories = page.locator('[data-story]');
  await expect(stories).toHaveCount(3);
  assert.deepEqual(
    await stories.evaluateAll((items) => items.map((item) => item.getAttribute('data-story'))),
    ['plan', 'handoff', 'review'],
  );
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByText('UniHack / Aurora', { exact: true })).toHaveCount(0);
  await expect(page.getByText('3 Codex online · Bạn dẫn đội', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xem tất cả tin nhắn' })).toHaveCount(0);
  async function storyProgress(name: string, progress: number) {
    await page.locator('[data-story="' + name + '"]').evaluate((element, value) => {
      const top = element.getBoundingClientRect().top + scrollY;
      scrollTo({
        top:
          top -
          innerHeight * 0.75 +
          (element.getBoundingClientRect().height - innerHeight * 0.15) * value,
        behavior: 'instant',
      });
    }, progress);
  }
  const plan = page.locator('#demo-plan');
  const planMessages = plan.locator('[data-scroll-message]');
  await storyProgress('plan', 0.02);
  await expect(planMessages.first()).toHaveCSS('opacity', '0');
  await storyProgress('plan', 0.4);
  await expect(planMessages.first()).toHaveCSS('opacity', '1');
  await expect(planMessages.nth(3)).toHaveCSS('opacity', '0');
  await page.screenshot({ path: '.local/kivuno-scroll-plan-mid.png' });
  await storyProgress('plan', 0.85);
  await expect(planMessages.last()).toHaveCSS('opacity', '1');
  await storyProgress('plan', 0.2);
  await expect(planMessages.last()).toHaveCSS('opacity', '0');
  await expect(planMessages.first()).toHaveCSS('opacity', '1');
  await expect(menu).toHaveClass(/is-docked/);
  await expect
    .poll(async () => {
      const dock = await menu.boundingBox();
      return Boolean(dock && dock.y < 80 && Math.abs(dock.x + dock.width / 2 - 720) < 4);
    })
    .toBe(true);
  await storyProgress('plan', 0.85);
  await expect(planMessages.last()).toHaveCSS('opacity', '1');
  await plan.getByRole('button', { name: 'Sessions', exact: true }).click();
  await storyProgress('plan', 0.5);
  await expect(page.getByLabel('Graph session minh họa')).toBeVisible();
  await page.getByRole('button', { name: 'Session Tests của Ari' }).click();
  await expect(page.locator('.kp-session-selected')).toContainText('Tests · Ari');
  await plan.getByRole('button', { name: 'Sessions', exact: true }).click();
  await plan.getByRole('button', { name: 'Đã hiểu', exact: true }).first().click();
  await expect(plan.getByRole('button', { name: 'Đã hiểu', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const name of ['handoff', 'review']) {
    await storyProgress(name, 0.85);
    await expect(page.locator('#demo-' + name + ' [data-scroll-message]').last()).toHaveCSS(
      'opacity',
      '1',
    );
    await page.screenshot({ path: '.local/kivuno-scroll-' + name + '.png' });
    await storyProgress(name, 0.05);
    await expect(page.locator('#demo-' + name + ' [data-scroll-message]').last()).toHaveCSS(
      'opacity',
      '0',
    );
  }
  await page.locator('.kp-features').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/kivuno-features-desktop.png' });
  await menu.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Read all messages' })).toHaveCount(0);
  await expect(page.getByText('Scroll to follow', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Divide the work', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Hand off', exact: true })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Refine together. You approve.', exact: true }),
  ).toHaveCount(1);
  await expect(
    plan.getByText('/goal Build a research assistant for UniHack.', { exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .locator('#demo-handoff')
      .getByText('49% usage left. I’ve paused new work.', { exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .locator('#demo-review')
      .getByText('Demo finding: the admin route is missing an authorization check.', {
        exact: true,
      }),
  ).toHaveCount(1);
  await storyProgress('review', 0.8);
  await page.screenshot({ path: '.local/kivuno-scroll-english.png' });
  await menu.getByRole('button', { name: 'Sign up', exact: true }).click();
  const englishAuth = page.getByRole('dialog');
  await expect(englishAuth).toHaveAccessibleName('Create account');
  await englishAuth.getByLabel('Your name').fill('Language check');
  await expect(page.locator('.ka-content')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.local/kivuno-auth-desktop.png' });
  await englishAuth.getByRole('button', { name: 'Chuyển sang Tiếng Việt' }).click();
  await expect(englishAuth.getByLabel('Tên của bạn')).toHaveValue('Language check');
  await englishAuth.getByRole('button', { name: 'Switch to English' }).click();
  await englishAuth.getByRole('button', { name: 'Close sign-in' }).click();
  const themeToggle = menu.getByRole('button', { name: 'Dark appearance' });
  await expect(themeToggle).toHaveAttribute('aria-pressed', 'false');
  await themeToggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await expect(themeToggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect(title).toHaveAttribute('data-title-state', 'ready', { timeout: 20000 });
  await page.screenshot({ path: '.local/kivuno-hero-desktop-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: '.local/kivuno-hero-mobile-dark.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(menu.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page.locator('.ka-overlay')).toBeVisible();
  await page.screenshot({ path: '.local/kivuno-auth-dark.png' });
  await page.keyboard.press('Escape');
  await page.goto(origin + '/art/photo-credits.html');
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A forest of real photographs.');
  await page.goto(origin);
  await page.getByRole('link', { name: 'Kivuno plans', exact: true }).click();
  await expect(page.locator('.kp-route-blinds')).toHaveCount(1);
  await expect(page).toHaveURL(origin + '/billing');
  await expect(page.locator('.kp-route-blinds')).toHaveCount(0);
  await expect(page.locator('.plan-banner')).toHaveCount(3);
  await expect(page.locator('.billing-auth')).toHaveCount(0);
  await expect(page.locator('[data-theme-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await page.goBack();
  await expect(page).toHaveURL(origin);
  await expect(page.locator('.kp-route-blinds')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await menu.getByRole('button', { name: 'Dark appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-portal-theme', 'light');
  await expect(
    page.getByRole('button', { name: 'Windows download not available', exact: true }),
  ).toBeDisabled();
  await menu.getByRole('button', { name: 'Chuyển sang Tiếng Việt' }).click();
  const guide = page.locator('#workflow');
  await guide.scrollIntoViewIfNeeded();
  await expect(guide.getByRole('heading', { name: 'Từ ý tưởng đến cùng làm.' })).toBeVisible();
  await expect(guide.getByRole('tab')).toHaveCount(0);
  const demoMessages = guide.locator('[data-demo-message]');
  await expect(guide.getByRole('button', { name: 'Phát lại mô phỏng' })).toHaveCount(0);
  const demoSend = guide.getByRole('button', { name: 'Gửi tin nhắn mô phỏng' });
  const demoInput = guide.getByRole('textbox', { name: 'Tin nhắn mô phỏng' });
  const demoApiCalls = apiCalls.length;
  await expect(demoSend).toBeDisabled();
  await expect(guide.locator('[data-demo-message="goal-1"]')).toBeVisible({ timeout: 30000 });
  await expect(guide.locator('[data-demo-message="plan-1"]')).toBeVisible({ timeout: 5000 });
  await expect(guide.locator('[data-demo-message="plan-1"]')).toHaveCSS('opacity', '1');
  await guide.getByRole('button', { name: 'Tạm dừng mô phỏng' }).click();
  const pausedCount = await demoMessages.count();
  await page.waitForTimeout(3300);
  await expect(demoMessages).toHaveCount(pausedCount);
  await demoInput.fill('   ');
  await expect(demoSend).toBeDisabled();
  await demoInput.fill('Kiểm tra thêm các trạng thái bàn phím nhé.');
  await page.keyboard.press('Enter');
  await expect(guide.locator('[data-demo-message="local-1"]')).toContainText(
    'Kiểm tra thêm các trạng thái bàn phím nhé.',
  );
  await expect(guide.locator('[data-demo-message="reply-1"]')).toContainText('Sade');
  await expect(demoInput).toHaveValue('');
  await expect(demoInput).toBeFocused();
  await expect(demoSend).toBeDisabled();
  await expect(guide.getByRole('button', { name: 'Tiếp tục mô phỏng' })).toBeVisible();
  await menu.getByRole('button', { name: 'Switch to English' }).click();
  await expect(guide.getByRole('log', { name: 'Demo conversation' })).toBeVisible();
  await expect(guide.locator('[data-demo-message="local-1"]')).toContainText(
    'Kiểm tra thêm các trạng thái bàn phím nhé.',
  );
  await expect(guide.getByRole('button', { name: 'Resume demo' })).toBeVisible();
  await menu.getByRole('button', { name: 'Chuyển sang Tiếng Việt' }).click();
  await expect(demoMessages.last()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.local/kivuno-group-chat-interaction.png' });
  await guide.getByRole('button', { name: 'Tiếp tục mô phỏng' }).click();
  await expect(guide.getByRole('button', { name: 'Tạm dừng mô phỏng' })).toBeVisible();
  assert.equal(apiCalls.length, demoApiCalls, 'The scripted group chat never calls real services.');
  const downloadOpener = menu.getByRole('button', { name: 'Tải app', exact: true });
  await downloadOpener.click();
  const downloads = page.getByRole('dialog', { name: 'Tải Kivuno' });
  await expect(downloads.getByRole('button', { name: 'Windows chưa có bản tải' })).toBeDisabled();
  await expect(
    downloads.getByRole('button', { name: /macOS.*(chưa có bản tải|download not available)/i }),
  ).toBeDisabled();
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
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect(menu).not.toHaveClass(/is-docked/);
  await page.screenshot({ path: '.local/kivuno-hero-mobile.png' });
  for (const selector of [
    '.kp-hero',
    '#demo-plan',
    '#demo-handoff',
    '#demo-review',
    '#workflow',
    '.kp-footer',
  ]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  // Decorative artwork may be SVG or CSS; every actual image still needs to load.
  await expect
    .poll(() =>
      page
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (img) =>
              (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await storyProgress('handoff', 0.75);
  await page.screenshot({ path: '.local/kivuno-scroll-mobile.png' });
  await page.screenshot({ path: '.local/kivuno-portal-mobile.png', fullPage: true });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of ['.kp-hero', '#workflow', '.kp-features', '#updates']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
    await page.screenshot({ path: `.local/kivuno-portal-${width}.png`, fullPage: true });
  }
  for (const viewport of [
    { width: 1366, height: 720 },
    { width: 768, height: 768 },
    { width: 390, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() =>
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    for (const item of await page
      .locator('.kp-footer h2, .kp-footer-cta, .kp-footer-bottom a, .kp-footer-bottom button')
      .all()) {
      await expect(item).toBeVisible();
      await expect
        .poll(async () => {
          const box = await item.boundingBox();
          return (
            !!box &&
            box.y >= -1 &&
            box.y + box.height <= viewport.height + 1 &&
            box.x >= -1 &&
            box.x + box.width <= viewport.width + 1
          );
        })
        .toBe(true);
      await expect
        .poll(
          async () => {
            const box = await item.boundingBox();
            const dock = await menu.boundingBox();
            if (!box || !dock) return false;
            return (
              box.x >= dock.x + dock.width ||
              box.x + box.width <= dock.x ||
              box.y >= dock.y + dock.height ||
              box.y + box.height <= dock.y
            );
          },
          { message: 'Footer content must not be hidden behind the floating dock.' },
        )
        .toBe(true);
    }
    await page.screenshot({
      path: `.local/kivuno-footer-${viewport.width}x${viewport.height}.png`,
    });
  }
  await expect(page.locator('.kp-hivemind-art')).toHaveAttribute(
    'src',
    '/art/kivuno-flower-collage.webp',
  );
  const footerGlass = page.locator('.kp-footer-glass');
  await expect(footerGlass).toHaveAttribute('data-glass-state', 'ready', { timeout: 20000 });
  await expect(footerGlass.locator('[data-footer-glass-canvas]')).toBeVisible();
  await expect(footerGlass).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.kp-footer-bottom')).toContainText('© 2026 Kivuno · NoSleepClub');
  const footerDownload = page.locator('.kp-footer-cta');
  await expect(footerDownload).toContainText('Tải Kivuno');
  await footerDownload.click();
  await expect(page.getByRole('dialog', { name: 'Tải Kivuno' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(footerDownload).toBeFocused();
  await expect(page.locator('.kp-footer a[href="/art/photo-credits.html"]')).toBeVisible();
  const credits = await page.evaluate(async () => {
    const response = await fetch('/art/photo-credits.html');
    return { status: response.status, text: await response.text() };
  });
  assert.equal(credits.status, 200);
  for (const species of [
    'Fritillaria meleagris',
    'Tricyrtis hirta',
    'Passiflora incarnata',
    'Eryngium alpinum',
    'Helleborus foetidus',
  ])
    assert.ok(credits.text.includes(species), `Photo credits include ${species}.`);

  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    hasTouch: true,
  });
  await routePortal(reduced, true);
  const accountPage = await reduced.newPage();
  await accountPage.goto(`${origin}/?activate=${grant.userCode}`);
  await expect(accountPage.locator('html')).toHaveAttribute('data-portal-theme', 'dark');
  await accountPage.emulateMedia({ colorScheme: 'light' });
  await expect(accountPage.locator('html')).toHaveAttribute('data-portal-theme', 'light');
  const dialog = accountPage.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await dialog.getByLabel('Tên của bạn').fill('Ari Test');
  await dialog.getByLabel('Email', { exact: true }).fill(memberEmail.toUpperCase());
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill('short');
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  assert.equal(signupRequests, 0, 'Short passwords must not reach signup.');
  await accountPage.screenshot({ path: '.local/kivuno-auth-mobile-validation.png' });
  await dialog.getByLabel('Mật khẩu', { exact: true }).fill(memberPassword);
  await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await dialog.getByText('Browser test desktop', { exact: true }).waitFor();
  assert.equal(signupRequests, 1);
  assert.equal(approvalRequests, 0, 'Signup must not automatically approve the desktop.');
  assert.equal((await exchange(grant.deviceCode)).statusCode, 202);
  await dialog.getByRole('button', { name: 'Xác nhận kết nối', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Đã kết nối');
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
  await expect(dialog).toHaveAccessibleName('Đã kết nối');
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
  await expect(accountPage.getByRole('link', { name: 'Tải Kivuno cho macOS' })).toHaveAttribute(
    'href',
    '/downloads/Kivuno-macOS-arm64.dmg',
  );
  await accountPage.locator('#workflow').scrollIntoViewIfNeeded();
  await accountPage.getByRole('button', { name: 'Tải app', exact: true }).click();
  const macDownloads = accountPage.getByRole('dialog', { name: 'Tải Kivuno' });
  await expect(macDownloads.getByRole('link', { name: 'Tải Kivuno cho macOS' })).toContainText(
    'macOS Apple Silicon',
  );
  await expect(macDownloads.getByText(/Privacy & Security → Open Anyway/)).toBeVisible();
  await accountPage.keyboard.press('Escape');
  await accountPage.locator('#workflow').scrollIntoViewIfNeeded();
  const reducedDemo = accountPage.locator('#workflow');
  await expect(reducedDemo.locator('[data-demo-message]')).toHaveCount(8);
  await expect(reducedDemo.getByRole('button', { name: 'Tạm dừng mô phỏng' })).toHaveCount(0);
  const demoApprove = reducedDemo.getByRole('button', { name: 'Duyệt bản demo', exact: true });
  const beforeDemoApproval = apiCalls.length;
  await demoApprove.focus();
  await accountPage.keyboard.press('Enter');
  await expect(reducedDemo.locator('[data-demo-message="approved-0"]')).toContainText(
    'Mình đã duyệt bản thay đổi trong mô phỏng.',
  );
  await expect(reducedDemo.getByRole('button', { name: 'Đã duyệt bản demo' })).toBeDisabled();
  assert.equal(apiCalls.length, beforeDemoApproval, 'Demo approval never approves real work.');
  await accountPage.screenshot({ path: '.local/kivuno-group-chat-mobile-approved.png' });
  await expect(reducedDemo.getByRole('button', { name: 'Phát lại mô phỏng' })).toHaveCount(0);
  await expect(reducedDemo.locator('[data-demo-message]')).toHaveCount(9);
  for (const message of await reducedDemo.locator('[data-demo-message]').all())
    await expect(message).toHaveCSS('opacity', '1');
  await accountPage.getByRole('button', { name: 'Kivuno — về màn hình đầu' }).click();
  await expect.poll(() => accountPage.evaluate(() => scrollY)).toBe(0);
  await expect(accountPage.locator('.kp-pixel-curtain')).toHaveCount(0);
  const reducedTitle = accountPage.getByRole('heading', { name: 'Kivuno', exact: true });
  await expect(reducedTitle).toHaveText('Kivuno');
  const reducedStage = accountPage.locator('.kp-puffy-stage');
  await expect(accountPage.locator('.kp-puffy-title')).toHaveAttribute(
    'data-title-state',
    'ready',
    { timeout: 20000 },
  );
  await reducedStage.focus();
  await accountPage.keyboard.down('ArrowRight');
  await expect(reducedStage).toHaveAttribute('data-rotation', '0.0000,0.1500');
  await accountPage.keyboard.up('ArrowRight');
  await expect(reducedStage).toHaveAttribute('data-rotation', '0.0000,0.0000');
  await expect(reducedStage).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  const touch = await reduced.newCDPSession(accountPage);
  const touchBox = await reducedStage.boundingBox();
  assert.ok(touchBox);
  const touchX = touchBox.x + touchBox.width / 2,
    touchY = touchBox.y + touchBox.height * 0.8;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: touchX, y: touchY }],
  });
  for (let step = 1; step <= 5; step++)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: touchX, y: touchY - step * 25 }],
    });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => accountPage.evaluate(() => scrollY)).toBeGreaterThan(20);
  await expect(reducedStage).not.toHaveClass(/is-dragging/);
  await touch.detach();
  await expect(accountPage.locator('.kp-scroll-story.show-all')).toHaveCount(3);
  for (const message of await accountPage.locator('[data-scroll-message]').all())
    await expect(message).toHaveCSS('opacity', '1');
  // Real recovery UI against the same identity service; mail stays in a local fixture inbox.
  await accountPage.goto(`${origin}/?login`);
  const recoveryDialog = accountPage.getByRole('dialog');
  await recoveryDialog.getByRole('button', { name: 'Quên mật khẩu?', exact: true }).click();
  await expect(recoveryDialog).toHaveAccessibleName('Quên mật khẩu?');
  await expect(recoveryDialog.getByLabel('Email', { exact: true })).toBeFocused();
  await recoveryDialog.getByRole('button', { name: 'Quay lại đăng nhập' }).click();
  await expect(
    recoveryDialog.getByRole('button', { name: 'Quên mật khẩu?', exact: true }),
  ).toBeFocused();
  await accountPage.goto(`${origin}/forgot-password`);
  await accountPage.getByLabel('Email', { exact: true }).fill(memberEmail);
  await accountPage.getByRole('button', { name: 'Gửi liên kết khôi phục' }).click();
  await expect(accountPage.getByRole('heading', { name: 'Đã nhận yêu cầu.' })).toBeVisible();
  await expect.poll(() => recoveryInbox.length).toBe(1);
  const resetUrl = recoveryInbox[0].text.match(
    /https:\/\/relay\.example\/reset-password#token=[A-Za-z0-9_-]+/,
  )?.[0];
  assert.ok(resetUrl, 'Recovery email contains the fixed-origin fragment URL.');
  await accountPage.goto(resetUrl);
  await expect(accountPage).toHaveURL(`${origin}/reset-password`);
  const newPassword = randomBytes(24).toString('hex');
  await accountPage.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
  await accountPage.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(`${newPassword}wrong`);
  await accountPage.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(accountPage.getByRole('alert')).toContainText('Hai mật khẩu chưa khớp.');
  await accountPage.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(newPassword);
  await accountPage.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(accountPage.getByRole('heading', { name: 'Đã đổi mật khẩu.' })).toBeVisible();
  await accountPage.screenshot({ path: '.local/kivuno-password-reset-mobile.png' });
  await accountPage.goto(resetUrl);
  await accountPage.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
  await accountPage.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(newPassword);
  await accountPage.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(accountPage.getByRole('alert')).toContainText('Liên kết không hợp lệ');
  await accountPage.goto(`${origin}/?login`);
  const recoveredLogin = accountPage.getByRole('dialog');
  await recoveredLogin.getByLabel('Email', { exact: true }).fill(memberEmail);
  await recoveredLogin.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await recoveredLogin.getByLabel('Mật khẩu', { exact: true }).fill(newPassword);
  await recoveredLogin.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(recoveredLogin.getByText('Ari Test', { exact: true })).toBeVisible();
  // A device without WebGL retains real artwork and usable download/credits controls.
  await page.close();
  await accountPage.close();
  const fallbackPage = await context.newPage();
  await fallbackPage.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext: (type: string, ...args: unknown[]) => unknown;
    };
    const getContext = prototype.getContext;
    prototype.getContext = function (type, ...args) {
      return type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl'
        ? null
        : getContext.call(this, type, ...args);
    };
  });
  await fallbackPage.goto(origin);
  await expect(fallbackPage.locator('.kp-puffy-title')).toHaveAttribute(
    'data-title-state',
    'poster',
  );
  await expect(fallbackPage.locator('.kp-puffy-poster')).toBeVisible();
  await expect(fallbackPage.locator('.kp-puffy-stage')).toHaveAttribute('tabindex', '-1');
  await fallbackPage.locator('.kp-footer').scrollIntoViewIfNeeded();
  await expect(fallbackPage.locator('.kp-footer-glass')).toHaveAttribute(
    'data-glass-state',
    'fallback',
  );
  await expect(fallbackPage.locator('.kp-hivemind-art')).toBeVisible();
  await fallbackPage.locator('.kp-footer-cta').click();
  await expect(fallbackPage.getByRole('dialog', { name: 'Tải Kivuno' })).toBeVisible();
  await fallbackPage.keyboard.press('Escape');
  await fallbackPage.close();
  assert.deepEqual(workspaceCalls, []);
  assert.deepEqual(cspViolations, [], 'The production CSP permits all portal resources.');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      portalOnly: true,
      responsive: true,
      honestReleaseState: true,
      platformDownloads: true,
      macOSUnavailableShown: true,
      interactiveDemos: true,
      noTabbedGuide: true,
      fourBlenderTitleRows: true,
      dragRotationSpringReturn: true,
      localLetterDentAndRecovery: true,
      keyboardRotationAndTouchScrolling: true,
      persistedLightDarkAcrossBilling: true,
      photoCollageWithCredits: true,
      opticalFooterAndWorkingDownload: true,
      usableWebGLFallbacks: true,
      shortViewportFooterReachable: true,
      timedGroupChatContinuousLoopAndPause: true,
      localDemoComposerAndApproval: true,
      separateScrollStories: true,
      reversibleScrollBubbles: true,
      persistedVietnameseEnglish: true,
      localizedAuth: true,
      vietnameseRenderedFonts: renderedFonts.fonts.map((font) => ({
        family: font.familyName,
        glyphs: font.glyphCount,
      })),
      dockAndLogoReturn: true,
      keyboardFocus: true,
      reducedMotion: true,
      realSignupAndLogin: true,
      realPasswordRecoveryAndOneUseLink: true,
      realOwnerLogin: true,
      separateDesktopOwners: true,
      explicitDesktopConsent: true,
      oneUseExchange: true,
      noModelUsage: true,
      pageErrors: 0,
      cspViolations: 0,
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
