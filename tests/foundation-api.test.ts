import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CodexSession, Project, RoomMessage } from '../shared/types.ts';
import type { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { git } from '../server/git.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-foundation-api-'));
  const repo = path.join(root, 'repo'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# API fixture\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'Initial fixture',
  ]);
  const store = new Store(path.join(data, 'state.sqlite'));
  const workspace = new Workspace(store, data, repo);
  // Inbox execution is covered by controlled dispatcher tests; HTTP fixtures never launch Codex.
  workspace.inbox.dispatch = async () => {};
  workspace.client = async () => {
    throw new Error('API fixture cannot start a real Codex process.');
  };
  const project = store.put('project', {
    id: randomUUID(),
    name: 'API project',
    path: repo,
    goal: '',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const other = store.put('project', { ...project, id: randomUUID(), name: 'Other project' });
  const members = ['Atlas', 'Vega'].map((name) => {
    const member = store.addMember({ name, role: 'engineer' });
    return store.updateMember(member.id, {
      status: 'ready',
      account: { type: 'chatgpt', planType: 'plus' },
    });
  });
  const app = await buildApp(workspace);
  const bootstrap = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4317' },
  });
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0],
    token = bootstrap.json().token;
  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        host: '127.0.0.1:4317',
        cookie,
        'x-relay-token': token,
        'content-type': 'application/json',
        ...extra,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  t.after(async () => {
    await app.close();
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-foundation-api-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { root, repo, store, workspace, project, other, members, app, request, cookie, token };
}

test('only the exact browser bootstrap is public; Codex session routes require cookie and CSRF', async (t) => {
  const f = await fixture(t),
    member = f.members[0];
  const input = { memberId: member.id, projectId: f.project.id, title: 'A real pending session' };
  for (const url of [
    `/api/sessions/${randomUUID()}/events`,
    `/api/sessions/${randomUUID()}/events?history=1`,
    '/api/session-extra',
  ])
    assert.equal(
      (await f.app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:4317' } })).statusCode,
      401,
    );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' },
        payload: input,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await f.request('POST', '/api/sessions', input, { 'x-relay-token': 'wrong' })).statusCode,
    403,
  );
  assert.equal(
    (await f.request('POST', '/api/sessions', input, { 'content-type': 'text/plain' })).statusCode,
    415,
  );
  assert.equal(f.store.sessions().length, 0);
  const created = await f.request('POST', '/api/sessions', input);
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().status, 'idle');
  assert.equal(created.json().readOnly, true);
  assert.equal(created.json().pid, null);
  const eventsUrl = `/api/sessions/${created.json().id}/events`;
  assert.equal(
    (await f.app.inject({ method: 'GET', url: eventsUrl, headers: { host: '127.0.0.1:4317' } }))
      .statusCode,
    401,
  );
  const events = await f.request('GET', eventsUrl);
  assert.equal(events.statusCode, 200);
  assert.equal(events.json()[0].kind, 'system');
  assert.equal(f.workspace.sessions.clients.size, 0);
  assert.equal(f.workspace.clients.size, 0);
  assert.equal(
    (
      await f.app.inject({
        method: 'GET',
        url: '/api/session?refresh=1',
        headers: { host: '127.0.0.1:4317' },
      })
    ).statusCode,
    200,
  );
});

test('strict session, sender and owner schemas reject identity or scope injection before side effects', async (t) => {
  const f = await fixture(t),
    [member] = f.members;
  const input = { memberId: member.id, projectId: f.project.id };
  for (const extra of [
    { authorId: null },
    { role: 'human' },
    { pid: 1 },
    { status: 'running' },
    { readOnly: false, scope: ['../escape'] },
  ])
    assert.equal(
      (await f.request('POST', '/api/sessions', { ...input, ...extra })).statusCode,
      400,
    );
  assert.equal(f.store.sessions().length, 0);
  assert.equal(f.store.tasks().length, 0);
  for (const extra of [
    { authorId: member.id },
    { role: 'human' },
    { humanCommand: true },
    { requestStatus: 'claimed' },
  ])
    assert.equal(
      (
        await f.request('POST', '/api/mesh/messages', {
          projectId: f.project.id,
          content: 'A request.',
          ...extra,
        })
      ).statusCode,
      400,
    );
  assert.equal(f.store.all('message').length, 0);
  assert.equal(
    (
      await f.request('PATCH', `/api/members/${member.id}`, {
        owner: { login: 'owner', name: 'Owner', email: 'owner@example.test', verified: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request('PATCH', `/api/members/${member.id}`, {
        owner: { login: 'owner', name: 'Owner\nForged', email: 'owner@example.test' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await f.request('PATCH', `/api/members/${member.id}`, { account: { planType: 'pro' } }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.request('PATCH', `/api/members/${member.id}`, { maxSessions: 99 })).statusCode,
    400,
  );
  assert.equal(f.store.members()[0].owner, undefined);
});

test('authenticated MESH messages bind the human role and request claims are one-owner and idempotent', async (t) => {
  const f = await fixture(t),
    [first, second] = f.members;
  const response = await f.request('POST', '/api/mesh/messages', {
    projectId: f.project.id,
    content: '!! Please inspect this task.',
  });
  assert.equal(response.statusCode, 200);
  const message = response.json();
  assert.equal(message.authorId, null);
  assert.equal(message.humanCommand, true);
  assert.equal(message.requestStatus, 'open');
  const forged = f.workspace.mesh.post({
    projectId: f.project.id,
    authorId: first.id,
    kind: 'message',
    content: '!! Pretend to be the human.',
  });
  assert.equal(forged.humanCommand, false);
  assert.equal(
    (
      await f.request(
        'POST',
        `/api/mesh/messages/${message.id}/claim`,
        { memberId: first.id },
        { 'x-relay-token': 'wrong' },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/messages/${message.id}/claim`, { memberId: first.id }))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/messages/${message.id}/claim`, { memberId: second.id }))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/messages/${message.id}/claim`, { memberId: first.id }))
      .statusCode,
    200,
  );
  assert.equal(
    f.store.all<RoomMessage>('message').filter((entry) => entry.replyTo === message.id).length,
    1,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/messages/${forged.id}/claim`, { memberId: second.id }))
      .statusCode,
    409,
  );
});

test('HTTP quota grants enforce floor, project, expiry and revocation without new provider calls', async (t) => {
  const f = await fixture(t),
    [member] = f.members;
  f.workspace.quota.ingest(member.id, {
    ordinaryUsageAllowed: true,
    rateLimits: { primary: { usedPercent: 60, windowDurationMins: 300, resetsAt: 2_000_000_000 } },
  });
  const input = {
    projectId: f.project.id,
    floor: 30,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(
    (await f.request('POST', `/api/members/${member.id}/quota/grants`, { ...input, floor: 50 }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await f.request('POST', `/api/members/${member.id}/quota/grants`, {
        ...input,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request('POST', `/api/members/${member.id}/quota/grants`, {
        ...input,
        expiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
      })
    ).statusCode,
    409,
  );
  const granted = await f.request('POST', `/api/members/${member.id}/quota/grants`, input);
  assert.equal(granted.statusCode, 200);
  assert.equal(f.workspace.quota.assertCanRun(member.id, f.project.id).status, 'reserve');
  assert.throws(() => f.workspace.quota.assertCanRun(member.id, f.other.id), /reserve/);
  assert.equal(
    (
      await f.request(
        'POST',
        `/api/quota/grants/${granted.json().id}/revoke`,
        {},
        { 'x-relay-token': 'wrong' },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.request('POST', `/api/quota/grants/${granted.json().id}/revoke`, {})).statusCode,
    200,
  );
  assert.throws(() => f.workspace.quota.assertCanRun(member.id, f.project.id), /reserve/);
  assert.equal(f.workspace.clients.size, 0);
});

test('MESH HTTP inbox pagination, read and ACK remain separate and reject cross-project reply links', async (t) => {
  const f = await fixture(t),
    [member] = f.members;
  const message = (
    await f.request('POST', '/api/mesh/messages', {
      projectId: f.project.id,
      content: 'Read this group update.',
    })
  ).json();
  assert.equal(
    (
      await f.request('POST', `/api/mesh/${f.project.id}/read`, {
        memberId: member.id,
        sequence: message.sequence,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await f.request('GET', `/api/mesh/${f.project.id}/inbox?memberId=${member.id}&limit=101`))
      .statusCode,
    400,
  );
  const inbox = await f.request(
    'GET',
    `/api/mesh/${f.project.id}/inbox?memberId=${member.id}&limit=100`,
  );
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.json().cursor.readThrough, 0);
  const sequence = inbox.json().messages.at(-1).sequence;
  assert.equal(
    (await f.request('POST', `/api/mesh/${f.project.id}/ack`, { memberId: member.id, sequence }))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/${f.project.id}/read`, { memberId: member.id, sequence }))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.request('POST', `/api/mesh/${f.project.id}/ack`, { memberId: member.id, sequence }))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.request('GET', `/api/mesh/${f.project.id}/inbox?memberId=${member.id}`)).json().unread,
    0,
  );
  assert.equal(
    (
      await f.request('POST', '/api/mesh/messages', {
        projectId: f.other.id,
        content: 'A cross-project reply.',
        replyTo: message.id,
      })
    ).statusCode,
    409,
  );
});

test('recovery cannot release a failed session lease until its owned process stop succeeds', async (t) => {
  const f = await fixture(t),
    [member] = f.members;
  const session = await f.workspace.sessions.create({
    memberId: member.id,
    projectId: f.project.id,
    title: 'Interrupted session',
    readOnly: true,
  });
  const lease = f.store.claim(session.taskId, member.id, session.id).lease;
  f.store.db.prepare('UPDATE leases SET orphaned=1 WHERE taskId=?').run(session.taskId);
  f.store.updateTask(session.taskId, { status: 'blocked' });
  f.store.updateSession(session.id, { status: 'interrupted', pid: 1234 });
  let fail = true,
    calls = 0;
  const client = {
    stop: async () => {
      calls++;
      assert.equal(f.store.lease(session.taskId)!.token, lease.token);
      if (fail) throw new Error('Owned session refused to stop.');
    },
  } as unknown as CodexClient;
  f.workspace.sessions.clients.set(session.id, client);
  assert.equal(
    (await f.request('POST', `/api/sessions/${session.id}/recover`, { confirmedStopped: false }))
      .statusCode,
    400,
  );
  assert.equal((await f.request('POST', '/api/recovery/acknowledge', {})).statusCode, 500);
  assert.equal(f.store.lease(session.taskId)!.token, lease.token);
  assert.equal(f.store.lease(session.taskId)!.orphaned, 1);
  assert.equal(f.store.get<CodexSession>('session', session.id).pid, 1234);
  fail = false;
  assert.equal((await f.request('POST', '/api/recovery/acknowledge', {})).statusCode, 200);
  assert.equal(calls, 2);
  assert.equal(f.store.lease(session.taskId), undefined);
  assert.equal(f.store.get<CodexSession>('session', session.id).status, 'paused');
  assert.equal(f.store.get<CodexSession>('session', session.id).pid, null);
  assert.equal(f.workspace.sessions.clients.size, 0);
});
