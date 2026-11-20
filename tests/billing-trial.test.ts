import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { effectiveTier, registerBillingRoutes } from '../server/billing.ts';
import { Store } from '../server/store.ts';
import { SharedGroups } from '../server/collaboration.ts';
import type { SharedGroup } from '../shared/collaboration.ts';
import { Workspace } from '../server/service.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { buildApp } from '../server/app.ts';
import { DesktopIdentity } from '../server/desktop-auth.ts';

const user = { id: 'trial-owner', name: 'Trial owner', email: 'trial@example.test' };
const period = 30 * 86400_000;
type Trial = {
  id: string;
  ownerId: string;
  tier: 'plus' | 'max';
  startedAt: number;
  paidUntil: number;
};

test('trial requires authentication and accepts only a server-defined paid plan', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  let authenticated = false;
  registerBillingRoutes(app, store, async () => (authenticated ? user : null));
  t.after(async () => {
    await app.close();
    store.close();
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'max' } }))
      .statusCode,
    401,
  );
  authenticated = true;
  for (const payload of [
    { plan: 'free' },
    { plan: 'max', paidUntil: Date.now() + period * 10 },
    { plan: 'max', ownerId: 'someone-else' },
  ]) {
    assert.ok(
      (await app.inject({ method: 'POST', url: '/api/billing/trial', payload })).statusCode >= 400,
    );
  }
  assert.deepEqual(store.all('billingTrial'), []);
});

test('concurrent claims grant exactly one 30-day trial without a wallet and cannot switch or extend it', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  registerBillingRoutes(app, store, async () => user);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const before = Date.now();
  const results = await Promise.all(
    ['plus', 'max'].map((plan) =>
      app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan } }),
    ),
  );
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 409]);
  const trial = store.lookup<Trial>('billingTrial', user.id)!;
  assert.equal(trial.paidUntil - trial.startedAt, period);
  assert.ok(trial.startedAt >= before && trial.startedAt <= Date.now());
  assert.equal(effectiveTier(store, user.id), trial.tier);
  assert.deepEqual(store.all('billingWallet'), []);
  const summary = (
    await app.inject({ method: 'GET', url: '/api/billing/summary?rail=bank' })
  ).json();
  assert.deepEqual(summary.trial, {
    eligible: false,
    active: true,
    tier: trial.tier,
    endsAt: new Date(trial.paidUntil).toISOString(),
  });
  assert.equal(summary.profileLimit, trial.tier === 'max' ? null : 10);
  const retry = await app.inject({
    method: 'POST',
    url: '/api/billing/trial',
    payload: { plan: 'max' },
  });
  assert.equal(retry.statusCode, 409);
  assert.deepEqual(store.lookup('billingTrial', user.id), trial);
  assert.equal(results.find((result) => result.statusCode === 201)!.json().automaticRenewal, false);
});

test('trial expires at the exact boundary and remains consumed afterwards', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  registerBillingRoutes(app, store, async () => user);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const end = Date.now() - 1;
  store.put('billingTrial', {
    id: user.id,
    ownerId: user.id,
    tier: 'max',
    startedAt: end - period,
    paidUntil: end,
  });
  assert.equal(effectiveTier(store, user.id, end - 1), 'max');
  assert.equal(effectiveTier(store, user.id, end), 'free');
  const summary = (
    await app.inject({ method: 'GET', url: '/api/billing/summary?rail=bank' })
  ).json();
  assert.equal(summary.tier, 'free');
  assert.equal(summary.profileLimit, 3);
  assert.equal(summary.trial.active, false);
  assert.equal(summary.trial.eligible, false);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'plus' } }))
      .statusCode,
    409,
  );
});

test('paid terms take precedence and an active paid account cannot claim a trial', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  registerBillingRoutes(app, store, async () => user);
  t.after(async () => {
    await app.close();
    store.close();
  });
  const now = Date.now();
  store.put('billingEntitlement', {
    id: user.id,
    ownerId: user.id,
    tier: 'plus',
    paidUntil: now + period,
    syncedBlock: 1,
    updatedAt: new Date(now).toISOString(),
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'max' } }))
      .statusCode,
    409,
  );
  assert.deepEqual(store.all('billingTrial'), []);
  store.put('billingTrial', {
    id: user.id,
    ownerId: user.id,
    tier: 'max',
    startedAt: now,
    paidUntil: now + period * 2,
  });
  assert.equal(effectiveTier(store, user.id, now), 'plus');
  const summary = (
    await app.inject({ method: 'GET', url: '/api/billing/summary?rail=bank' })
  ).json();
  assert.equal(summary.tier, 'plus');
  assert.equal(summary.trial.active, false);
  assert.equal(summary.trial.eligible, false);
});

test('a claim belongs only to its authenticated account', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  let current = user;
  registerBillingRoutes(app, store, async () => current);
  t.after(async () => {
    await app.close();
    store.close();
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'plus' } }))
      .statusCode,
    201,
  );
  current = { ...user, id: 'different-account', email: 'other@example.test' };
  assert.equal(effectiveTier(store, current.id), 'free');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/billing/summary?rail=bank' })).json().trial
      .eligible,
    true,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'max' } }))
      .statusCode,
    201,
  );
  assert.equal(effectiveTier(store, current.id), 'max');
  assert.equal(effectiveTier(store, user.id), 'plus');
});

test('trial limits govern real group seats and provider selection, including expiry', async (t) => {
  const store = new Store(':memory:');
  const app = Fastify();
  const identity = new DesktopIdentity(store, 'https://trial.example');
  registerBillingRoutes(app, store, async () => user, identity);
  t.after(async () => {
    identity.close();
    await app.close();
    store.close();
  });
  const people = Array.from({ length: 10 }, (_, index) => ({
    id: `trial-person-${index}`,
    name: `Person ${index}`,
  }));
  const groups = new SharedGroups(
    store,
    (account) => people.find((person) => person.id === account) || null,
  );
  const group = groups.execute(user, {
    action: 'create',
    id: randomUUID(),
    name: 'Trial team',
  }) as SharedGroup;
  await app.inject({ method: 'POST', url: '/api/billing/trial', payload: { plan: 'plus' } });
  for (const person of people.slice(0, 9))
    groups.execute(user, { action: 'invite', groupId: group.id, account: person.id });
  assert.throws(
    () => groups.execute(user, { action: 'invite', groupId: group.id, account: people[9].id }),
    /10 active group seats/,
  );
  const verifier = randomBytes(32).toString('base64url');
  const grant = identity.authorize(
    createHash('sha256').update(verifier).digest('base64url'),
    'Trial desktop',
    'test',
  );
  identity.approve(grant.userCode, user);
  const token = identity.token(grant.deviceCode, verifier)!;
  const profiles = Array.from({ length: 5 }, (_, index) => ({
    profileId: randomUUID(),
    name: `Profile ${index}`,
    provider: 'codex',
  }));
  const sync = () =>
    app.inject({
      method: 'POST',
      url: '/api/desktop/profiles',
      headers: { authorization: `Bearer ${token.accessToken}` },
      payload: { action: 'sync', profiles },
    });
  const accepted = await sync();
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json().lockedIds, []);
  const active = (await app.inject({ method: 'GET', url: '/api/billing/profiles' })).json();
  assert.equal(active.limit, 10);
  assert.equal(
    active.profiles.filter((profile: { selected: boolean }) => profile.selected).length,
    5,
  );
  const trial = store.lookup<Trial>('billingTrial', user.id)!;
  store.put('billingTrial', { ...trial, paidUntil: Date.now() - 1 });
  const locked = await sync();
  assert.equal(locked.statusCode, 200, locked.body);
  assert.equal(locked.json().lockedIds.length, 2);
  const expired = (await app.inject({ method: 'GET', url: '/api/billing/profiles' })).json();
  assert.equal(expired.limit, 3);
  assert.equal(
    expired.profiles.filter((profile: { selected: boolean }) => profile.selected).length,
    3,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/billing/profiles/select',
        payload: {
          reservationIds: active.profiles
            .slice(0, 4)
            .map((profile: { reservationId: string }) => profile.reservationId),
        },
      })
    ).statusCode,
    429,
  );
  const listing = groups.execute(user, { action: 'list' }) as { groups: SharedGroup[] };
  assert.equal(listing.groups[0].seatLimit, 3);
  assert.equal(listing.groups[0].people.length, 10);
  assert.equal(listing.groups[0].people.filter((person) => !person.quotaLocked).length, 1);
});

test('public account trial passes the cloud gateway only with same-origin session and CSRF token', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-trial-gateway-'));
  const store = new Store(path.join(directory, 'workspace.db'));
  const workspace = new Workspace(store, directory, directory);
  const origin = 'https://trial.example';
  const gatewaySecret = randomBytes(32).toString('hex');
  const auth = await createCloudIdentity({
    directory,
    origin,
    secret: randomBytes(32).toString('hex'),
    bootstrapPassword: randomBytes(24).toString('hex'),
  });
  const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth } });
  t.after(async () => {
    await app.close();
    store.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    await rm(directory, { recursive: true, force: true });
  });
  const cookies = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value : [value || ''])
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
  const headers = {
    origin,
    host: 'private-worker.vercel.run',
    'x-relay-gateway': gatewaySecret,
    'content-type': 'application/json',
  };
  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers,
    payload: {
      name: 'Trial public',
      email: 'trial-public@example.test',
      password: randomBytes(24).toString('hex'),
    },
  });
  assert.equal(signup.statusCode, 200, signup.body);
  const accountCookie = cookies(signup.headers['set-cookie']);
  const session = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { ...headers, cookie: accountCookie },
  });
  assert.equal(session.statusCode, 200, session.body);
  const secure = {
    ...headers,
    cookie: `${accountCookie}; ${cookies(session.headers['set-cookie'])}`,
    'x-relay-token': session.json().token,
  };
  const claim = (extra = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/billing/trial',
      headers: { ...secure, ...extra },
      payload: { plan: 'max' },
    });
  assert.equal((await claim({ origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await claim({ origin: '' })).statusCode, 403);
  assert.equal((await claim({ 'x-relay-token': '' })).statusCode, 403);
  assert.equal((await claim({ cookie: '' })).statusCode, 401);
  assert.equal((await claim({ 'x-relay-gateway': '' })).statusCode, 403);
  assert.deepEqual(store.all('billingTrial'), []);
  const success = await claim();
  assert.equal(success.statusCode, 201, success.body);
  assert.equal(success.json().tier, 'max');
  assert.equal(store.all<Trial>('billingTrial')[0].ownerId, signup.json().user.id);
});
