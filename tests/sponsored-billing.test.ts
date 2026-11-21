import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Wallet, JsonRpcProvider, parseEther, keccak256, toUtf8Bytes } from 'ethers';
import { Store, DomainError } from '../server/store.ts';
import { registerBillingRoutes, effectiveTier } from '../server/billing.ts';

test('sponsored receipts survive restart, deduplicate confirmations and only grant after mining', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-sponsored-'));
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const server = require('ganache').server({chain:{chainId:43113},logging:{quiet:true}});
    server.listen(0,'127.0.0.1').then(()=>process.send(server.address().port));
    process.on('disconnect',()=>server.close().finally(()=>process.exit()));
  `,
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
  );
  const [port] = await once(child, 'message');
  const rpc = new JsonRpcProvider('http://127.0.0.1:' + port, 43113, { cacheTimeout: -1 });
  const sponsor = Wallet.createRandom();
  const buyer = Wallet.createRandom();
  const [fund] = await rpc.listAccounts();
  await (await fund.sendTransaction({ to: sponsor.address, value: parseEther('1') })).wait();
  const before = { ...process.env };
  Object.assign(process.env, {
    KIVUNO_BILLING_MODE: 'sponsored-demo',
    KIVUNO_FUJI_RECEIPT_KEY: sponsor.privateKey,
    KIVUNO_FUJI_RPC_URL: 'http://127.0.0.1:' + port,
  });
  let store = new Store(path.join(directory, 'test.db'));
  let user: { id: string; name: string; email: string } | null = {
    id: 'buyer',
    name: 'Buyer',
    email: 'buyer@example.test',
  };
  const makeApp = () => {
    const app = Fastify();
    app.setErrorHandler((err, req, reply) =>
      reply
        .code(err instanceof DomainError ? err.status : 400)
        .send({ error: err instanceof Error ? err.message : String(err) }),
    );
    registerBillingRoutes(app, store, async () => user);
    return app;
  };
  let app = makeApp();
  t.after(async () => {
    await app.close();
    store.close();
    rpc.destroy();
    for (const name of ['KIVUNO_BILLING_MODE', 'KIVUNO_FUJI_RECEIPT_KEY', 'KIVUNO_FUJI_RPC_URL']) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    const stopped = once(child, 'exit');
    child.disconnect();
    await stopped;
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const post = (path: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/billing/' + path, payload });
  const create = async (plan = 'plus') => {
    const response = await post('demo/order', { plan });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  assert.equal(
    (await post('demo/order', { plan: 'plus' })).statusCode,
    409,
    'Wallet must already exist',
  );
  store.put('billingWallet', { id: 'buyer', address: buyer.address, ownerId: 'buyer' });
  assert.equal(
    (await post('intent', { plan: 'plus' })).statusCode,
    409,
    'Legacy charge path disabled',
  );
  const quote = await create();
  assert.equal(
    (await post('verify', {})).statusCode,
    409,
    'Legacy settlement cannot overwrite sponsored entitlement',
  );
  assert.equal(quote.actualUsdc, 0);
  assert.equal(quote.simulatedUsdc, 2);
  assert.equal((await create()).id, quote.id, 'Repeated order creation reuses quote');
  assert.equal(
    (await post('demo/confirm', { id: quote.id, to: fund.address })).statusCode,
    400,
    'No caller-controlled destination',
  );
  const savedUser = user;
  user = { ...user!, id: 'other' };
  assert.equal((await post('demo/confirm', { id: quote.id })).statusCode, 404);
  user = null;
  assert.equal((await post('demo/confirm', { id: quote.id })).statusCode, 401);
  user = savedUser;
  await rpc.send('miner_stop', []);
  const confirms = await Promise.all([
    post('demo/confirm', { id: quote.id }),
    post('demo/confirm', { id: quote.id }),
  ]);
  assert.deepEqual(confirms.map((r) => r.statusCode).sort(), [200, 409]);
  const pending = confirms.find((r) => r.statusCode === 200)!.json();
  assert.equal(pending.status, 'pending');
  assert.equal(effectiveTier(store, 'buyer'), 'free', 'No entitlement before chain receipt');
  assert.equal(pending.raw, undefined, 'Signed transaction never leaves backend');
  const raw = store.get<{ raw: string }>('sponsoredOrder', quote.id).raw;
  await app.close();
  store.close();
  store = new Store(path.join(directory, 'test.db'));
  app = makeApp();
  const retry = await post('demo/confirm', { id: quote.id });
  assert.equal(retry.json().txHash, pending.txHash, 'Restart reuses same transaction');
  assert.equal(store.get<{ raw: string }>('sponsoredOrder', quote.id).raw, raw);
  await rpc.send('miner_start', []);
  const status = await app.inject({ url: '/api/billing/demo/status?id=' + quote.id });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().status, 'confirmed');
  assert.equal(effectiveTier(store, 'buyer'), 'plus');
  const firstUntil = store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil;
  await post('demo/confirm', { id: quote.id });
  assert.equal(
    store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil,
    firstUntil,
  );
  assert.equal(await rpc.getTransactionCount(sponsor.address), 1);
  assert.equal(await rpc.getBalance(buyer.address), 0n);
  const tx = await rpc.getTransaction(pending.txHash);
  assert.equal(tx?.to, sponsor.address);
  assert.equal(tx?.from, sponsor.address);
  assert.equal(tx?.value, 0n);
  assert.equal(
    tx?.data,
    keccak256(
      toUtf8Bytes(
        JSON.stringify([
          'kivuno-sponsored-receipt-v1',
          43113,
          quote.id,
          buyer.address,
          'plus',
          0,
          2,
          quote.createdAt,
        ]),
      ),
    ),
  );
  const renewal = await create();
  await post('demo/confirm', { id: renewal.id });
  await app.inject({ url: '/api/billing/demo/status?id=' + renewal.id });
  assert.equal(
    store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil,
    firstUntil + 30 * 86400_000,
  );
  const max = await create('max');
  assert.equal(max.simulatedUsdc, 6);
  await post('demo/confirm', { id: max.id });
  await app.inject({ url: '/api/billing/demo/status?id=' + max.id });
  assert.equal(effectiveTier(store, 'buyer'), 'max');
  assert.ok(
    store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil <
      firstUntil + 86400_000,
  );
  await rpc.send('evm_setAccountBalance', [sponsor.address, '0x0']);
  const unfunded = await create();
  assert.equal(
    (await post('demo/confirm', { id: unfunded.id })).statusCode,
    503,
    'Sponsor gas failure is not charged to buyer',
  );
  assert.equal(store.get<{ status: string }>('sponsoredOrder', unfunded.id).status, 'quoted');
  assert.equal(effectiveTier(store, 'buyer'), 'max');
});
