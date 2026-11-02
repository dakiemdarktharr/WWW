import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { git } from '../server/git.ts';
import type { CodexSession, Member, Project } from '../shared/types.ts';

/** In-memory protocol peer; no login, child process or billable turn. */
class SessionPeer extends CodexClient {
  calls: { method: string; params: any }[] = [];
  responses: { id: string | number; result: any }[] = [];
  rejections: (string | number)[] = [];
  stopFails = false;
  stopCalls = 0;
  turn = 0;
  onTurn?: (threadId: string, turnId: string) => Promise<void>;
  thread = randomUUID();
  constructor(root: string) {
    super({ home: root, cwd: root });
  }
  override get pid() {
    return 123456;
  }
  override async start() {}
  override async stop() {
    this.stopCalls++;
    if (this.stopFails) throw new Error('Controlled process refused to stop.');
  }
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.calls.push({ method, params });
    let response: unknown = {};
    if (method === 'account/read')
      response = { account: { type: 'chatgpt', email: 'session@example.test', planType: 'plus' } };
    else if (method === 'account/rateLimits/read')
      response = {
        rateLimits: {
          primary: {
            usedPercent: 10,
            windowDurationMins: 300,
            resetsAt: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        ordinaryUsageAllowed: true,
      };
    else if (method === 'thread/start' || method === 'thread/resume')
      response = {
        thread: { id: params.threadId || this.thread },
        sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' },
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      };
    else if (method === 'turn/start') {
      const turnId = `turn-${++this.turn}`;
      if (this.onTurn) await this.onTurn(params.threadId, turnId);
      response = { turn: { id: turnId } };
    }
    return response as T;
  }
  override respond(id: string | number, result: unknown) {
    this.responses.push({ id, result });
  }
  override rejectRequest(id: string | number) {
    this.rejections.push(id);
  }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-sessions-test-'));
  const repo = path.join(root, 'repo'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# Session fixture\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [
    '-c',
    'user.name=Session fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'Initial',
  ]);
  const store = new Store(path.join(data, 'workspace.sqlite'));
  const workspace = new Workspace(store, data, repo);
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Sessions',
    path: repo,
    goal: 'Coordinate actual session contracts.',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const member = store.addMember({ name: 'Atlas', role: 'engineer' });
  store.updateMember(member.id, {
    account: { type: 'chatgpt', email: 'session@example.test' },
    status: 'ready',
    maxSessions: 4,
  });
  const control = new SessionPeer(root),
    peers = new Map<string, SessionPeer>();
  workspace.client = async () => control;
  workspace.refresh = async (id) =>
    store.updateMember(id, {
      account: { type: 'chatgpt', email: 'session@example.test' },
      status: workspace.sessions
        .all()
        .some((session) => session.memberId === id && session.status === 'running')
        ? 'working'
        : 'ready',
    });
  workspace.sessions.createClient = (session) => {
    const peer = new SessionPeer(root);
    peers.set(session.id, peer);
    return peer;
  };
  t.after(async () => {
    for (const peer of peers.values()) peer.stopFails = false;
    await workspace.close();
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-sessions-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  const create = (title: string, scope = ['.'], readOnly = false) =>
    workspace.sessions.create({
      projectId: project.id,
      memberId: member.id,
      title,
      scope,
      readOnly,
    });
  async function complete(session: CodexSession, text = 'Verified controlled result.') {
    const current = workspace.sessions.get(session.id),
      peer = peers.get(session.id)!;
    await workspace.sessions.notification(session.id, peer, 'item/completed', {
      threadId: current.threadId,
      turnId: current.turnId,
      item: { type: 'agentMessage', text },
    });
    await workspace.sessions.notification(session.id, peer, 'turn/completed', {
      threadId: current.threadId,
      turn: { id: current.turnId, status: 'completed' },
    });
    return workspace.sessions.get(session.id);
  }
  return { root, repo, data, store, workspace, project, member, peers, control, create, complete };
}

test('two writing sessions share an account but hold independent process, task and scope leases', async (t) => {
  const f = await fixture(t);
  const a = await f.create('Build A', ['a']),
    b = await f.create('Build B', ['b']);
  await Promise.all([
    f.workspace.sessions.send(a.id, 'Implement A.'),
    f.workspace.sessions.send(b.id, 'Implement B.'),
  ]);
  assert.equal(f.workspace.sessions.get(a.id).status, 'running');
  assert.equal(f.workspace.sessions.get(b.id).status, 'running');
  assert.notEqual(f.peers.get(a.id), f.peers.get(b.id));
  assert.notEqual(f.store.lease(a.taskId)?.token, f.store.lease(b.taskId)?.token);
  assert.equal(f.store.lease(a.taskId)?.sessionId, a.id);
  assert.equal(f.store.lease(b.taskId)?.sessionId, b.id);
  const duplicate = await f.create('Conflicting scope', ['a/file.ts']);
  await assert.rejects(f.workspace.sessions.send(duplicate.id, 'Change A too.'), /overlap/i);
  assert.equal(f.store.leases().length, 2);
});

test('a rejected initial prompt remains a visible failed session without creating a runtime or duplicate task', async (t) => {
  const f = await fixture(t);
  f.workspace.quota.assertCanRun = () => {
    throw new Error('Sign in to this account in Team.');
  };
  const session = await f.workspace.sessions.create({
    memberId: f.member.id,
    projectId: f.project.id,
    title: 'Needs sign-in',
    readOnly: true,
    prompt: 'Read the project.',
  });
  assert.equal(session.status, 'error');
  assert.match(session.error!, /Sign in/);
  assert.equal(f.store.sessions().length, 1);
  assert.equal(f.store.tasks().length, 1);
  assert.equal(f.store.leases().length, 0);
  assert.equal(f.peers.size, 0);
});

test('an existing implementation task cannot be completed by attaching a read-only session', async (t) => {
  const f = await fixture(t);
  const task = f.store.addTask({
    projectId: f.project.id,
    title: 'Implement a real artifact',
    description: 'Requires reviewed changes.',
    kind: 'code',
    priority: 'medium',
    scope: ['src'],
    dependsOn: [],
    acceptance: 'Artifact is implemented and tested.',
    assignedTo: f.member.id,
  });
  await assert.rejects(
    f.workspace.sessions.create({
      memberId: f.member.id,
      projectId: f.project.id,
      taskId: task.id,
      readOnly: true,
      prompt: 'Just say done.',
    }),
    /requires a writing session/,
  );
  assert.equal(f.store.get<any>('task', task.id).status, 'ready');
  assert.equal(f.store.lease(task.id), undefined);
  assert.equal(f.workspace.sessions.all().length, 0);
  assert.equal(f.peers.size, 0);
});

test('finished read-only processes are evicted at the account cap and their saved threads resume safely', async (t) => {
  const f = await fixture(t);
  f.store.updateMember(f.member.id, { maxSessions: 2 });
  const a = await f.create('Idle A', ['.'], true),
    b = await f.create('Idle B', ['.'], true);
  const startedA = await f.workspace.sessions.send(a.id, 'Read A.');
  const originalA = f.peers.get(a.id)!;
  await f.complete(a);
  await f.workspace.sessions.send(b.id, 'Read B.');
  await f.complete(b);
  const c = await f.create('Current C', ['.'], true);
  await f.workspace.sessions.send(c.id, 'Read C.');
  assert.equal(f.workspace.sessions.clients.size, 2);
  assert.equal(f.workspace.sessions.clients.has(a.id), false);
  assert.equal(originalA.stopCalls, 1);
  assert.equal(f.workspace.sessions.get(a.id).threadId, startedA.threadId);
  assert.equal(f.workspace.sessions.get(a.id).status, 'idle');
  assert.equal(f.workspace.sessions.get(a.id).pid, null);
  await f.workspace.sessions.send(a.id, 'Continue A.');
  assert.equal(f.workspace.sessions.clients.size, 2);
  assert.notEqual(f.peers.get(a.id), originalA);
  assert.equal(
    f.peers.get(a.id)!.calls.find((call) => call.method === 'thread/resume')?.params.threadId,
    startedA.threadId,
  );
  assert.equal(f.workspace.sessions.get(c.id).status, 'running');
});

test('failed idle-process eviction blocks new execution and preserves the uncertain process for recovery', async (t) => {
  const f = await fixture(t);
  f.store.updateMember(f.member.id, { maxSessions: 1 });
  const old = await f.create('Uncertain idle', ['.'], true);
  await f.workspace.sessions.send(old.id, 'Read once.');
  await f.complete(old);
  f.peers.get(old.id)!.stopFails = true;
  const next = await f.create('Must wait', ['.'], true);
  await assert.rejects(
    f.workspace.sessions.send(next.id, 'Do not create another process.'),
    /Recover that session/,
  );
  assert.equal(f.workspace.sessions.clients.size, 1);
  assert.equal(f.workspace.sessions.get(old.id).status, 'interrupted');
  assert.equal(f.peers.has(next.id), false);
  assert.equal(f.store.lease(next.taskId), undefined);
});

test('read-only sessions stream actual protocol output, steer current turns and resume verified threads', async (t) => {
  const f = await fixture(t),
    session = await f.create('Read project', ['.'], true);
  const running = await f.workspace.sessions.send(session.id, 'Read the project.');
  const peer = f.peers.get(session.id)!;
  assert.equal(
    peer.calls.find((call) => call.method === 'thread/start')?.params.sandbox,
    'read-only',
  );
  assert.equal(f.store.lease(session.taskId)?.scopes.length, 0);
  await f.workspace.sessions.send(session.id, 'Focus on the entry point.');
  assert.equal(peer.calls.filter((call) => call.method === 'turn/start').length, 1);
  assert.equal(
    peer.calls.find((call) => call.method === 'turn/steer')?.params.expectedTurnId,
    running.turnId,
  );
  await f.workspace.sessions.notification(session.id, peer, 'item/agentMessage/delta', {
    threadId: running.threadId,
    turnId: running.turnId,
    delta: 'Observed ',
  });
  await f.workspace.sessions.notification(session.id, peer, 'item/agentMessage/delta', {
    threadId: running.threadId,
    turnId: running.turnId,
    delta: 'entry point.',
  });
  assert.equal(
    f.workspace.sessions.events(session.id).filter((event) => event.kind === 'agent').length,
    1,
  );
  assert.equal((await f.complete(session)).status, 'idle');
  assert.equal(f.store.lease(session.taskId), undefined);
  await f.workspace.sessions.send(session.id, 'Continue the same conversation.');
  assert.equal(
    peer.calls.find((call) => call.method === 'thread/resume')?.params.threadId,
    running.threadId,
  );
});

test('foreign events and tool calls cannot write another session history or room', async (t) => {
  const f = await fixture(t),
    session = await f.create('Fenced conversation', ['.'], true);
  const running = await f.workspace.sessions.send(session.id, 'Read safely.'),
    peer = f.peers.get(session.id)!;
  await f.workspace.sessions.notification(session.id, peer, 'item/completed', {
    threadId: 'foreign-thread',
    turnId: running.turnId,
    item: { type: 'agentMessage', text: 'Foreign text.' },
  });
  await f.workspace.sessions.request(session.id, peer, {
    id: 1,
    method: 'item/tool/call',
    params: {
      threadId: running.threadId,
      turnId: 'foreign-turn',
      tool: 'mesh_post',
      arguments: { content: 'Foreign report', kind: 'progress' },
    },
  });
  assert.equal(peer.rejections.includes(1), true);
  assert.equal(
    f.workspace.sessions.events(session.id).some((event) => event.text.includes('Foreign')),
    false,
  );
  assert.equal(
    f.store.all<any>('message').some((message) => message.content === 'Foreign report'),
    false,
  );
});

test('a completed writing turn retains ownership through review and user follow-up', async (t) => {
  const f = await fixture(t),
    session = await f.create('Review work', ['src']);
  await f.workspace.sessions.send(session.id, 'Implement the task.');
  const token = f.store.lease(session.taskId)!.token;
  assert.equal((await f.complete(session)).status, 'review');
  assert.equal(f.store.lease(session.taskId)?.token, token);
  await f.workspace.sessions.send(session.id, 'Improve the acceptance evidence.');
  assert.equal(f.store.lease(session.taskId)?.token, token);
  assert.equal(f.workspace.sessions.get(session.id).status, 'running');
});

test('pause confirms process termination and retains task ownership until explicit stop', async (t) => {
  const f = await fixture(t),
    session = await f.create('Pause work', ['src']);
  await f.workspace.sessions.send(session.id, 'Implement task.');
  const token = f.store.lease(session.taskId)!.token;
  await f.workspace.sessions.interrupt(session.id);
  assert.equal(f.workspace.sessions.get(session.id).status, 'paused');
  assert.equal(f.workspace.sessions.get(session.id).pid, null);
  assert.equal(f.store.lease(session.taskId)?.token, token);
  await f.workspace.sessions.stop(session.id);
  assert.equal(f.workspace.sessions.get(session.id).status, 'stopped');
  assert.equal(f.store.lease(session.taskId), undefined);
});

test('failed process stop keeps an orphan lease and recovery never starts a paid turn', async (t) => {
  const f = await fixture(t),
    session = await f.create('Recover work', ['src']);
  await f.workspace.sessions.send(session.id, 'Implement task.');
  const peer = f.peers.get(session.id)!,
    token = f.store.lease(session.taskId)!.token;
  peer.stopFails = true;
  await assert.rejects(f.workspace.sessions.interrupt(session.id), /refused to stop/);
  assert.equal(f.store.lease(session.taskId)?.token, token);
  assert.equal(f.store.lease(session.taskId)?.orphaned, 1);
  await assert.rejects(
    f.workspace.sessions.recover(session.id, { confirmedStopped: false }),
    /Confirm/,
  );
  peer.stopFails = false;
  const turns = peer.calls.filter((call) => call.method === 'turn/start').length;
  await f.workspace.sessions.recover(session.id, { confirmedStopped: true });
  assert.equal(f.store.lease(session.taskId), undefined);
  assert.equal(f.workspace.sessions.get(session.id).status, 'paused');
  assert.equal(peer.calls.filter((call) => call.method === 'turn/start').length, turns);
});

test('early completion during turn start stays terminal and a writable sandbox cannot downgrade read-only', async (t) => {
  const f = await fixture(t),
    session = await f.create('Immediate completion', ['.'], true);
  f.workspace.sessions.createClient = () => {
    const peer = new SessionPeer(f.root);
    f.peers.set(session.id, peer);
    peer.onTurn = async (threadId, turnId) => {
      await f.workspace.sessions.notification(session.id, peer, 'turn/started', {
        threadId,
        turn: { id: turnId },
      });
      await f.workspace.sessions.notification(session.id, peer, 'turn/completed', {
        threadId,
        turn: { id: turnId, status: 'completed' },
      });
    };
    return peer;
  };
  assert.equal((await f.workspace.sessions.send(session.id, 'Return immediately.')).status, 'idle');
  const denied = await f.create('Sandbox check', ['.'], true);
  let peer!: SessionPeer;
  f.workspace.sessions.createClient = () => {
    peer = new SessionPeer(f.root);
    f.peers.set(denied.id, peer);
    const request = peer.request.bind(peer);
    peer.request = async (method, params) =>
      method === 'thread/start'
        ? ({
            thread: { id: 'unsafe' },
            sandbox: { type: 'workspaceWrite' },
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          } as any)
        : request(method, params);
    return peer;
  };
  await assert.rejects(f.workspace.sessions.send(denied.id, 'Read only.'), /sandbox/);
  assert.equal(
    peer.calls.some((call) => call.method === 'turn/start'),
    false,
  );
});

test('pause during quota preflight fences the late claim and consumes no model turn', async (t) => {
  const f = await fixture(t),
    session = await f.create('Late claim', ['src']);
  const refresh = f.workspace.quota.refresh.bind(f.workspace.quota);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.workspace.quota.refresh = async (memberId) => {
    entered();
    await gate;
    return refresh(memberId);
  };
  const starting = f.workspace.sessions.send(session.id, 'Do not escape a newer pause.');
  await waiting;
  const rejection = assert.rejects(starting, /cancelled/);
  const pausing = f.workspace.sessions.interrupt(session.id);
  release();
  await rejection;
  assert.equal((await pausing).status, 'paused');
  assert.equal(f.store.lease(session.taskId), undefined);
  assert.equal(f.peers.size, 0);
});

test('pause during turn-start waits for confirmed process stop and retains its fenced lease', async (t) => {
  const f = await fixture(t),
    session = await f.create('Late turn', ['src']);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.workspace.sessions.createClient = () => {
    const peer = new SessionPeer(f.root);
    f.peers.set(session.id, peer);
    peer.onTurn = async () => {
      entered();
      await gate;
    };
    return peer;
  };
  const starting = f.workspace.sessions.send(session.id, 'Start once.');
  await waiting;
  const token = f.store.lease(session.taskId)!.token;
  const pausing = f.workspace.sessions.interrupt(session.id);
  release();
  await starting;
  assert.equal((await pausing).status, 'paused');
  assert.equal(f.store.lease(session.taskId)?.token, token);
  assert.equal(f.workspace.sessions.get(session.id).pid, null);
});

test('MESH tools deliver then mark read, and a current session cannot claim another project message', async (t) => {
  const f = await fixture(t),
    session = await f.create('MESH reader', ['.'], true);
  const running = await f.workspace.sessions.send(session.id, 'Read messages.'),
    peer = f.peers.get(session.id)!;
  const message = f.workspace.mesh.post({
    projectId: f.project.id,
    authorId: null,
    content: '!! Inspect the entry point.',
    kind: 'message',
  });
  await f.workspace.sessions.request(session.id, peer, {
    id: 'read',
    method: 'item/tool/call',
    params: {
      threadId: running.threadId,
      turnId: running.turnId,
      tool: 'mesh_read',
      arguments: {},
    },
  });
  assert.equal(peer.responses.find((response) => response.id === 'read')?.result.success, true);
  assert.ok(
    f.store
      .all<any>('meshCursor')
      .some((cursor) => cursor.memberId === f.member.id && cursor.readThrough >= message.sequence!),
  );
  const second = f.store.put('project', { ...f.project, id: randomUUID(), name: 'Other group' });
  const foreign = f.workspace.mesh.post({
    projectId: second.id,
    authorId: null,
    content: '!! Other group request.',
    kind: 'message',
  });
  await f.workspace.sessions.request(session.id, peer, {
    id: 'claim',
    method: 'item/tool/call',
    params: {
      threadId: running.threadId,
      turnId: running.turnId,
      tool: 'mesh_claim',
      arguments: { messageId: foreign.id },
    },
  });
  assert.equal(peer.responses.find((response) => response.id === 'claim')?.result.success, false);
  assert.equal(f.store.get<any>('message', foreign.id).requestStatus, 'open');
});
