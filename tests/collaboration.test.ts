import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { SharedGroups } from '../server/collaboration.ts';
import { Workspace } from '../server/service.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { buildApp } from '../server/app.ts';
import type { SharedGroup } from '../shared/collaboration.ts';

const tempRoot = path.resolve(os.tmpdir());

test('groups isolate accounts, require invitation acceptance and protect teammate ownership and message retries', async (t) => {
  const dir = await mkdtemp(path.join(tempRoot, 'kivuno-groups-'));
  const store = new Store(path.join(dir, 'groups.db'));
  t.after(async () => {
    store.close();
    assert.equal(path.dirname(dir), tempRoot);
    await rm(dir, { recursive: true, force: true });
  });
  const alice = { id: 'alice', name: 'Alice' },
    bob = { id: 'bob', name: 'Bob' },
    stranger = { id: 'eve', name: 'Eve' };
  const groups = new SharedGroups(
    store,
    (id) => [alice, bob, stranger].find((user) => user.id === id) || null,
  );
  const group = groups.execute(alice, {
    action: 'create',
    id: randomUUID(),
    name: 'Project chat',
  }) as SharedGroup;
  const call = (who: typeof alice, action: string, extra = {}) =>
    groups.execute(who, { action, groupId: group.id, ...extra }) as any;
  assert.throws(() => call(bob, 'read'), /unavailable/);
  call(alice, 'invite', { account: bob.id });
  assert.throws(() => call(bob, 'read'), /Accept/);
  assert.deepEqual((groups.execute(bob, { action: 'list' }) as any).groups, []);
  call(bob, 'accept');
  const member = { localId: randomUUID(), name: 'Alice Codex', provider: 'codex' };
  call(alice, 'teammates', { teammates: [member] });
  const other = { localId: member.localId, name: 'Bob Gemini', provider: 'gemini' };
  call(bob, 'teammates', { teammates: [other] });
  const roster = call(bob, 'read').group.teammates;
  assert.equal(roster.length, 2, 'same local UUID is namespaced by Kivuno owner');
  assert.deepEqual(
    roster.map((member: any) => member.ownerId),
    ['alice', 'bob'],
  );
  assert.throws(() => call(bob, 'teammates', { teammates: [{ ...other, ownerId: 'alice' }] }));
  assert.throws(() => call(bob, 'remove', { userId: 'alice' }));
  assert.throws(() => call(bob, 'invite', { account: 'eve' }));
  const message = { id: randomUUID(), content: 'Shared message' };
  const sent = call(alice, 'message', message);
  assert.deepEqual(call(alice, 'message', message), sent);
  assert.throws(() => call(bob, 'message', message), /already used/);
  for (let i = 0; i < 105; i++) call(bob, 'message', { id: randomUUID(), content: `Reply ${i}` });
  assert.equal(call(alice, 'read').messages.length, 100);
  assert.equal(call(alice, 'read').hasMore, true);
  const fullLastPage = call(alice, 'read', { after: 6 });
  assert.equal(fullLastPage.messages.length, 100);
  assert.equal(fullLastPage.hasMore, false);
  assert.equal(call(alice, 'read', { after: 100 }).messages.length, 6);
  assert.throws(() => call(stranger, 'read'));
  call(alice, 'remove', { userId: bob.id });
  assert.throws(() => call(bob, 'read'));
  assert.equal(call(alice, 'read').group.teammates.length, 1);
  call(alice, 'invite', { account: 'eve' });
  assert.deepEqual(call(stranger, 'decline'), { declined: true });
});

test('free group seats include the owner, reserve invitations, and let locked people leave', async (t) => {
  const dir = await mkdtemp(path.join(tempRoot, 'kivuno-group-seats-'));
  const store = new Store(path.join(dir, 'groups.db'));
  t.after(async () => {
    store.close();
    assert.equal(path.dirname(dir), tempRoot);
    await rm(dir, { recursive: true, force: true });
  });
  const owner = { id: 'seat-owner', name: 'Owner' };
  const bob = { id: 'seat-bob', name: 'Bob' };
  const charlie = { id: 'seat-charlie', name: 'Charlie' };
  const dave = { id: 'seat-dave', name: 'Dave' };
  const accounts = [owner, bob, charlie, dave];
  const groups = new SharedGroups(
    store,
    (account) => accounts.find((user) => user.id === account) || null,
  );
  const group = groups.execute(owner, {
    action: 'create',
    id: randomUUID(),
    name: 'Seat-limited group',
  }) as SharedGroup;
  const call = (who: typeof owner, action: string, extra = {}) =>
    groups.execute(who, { action, groupId: group.id, ...extra }) as any;

  call(owner, 'invite', { account: bob.id });
  call(owner, 'invite', { account: charlie.id });
  assert.throws(() => call(owner, 'invite', { account: dave.id }), /3 active group seats/);

  const selected = call(owner, 'seats', { userIds: [owner.id, bob.id] }) as SharedGroup;
  assert.equal(selected.people.find((person) => person.id === charlie.id)?.quotaLocked, true);
  const charlieListing = groups.execute(charlie, { action: 'list' }) as any;
  assert.deepEqual(charlieListing.lockedGroups, [{ id: group.id, name: group.name }]);
  assert.throws(() => call(charlie, 'accept'), /seat is locked/);
  assert.throws(() => call(charlie, 'read'), /seat is locked/);
  assert.equal(
    (call(owner, 'read').group as SharedGroup).people.some((person) => person.id === charlie.id),
    true,
  );

  call(owner, 'remove', { userId: charlie.id });
  call(owner, 'invite', { account: charlie.id });
  assert.throws(() => call(owner, 'invite', { account: dave.id }), /3 active group seats/);
  call(owner, 'seats', { userIds: [owner.id] });
  assert.equal((groups.execute(bob, { action: 'list' }) as any).lockedGroups.length, 1);
  assert.equal(call(bob, 'leave').id, group.id);
  call(owner, 'invite', { account: dave.id });

  assert.throws(
    () => call(owner, 'seats', { userIds: [bob.id] }),
    /owner must have an active seat/,
  );
  assert.throws(
    () => call(owner, 'seats', { userIds: [owner.id, 'missing'] }),
    /only people already in this group/,
  );
});

test('Plus and Max group seats follow the owner tier and preserve people after a downgrade', async (t) => {
  const dir = await mkdtemp(path.join(tempRoot, 'kivuno-group-plan-seats-'));
  const store = new Store(path.join(dir, 'groups.db'));
  t.after(async () => {
    store.close();
    assert.equal(path.dirname(dir), tempRoot);
    await rm(dir, { recursive: true, force: true });
  });
  const owner = { id: 'plan-owner', name: 'Plan owner' };
  const invitees = Array.from({ length: 39 }, (_, index) => ({
    id: `plan-member-${index}`,
    name: `Member ${index}`,
  }));
  const accounts = [owner, ...invitees];
  const groups = new SharedGroups(
    store,
    (account) => accounts.find((user) => user.id === account) || null,
  );
  const paidUntil = Date.now() + 30 * 86400000;
  const entitlement = (tier: 'plus' | 'max') =>
    store.put('billingEntitlement', {
      id: owner.id,
      ownerId: owner.id,
      tier,
      paidUntil,
      syncedBlock: 100,
      updatedAt: new Date().toISOString(),
    });
  const group = groups.execute(owner, {
    action: 'create',
    id: randomUUID(),
    name: 'Plan group',
  }) as SharedGroup;
  const call = (who: typeof owner, action: string, extra = {}) =>
    groups.execute(who, { action, groupId: group.id, ...extra }) as any;

  entitlement('plus');
  for (const member of invitees.slice(0, 9)) call(owner, 'invite', { account: member.id });
  assert.throws(() => call(owner, 'invite', { account: invitees[9].id }), /10 active group seats/);

  entitlement('max');
  for (const member of invitees.slice(9)) call(owner, 'invite', { account: member.id });
  const maxSeats = call(owner, 'seats', { userIds: [owner.id] }) as SharedGroup;
  assert.equal(maxSeats.people.length, 40);
  assert.equal(
    maxSeats.people.every((person) => !person.quotaLocked),
    true,
  );
  call(invitees[0], 'accept');
  call(owner, 'message', { id: randomUUID(), content: 'Keep this history' });

  store.remove('billingEntitlement', owner.id);
  const listing = groups.execute(owner, { action: 'list' }) as any;
  const downgraded = listing.groups.find(
    (item: SharedGroup) => item.id === group.id,
  ) as SharedGroup;
  assert.equal(downgraded.seatLimit, 3);
  assert.equal(downgraded.people.length, 40);
  assert.equal(downgraded.people.find((person) => person.id === owner.id)?.quotaLocked, false);
  assert.equal(
    downgraded.people
      .filter((person) => person.id !== owner.id)
      .every((person) => person.quotaLocked),
    true,
  );
  assert.equal(call(owner, 'read').messages[0].content, 'Keep this history');

  const lockedListing = groups.execute(invitees[0], { action: 'list' }) as any;
  assert.deepEqual(lockedListing.groups, []);
  assert.deepEqual(lockedListing.lockedGroups, [{ id: group.id, name: group.name }]);
  assert.throws(() => call(invitees[0], 'read'), /seat is locked/);
  assert.throws(
    () => call(invitees[0], 'message', { id: randomUUID(), content: 'Blocked' }),
    /seat is locked/,
  );
  call(owner, 'remove', { userId: invitees[1].id });
  assert.equal(call(invitees[0], 'leave').id, group.id);

  const selected = call(owner, 'seats', {
    userIds: [owner.id, invitees[2].id, invitees[3].id],
  }) as SharedGroup;
  assert.equal(selected.people.filter((person) => !person.quotaLocked).length, 3);
  assert.throws(
    () =>
      call(owner, 'seats', {
        userIds: [owner.id, ...invitees.slice(2, 5).map((person) => person.id)],
      }),
    /up to 3 active group seats/,
  );
});

test('real account login and PKCE tokens authenticate group API; cookies and revoked tokens cannot bypass it', async (t) => {
  const dir = await mkdtemp(path.join(tempRoot, 'kivuno-groups-auth-'));
  const store = new Store(path.join(dir, 'workspace.db'));
  const workspace = new Workspace(store, dir, dir);
  const origin = 'https://kivuno.test',
    gatewaySecret = randomBytes(32).toString('hex');
  const auth = await createCloudIdentity({
    directory: dir,
    origin,
    secret: randomBytes(32).toString('hex'),
    bootstrapPassword: randomBytes(24).toString('hex'),
  });
  const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth } });
  t.after(async () => {
    await app.close();
    store.close();
    assert.equal(path.dirname(dir), tempRoot);
    await rm(dir, { recursive: true, force: true });
  });
  const request = (url: string, payload: unknown, headers = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin, 'x-relay-gateway': gatewaySecret, ...headers },
      payload: payload as any,
    });
  const account = async (name: string) => {
    const signup = await request('/api/auth/sign-up/email', {
      name,
      email: `${name}@example.test`,
      password: randomBytes(24).toString('hex'),
    });
    assert.equal(signup.statusCode, 200, signup.body);
    const cookie = (signup.headers['set-cookie'] as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { origin, 'x-relay-gateway': gatewaySecret, cookie },
    });
    const browser = {
      cookie: cookie + '; ' + String(session.headers['set-cookie']).split(';')[0],
      'x-relay-token': session.json().token,
    };
    const verifier = randomBytes(32).toString('base64url');
    const grant = await request('/api/desktop/authorize', {
      name,
      challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const approval = await request(
      '/api/desktop/approve',
      { userCode: grant.json().userCode },
      browser,
    );
    assert.equal(approval.statusCode, 200, approval.body);
    const token = await request('/api/desktop/token', {
      verifier,
      deviceCode: grant.json().deviceCode,
    });
    assert.equal(token.statusCode, 200, token.body);
    return { bearer: { authorization: `Bearer ${token.json().accessToken}` }, browser };
  };
  const alice = await account('Alice'),
    bob = await account('Bob');
  const id = randomUUID();
  assert.equal(
    (await request('/api/desktop/groups', { action: 'list' }, alice.browser)).statusCode,
    401,
  );
  assert.equal(
    (await request('/api/desktop/groups', { action: 'create', id, name: 'Shared' }, alice.bearer))
      .statusCode,
    200,
  );
  assert.equal(
    (await request('/api/desktop/groups', { action: 'read', groupId: id }, bob.bearer)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        '/api/desktop/groups',
        { action: 'invite', groupId: id, account: 'bob@example.test' },
        alice.bearer,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request('/api/desktop/groups', { action: 'accept', groupId: id }, bob.bearer))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        '/api/desktop/groups',
        { action: 'message', groupId: id, id: randomUUID(), content: 'Hello' },
        bob.bearer,
      )
    ).statusCode,
    200,
  );
  await request('/api/desktop/revoke', {}, bob.bearer);
  assert.equal(
    (await request('/api/desktop/groups', { action: 'read', groupId: id }, bob.bearer)).statusCode,
    401,
  );
});
