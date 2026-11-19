import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import {
  bankCheckoutMode,
  bankEntitlement,
  registerBankCheckout,
} from '../server/bank-checkout.ts';
import type { CloudUser } from '../server/cloud-auth.ts';
import { DomainError, Store } from '../server/store.ts';

type View = {
  id: string;
  plan: 'plus' | 'max';
  amountVnd: number;
  amountUsdc: number;
  rateVndPerUsdc: number;
  reference: string;
  accountNumber: string;
  status: string;
  paidUntil?: string;
};

async function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'kivuno-bank-test-'));
  const dir = path.join(root, '.relay-fuji-demo');
  mkdirSync(dir);
  const env = {
    NODE_ENV: 'development',
    RELAY_LOCAL_CLOUD_DEMO: '1',
    RELAY_DEPLOYMENT: 'cloud',
    RELAY_PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
    RELAY_PORT: '4317',
    RELAY_DATA_DIR: dir,
    KIVUNO_BANK_VND_PER_USDC: '26100',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const store = new Store(path.join(dir, 'workspace.db'));
  const app = Fastify();
  app.setErrorHandler((err, _request, reply) => {
    reply
      .code(err instanceof DomainError ? err.status : err instanceof ZodError ? 400 : 500)
      .send({ error: 'Rejected' });
  });
  let actor: CloudUser | null = { id: 'alice', name: 'Demo Buyer', email: 'alice@example.test' };
  registerBankCheckout(app, store, async () => actor);
  await app.ready();
  t.after(async () => {
    await app.close();
    store.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(path.dirname(root), tmpdir());
    assert.ok(path.basename(root).startsWith('kivuno-bank-test-'));
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const post = (suffix: string, body: object) =>
    app.inject({ method: 'POST', url: '/api/billing/bank/' + suffix, payload: body });
  async function order(plan: 'plus' | 'max') {
    const res = await post('order', { plan });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<View>();
  }
  const confirm = (o: View) =>
    post('simulate', {
      id: o.id,
      amountVnd: o.amountVnd,
      reference: o.reference,
      accountNumber: o.accountNumber,
    });
  return {
    app,
    store,
    post,
    order,
    confirm,
    setUser: (user: CloudUser | null) => {
      actor = user;
    },
  };
}

test('local bank quotes are locked, private to the buyer, and only exact simulated credits settle', async (t) => {
  const { store, app, post, order, confirm, setUser } = await setup(t);
  const config = await app.inject('/api/billing/bank/config');
  assert.equal(config.json().plusVnd, 52200);
  const first = await order('plus');
  assert.equal(first.amountUsdc, 2);
  assert.equal(first.amountVnd, 52200);
  assert.equal(first.accountNumber, 'DEMO-KIVUNO');
  process.env.KIVUNO_BANK_VND_PER_USDC = '26999';
  assert.deepEqual(await order('plus'), first);
  const max = await order('max');
  assert.equal(max.amountUsdc, 6);
  assert.equal(max.amountVnd, 161994);
  for (const bad of [
    { amountVnd: 1 },
    { reference: max.reference },
    { accountNumber: '12345678' },
  ]) {
    const res = await post('simulate', {
      id: first.id,
      amountVnd: first.amountVnd,
      reference: first.reference,
      accountNumber: first.accountNumber,
      ...bad,
    });
    assert.equal(res.statusCode, 400);
  }
  assert.equal((await post('status', { id: first.id })).json().status, 'pending');
  assert.equal(store.all('bankSimulatedCredit').length, 0);
  setUser({ id: 'other', name: 'Other Buyer', email: 'other@example.test' });
  assert.equal((await post('status', { id: first.id })).statusCode, 404);
  assert.equal((await confirm(first)).statusCode, 404);
  setUser(null);
  assert.equal((await post('order', { plan: 'plus' })).statusCode, 401);
  assert.equal((await confirm(first)).statusCode, 401);
  assert.equal(store.all('bankFujiCandidate').length, 0);
});

test('credits settle once, same-tier extends, switches restart and verifying an older order cannot overwrite the latest term', async (t) => {
  const { store, post, order, confirm } = await setup(t);
  const plus = await order('plus');
  await Promise.all([confirm(plus), confirm(plus)]);
  const booked = bankEntitlement(store, 'alice')!;
  assert.equal(booked.tier, 'plus');
  assert.equal(booked.paidUntil - booked.latestPaidAt, 30 * 86400_000);
  assert.equal(store.all('bankSimulatedCredit').length, 1);
  const originalAnchor = store.get<{ nonce: string }>('bankFujiCandidate', plus.id);
  assert.match(originalAnchor.nonce, /^0x[0-9a-f]{64}$/);
  assert.equal((await confirm(plus)).json().status, 'paid');
  assert.deepEqual(store.get('bankFujiCandidate', plus.id), originalAnchor);
  const renewal = await order('plus');
  assert.notEqual(renewal.id, plus.id);
  await confirm(renewal);
  assert.equal(bankEntitlement(store, 'alice')?.paidUntil, booked.paidUntil + 30 * 86400_000);
  const max = await order('max');
  await confirm(max);
  const latest = bankEntitlement(store, 'alice')!;
  assert.equal(latest.tier, 'max');
  assert.equal(latest.paidUntil - latest.latestPaidAt, 30 * 86400_000);
  assert.equal((await post('status', { id: plus.id })).json().status, 'paid');
  assert.deepEqual(bankEntitlement(store, 'alice'), latest);
  assert.equal(store.all('bankSimulatedCredit').length, 3);
  assert.equal(store.all('bankFujiCandidate').length, 3);
  assert.equal(store.all('billingPayment').length, 0);
});

test('status recovers committed credits in posting order after a receiver interruption', async (t) => {
  const { store, post, order, confirm } = await setup(t);
  const plus = await order('plus');
  const max = await order('max');
  const original = store.put.bind(store);
  const fail = t.mock.method(store, 'put', (kind: string, data: { id: string }) => {
    if (kind === 'bankFujiCandidate') throw new Error('forced local interruption');
    return original(kind, data);
  });
  assert.equal((await confirm(plus)).statusCode, 500);
  assert.equal((await confirm(max)).statusCode, 500);
  assert.equal(store.all('bankSimulatedCredit').length, 2);
  assert.equal(store.all('bankFujiCandidate').length, 0);
  assert.equal(bankEntitlement(store, 'alice'), undefined);
  fail.mock.restore();
  assert.equal((await post('status', { id: plus.id })).json().status, 'paid');
  assert.equal((await post('status', { id: max.id })).json().status, 'paid');
  assert.equal(bankEntitlement(store, 'alice')?.tier, 'max');
  assert.equal(store.all('bankFujiCandidate').length, 2);
});

test('expired orders reject new transfers and disabled server modes cannot grant or reveal demo access', async (t) => {
  const { app, store, post, order, confirm } = await setup(t);
  const old = await order('plus');
  const record = store.get<{ id: string; expiresAt: number }>('bankOrder', old.id);
  store.put('bankOrder', { ...record, expiresAt: Date.now() - 100 });
  assert.equal((await post('status', { id: old.id })).json().status, 'expired');
  assert.equal((await confirm(old)).statusCode, 409);
  const fresh = await order('plus');
  assert.notEqual(fresh.id, old.id);
  await confirm(fresh);
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production',
    RELAY_DEPLOYMENT: 'local',
    RELAY_PORT: '4444',
    RELAY_LOCAL_CLOUD_DEMO: '0',
    RELAY_PUBLIC_ORIGIN: 'https://kivuno.example',
    RELAY_DATA_DIR: path.resolve(tmpdir(), 'other', '.relay-fuji-demo'),
  })) {
    const prior = process.env[key];
    process.env[key] = value;
    assert.equal(bankCheckoutMode(store), null, key);
    assert.equal(bankEntitlement(store, 'alice'), undefined, key);
    assert.equal((await app.inject('/api/billing/bank/config')).json().available, false, key);
    assert.equal((await post('order', { plan: 'max' })).statusCode, 404, key);
    assert.equal((await confirm(fresh)).statusCode, 404, key);
    process.env[key] = prior;
  }
});
