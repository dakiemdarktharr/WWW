import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { CodexClient } from '../server/codex.ts';
import { buildApp } from '../server/app.ts';
import { ExternalProviders } from '../server/external-provider.ts';
import type { Member, Project } from '../shared/types.ts';

// Controlled auth/capability protocol; never launches a model or authenticates a user.
class ProfileClient extends CodexClient {
  signedIn = false;
  stopFails = false;
  calls: string[] = [];
  constructor(
    public profile: string,
    public email: string,
    public used: number,
  ) {
    super({ home: profile, cwd: profile });
  }
  override async start() {}
  override async stop() {
    if (this.stopFails) throw new Error('shutdown not confirmed');
  }
  override async request<T = any>(method: string): Promise<T> {
    this.calls.push(method);
    const responses: Record<string, unknown> = {
      'account/read': {
        account: this.signedIn ? { type: 'chatgpt', email: this.email, planType: 'plus' } : null,
      },
      'account/login/start': {
        type: 'chatgptDeviceCode',
        loginId: randomUUID(),
        userCode: 'TEST-ONLY',
      },
      'account/rateLimits/read': {
        rateLimits: { primary: { usedPercent: this.used, windowDurationMins: 300 } },
      },
      'skills/list': { data: [{ skills: [{ name: 'profile-skill', enabled: true }] }] },
      'plugin/list': { data: [] },
    };
    if (method === 'account/logout') this.signedIn = false;
    return (responses[method] || {}) as T;
  }
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-team-test-'));
  const store = new Store(path.join(root, 'workspace.db'));
  const workspace = new Workspace(store, root, root);
  workspace.autonomy.ready = async () => {};
  workspace.client = async (id) => {
    const member = store.get<Member>('member', id);
    assert.ok(!member.removedAt);
    let client = workspace.clients.get(id);
    if (!client) {
      client = new ProfileClient(
        workspace.home(id),
        `account-${workspace.clients.size}@example.test`,
        10 + workspace.clients.size * 10,
      );
      workspace.clients.set(id, client);
    }
    return client;
  };
  const app = await buildApp(workspace);
  const session = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4317' },
  });
  const headers = {
    host: '127.0.0.1:4317',
    cookie: String(session.headers['set-cookie']).split(';')[0],
    'x-relay-token': session.json().token,
  };
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Team test',
    path: root,
    goal: 'No model turns',
    createdAt: new Date().toISOString(),
    memberIds: [],
  } satisfies Project);
  t.after(async () => {
    for (const client of workspace.clients.values()) (client as ProfileClient).stopFails = false;
    await app.close();
    await workspace.close();
    store.close();
    const actual = await realpath(root);
    assert.equal(path.dirname(actual), await realpath(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('kivuno-team-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { root, store, workspace, app, headers, project };
}

test('four accounts on one machine retain distinct profiles, email and quota; cancelled profiles are not silently reused', async (t) => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const connected = await f.app.inject({
      method: 'POST',
      url: '/api/accounts/connect',
      headers: f.headers,
      payload: { provider: 'codex' },
    });
    assert.equal(connected.statusCode, 200, connected.body);
    const { member, login } = connected.json();
    ids.push(member.id);
    assert.equal(member.runnerId, undefined);
    const blocked = await f.app.inject({
      method: 'POST',
      url: '/api/accounts/connect',
      headers: f.headers,
      payload: { provider: 'codex' },
    });
    assert.equal(blocked.statusCode, 409);
    if (i === 0) await f.workspace.cancelLogin(member.id, login.loginId);
    else {
      const client = f.workspace.clients.get(member.id) as ProfileClient;
      client.signedIn = true;
      await f.workspace.notification(member.id, 'account/login/completed', { success: true });
      const refreshed = f.store.get<Member>('member', member.id);
      assert.equal(refreshed.account?.email, client.email);
      await f.workspace.notification(member.id, 'account/login/completed', {
        loginId: login.loginId,
        success: false,
        error: 'Login timed out',
      });
      assert.equal(
        f.store.get<Member>('member', member.id).status,
        'ready',
        'late login timeout cannot disconnect an authenticated profile',
      );
      assert.equal(
        f.workspace.quota.current(member.id).windows[0].remainingPercent,
        100 - client.used,
      );
    }
  }
  assert.equal(new Set(ids).size, 4);
  assert.equal(new Set(ids.map((id) => f.workspace.home(id))).size, 4);
  assert.equal(f.store.members().length, 4);
  assert.equal(f.store.get<Member>('member', ids[0]).account, null);
  assert.ok(
    [...f.workspace.clients.values()].every(
      (client) => !(client as ProfileClient).calls.includes('turn/start'),
    ),
  );
});

test('logging out one account and cancelling an old dialog never unlock another sign-in', async (t) => {
  const f = await fixture(t);
  const first = f.workspace.autonomy.addAccount(),
    second = f.workspace.autonomy.addAccount();
  const login = await f.workspace.login(second.id, 'device');
  await f.workspace.logout(first.id);
  assert.equal(f.workspace.loginOwner, second.id);
  await f.workspace.cancelLogin(first.id, 'old-login');
  assert.equal(f.workspace.loginOwner, second.id);
  await f.workspace.cancelLogin(second.id, 'outdated-login');
  assert.equal(f.workspace.loginOwner, second.id);
  await f.workspace.cancelLogin(second.id, login.loginId!);
  assert.equal(f.workspace.loginOwner, null);
});

test('removing a teammate requires owner CSRF, signs out only that profile, retains history and rejects reuse', async (t) => {
  const f = await fixture(t);
  const member = f.workspace.autonomy.addAccount(),
    other = f.workspace.autonomy.addAccount();
  f.store.updateMember(member.id, { connectedAt: new Date().toISOString() });
  f.store.put('project', {
    ...f.project,
    memberIds: [member.id, other.id],
    ownerMemberId: member.id,
  });
  const client = (await f.workspace.client(member.id)) as ProfileClient;
  client.signedIn = true;
  const otherClient = (await f.workspace.client(other.id)) as ProfileClient;
  otherClient.signedIn = true;
  f.store.message({
    projectId: f.project.id,
    authorId: member.id,
    taskId: null,
    kind: 'message',
    content: 'Preserved history',
    mentions: [],
    humanCommand: false,
  });
  const rejected = await f.app.inject({
    method: 'DELETE',
    url: `/api/members/${member.id}`,
    headers: { host: '127.0.0.1:4317' },
  });
  assert.notEqual(rejected.statusCode, 200);
  const removed = await f.app.inject({
    method: 'DELETE',
    url: `/api/members/${member.id}`,
    headers: f.headers,
    payload: {},
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(
    f.store.members().map((entry) => entry.id),
    [other.id],
  );
  assert.equal(client.signedIn, false);
  assert.equal(otherClient.signedIn, true);
  assert.equal(f.store.get<Member>('member', member.id).name, member.name);
  assert.equal(f.store.all('message').length, 1);
  assert.deepEqual(f.store.get<Project>('project', f.project.id).memberIds, [other.id]);
  assert.equal(f.store.get<Project>('project', f.project.id).ownerMemberId, undefined);
  assert.throws(() => f.workspace.mesh.setMembers(f.project.id, [member.id]), /removed/);
  await assert.rejects(Workspace.prototype.client.call(f.workspace, member.id), /removed/);
  await assert.rejects(f.workspace.login(member.id, 'device'), /removed/);
  assert.deepEqual(await f.workspace.removeMember(member.id), { removed: true });
});

test('active ownership and uncertain shutdown prevent removal without losing recoverable work', async (t) => {
  const f = await fixture(t),
    member = f.workspace.autonomy.addAccount();
  f.store.updateMember(member.id, { account: { type: 'chatgpt' }, status: 'ready' });
  f.store.put('project', { ...f.project, memberIds: [member.id] });
  const task = f.store.addTask({
    projectId: f.project.id,
    title: 'Keep work',
    description: 'Test',
    kind: 'code',
    priority: 'medium',
    scope: ['src'],
    dependsOn: [],
    acceptance: 'Keep lease',
  });
  const { lease } = f.store.claim(task.id, member.id);
  await assert.rejects(f.workspace.removeMember(member.id), /Stop or hand off/);
  assert.equal(f.store.lease(task.id)?.token, lease.token);
  f.store.release(task.id, lease.token);
  const client = (await f.workspace.client(member.id)) as ProfileClient;
  client.stopFails = true;
  await assert.rejects(f.workspace.removeMember(member.id), /shutdown not confirmed/);
  assert.equal(f.store.members().length, 1);
  assert.equal(f.store.get<Member>('member', member.id).removedAt, undefined);
});

test('removed external teammates lose access through their existing MESH token', async (t) => {
  const f = await fixture(t),
    member = f.workspace.autonomy.addAccount('claude');
  f.store.put('project', { ...f.project, memberIds: [member.id] });
  const external = new ExternalProviders(f.workspace);
  try {
    const connection = external.create({ memberId: member.id, projectId: f.project.id });
    const token = Object.values(connection.config.mcpServers)[0].env.KIVUNO_MCP_TOKEN;
    assert.equal(external.authenticate(`Bearer ${token}`).memberId, member.id);
    await f.workspace.removeMember(member.id);
    assert.throws(() => external.authenticate(`Bearer ${token}`), /project group/);
  } finally {
    external.close();
  }
});
