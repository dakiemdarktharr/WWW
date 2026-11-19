// Run against the local dev:fuji-demo launcher only. Requires an installed Edge.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

if (process.env.KIVUNO_RUN_FUJI_SMOKE !== '1') {
  console.log('Set KIVUNO_RUN_FUJI_SMOKE=1 to run the local Fuji billing smoke.');
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const timeout = 45_000;
  context.setDefaultTimeout(timeout);
  let writeAttempts = 0;
  await context.route('https://api.avax-test.network/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (calls.some((call) => /^eth_(send|sign)|^personal_/.test(call.method))) {
        writeAttempts++;
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  await page.goto('http://127.0.0.1:5173/billing?demo=fuji');
  await page.getByRole('button', { name: /Chưa có tài khoản/ }).click();
  await page.getByLabel('Tên của bạn').fill('Local Fuji Smoke');
  await page.getByLabel('Email').fill(`fuji-smoke-${randomUUID()}@example.test`);
  await page.getByLabel('Mật khẩu').fill(randomBytes(24).toString('base64url'));
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  const wallet = page.getByRole('region', { name: 'Ví thanh toán Kivuno' });
  const address = wallet.locator('code');
  await expect(address).toHaveText(/^0x[0-9A-Fa-f]{40}$/, { timeout });
  const buyer = await address.textContent();
  assert.notEqual(buyer.toLowerCase(), '0x2b5a65b5c404b48ba775d3a9ea7ee9eaf2bc2805');
  console.log('Signed up and provisioned a buyer wallet separate from the treasury.');
  await page.reload();
  await expect(address).toHaveText(buyer, { timeout });
  await expect(wallet.getByText('Nạp token thử và sao lưu ví')).toBeVisible({ timeout });
  console.log('Reload reopened the same embedded wallet.');

  // Use the real Fuji balances and only exercise the insufficient-funds path.
  await expect(wallet).toContainText(/0(?:\.0)? test USDC · 0 test AVAX/, { timeout });
  const plus = page.getByRole('button', { name: /^Plus\b/ });
  await plus.click();
  await page.getByRole('button', { name: 'Tiếp tục với 2 test USDC' }).click();
  const review = page.getByRole('region', { name: 'Kiểm tra yêu cầu thanh toán' });
  await expect(review).toContainText(buyer, { timeout });
  await expect(review).toContainText('0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805');
  console.log('Plus confirmation showed the buyer, treasury, Fuji network and 2 test USDC.');
  await review.getByRole('button', { name: 'Thanh toán 2 test USDC' }).click();
  await expect(page.getByRole('alert')).toContainText(/Ví cần ít nhất 2 test USDC/, { timeout });
  assert.equal(writeAttempts, 0);
  console.log('Insufficient funds blocked purchase before a transaction was submitted.');
} finally {
  await browser.close();
}
