import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { redact, safeDetails } from '../server/security.ts';
import type { CodexSession } from '../shared/types.ts';

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-api-'));
  const store = new Store(path.join(dir, 'state.db'));
  const workspace = new Workspace(store, dir, dir);
  const app = await buildApp(workspace, { port: 4317 });
  const bootstrap = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4317' },
  });
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0],
    token = bootstrap.json().token;
  const request = (
    method: any,
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
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
  return {
    dir,
    store,
    workspace,
    app,
    request,
    cookie,
    token,
    close: async () => {
      await app.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test(
  'managed CLI opt-in requires explicit acknowledgement and retires external authority',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture();
    t.after(() => f.close());
    const previous = process.env.RELAY_CLAUDE_COMMAND;
    process.env.RELAY_CLAUDE_COMMAND = path.resolve('tests/fixtures/managed-peer.mjs');
    t.after(() => {
      if (previous === undefined) delete process.env.RELAY_CLAUDE_COMMAND;
      else process.env.RELAY_CLAUDE_COMMAND = previous;
    });
    const member = f.workspace.autonomy.addAccount('claude');
    const project = f.store.put('project', {
      id: randomUUID(),
      name: 'Managed scope',
      path: f.dir,
      goal: 'Test',
      createdAt: new Date().toISOString(),
      memberIds: [member.id],
    });
    const body = {
      memberId: member.id,
      projectId: project.id,
      durationMinutes: 30,
      allowTaskClaims: false,
      allowUnknownQuota: false,
    };
    const before = await f.request('POST', '/api/external-connections', body);
    assert.equal(before.statusCode, 200, before.body);
    assert.equal(
      (await f.request('POST', `/api/members/${member.id}/managed-runtime`, {})).statusCode,
      400,
    );
    const enabled = await f.request('POST', `/api/members/${member.id}/managed-runtime`, {
      acknowledgeLocalExecution: true,
    });
    assert.equal(enabled.statusCode, 200, enabled.body);
    assert.equal(enabled.json().managedRuntime, true);
    assert.equal(enabled.json().account, null);
    const connections = await f.request('GET', '/api/external-connections');
    assert.ok(connections.json().find((entry: any) => entry.id === before.json().id).revokedAt);
    assert.equal((await f.request('POST', '/api/external-connections', body)).statusCode, 403);
  },
);

test('project endpoint initializes a selected plain folder only when explicitly requested', async (t) => {
  const f = await fixture();
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'Kivuno project thử nghiệm-'));
  const privatePath = path.join(f.dir, 'selected-private-folder');
  await mkdir(privatePath);
  await writeFile(path.join(projectPath, 'README.md'), 'Project files stay local.\n');
  t.after(async () => {
    await f.close();
    await rm(projectPath, { recursive: true, force: true });
  });

  const rejected = await f.request('POST', '/api/projects', {
    name: 'Plain folder',
    path: projectPath,
    goal: 'Work safely',
  });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error, /Start from a folder/);

  const privateFolder = await f.request('POST', '/api/projects', {
    name: 'Private folder',
    path: privatePath,
    goal: 'Stay private',
    initializeGit: true,
  });
  assert.equal(privateFolder.statusCode, 400);
  await assert.rejects(lstat(path.join(privatePath, '.git')), { code: 'ENOENT' });

  const initialized = await f.request('POST', '/api/projects', {
    name: 'Plain folder',
    path: projectPath,
    goal: 'Work safely',
    initializeGit: true,
  });
  assert.equal(initialized.statusCode, 200);
  assert.equal(initialized.json().path, await realpath(projectPath));
  assert.equal(f.store.projects().length, 1);
});

test('group mutation endpoints bind human identity and browser sharing continues only the same session once', async () => {
  const f = await fixture();
  try {
    const member = f.store.addMember({ name: 'Atlas', role: 'engineer' });
    const outside = f.store.addMember({ name: 'Vega', role: 'reviewer' });
    const project = f.store.put('project', {
      id: randomUUID(),
      name: 'Group',
      path: f.dir,
      goal: '',
      memberIds: [],
      createdAt: new Date().toISOString(),
    });
    const roster = await f.request('PATCH', `/api/projects/${project.id}/members`, {
      memberIds: [member.id],
    });
    assert.equal(roster.statusCode, 200);
    assert.deepEqual(roster.json().memberIds, [member.id]);
    assert.equal(
      (
        await f.request('PATCH', `/api/projects/${project.id}/members`, {
          memberIds: [member.id],
          ownerId: outside.id,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.request('POST', `/api/mesh/${project.id}/heartbeat`, {})).statusCode,
      200,
    );
    assert.equal(
      (await f.request('POST', `/api/mesh/${project.id}/heartbeat`, { memberId: outside.id }))
        .statusCode,
      400,
    );
    const message = f.workspace.mesh.post({
      projectId: project.id,
      authorId: member.id,
      kind: 'progress',
      content: 'Review ready',
    });
    assert.equal(
      (
        await f.request('POST', `/api/mesh/messages/${message.id}/reactions`, {
          emoji: 'up',
          actorId: outside.id,
        })
      ).statusCode,
      400,
    );
    const reaction = await f.request('POST', `/api/mesh/messages/${message.id}/reactions`, {
      emoji: 'up',
    });
    assert.equal(reaction.json().reactions[0].actorId, 'human');
    const session = f.store.put('session', {
      id: randomUUID(),
      projectId: project.id,
      memberId: member.id,
      taskId: randomUUID(),
      title: 'Browser',
      readOnly: true,
      status: 'idle',
      threadId: null,
      turnId: null,
      pid: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies CodexSession);
    const calls: string[] = [];
    f.workspace.sessions.send = async (id) => {
      calls.push(id);
      return session;
    };
    const body = {
      sessionId: session.id,
      url: 'https://example.com/account?token=private',
      title: 'Reviewed page',
      text: 'Visible information',
      reviewed: true,
    };
    assert.equal(
      (
        await f.request('POST', `/api/projects/${project.id}/browser/share`, {
          ...body,
          reviewed: false,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.request('POST', `/api/projects/${randomUUID()}/browser/share`, body)).statusCode,
      403,
    );
    const shared = await f.request('POST', `/api/projects/${project.id}/browser/share`, body);
    assert.equal(shared.statusCode, 200);
    assert.equal(shared.json().continuation, 'sent');
    assert.equal(shared.json().url, 'https://example.com/account');
    assert.equal(
      (await f.request('POST', `/api/projects/${project.id}/browser/share`, body)).json()
        .continuation,
      'sent',
    );
    assert.deepEqual(calls, [session.id]);
    assert.equal(f.store.all('meshDispatch').length, 0);
    f.store.updateSession(session.id, { status: 'interrupted' });
    const paused = await f.request('POST', `/api/projects/${project.id}/browser/share`, {
      ...body,
      text: 'Updated content',
    });
    assert.equal(paused.json().continuation, 'paused');
    assert.equal(calls.length, 1, 'sharing cannot bypass explicit recovery');
    const state = (await f.request('GET', '/api/state')).json();
    assert.equal(state.groupIntroductions.length, 1);
    assert.equal(state.humanPresence[0].status, 'online');
  } finally {
    await f.close();
  }
});

test('hosted launcher can open the local document without granting cross-site API access', async () => {
  const f = await fixture();
  try {
    const navigation = {
      host: '127.0.0.1:4317',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-user': '?1',
    };
    // This fixture has no dist handler, so an accepted document reaches the router (404).
    assert.equal(
      (await f.app.inject({ method: 'GET', url: '/', headers: navigation })).statusCode,
      404,
    );
    assert.equal(
      (await f.app.inject({ method: 'GET', url: '/?source=launcher', headers: navigation }))
        .statusCode,
      404,
    );
    for (const url of [
      '/api/session',
      '/api/state',
      '/api/sessions',
      '/api/events',
      '/assets/app.js',
    ])
      assert.equal(
        (await f.app.inject({ method: 'GET', url, headers: navigation })).statusCode,
        403,
        url,
      );
    for (const change of [
      { 'sec-fetch-user': '' },
      { 'sec-fetch-mode': 'cors' },
      { 'sec-fetch-dest': 'iframe' },
    ])
      assert.equal(
        (await f.app.inject({ method: 'GET', url: '/', headers: { ...navigation, ...change } }))
          .statusCode,
        403,
      );
    assert.equal(
      (await f.app.inject({ method: 'POST', url: '/', headers: navigation, payload: {} }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: '/',
          headers: { ...navigation, host: 'attacker.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: '/',
          headers: { ...navigation, origin: 'https://attacker.example' },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test('local API requires an authenticated browser session for reads', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.app.inject({ url: '/api/state', headers: { host: '127.0.0.1:4317' } })).statusCode,
      401,
    );
    const response = await f.request('GET', '/api/state');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().members, []);
    assert.deepEqual(response.json().tasks, []);
  } finally {
    await f.close();
  }
});
test('host, origin and fetch-site checks prevent remote origins and DNS rebinding', async () => {
  const f = await fixture();
  try {
    const blockedHeaders: Record<string, string>[] = [
      { host: 'evil.example:4317' },
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of blockedHeaders)
      assert.equal((await f.request('GET', '/api/state', undefined, headers)).statusCode, 403);
    assert.equal(
      (await f.request('GET', '/api/state', undefined, { origin: 'http://127.0.0.1:4317' }))
        .statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});
test('mutations require session-bound CSRF token and JSON body', async () => {
  const f = await fixture();
  try {
    const input = { name: 'Atlas', role: 'engineer' };
    assert.equal(
      (await f.request('POST', '/api/members', input, { 'x-relay-token': 'invalid' })).statusCode,
      403,
    );
    assert.equal(
      (await f.request('POST', '/api/members', input, { 'content-type': 'text/plain' })).statusCode,
      415,
    );
    const member = await f.request('POST', '/api/members', input);
    assert.equal(member.statusCode, 200);
    assert.equal(member.json().status, 'offline');
    assert.equal(member.json().account, null);
    assert.equal(f.workspace.clients.size, 0);
  } finally {
    await f.close();
  }
});
test('task API persists real state, validates paths, rejects duplicates, and scopes messages', async () => {
  const f = await fixture();
  try {
    const project = {
      id: randomUUID(),
      name: 'Project',
      path: f.dir,
      goal: 'Ship safely',
      createdAt: new Date().toISOString(),
    };
    f.store.put('project', project);
    const invalid = await f.request('POST', '/api/tasks', {
      projectId: project.id,
      title: 'Escape',
      scope: ['../other'],
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(f.store.tasks().length, 0);
    const first = await f.request('POST', '/api/tasks', {
      projectId: project.id,
      title: 'Build interface',
      scope: ['src/ui'],
      acceptance: 'Keyboard accessible',
    });
    assert.equal(first.statusCode, 200);
    const task = first.json();
    assert.equal(
      (
        await f.request('POST', '/api/tasks', {
          projectId: project.id,
          title: ' BUILD   INTERFACE ',
        })
      ).statusCode,
      409,
    );
    const msg = await f.request('POST', '/api/messages', {
      projectId: project.id,
      taskId: task.id,
      content: 'Ready for a handoff.',
    });
    assert.equal(msg.statusCode, 200);
    assert.equal(msg.json().authorId, null);
    assert.equal(
      (await f.request('PATCH', `/api/tasks/${task.id}`, { dependsOn: [task.id] })).statusCode,
      409,
    );
    const state = (await f.request('GET', '/api/state')).json();
    assert.equal(state.tasks.length, 1);
    assert.equal(state.messages.length, 1);
  } finally {
    await f.close();
  }
});
test('unknown fields cannot escalate task status or overwrite account identity', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request('POST', '/api/members', {
          name: 'Fake',
          role: 'engineer',
          account: { email: 'fake@example.com' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.request('POST', '/api/tasks', {
          projectId: randomUUID(),
          title: 'Injected',
          status: 'done',
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test('redaction strips provider tokens and nested secret fields', () => {
  assert.ok(!redact(`api_key=sk-${'abcdefghijklmnopqrstuvwxyz'}`).includes('sk-'));
  assert.ok(!redact('Authorization: Bearer private-test-value').includes('private-test-value'));
  assert.ok(!redact('{"refresh_token":"private-test-value"}').includes('private-test-value'));
  const output = safeDetails({
    accessToken: 'secret-value',
    nested: { authorization: 'Bearer secret', note: 'okay' },
  }) as any;
  assert.equal(output.accessToken, '[REDACTED]');
  assert.equal(output.nested.authorization, '[REDACTED]');
  assert.equal(output.nested.note, 'okay');
});
test('static server serves only built assets and uses defensive response headers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-static-'));
  await mkdir(path.join(dir, 'dist'));
  await writeFile(path.join(dir, 'dist', 'index.html'), '<title>RELAY</title>');
  await writeFile(path.join(dir, 'private.txt'), 'must not leak');
  const store = new Store(path.join(dir, 'state.db'));
  const app = await buildApp(new Workspace(store, dir, dir), {
    port: 4317,
    distDir: path.join(dir, 'dist'),
  });
  try {
    const response = await app.inject({ url: '/', headers: { host: '127.0.0.1:4317' } });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /RELAY/);
    assert.equal(response.headers['x-frame-options'], 'DENY');
    const traversal = await app.inject({
      url: '/%2e%2e/private.txt',
      headers: { host: '127.0.0.1:4317' },
    });
    assert.ok(!traversal.body.includes('must not leak'));
    assert.equal(
      (await app.inject({ url: '/api/missing', headers: { host: '127.0.0.1:4317' } })).statusCode,
      401,
    );
  } finally {
    await app.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('coordinator closes an open SSE connection without hanging shutdown', async () => {
  const f = await fixture();
  try {
    const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
    const url = new URL('/api/events', address);
    const stream = await new Promise<import('node:http').ClientRequest>((resolve, reject) => {
      const request = get(
        url,
        { headers: { host: '127.0.0.1:4317', cookie: f.cookie } },
        (response) => {
          assert.equal(response.statusCode, 200);
          response.once('data', () => resolve(request));
          response.on('error', () => {});
        },
      );
      request.on('error', reject);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        f.app.close(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('SSE prevented shutdown')), 2000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      stream.destroy();
    }
    assert.equal(f.store.listenerCount('change'), 0);
  } finally {
    await f.close();
  }
});
