import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Wallet, JsonRpcProvider, parseEther, ContractFactory, Signature } from 'ethers';
import tokenArtifact from '../shared/mock-usdc-test-shanghai-artifact.json' with { type: 'json' };
import plansArtifact from '../shared/kivuno-plans-sponsored-test-shanghai-artifact.json' with { type: 'json' };
import {
  AUTHORIZATION_TYPES,
  LEGACY_AUTHORIZATION_TYPES,
  LEGACY_SPONSORED_PROTOCOL,
  purchaseAuthorization,
  authorizationInterface,
  plansInterface,
  contractPurchase,
} from '../shared/sponsored-authorization.ts';
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
  const usdc = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, fund).deploy();
  await usdc.waitForDeployment();
  const token = await usdc.getAddress();
  const treasury = fund.address;
  const plans = await new ContractFactory(plansArtifact.abi, plansArtifact.bytecode, fund).deploy(
    token,
    treasury,
    sponsor.address,
  );
  await plans.waitForDeployment();
  const contract = await plans.getAddress();
  await (await fund.sendTransaction({ to: sponsor.address, value: parseEther('1') })).wait();
  const before = { ...process.env };
  Object.assign(process.env, {
    KIVUNO_BILLING_MODE: 'sponsored-demo',
    KIVUNO_FUJI_RECEIPT_KEY: sponsor.privateKey,
    KIVUNO_FUJI_RPC_URL: 'http://127.0.0.1:' + port,
    KIVUNO_FUJI_USDC_ADDRESS: token,
    KIVUNO_FUJI_TREASURY_ADDRESS: treasury,
    KIVUNO_FUJI_SPONSORED_CONTRACT: contract,
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
    for (const name of [
      'KIVUNO_BILLING_MODE',
      'KIVUNO_FUJI_RECEIPT_KEY',
      'KIVUNO_FUJI_RPC_URL',
      'KIVUNO_FUJI_USDC_ADDRESS',
      'KIVUNO_FUJI_TREASURY_ADDRESS',
      'KIVUNO_FUJI_SPONSORED_CONTRACT',
    ]) {
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
  const sign = async (id: string) => {
    const order = store.get<any>('sponsoredOrder', id);
    const auth = purchaseAuthorization(order);
    return buyer.signTypedData(auth.domain, AUTHORIZATION_TYPES, auth.message);
  };
  const confirm = async (id: string) => post('demo/confirm', { id, signature: await sign(id) });
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
    (await post('demo/confirm', { id: quote.id })).statusCode,
    400,
    'No unsigned purchases',
  );
  const auth = quote.authorization;
  const wrongBuyer = await Wallet.createRandom().signTypedData(
    auth.domain,
    AUTHORIZATION_TYPES,
    auth.message,
  );
  assert.equal(
    (await post('demo/confirm', { id: quote.id, signature: wrongBuyer })).statusCode,
    403,
  );
  for (const changed of [
    { value: '1' },
    { to: buyer.address },
    { nonce: '0x' + '11'.repeat(32) },
  ]) {
    const signature = await buyer.signTypedData(auth.domain, AUTHORIZATION_TYPES, {
      ...auth.message,
      ...changed,
    });
    assert.equal((await post('demo/confirm', { id: quote.id, signature })).statusCode, 403);
  }
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
  const confirms = await Promise.all([confirm(quote.id), confirm(quote.id)]);
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
  assert.equal(tx?.to, contract);
  assert.equal(tx?.from, sponsor.address);
  assert.equal(tx?.value, 0n);
  const decoded = plansInterface.decodeFunctionData('paySponsored', tx!.data);
  assert.equal(decoded.purchase.payer, buyer.address);
  assert.equal(decoded.purchase.planId, 1n);
  assert.equal(
    await plans.getFunction('authorizationNonce')(decoded.purchase.toArray()),
    quote.authorization.message.nonce,
  );
  const chainReceipt = await rpc.getTransactionReceipt(pending.txHash);
  const transfers = chainReceipt!.logs
    .flatMap((log) => {
      try {
        return [authorizationInterface.parseLog(log)];
      } catch {
        return [];
      }
    })
    .filter((e) => e?.name === 'Transfer');
  assert.equal(transfers[0]!.args.from, buyer.address);
  assert.equal(transfers[0]!.args.to, contract);
  assert.equal(transfers[0]!.args.value, 0n);
  assert.equal(transfers[1]!.args.from, contract);
  assert.equal(transfers[1]!.args.to, treasury);
  assert.equal(transfers[1]!.args.value, 0n);
  assert.equal(
    Number((await plans.getFunction('subscriptions')(buyer.address)).paidUntil) * 1000,
    firstUntil,
  );
  assert.equal(await usdc.getFunction('balanceOf')(treasury), 0n);
  assert.equal(await usdc.getFunction('balanceOf')(buyer.address), 0n);
  const signerPlans = plans.connect(sponsor.connect(rpc));
  await assert.rejects(
    signerPlans
      .getFunction('paySponsored')
      .staticCall(decoded.purchase.toArray(), decoded.v, decoded.r, decoded.s),
    'No on-chain replay',
  );
  const renewal = await create();
  await confirm(renewal.id);
  await app.inject({ url: '/api/billing/demo/status?id=' + renewal.id });
  assert.equal(
    store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil,
    firstUntil + 30 * 86400_000,
  );
  const max = await create('max');
  assert.equal(max.simulatedUsdc, 6);
  const maxResult = await confirm(max.id);
  assert.equal(maxResult.statusCode, 200, maxResult.body);
  await app.inject({ url: '/api/billing/demo/status?id=' + max.id });
  assert.equal(effectiveTier(store, 'buyer'), 'max');
  assert.ok(
    store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil <
      firstUntil + 86400_000,
  );
  // A third party cannot consume a receive authorization or relay a purchase.
  const frontRun = await create('max');
  const signature = Signature.from(await sign(frontRun.id));
  const msg = frontRun.authorization.message;
  await assert.rejects(
    usdc
      .getFunction('receiveWithAuthorization')
      .staticCall(
        msg.from,
        msg.to,
        0,
        msg.validAfter,
        msg.validBefore,
        msg.nonce,
        signature.v,
        signature.r,
        signature.s,
      ),
  );
  const purchase = contractPurchase(frontRun);
  await assert.rejects(
    plans.getFunction('paySponsored').staticCall(purchase, signature.v, signature.r, signature.s),
  );
  await assert.rejects(
    signerPlans
      .getFunction('paySponsored')
      .staticCall({ ...purchase, planId: 1 }, signature.v, signature.r, signature.s),
    'Plan bound into signature nonce',
  );
  const externalResult = await confirm(frontRun.id);
  assert.equal(externalResult.statusCode, 200, externalResult.body);
  const externalStatus = await app.inject({ url: '/api/billing/demo/status?id=' + frontRun.id });
  assert.equal(externalStatus.json().status, 'confirmed');
  const expiry = store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil;
  await confirm(frontRun.id);
  assert.equal(store.get<{ paidUntil: number }>('billingEntitlement', 'buyer').paidUntil, expiry);
  // An old unsigned quote cannot create another self-transfer after migration.
  store.put('sponsoredOrder', {
    id: 'b98e2030-4425-4b77-b120-c6670625e45c',
    ownerId: 'buyer',
    wallet: buyer.address,
    plan: 'plus',
    status: 'quoted',
    createdAt: Date.now(),
  });
  assert.equal(
    (await post('demo/confirm', { id: 'b98e2030-4425-4b77-b120-c6670625e45c' })).statusCode,
    409,
  );
  const expired = await create('plus');
  store.put('sponsoredOrder', {
    ...store.get<any>('sponsoredOrder', expired.id),
    createdAt: Date.now() - 901_000,
  });
  assert.equal((await confirm(expired.id)).statusCode, 409);
  const secondBuyer = Wallet.createRandom();
  const legacyUntil = (Math.floor(Date.now() / 1000) + 60 * 86400) * 1000;
  store.put('billingEntitlement', {
    id: 'second',
    ownerId: 'second',
    tier: 'max',
    paidUntil: legacyUntil,
  });
  store.put('billingWallet', { id: 'second', ownerId: 'second', address: secondBuyer.address });
  user = { ...savedUser!, id: 'second' };
  const secondOrder = await create('max');
  assert.notEqual(secondOrder.wallet, quote.wallet, 'Separate accounts keep distinct wallets');
  assert.equal(
    (await confirm(secondOrder.id)).statusCode,
    403,
    'First wallet cannot sign for second account',
  );
  const secondAuth = secondOrder.authorization;
  const secondSignature = await secondBuyer.signTypedData(
    secondAuth.domain,
    AUTHORIZATION_TYPES,
    secondAuth.message,
  );
  assert.equal(
    (await post('demo/confirm', { id: secondOrder.id, signature: secondSignature })).statusCode,
    200,
  );
  await app.inject({ url: '/api/billing/demo/status?id=' + secondOrder.id });
  assert.equal(effectiveTier(store, 'second'), 'max');
  assert.equal(
    store.get<{ paidUntil: number }>('billingEntitlement', 'second').paidUntil,
    legacyUntil + 30 * 86400_000,
    'Existing purchased time is imported once',
  );
  assert.equal(
    Number((await plans.getFunction('subscriptions')(secondBuyer.address)).paidUntil) * 1000,
    legacyUntil + 30 * 86400_000,
  );
  assert.equal(await rpc.getBalance(secondBuyer.address), 0n);
  assert.equal(await rpc.getTransactionCount(secondBuyer.address), 0);
  // A v2 transaction signed before migration can still settle under the v3 server.
  const legacyBuyer = Wallet.createRandom();
  user = { ...savedUser!, id: 'legacy-pending' };
  const legacyOrder = {
    id: '8ee74050-178b-42e0-bf24-a8bb716da68e',
    ownerId: user.id,
    wallet: legacyBuyer.address,
    plan: 'plus' as const,
    createdAt: Date.now(),
    token,
    treasury,
    protocol: LEGACY_SPONSORED_PROTOCOL,
    sponsor: sponsor.address,
  };
  const legacyAuth = purchaseAuthorization(legacyOrder);
  const legacySig = Signature.from(
    await legacyBuyer.signTypedData(
      legacyAuth.domain,
      LEGACY_AUTHORIZATION_TYPES,
      legacyAuth.message,
    ),
  );
  const legacyData = authorizationInterface.encodeFunctionData('transferWithAuthorization', [
    legacyBuyer.address,
    treasury,
    0,
    legacyAuth.message.validAfter,
    legacyAuth.message.validBefore,
    legacyAuth.message.nonce,
    legacySig.v,
    legacySig.r,
    legacySig.s,
  ]);
  const legacyRaw = await sponsor.signTransaction({
    to: token,
    data: legacyData,
    value: 0,
    chainId: 43113,
    nonce: await rpc.getTransactionCount(sponsor.address, 'pending'),
    gasPrice: (await rpc.getFeeData()).gasPrice!,
    gasLimit: 150000,
    type: 0,
  });
  const legacyTx = await rpc.broadcastTransaction(legacyRaw);
  await legacyTx.wait();
  store.put('sponsoredOrder', {
    ...legacyOrder,
    status: 'pending',
    raw: legacyRaw,
    hash: legacyTx.hash,
    commitment: legacyAuth.message.nonce,
  });
  store.put('sponsoredLane', { id: sponsor.address, orderId: legacyOrder.id, until: 0 });
  const legacyStatus = await app.inject({ url: '/api/billing/demo/status?id=' + legacyOrder.id });
  assert.equal(legacyStatus.statusCode, 200, legacyStatus.body);
  assert.equal(legacyStatus.json().status, 'confirmed');
  assert.equal(effectiveTier(store, user.id), 'plus');
  user = savedUser;
  await rpc.send('evm_setAccountBalance', [sponsor.address, '0x0']);
  const unfunded = await create();
  assert.equal(
    (await confirm(unfunded.id)).statusCode,
    503,
    'Sponsor gas failure is not charged to buyer',
  );
  assert.equal(store.get<{ status: string }>('sponsoredOrder', unfunded.id).status, 'quoted');
  assert.equal(effectiveTier(store, 'buyer'), 'max');
});
