// Run: node --import tsx --test --test-force-exit tests/billing-checkout.e2e.ts. All RPC calls go to Ganache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { Contract, ContractFactory, JsonRpcProvider, parseEther } from 'ethers';
import plans from '../shared/kivuno-plans-artifact.json' with { type: 'json' };
import token from '../shared/mock-usdc-test-shanghai-artifact.json' with { type: 'json' };
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';

test('browser buyer creates a wallet, reviews Plus and pays the treasury', async (t) => {
  const origin = 'https://checkout.example.test';
  const data = await mkdtemp(path.join(os.tmpdir(), 'kivuno-buyer-'));
  // A separate Ganache process releases its native LevelDB handles on Windows before cleanup.
  const chain = spawn(
    process.execPath,
    [
      '-e',
      `
    const chain = require('ganache').server({chain:{chainId:43113,hardfork:'shanghai'},
      database:{dbPath:process.argv[1]},logging:{quiet:true}});
    chain.listen(0,'127.0.0.1').then(() => process.send(chain.address().port));
    process.on('disconnect', () => chain.close().finally(() => process.exit()));
  `,
      path.join(data, 'ganache'),
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true },
  );
  const [port] = await once(chain, 'message');
  const url = 'http://127.0.0.1:' + port;
  const rpc = new JsonRpcProvider(url, 43113, { cacheTimeout: -1, pollingInterval: 30 });
  const [owner, treasury] = await rpc.listAccounts();
  const usdc = await new ContractFactory(token.abi, token.bytecode, owner).deploy();
  await usdc.waitForDeployment();
  const tokenAddress = await usdc.getAddress();
  const deployed = await new ContractFactory(plans.abi, plans.bytecode, owner).deploy(
    tokenAddress,
    treasury.address,
  );
  await deployed.waitForDeployment();
  const store = new Store(path.join(data, 'workspace.db'));
  const workspace = new Workspace(store, data, data);
  const gateway = randomBytes(32).toString('hex');
  const auth = await createCloudIdentity({
    directory: data,
    origin,
    secret: randomBytes(32).toString('hex'),
    bootstrapPassword: randomBytes(20).toString('hex'),
  });
  const env = {
    KIVUNO_FUJI_PAYMENT_CONTRACT: await deployed.getAddress(),
    KIVUNO_FUJI_USDC_ADDRESS: tokenAddress,
    KIVUNO_FUJI_TREASURY_ADDRESS: treasury.address,
    KIVUNO_FUJI_RPC_URL: url,
  };
  const before = Object.entries(env).map(([key]) => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  const app = await buildApp(workspace, {
    cloud: { origin, gatewaySecret: gateway, auth },
  }).finally(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  t.after(async () => {
    await browser.close();
    await app.close();
    store.close();
    rpc.destroy();
    const exit = once(chain, 'exit');
    chain.disconnect();
    await exit;
    assert.equal(path.dirname(data), os.tmpdir());
    assert.ok(path.basename(data).startsWith('kivuno-buyer-'));
    await rm(data, { recursive: true, force: true, maxRetries: 5 });
  });
  const { outputFiles } = await build({
    stdin: {
      contents:
        "import React from 'react'; import {createRoot} from 'react-dom/client'; import Billing from './src/Billing'; createRoot(document.getElementById('root')).render(<React.StrictMode><Billing /></React.StrictMode>);",
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    outfile: 'checkout.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const browserErrors: string[] = [];
  context.on('page', (page) => page.on('pageerror', (error) => browserErrors.push(error.message)));
  const writes: string[] = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const endpoint = new URL(req.url());
    if (endpoint.href === 'https://api.avax-test.network/ext/bc/C/rpc') {
      if (req.method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'POST',
          },
        });
      const payload = req.postDataJSON();
      for (const call of Array.isArray(payload) ? payload : [payload]) {
        if (call.method === 'eth_sendRawTransaction') writes.push(call.method);
      }
      const local = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: req.postData(),
      });
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': origin },
        body: await local.text(),
      });
    }
    if (endpoint.origin !== origin) return route.abort();
    if (endpoint.pathname.startsWith('/api/')) {
      const response = await app.inject({
        method: req.method() as 'GET' | 'POST',
        url: endpoint.pathname + endpoint.search,
        headers: { ...(await req.allHeaders()), 'x-relay-gateway': gateway },
        ...(req.postData() ? { payload: req.postData()! } : {}),
      });
      const headers = Object.fromEntries(
        Object.entries(response.headers)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
      );
      return route.fulfill({ status: response.statusCode, headers, body: response.body });
    }
    if (endpoint.pathname === '/billing')
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/checkout.css"><div id="root"></div><script src="/checkout.js"></script>',
      });
    if (endpoint.pathname === '/checkout.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: outputFiles.find((file) => file.path.endsWith('.js'))!.text,
      });
    if (endpoint.pathname === '/checkout.css')
      return route.fulfill({
        contentType: 'text/css',
        body: outputFiles.find((file) => file.path.endsWith('.css'))!.text,
      });
    return route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  await page.goto(origin + '/billing');
  await expect(page.locator('.plan-banner')).toHaveCount(3);
  await expect(page.locator('.billing-auth')).toHaveCount(0);
  await page.getByRole('button', { name: 'Đăng nhập để xem gói của tôi' }).click();
  await expect(page.locator('.billing-auth')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.locator('.plan-banner--plus').hover();
  await expect(page.locator('.plan-banner--plus .plan-banner-bottom')).toHaveCSS('opacity', '1');
  await page.locator('.plan-banner--plus').click();
  await expect(page.getByRole('link', { name: 'Quên mật khẩu?' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
  await page.getByRole('button', { name: /Chưa có tài khoản/ }).click();
  await page.getByLabel('Tên của bạn').fill('Test Buyer');
  await page.getByLabel('Email', { exact: true }).fill('buyer@example.test');
  await page.getByLabel(/^Mật khẩu/).fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Dùng thử 30 ngày · Plus', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.billing-wallet-address')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tiếp tục thanh toán · Plus', exact: true }).click();
  const addressEl = page.locator('.billing-wallet-address code');
  await expect(addressEl)
    .toHaveText(/^0x[\da-f]{40}$/i, { timeout: 15_000 })
    .catch(async (error) => {
      throw new Error(
        error.message + ' ' + (await page.getByRole('alert').allTextContents()).join(' '),
      );
    });
  const buyer = (await addressEl.innerText()).trim();
  const fixtureToken = new Contract(tokenAddress, token.abi, owner);
  await (await fixtureToken.mint(buyer, 2_000_000n)).wait();
  await (await owner.sendTransaction({ to: buyer, value: parseEther('0.4') })).wait();
  await page.getByRole('button', { name: 'Tiếp tục với 2 test USDC' }).click();
  assert.equal(writes.length, 0, 'Review must not broadcast');
  await expect(page.locator('.billing-current strong')).toHaveText('Free');
  await page.getByRole('button', { name: 'Thanh toán 2 test USDC', exact: true }).click();
  await expect(page.locator('.billing-current strong'))
    .toHaveText('Plus', { timeout: 35_000 })
    .catch(async (error) => {
      throw new Error(
        error.message +
          ' ' +
          (await page.getByRole('alert').allTextContents()).join(' ') +
          ' broadcasts=' +
          writes.length,
      );
    });
  assert.equal(writes.length, 1);
  assert.equal(await fixtureToken.balanceOf(treasury.address), 2_000_000n);
  assert.equal(await fixtureToken.balanceOf(buyer), 0n);
  assert.equal(store.all('billingPayment').length, 1);
  await expect(page.locator('.plan-banner--plus .plan-banner-bottom')).toHaveText('Gia hạn Plus');
  await page.locator('.plan-banner--plus').click();
  await expect(page.getByRole('heading', { name: 'Gia hạn Plus' })).toBeVisible();
  assert.equal(writes.length, 1, 'Selecting renewal must not charge');
  const firstExpiry = await page.locator('.billing-current time').getAttribute('datetime');
  assert.ok(firstExpiry);
  await (await fixtureToken.mint(buyer, 2_000_000n)).wait();
  await page.getByRole('button', { name: 'Tiếp tục thanh toán · Plus' }).click();
  await page.getByRole('button', { name: 'Tiếp tục với 2 test USDC' }).click();
  assert.equal(writes.length, 1, 'Reviewing renewal must not charge');
  await page.getByRole('button', { name: 'Thanh toán 2 test USDC', exact: true }).click();
  const renewedExpiry = new Date(Date.parse(firstExpiry) + 30 * 86400_000).toISOString();
  await expect(page.locator('.billing-current time')).toHaveAttribute('datetime', renewedExpiry, {
    timeout: 35_000,
  });
  assert.equal(writes.length, 2);
  assert.equal(store.all('billingPayment').length, 2);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.locator('.billing-auth')).toHaveCount(0);
  await page.locator('.plan-banner--max').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Chưa có tài khoản/ }).click();
  await page.getByLabel('Tên của bạn').fill('Trial Buyer');
  await page.getByLabel('Email', { exact: true }).fill('trial-buyer@example.test');
  await page.getByLabel(/^Mật khẩu/).fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await page.getByRole('button', { name: 'Dùng thử 30 ngày · Max', exact: true }).click();
  await expect(page.locator('.billing-current strong')).toHaveText('Max · Dùng thử');
  await expect(page.locator('.plan-banner--max .plan-banner-bottom')).toHaveText('Mua gói Max');
  await expect(
    page.getByRole('button', { name: 'Dùng thử 30 ngày · Max', exact: true }),
  ).toHaveCount(0);
  assert.equal(store.all('billingTrial').length, 1);
  assert.equal(store.all('billingWallet').length, 1, 'The trial must not create a wallet');
  assert.equal(writes.length, 2, 'The trial must not broadcast or charge');
  const screenshots = path.join(process.cwd(), '.local', 'billing-review');
  await mkdir(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('.plan-banners')
    .screenshot({ path: path.join(screenshots, 'plans-light.png') });
  await page.getByRole('button', { name: 'Giao diện tối', exact: true }).click();
  await page
    .locator('.plan-banners')
    .screenshot({ path: path.join(screenshots, 'plans-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tier of ['free', 'plus', 'max'])
    await expect(page.locator(`.plan-banner--${tier} .plan-banner-bottom`)).toHaveCSS(
      'opacity',
      '1',
    );
  await page
    .locator('.plan-banners')
    .screenshot({ path: path.join(screenshots, 'plans-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.reload();
  await expect(page.locator('.billing-current strong')).toHaveText('Max · Dùng thử');
  assert.deepEqual(browserErrors, []);
});
