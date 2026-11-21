// Run: node --import tsx --test --test-force-exit tests/billing-checkout.e2e.ts. All RPC calls go to Ganache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { Contract, ContractFactory, JsonRpcProvider, parseEther, Wallet } from 'ethers';
import { authorizationInterface } from '../shared/sponsored-authorization.ts';
import plans from '../shared/kivuno-plans-artifact.json' with { type: 'json' };
import token from '../shared/mock-usdc-test-shanghai-artifact.json' with { type: 'json' };
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';

test('sponsored checkout provisions the account wallet at signup and grants a real receipt with zero buyer funds', async (t) => {
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
  const sponsor = Wallet.createRandom();
  await (await owner.sendTransaction({ to: sponsor.address, value: parseEther('1') })).wait();
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
    KIVUNO_BILLING_MODE: 'sponsored-demo',
    KIVUNO_FUJI_RECEIPT_KEY: sponsor.privateKey,
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
  assert.equal(store.all('billingWallet').length, 1, 'Wallet bound before checkout opens');
  await page.getByRole('button', { name: 'Tiếp tục thanh toán · Plus', exact: true }).click();

  const account = await page.evaluate(
    async () => (await (await fetch('/api/auth/get-session')).json()).user,
  );
  const binding = store.get<{ id: string; address: string }>('billingWallet', account.id);
  assert.equal(await rpc.getBalance(binding.address), 0n);
  await expect(page.getByRole('heading', { name: 'Thực trả: 0 USDC' })).toBeVisible();
  await expect(page.getByText(/Bạn không cần nạp USDC hoặc AVAX/)).toBeVisible();
  if (process.env.KIVUNO_BILLING_SCREENSHOTS) {
    await mkdir(process.env.KIVUNO_BILLING_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: path.join(process.env.KIVUNO_BILLING_SCREENSHOTS, `checkout-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
        'No horizontal overflow',
      );
    }
  }
  await page.getByText('Ví riêng của tài khoản', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải bản sao lưu mã hóa' }).click();
  const backupPath = await (await downloadPromise).path();
  assert.ok(backupPath);
  const backup = await readFile(backupPath);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('kivuno-fuji-wallets', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('wallets', 'readwrite');
        tx.objectStore('wallets').clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByRole('button', { name: 'Ký mua gói · 0 USDC', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('chưa có khóa ví');
  assert.equal(
    store.all<any>('sponsoredOrder').filter((o) => o.hash).length,
    0,
    'Missing private key cannot submit',
  );
  await page
    .getByLabel('Khôi phục ví từ bản sao lưu')
    .setInputFiles({ name: 'wallet.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('alert')).toContainText('Đã khôi phục ví');
  await page.getByRole('button', { name: 'Ký mua gói · 0 USDC', exact: true }).click();
  const receipt = page.getByRole('heading', { name: 'Đã ghi biên nhận Fuji' });
  await expect
    .poll(
      async () =>
        (await receipt.isVisible()) ||
        (await page.getByRole('button', { name: 'Kiểm tra biên nhận', exact: true }).isVisible()) ||
        (await page.getByRole('alert').count()) > 0,
    )
    .toBe(true);
  assert.equal(
    await page.getByRole('alert').count(),
    0,
    (await page.getByRole('alert').allTextContents()).join(' '),
  );
  if (!(await receipt.isVisible()))
    await page.getByRole('button', { name: 'Kiểm tra biên nhận', exact: true }).click();
  await expect(receipt).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.billing-current strong')).toHaveText('Plus');
  const order = store.all<{ id: string; hash: string; paidUntil: number; commitment: string }>(
    'sponsoredOrder',
  )[0];
  const tx = await rpc.getTransaction(order.hash);
  assert.equal(tx?.from, sponsor.address);
  assert.equal(tx?.to, tokenAddress);
  assert.equal(tx?.value, 0n);
  const decoded = authorizationInterface.decodeFunctionData('transferWithAuthorization', tx!.data);
  assert.equal(decoded.from, binding.address);
  assert.equal(decoded.to, treasury.address);
  assert.equal(decoded.value, 0n);
  assert.equal(decoded.nonce, order.commitment);
  assert.equal(await rpc.getBalance(binding.address), 0n);
  assert.equal(await rpc.getTransactionCount(binding.address), 0);
  assert.equal(await new Contract(tokenAddress, token.abi, owner).balanceOf(treasury.address), 0n);
  assert.equal(writes.length, 0, 'Browser must never broadcast a user transaction');
  await page.reload();
  await page.locator('.plan-banner--plus').click();
  await page.getByRole('button', { name: 'Tiếp tục thanh toán · Plus', exact: true }).click();
  await expect(receipt).toBeVisible();
  assert.equal(
    store.get<{ paidUntil: number }>('billingEntitlement', account.id).paidUntil,
    order.paidUntil,
  );
  assert.deepEqual(browserErrors, []);
});
