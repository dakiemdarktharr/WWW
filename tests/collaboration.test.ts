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

test('groups isolate accounts, require invitation acceptance and protect teammate ownership and message retries', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kivuno-groups-'));
  const store = new Store(path.join(dir, 'groups.db'));
  t.after(async () => {
    store.close();
    assert.equal(path.dirname(dir), os.tmpdir());
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
  assert.equal(call(alice, 'read', { after: 100 }).messages.length, 6);
  assert.throws(() => call(stranger, 'read'));
  call(alice, 'remove', { userId: bob.id });
  assert.throws(() => call(bob, 'read'));
  assert.equal(call(alice, 'read').group.teammates.length, 1);
  call(alice, 'invite', { account: 'eve' });
  assert.deepEqual(call(stranger, 'decline'), { declined: true });
});

test('real account login and PKCE tokens authenticate group API; cookies and revoked tokens cannot bypass it', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kivuno-groups-auth-'));
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
    assert.equal(path.dirname(dir), os.tmpdir());
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
