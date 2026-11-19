import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Exercise the actual browser vault independently of funding and blockchain settlement.
const { outputFiles } = await build({
  stdin: {
    contents: `import { walletForAccount, backupWallet, restoreWallet } from './src/embedded-wallet';
      window.vault = {
        address: async (...args) => (await walletForAccount(...args))?.address ?? null,
        backup: backupWallet,
        restore: (account, bound, json) => restoreWallet(account, bound, new File([json], 'backup.json')),
      };`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'browser',
});
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
const wrappingKey = '0x' + randomBytes(32).toString('hex');
const origin = 'https://kivuno-wallet.example';

async function freshContext() {
  const context = await browser.newContext();
  await context.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { token: 'csrf' } });
    if (path === '/api/billing/wallet/unlock') {
      assert.deepEqual(route.request().postDataJSON(), { accountId: 'buyer' });
      return route.fulfill({ json: { accountId: 'buyer', wrappingKey } });
    }
    if (path === '/client.js')
      return route.fulfill({ contentType: 'application/javascript', body: outputFiles[0].text });
    return route.fulfill({ contentType: 'text/html', body: '<script src="/client.js"></script>' });
  });
  return context;
}

try {
  const profiles = await Promise.all([freshContext(), freshContext()]);
  const [first, second, elsewhere] = await Promise.all([
    profiles[0].newPage(),
    profiles[0].newPage(),
    profiles[1].newPage(),
  ]);
  await Promise.all([first, second, elsewhere].map((page) => page.goto(origin)));

  const [address, concurrent] = await Promise.all(
    [first, second].map((page) => page.evaluate(() => window.vault.address('buyer', null, true))),
  );
  assert.match(address, /^0x[0-9a-f]{40}$/i);
  assert.equal(address, concurrent);
  await first.reload();
  assert.equal(
    await first.evaluate((a) => window.vault.address('buyer', a, false), address),
    address,
  );
  assert.equal(
    await elsewhere.evaluate((a) => window.vault.address('buyer', a, true), address),
    null,
  );
  const [download] = await Promise.all([
    first.waitForEvent('download'),
    first.evaluate((a) => window.vault.backup('buyer', a), address),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const json = Buffer.concat(chunks).toString();
  const record = JSON.parse(json);
  assert.deepEqual(Object.keys(record).sort(), [
    'accountId',
    'address',
    'ciphertext',
    'format',
    'iv',
  ]);
  assert.equal(record.ciphertext.length, 98);
  assert.ok(!json.includes(wrappingKey.slice(2)));

  const restore = (page, account, content) =>
    page.evaluate(
      ([id, addr, file]) => window.vault.restore(id, addr, file),
      [account, address, content],
    );
  await assert.rejects(restore(elsewhere, 'other', json), /tài khoản/);
  await restore(elsewhere, 'buyer', json);
  const tampered = { ...record, ciphertext: '0x' + '00'.repeat(48) };
  await assert.rejects(restore(elsewhere, 'buyer', JSON.stringify(tampered)), /giải mã/);
  assert.equal(
    await elsewhere.evaluate((a) => window.vault.address('buyer', a, false), address),
    address,
  );
  console.log('Browser wallet creation, concurrent access, backup and recovery passed.');
} finally {
  await browser.close();
}
