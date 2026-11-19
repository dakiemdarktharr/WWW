// Run: node --import tsx tests/bank-wallet.e2e.ts. Uses only an in-memory billing service.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import Fastify from 'fastify';
import { registerBillingRoutes } from '../server/billing.ts';
import { Store, DomainError } from '../server/store.ts';

const root = process.cwd();
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import '@fontsource-variable/geist'; import './src/styles.css'; import Billing from './src/Billing'; createRoot(document.getElementById('root')).render(<React.StrictMode><Billing rail="bank" /></React.StrictMode>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  outdir: '.local/wallet-ui-bundle',
  loader: { '.woff2': 'dataurl' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
const user = {
  id: 'wallet-visual-buyer',
  name: 'Studio North',
  email: 'wallet-visual@example.test',
};
const app = Fastify();
const store = new Store(':memory:');
app.setErrorHandler((error, _request, reply) =>
  reply
    .code(error instanceof DomainError ? error.status : 500)
    .send({ error: error instanceof Error ? error.message : 'Unknown fixture error' }),
);
registerBillingRoutes(app, store, async () => user);
await app.ready();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const origin = 'https://bank-wallet.example.test';
const external: string[] = [];
const forbidden: string[] = [];
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
    acceptDownloads: true,
  });
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== origin) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === '/ui.js')
      return route.fulfill({ contentType: 'text/javascript', body: js });
    if (url.pathname === '/ui.css') return route.fulfill({ contentType: 'text/css', body: css });
    if (url.pathname === '/kivuno.svg')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: await readFile('public/kivuno.svg', 'utf8'),
      });
    if (url.pathname === '/billing')
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script>',
      });
    if (url.pathname === '/api/auth/get-session') return json({ user });
    if (url.pathname === '/api/session') return json({ token: 'local-fixture' });
    if (url.pathname === '/api/billing/bank/config')
      return json({ available: true, mode: 'sandbox', plusVnd: 52200, maxVnd: 156600 });
    if (url.pathname === '/api/billing/intent' || url.pathname === '/api/billing/confirm') {
      forbidden.push(url.pathname);
      return route.abort();
    }
    if (url.pathname.startsWith('/api/billing/')) {
      const response = await app.inject({
        method: req.method() as 'GET' | 'POST',
        url: url.pathname + url.search,
        headers: await req.allHeaders(),
        ...(req.postData() ? { payload: req.postData()! } : {}),
      });
      return route.fulfill({
        status: response.statusCode,
        contentType: 'application/json',
        body: response.body,
      });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/billing');
  const details = page.locator('details.billing-wallet-box');
  const summary = details.locator('summary');
  const address = details.locator('.billing-wallet-address');
  await expect(address).toHaveText(/^0x[0-9a-f]{40}$/i);
  const buyer = (await address.textContent())!;
  await expect(details).not.toHaveAttribute('open');
  await expect(address).not.toBeVisible();
  await summary.click();
  await expect(address).toBeVisible();
  const backup = details.getByRole('button', { name: 'Tải bản sao lưu mã hóa' });
  await expect(backup).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), backup.click()]);
  const sealed = JSON.parse(await readFile((await download.path())!, 'utf8'));
  assert.equal(sealed.format, 'kivuno-fuji-wallet-v1');
  assert.equal(sealed.accountId, user.id);
  assert.equal(sealed.address, buyer);
  assert.match(sealed.ciphertext, /^0x[0-9a-f]{96}$/i);
  assert.match(sealed.iv, /^0x[0-9a-f]{24}$/i);
  assert.deepEqual(Object.keys(sealed).sort(), [
    'accountId',
    'address',
    'ciphertext',
    'format',
    'iv',
  ]);
  assert.equal(await details.locator('button').count(), 1);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open');
  await page.reload();
  await expect(address).toHaveText(buyer);
  await summary.click();
  await expect(backup).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Chọn Plus' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Chọn Max' })).toBeEnabled();
  // A second device has the account binding but no local ciphertext.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('kivuno-fuji-wallets');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Wallet database remained open.'));
      }),
  );
  await page.reload();
  await expect(address).toHaveText(buyer);
  await summary.click();
  const restore = details.getByLabel('Khôi phục ví');
  await expect(restore).toBeVisible();
  await expect(backup).toHaveCount(0);
  const bindingBefore = JSON.stringify(store.all('billingWallet'));
  await restore.setInputFiles({
    name: 'wrong-account.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...sealed, accountId: 'another-account' })),
  });
  await expect(details.getByRole('alert')).toContainText('thuộc tài khoản Kivuno khác');
  assert.equal(JSON.stringify(store.all('billingWallet')), bindingBefore);
  const corrupt = { ...sealed, ciphertext: '0x' + '0'.repeat(96) };
  await restore.setInputFiles({
    name: 'corrupted-wallet.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(corrupt)),
  });
  await expect(details.getByRole('alert')).toContainText('Không giải mã được');
  assert.equal(JSON.stringify(store.all('billingWallet')), bindingBefore);
  await restore.setInputFiles({
    name: 'wallet-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sealed)),
  });
  await expect(backup).toBeEnabled();
  await expect(details.getByRole('alert')).toHaveCount(0);
  await expect(address).toHaveText(buyer);
  assert.equal(
    JSON.stringify(store.all('billingWallet')),
    bindingBefore,
    'Restore must not rebind or create a different wallet',
  );
  const [restoredDownload] = await Promise.all([page.waitForEvent('download'), backup.click()]);
  const restoredSealed = JSON.parse(await readFile((await restoredDownload.path())!, 'utf8'));
  assert.deepEqual(restoredSealed, sealed);

  await mkdir('.local/prism-qa', { recursive: true });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Giao diện tối' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-portal-theme', theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'No overflow ' + theme + width,
      );
      await page.screenshot({
        path: '.local/prism-qa/bank-wallet-' + theme + '-' + width + '.png',
        fullPage: true,
      });
    }
  }
  assert.deepEqual(external, [], 'QR account wallet must not contact RPC');
  assert.deepEqual(forbidden, [], 'No buyer payment should be prepared or submitted');
  assert.deepEqual(errors, [], 'No page errors');
  console.log(
    'PASS: actual account wallet creation/signature binding, collapsed details, keyboard expand/collapse, encrypted backup download, reload same wallet, missing-device restore, wrong-account and corrupted ciphertext rejection, unchanged binding, QR choices, light/dark320/390/1440, zero externalRPC/payment requests/page errors.',
  );
  console.log(
    'Backup control height:',
    await backup.evaluate((el) => el.getBoundingClientRect().height),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
}
