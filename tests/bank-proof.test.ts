import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { registerBankProof } from '../server/bank-proof.ts';
import { DomainError, Store } from '../server/store.ts';

test('bank sandbox anchor verifies a persistent local EVM receipt and recovers the original signed attempt', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kivuno-bank-proof-'));
  const store = new Store(path.join(dir, 'workspace.db'));
  const env = {
    NODE_ENV: 'development',
    RELAY_DEPLOYMENT: 'cloud',
    RELAY_LOCAL_CLOUD_DEMO: '1',
    RELAY_PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
    RELAY_PORT: '4317',
    RELAY_DATA_DIR: dir,
  };
  function server(allow = true) {
    const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env, { NODE_ENV: allow ? 'development' : 'production' });
    try {
      const app = Fastify();
      app.setErrorHandler((e, req, reply) =>
        reply.code(e instanceof DomainError ? e.status : 500).send({ error: (e as Error).message }),
      );
      registerBankProof(app, store, async (request) => {
        const id = request.headers['x-test-user'];
        return typeof id === 'string' ? { id, name: 'Buyer', email: 'buyer@example.test' } : null;
      });
      return app;
    } finally {
      for (const [k, v] of Object.entries(before))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  }
  const first = {
    id: 'order-one',
    ownerId: 'buyer',
    paidAt: Date.now(),
    paidUntil: Date.now() + 2_592_000_000,
    nonce: randomBytes(32).toString('hex'),
    plan: 'plus',
    amountVnd: 54_321,
  };
  store.put('bankFujiCandidate', first);
  let app = server(false);
  const post = (id: string, user = 'buyer', remoteAddress = '127.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/api/billing/bank/proof',
      remoteAddress,
      headers: user ? { 'x-test-user': user } : {},
      payload: { id },
    });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  });
  assert.equal((await post(first.id)).statusCode, 404);
  await app.close();
  app = server();
  assert.equal((await post(first.id, '')).statusCode, 401);
  assert.equal((await post(first.id, 'other')).statusCode, 404);
  assert.equal((await post('unpaid')).statusCode, 404);
  assert.equal((await post(first.id, 'buyer', '192.0.2.4')).statusCode, 403);
  const responses = await Promise.all([post(first.id), post(first.id)]);
  for (const r of responses) assert.equal(r.statusCode, 200, r.body);
  const proof = responses[0].json();
  assert.deepEqual(proof, responses[1].json());
  assert.equal(proof.network, 'local');
  assert.equal(proof.chainId, 31337);
  assert.equal(proof.verified, true);
  assert.match(proof.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(proof.blockNumber, 1);
  assert.deepEqual(Object.keys(proof).sort(), [
    'blockNumber',
    'chainId',
    'commitment',
    'network',
    'txHash',
    'verified',
  ]);
  await app.close();
  app = server();
  const replay = await post(first.id);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), proof);
  store.put('bankFujiCandidate', { ...first, amountVnd: first.amountVnd + 1 });
  assert.equal((await post(first.id)).statusCode, 409);
  const second = { ...first, id: 'lost-ack', nonce: randomBytes(32).toString('hex') };
  store.put('bankFujiCandidate', second);
  const signer = new Wallet(store.get<{ key: string }>('bankLocalIssuer', 'issuer').key);
  const digest = keccak256(
    toUtf8Bytes(
      JSON.stringify([
        'kivuno.bank.simulated-receipt.v1',
        31337,
        second.nonce,
        second.id,
        second.ownerId,
        second.plan,
        second.amountVnd,
        second.paidAt,
        second.paidUntil,
      ]),
    ),
  );
  const signed = await signer.signTransaction({
    type: 0,
    chainId: 31337,
    nonce: 1,
    to: signer.address,
    data: digest,
    value: 0n,
    gasLimit: 25_000n,
    gasPrice: 2_000_000_000n,
  });
  const waiting = {
    id: second.id,
    nonce: 1,
    hash: keccak256(signed),
    commitment: digest,
    verified: false,
  };
  // Process failure after journaling but before broadcast.
  store.put('bankLocalProof', waiting);
  const secondProof = await post(second.id);
  assert.equal(secondProof.statusCode, 200, secondProof.body);
  assert.equal(secondProof.json().txHash, waiting.hash);
  assert.equal(secondProof.json().blockNumber, 2);
  // Process failure after broadcast but before persisting acknowledgement.
  store.put('bankLocalProof', waiting);
  assert.deepEqual((await post(second.id)).json(), secondProof.json());
});
