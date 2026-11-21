import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Wallet } from 'ethers';
import { effectiveTier, registerBillingRoutes } from '../server/billing.ts';
import { Store } from '../server/store.ts';
import { DesktopIdentity } from '../server/desktop-auth.ts';

test('re-authentication preserves selected profiles from retired devices within the plan limit', async (t) => {
  const app = Fastify(),
    store = new Store(':memory:');
  const identity = new DesktopIdentity(store, 'https://example.test');
  const owner = { id: 'returning-owner', name: 'Owner', email: 'owner@example.test' };
  registerBillingRoutes(app, store, async () => owner, identity);
  t.after(async () => {
    identity.close();
    await app.close();
    store.close();
  });
  const signIn = () => {
    const proof = randomBytes(32).toString('base64url');
    const grant = identity.authorize(
      createHash('sha256').update(proof).digest('base64url'),
      'Mac',
      'test',
    );
    identity.approve(grant.userCode, owner);
    return identity.token(grant.deviceCode, proof)!;
  };
  const profiles = ['Atlas', 'Vega', 'Nova', 'Fourth'].map((name) => ({
    name,
    profileId: randomUUID(),
    provider: 'codex',
  }));
  const sync = async (accessToken: string, list = profiles) => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/desktop/profiles',
      headers: { authorization: 'Bearer ' + accessToken },
      payload: { action: 'sync', profiles: list },
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json().lockedIds;
  };
  const old = signIn();
  const retired = { name: 'Retired', profileId: randomUUID(), provider: 'gemini' };
  store.put('billingProfile', {
    id: old.deviceId + ':' + retired.profileId,
    ...retired,
    ownerId: owner.id,
    deviceId: old.deviceId,
    state: 'active',
    selected: true,
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(await sync(old.accessToken, [retired, ...profiles.slice(0, 3)]), [
    retired.profileId,
  ]);
  const visible = (await app.inject({ method: 'GET', url: '/api/billing/profiles' })).json()
    .profiles;
  assert.deepEqual(
    new Set(visible.map((entry: { profileId: string }) => entry.profileId)),
    new Set(profiles.slice(0, 3).map((entry) => entry.profileId)),
  );
  assert.deepEqual(await sync(old.accessToken), [profiles[3].profileId]);
  const other = signIn();
  assert.deepEqual(await sync(other.accessToken, [profiles[2]]), [profiles[2].profileId]);
  identity.revoke(identity.authenticate('Bearer ' + old.accessToken));
  const current = signIn();
  assert.deepEqual(await sync(current.accessToken, profiles.slice().reverse()), [
    profiles[3].profileId,
  ]);
  assert.deepEqual(await sync(current.accessToken), [profiles[3].profileId]);
  const view = (await app.inject({ method: 'GET', url: '/api/billing/profiles' })).json();
  assert.equal(view.profiles.length, 5);
  assert.equal(view.profiles.filter((p: { selected: boolean }) => p.selected).length, 3);
  assert.ok(
    view.profiles.some(
      (p: { deviceId: string; selected: boolean }) => p.deviceId === other.deviceId && !p.selected,
    ),
  );
});

test('wallet unlock is stable per account and rejects other or expired sessions', async (t) => {
  const app = Fastify();
  const store = new Store(':memory:');
  const alice = { id: 'wallet-alice', name: 'Alice', email: 'alice@example.test' };
  const bob = { id: 'wallet-bob', name: 'Bob', email: 'bob@example.test' };
  let session: typeof alice | null = alice;
  registerBillingRoutes(app, store, async () => session);
  t.after(async () => {
    await app.close();
    store.close();
  });

  const unlock = (accountId: string) =>
    app.inject({ method: 'POST', url: '/api/billing/wallet/unlock', payload: { accountId } });
  const first = await unlock(alice.id);
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  const { accountId, wrappingKey } = first.json();
  assert.equal(accountId, alice.id);
  assert.match(wrappingKey, /^0x[0-9a-f]{64}$/i);
  assert.equal((await unlock(alice.id)).json().wrappingKey, wrappingKey);

  session = bob;
  const crossAccount = await unlock(alice.id);
  assert.equal(crossAccount.statusCode, 403);
  assert.equal(crossAccount.json().wrappingKey, undefined);
  const own = await unlock(bob.id);
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().accountId, bob.id);
  assert.notEqual(own.json().wrappingKey, wrappingKey);

  session = null;
  const anonymous = await unlock(alice.id);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().wrappingKey, undefined);
});

test('wallet binding requires ownership, both signatures for a change, and prevents reuse', async (t) => {
  const app = Fastify();
  const store = new Store(':memory:');
  let activeUser = { id: 'billing-alice', name: 'Alice', email: 'alice@example.com' };
  registerBillingRoutes(app, store, async () => activeUser);
  await app.ready();
  t.after(async () => {
    await app.close();
    store.close();
  });

  const request = (body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/billing/wallet/challenge',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
  const bind = (body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/billing/wallet/bind',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });

  const currentWallet = Wallet.createRandom();
  const firstChallenge = await request({ address: currentWallet.address });
  assert.equal(firstChallenge.statusCode, 200);
  const first = firstChallenge.json();
  const firstSignature = await currentWallet.signMessage(first.message);
  const firstBind = await bind({ challengeId: first.challengeId, signature: firstSignature });
  assert.equal(firstBind.statusCode, 200);
  assert.equal(firstBind.json().address, currentWallet.address);
  assert.equal(
    (await bind({ challengeId: first.challengeId, signature: firstSignature })).statusCode,
    409,
  );

  const nextWallet = Wallet.createRandom();
  const changeChallenge = await request({ address: nextWallet.address });
  const change = changeChallenge.json();
  assert.equal(typeof change.currentWalletMessage, 'string');
  const nextSignature = await nextWallet.signMessage(change.message);
  assert.equal(
    (
      await bind({
        challengeId: change.challengeId,
        signature: nextSignature,
      })
    ).statusCode,
    403,
  );
  const currentSignature = await currentWallet.signMessage(change.currentWalletMessage);
  const changed = await bind({
    challengeId: change.challengeId,
    signature: nextSignature,
    currentSignature,
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().address, nextWallet.address);

  activeUser = { id: 'billing-bob', name: 'Bob', email: 'bob@example.com' };
  const claimedChallenge = await request({ address: nextWallet.address });
  const claimed = claimedChallenge.json();
  const claimedSignature = await nextWallet.signMessage(claimed.message);
  assert.equal(
    (await bind({ challengeId: claimed.challengeId, signature: claimedSignature })).statusCode,
    409,
  );
});

test('entitlements resolve to Free immediately at expiry', () => {
  const store = new Store(':memory:');
  try {
    const now = Date.now();
    store.put('billingEntitlement', {
      id: 'billing-owner',
      ownerId: 'billing-owner',
      tier: 'plus',
      paidUntil: now + 1000,
      syncedBlock: 1,
      updatedAt: new Date(now).toISOString(),
    });
    assert.equal(effectiveTier(store, 'billing-owner', now), 'plus');
    assert.equal(effectiveTier(store, 'billing-owner', now + 1000), 'free');
  } finally {
    store.close();
  }
});

test('profile selection lets users choose which profiles remain active within their plan quota', async (t) => {
  const app = Fastify();
  const store = new Store(':memory:');
  const ownerId = 'billing-owner';
  const profiles = Array.from({ length: 5 }, (_, index) => ({
    id: `device:${index}`,
    ownerId,
    deviceId: 'device',
    profileId: `profile-${index}`,
    name: `Provider ${index}`,
    provider: 'codex' as const,
    state: 'active' as const,
    selected: true,
    createdAt: `2025-01-0${index + 1}T00:00:00.000Z`,
    updatedAt: `2025-01-0${index + 1}T00:00:00.000Z`,
  }));
  for (const profile of profiles) store.put('billingProfile', profile);
  registerBillingRoutes(app, store, async () => ({
    id: ownerId,
    name: 'Owner',
    email: 'owner@example.com',
  }));
  await app.ready();
  t.after(async () => {
    await app.close();
    store.close();
  });

  const list = await app.inject({ method: 'GET', url: '/api/billing/profiles' });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(
    list
      .json()
      .profiles.filter((profile: { selected: boolean }) => profile.selected)
      .map((profile: { reservationId: string }) => profile.reservationId),
    ['device:0', 'device:1', 'device:2'],
  );

  const select = (reservationIds: string[]) =>
    app.inject({
      method: 'POST',
      url: '/api/billing/profiles/select',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ reservationIds }),
    });
  const changed = await select(['device:2', 'device:3', 'device:4']);
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(
    changed
      .json()
      .profiles.filter((profile: { selected: boolean }) => profile.selected)
      .map((profile: { reservationId: string }) => profile.reservationId),
    ['device:2', 'device:3', 'device:4'],
  );
  assert.equal((await select(['device:0', 'device:1', 'device:2', 'device:3'])).statusCode, 429);
  assert.equal((await select(['not-owned'])).statusCode, 403);
  assert.equal((await select(['device:2', 'device:2'])).statusCode, 400);
});
