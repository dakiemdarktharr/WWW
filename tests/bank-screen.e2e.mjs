import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

if (process.env.KIVUNO_RUN_BANK_SMOKE !== '1') {
  console.log('Set KIVUNO_RUN_BANK_SMOKE=1 to exercise the local bank simulator.');
  process.exit(0);
}

const origin = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const unexpected = [];
  context.on('page', () => unexpected.push('Unexpected new tab or wallet popup'));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (
      /^\/api\/billing\/(?:wallet|intent|confirm)(?:\/|$)/.test(url.pathname) ||
      url.hostname === 'api.avax-test.network'
    )
      unexpected.push(url.pathname);
  });

  await page.goto(origin + '/billing');

  await page.getByRole('button', { name: /Chưa có tài khoản/ }).click();
  await page.getByLabel('Tên của bạn').fill('Bank Demo Buyer');
  await page.getByLabel('Email', { exact: true }).fill(`bank-smoke-${randomUUID()}@example.test`);
  await page.getByLabel(/^Mật khẩu/).fill(randomBytes(24).toString('base64url'));
  const [configResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url() === origin + '/api/billing/bank/config' && r.request().method() === 'GET',
    ),
    page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click(),
  ]);
  assert.equal(configResponse.status(), 200, 'Start npm run dev:fuji-demo before testing.');
  const config = await configResponse.json();
  assert.equal(config.available, true, 'The local bank sandbox must be available.');
  assert.equal(config.mode, 'sandbox');

  const bankResponse = (action) =>
    page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/billing/bank/${action}` &&
        response.request().method() === 'POST',
    );
  const tier = page.locator('.billing-current strong');
  await expect(tier).toHaveText('Free');
  const formattedVnd = (amount) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  const orders = new Set();
  for (const [plan, usdc, vnd] of [
    ['Plus', 2, config.plusVnd],
    ['Max', 6, config.maxVnd],
  ]) {
    const choice = page.getByRole('button', { name: 'Chọn ' + plan, exact: true });
    await expect(choice).toContainText(formattedVnd(vnd));
    const [orderResponse] = await Promise.all([bankResponse('order'), choice.click()]);
    assert.equal(orderResponse.status(), 200);
    const order = await orderResponse.json();
    assert.equal(order.status, 'pending');
    assert.equal(order.amountUsdc, usdc);
    assert.equal(order.amountVnd, vnd);
    assert.equal(orders.has(order.id), false, 'Each plan requires a separate checkout.');
    orders.add(order.id);
    const content = page.locator('main');
    const qr = page.getByRole('img', { name: /QR/i });
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    const decoded = await qr.evaluate(async (image) => {
      if (
        !window.BarcodeDetector ||
        !(await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')
      )
        return null;
      const results = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(image);
      return results.map((result) => result.rawValue);
    });
    if (decoded) assert.deepEqual(decoded, [`${origin}/billing?bank=${order.id}`]);
    for (const detail of [
      order.bankName,
      order.accountNumber,
      order.accountName,
      order.reference,
      formattedVnd(order.amountVnd),
    ]) {
      await expect(content).toContainText(detail);
    }
    await page.getByRole('link', { name: 'Mở ngân hàng mô phỏng' }).click();
    await expect(page).toHaveURL(`${origin}/billing?bank=${order.id}`);
    await expect(page.getByLabel('Tài khoản nhận')).toHaveValue(order.accountNumber);
    await expect(page.getByLabel('Số tiền (VND)')).toHaveValue(String(order.amountVnd));
    await expect(page.getByLabel('Nội dung chuyển khoản')).toHaveValue(order.reference);
    const [paidResponse] = await Promise.all([
      bankResponse('simulate'),
      page.getByRole('button', { name: 'Xác nhận chuyển thử' }).click(),
    ]);
    assert.equal(paidResponse.status(), 200);
    const paid = await paidResponse.json();
    assert.equal(paid.status, 'paid');
    assert.equal(paid.id, order.id);
    assert.equal(paid.plan, plan.toLowerCase());
    await page.getByRole('link', { name: 'Trở về Kivuno' }).click();
    await expect(page.getByRole('heading', { name: 'Đã ghi nhận chuyển khoản thử' })).toBeVisible();
    await expect(tier).toHaveText(plan);

    const [proofResponse] = await Promise.all([
      bankResponse('proof'),
      page.getByRole('button', { name: 'Kiểm chứng biên nhận' }).click(),
    ]);
    assert.equal(proofResponse.status(), 200);
    const proof = await proofResponse.json();
    assert.equal(proof.verified, true);
    assert.equal(proof.network, 'local');
    assert.equal(proof.chainId, 31337);
    assert.match(proof.txHash, /^0x[\da-f]{64}$/i);
    assert.ok(proof.blockNumber > 0);
    await expect(page.getByRole('status').filter({ hasText: proof.txHash })).toContainText(
      'Đã kiểm chứng trên EVM cục bộ',
    );

    await page.reload();
    await expect(tier).toHaveText(plan);
    console.log(
      `${plan} quote, simulated bank credit, persisted entitlement and local receipt verified. QR ${decoded ? 'decoded by Edge' : 'rendered; native decoder unavailable'}.`,
    );
  }
  assert.deepEqual(unexpected, [], 'Bank checkout opened a popup or requested wallet access.');
} finally {
  await browser.close();
}
