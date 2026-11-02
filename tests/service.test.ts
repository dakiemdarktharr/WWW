import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { git } from '../server/git.ts';
import { buildApp } from '../server/app.ts';
import type { Member, Project, RoomMessage, Task } from '../shared/types.ts';

/** Controlled protocol double: no child process, network connection, login or paid turn. */
class ControlledCodex extends CodexClient {
  calls: { method: string; params: any }[] = [];
  responses: { id: string | number; result: any }[] = [];
  rejections: { id: string | number; message?: string }[] = [];
  stopCalls = 0;
  stopFails = false;
  failTurn = false;
  beforeStop?: () => void;
  beforeThreadResponse?: () => Promise<void>;
  onTurn?: (threadId: string, turnId: string) => Promise<void>;
  threadId = 'controlled-thread';
  turnId = 'controlled-turn';
  constructor(directory: string) {
    super({ home: path.join(directory, 'profile'), cwd: directory });
  }
  override async start(): Promise<void> {}
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.calls.push({ method, params });
    let result: unknown = {};
    if (method === 'account/read')
      result = { account: { type: 'chatgpt', email: 'controlled@example.test', planType: 'plus' } };
    else if (method === 'thread/start') {
      if (this.beforeThreadResponse) await this.beforeThreadResponse();
      result = {
        thread: { id: this.threadId },
        sandbox: { type: 'workspaceWrite' },
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      };
    } else if (method === 'turn/start') {
      if (this.onTurn) await this.onTurn(params.threadId, this.turnId);
      if (this.failTurn) throw new Error('Codex request timed out: turn/start');
      result = { turn: { id: this.turnId } };
    }
    return result as T;
  }
  override respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }
  override rejectRequest(id: string | number, message?: string): void {
    this.rejections.push({ id, message });
  }
  override async stop(): Promise<void> {
    this.stopCalls++;
    this.beforeStop?.();
    if (this.stopFails) throw new Error('Controlled process refused to stop.');
  }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-service-test-'));
  const repo = path.join(root, 'repo'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# Controlled repository\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [
    '-c',
    'user.name=RELAY test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'Initial fixture',
  ]);
  const store = new Store(path.join(data, 'workspace.sqlite'));
  const workspace = new Workspace(store, data, repo);
  const project: Project = store.put('project', {
    id: randomUUID(),
    name: 'Controlled project',
    path: repo,
    goal: 'Test orchestration without model calls.',
    createdAt: new Date().toISOString(),
  });
  const initial = store.addMember({ name: 'Controlled engineer', role: 'engineer' });
  const member = store.updateMember(initial.id, {
    status: 'ready',
    account: { type: 'chatgpt', planType: 'plus', email: 'controlled@example.test' },
  });
  const client = new ControlledCodex(root);
  workspace.clients.set(member.id, client);
  workspace.client = async () => client;
  workspace.refresh = async (memberId) =>
    store.updateMember(memberId, {
      status: 'ready',
      account: { type: 'chatgpt', email: 'controlled@example.test', planType: 'plus' },
    });
  t.after(async () => {
    client.stopFails = false;
    client.beforeStop = undefined;
    await workspace.close();
    for (const run of workspace.running.values()) clearInterval(run.heartbeat);
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-service-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  const task = (title = 'Controlled task', extra: Partial<Parameters<Store['addTask']>[0]> = {}) =>
    store.addTask({
      projectId: project.id,
      title,
      description: 'Change only the assigned scope.',
      kind: 'code',
      priority: 'medium',
      scope: ['src'],
      dependsOn: [],
      acceptance: 'Expected artifact exists.',
      ...extra,
    });
  const complete = async (taskId: string) => {
    await workspace.notification(member.id, 'item/completed', {
      threadId: client.threadId,
      turnId: client.turnId,
      item: { type: 'agentMessage', text: 'Implemented and verified the controlled change.' },
    });
    await workspace.notification(member.id, 'turn/completed', {
      threadId: client.threadId,
      turn: { id: client.turnId, status: 'completed', error: null },
    });
    return store.get<Task>('task', taskId);
  };
  return { root, repo, data, store, workspace, project, member, client, task, complete };
}

test('a completed worker retains its scope lease until explicit integration', async (t) => {
  const f = await fixture(t),
    task = f.task();
  const running = await f.workspace.run(task.id, f.member.id);
  assert.equal(running.status, 'running');
  assert.ok(running.worktree);
  await mkdir(path.join(running.worktree!, 'src'));
  await writeFile(path.join(running.worktree!, 'src', 'result.txt'), 'verified result\n');
  const lease = f.store.lease(task.id)!;
  assert.equal((await f.complete(task.id)).status, 'review');
  assert.equal(f.store.lease(task.id)?.token, lease.token);
  assert.equal(f.workspace.running.has(f.member.id), false);
  assert.equal(f.store.get<Member>('member', f.member.id).status, 'ready');
  const accepted = await f.workspace.accept(task.id);
  assert.equal(accepted.status, 'done');
  assert.equal(f.store.lease(task.id), undefined);
  assert.equal(
    (await readFile(path.join(f.repo, 'src', 'result.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    'verified result\n',
  );
});

test('explicit review feedback releases the lease and preserves the worktree for revision', async (t) => {
  const f = await fixture(t),
    task = f.task();
  const running = await f.workspace.run(task.id, f.member.id);
  await f.complete(task.id);
  const app = await buildApp(f.workspace);
  t.after(async () => {
    await app.close();
  });
  const session = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4317' },
  });
  const cookie = String(session.headers['set-cookie']).split(';')[0];
  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/' + task.id + '/revise',
    headers: {
      host: '127.0.0.1:4317',
      cookie,
      'x-relay-token': session.json().token,
      'content-type': 'application/json',
    },
    payload: { feedback: 'Add a regression test before integration.' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(f.store.lease(task.id), undefined);
  const revised = f.store.get<Task>('task', task.id);
  assert.equal(revised.status, 'ready');
  assert.equal(revised.worktree, running.worktree);
  assert.match(revised.description, /Add a regression test/);
  assert.equal(f.store.all<RoomMessage>('message').at(-1)?.authorId, null);
});

test('a fast completion before turn/start resolves cannot be overwritten back to running', async (t) => {
  const f = await fixture(t),
    task = f.task();
  f.client.onTurn = async (threadId, turnId) => {
    await f.workspace.notification(f.member.id, 'turn/started', { threadId, turn: { id: turnId } });
    await f.workspace.notification(f.member.id, 'turn/completed', {
      threadId,
      turn: { id: turnId, status: 'completed', error: null },
    });
  };
  const result = await f.workspace.run(task.id, f.member.id);
  assert.equal(result.status, 'review');
  assert.equal(result.threadId, f.client.threadId);
  assert.equal(result.turnId, f.client.turnId);
  assert.ok(f.store.lease(task.id));
});

test('a timed-out turn start stops the owning client before releasing its lease', async (t) => {
  const f = await fixture(t),
    task = f.task();
  f.client.failTurn = true;
  let observedLockedDuringStop = false;
  f.client.beforeStop = () => {
    observedLockedDuringStop = !!f.store.lease(task.id);
  };
  await assert.rejects(f.workspace.run(task.id, f.member.id), /timed out/);
  assert.equal(observedLockedDuringStop, true);
  assert.equal(f.client.stopCalls, 1);
  assert.equal(f.store.lease(task.id), undefined);
  assert.equal(f.store.get<Task>('task', task.id).status, 'blocked');
});

test('a failed shutdown after a start timeout keeps an orphan lease', async (t) => {
  const f = await fixture(t),
    task = f.task();
  f.client.failTurn = true;
  f.client.stopFails = true;
  await assert.rejects(f.workspace.run(task.id, f.member.id), /timed out/);
  const lease = f.store.lease(task.id);
  assert.equal(lease?.orphaned, 1);
  assert.equal(f.store.owns(task.id, lease!.token), false);
  assert.equal(f.store.get<Task>('task', task.id).status, 'blocked');
  assert.match(f.store.get<Task>('task', task.id).error!, /remains locked/);
});

test('coordinator shutdown retains orphan locks for workers that cannot be stopped', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  f.client.stopFails = true;
  await f.workspace.close();
  assert.equal(f.store.lease(task.id)?.orphaned, 1);
  assert.equal(f.store.get<Task>('task', task.id).status, 'blocked');
  assert.equal(f.workspace.snapshot().runtime.recoveryRequired, true);
});

test('foreign thread events cannot complete or write output to the current task', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  const messages = f.store.all('message').length;
  await f.workspace.notification(f.member.id, 'item/completed', {
    threadId: 'foreign-thread',
    turnId: f.client.turnId,
    item: { type: 'agentMessage', text: 'Foreign result' },
  });
  await f.workspace.notification(f.member.id, 'turn/completed', {
    threadId: 'foreign-thread',
    turn: { id: f.client.turnId, status: 'completed' },
  });
  assert.equal(f.store.get<Task>('task', task.id).status, 'running');
  assert.equal(f.workspace.running.get(f.member.id)?.buffer, '');
  assert.equal(f.store.all('message').length, messages);
});

test('foreign turn output and tool requests cannot affect a current run in the same thread', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  const messages = f.store.all('message').length;
  await f.workspace.notification(f.member.id, 'item/agentMessage/delta', {
    threadId: f.client.threadId,
    turnId: 'stale-turn',
    delta: 'Stale output',
  });
  await f.workspace.workerRequest(f.member.id, f.client, {
    id: 'stale-request',
    method: 'item/tool/call',
    params: {
      threadId: f.client.threadId,
      turnId: 'stale-turn',
      tool: 'relay_report',
      arguments: { kind: 'progress', content: 'Stale progress' },
    },
  });
  assert.equal(f.workspace.running.get(f.member.id)?.buffer, '');
  assert.equal(f.store.all('message').length, messages);
  assert.ok(f.client.rejections.some((rejection) => rejection.id === 'stale-request'));
});

test('fenced ownership rejects late completion and room reports without altering the new lease', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  const old = f.store.lease(task.id)!;
  f.store.release(task.id, old.token);
  f.store.updateTask(task.id, { status: 'ready' });
  f.store.updateMember(f.member.id, { status: 'ready' });
  const replacement = f.store.claim(task.id, f.member.id).lease;
  await f.workspace.notification(f.member.id, 'turn/completed', {
    threadId: f.client.threadId,
    turn: { id: f.client.turnId, status: 'completed' },
  });
  await f.workspace.workerRequest(f.member.id, f.client, {
    id: 'fenced-request',
    method: 'item/tool/call',
    params: {
      threadId: f.client.threadId,
      turnId: f.client.turnId,
      tool: 'relay_report',
      arguments: { kind: 'handoff', content: 'Must not publish.' },
    },
  });
  assert.equal(f.store.lease(task.id)?.token, replacement.token);
  assert.equal(f.store.get<Task>('task', task.id).status, 'running');
  assert.equal(
    f.store.all<RoomMessage>('message').some((message) => message.content === 'Must not publish.'),
    false,
  );
  assert.ok(f.client.rejections.some((rejection) => rejection.id === 'fenced-request'));
});

test('dynamic room tools scope messages and assignments to the active project', async (t) => {
  const f = await fixture(t),
    task = f.task();
  const otherProject = f.store.put('project', {
    ...f.project,
    id: randomUUID(),
    name: 'Other room',
  });
  const otherTask = f.task('Unrelated task', { projectId: otherProject.id });
  f.store.message({
    projectId: otherProject.id,
    taskId: otherTask.id,
    authorId: null,
    kind: 'message',
    content: 'Other room private context.',
  });
  await f.workspace.run(task.id, f.member.id);
  await f.workspace.workerRequest(f.member.id, f.client, {
    id: 'report',
    method: 'item/tool/call',
    params: {
      threadId: f.client.threadId,
      turnId: f.client.turnId,
      tool: 'relay_report',
      arguments: {
        kind: 'progress',
        content: 'Owned scope is progressing.',
        projectId: otherProject.id,
      },
    },
  });
  const report = f.store.all<RoomMessage>('message').at(-1)!;
  assert.equal(report.projectId, f.project.id);
  assert.equal(report.taskId, task.id);
  assert.equal(report.authorId, f.member.id);
  await f.workspace.workerRequest(f.member.id, f.client, {
    id: 'read',
    method: 'item/tool/call',
    params: {
      threadId: f.client.threadId,
      turnId: f.client.turnId,
      tool: 'relay_read_room',
      arguments: {},
    },
  });
  const response = f.client.responses.find((reply) => reply.id === 'read')!;
  const context = JSON.parse(response.result.contentItems[0].text);
  assert.equal(
    context.assignments.some((assignment: any) => assignment.id === otherTask.id),
    false,
  );
  assert.equal(
    context.messages.some((message: any) => message.projectId === otherProject.id),
    false,
  );
});

test('execution and file-change approvals wait for a human decision and are single-use', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
  ]) {
    const requestId = method + '-id';
    await f.workspace.workerRequest(f.member.id, f.client, {
      id: requestId,
      method,
      params: {
        threadId: f.client.threadId,
        turnId: f.client.turnId,
        command: 'node verify.mjs',
        reason: 'Requires approval',
        accessToken: 'private-test-value',
      },
    });
    assert.equal(
      f.client.responses.some((response) => response.id === requestId),
      false,
    );
    const approval = [...f.workspace.approvals.values()].find(
      (value) => value.requestId === requestId,
    )!;
    assert.ok(approval);
    assert.equal(JSON.stringify(approval.public).includes('private-test-value'), false);
    assert.deepEqual(f.workspace.decide(approval.public.id, 'accept'), { ok: true });
    assert.deepEqual(f.client.responses.at(-1), { id: requestId, result: { decision: 'accept' } });
    assert.throws(() => f.workspace.decide(approval.public.id, 'accept'), /no longer pending/);
  }
});

test('an approval from fenced ownership cannot authorize the old worker', async (t) => {
  const f = await fixture(t),
    task = f.task();
  await f.workspace.run(task.id, f.member.id);
  await f.workspace.workerRequest(f.member.id, f.client, {
    id: 'pending-old',
    method: 'item/commandExecution/requestApproval',
    params: { threadId: f.client.threadId, turnId: f.client.turnId, command: 'node verify.mjs' },
  });
  const approval = [...f.workspace.approvals.values()][0];
  f.store.db.prepare('UPDATE leases SET orphaned=1 WHERE taskId=?').run(task.id);
  assert.throws(() => f.workspace.decide(approval.public.id, 'accept'));
  assert.equal(
    f.client.responses.some(
      (response) => response.id === 'pending-old' && response.result.decision === 'accept',
    ),
    false,
  );
});

test('concurrent login attempts reserve the sign-in slot before awaiting client startup', async (t) => {
  const f = await fixture(t);
  const other = f.store.addMember({ name: 'Second profile', role: 'reviewer' });
  let resume!: (client: CodexClient) => void;
  const gate = new Promise<CodexClient>((resolve) => {
    resume = resolve;
  });
  let clientCalls = 0;
  f.workspace.client = async () => {
    clientCalls++;
    return gate;
  };
  const first = f.workspace.login(f.member.id, 'browser');
  try {
    assert.equal(f.workspace.loginOwner, f.member.id);
    await assert.rejects(f.workspace.login(other.id, 'browser'), /pending sign-in/);
    await assert.rejects(f.workspace.login(f.member.id, 'device'), /pending sign-in/);
    assert.equal(clientCalls, 1);
    assert.equal(
      f.client.calls.some((call) => call.method === 'account/login/start'),
      false,
    );
  } finally {
    resume(f.client);
  }
  await first;
  const starts = f.client.calls.filter((call) => call.method === 'account/login/start');
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].params, { type: 'chatgpt' });
  assert.equal(f.workspace.loginOwner, f.member.id);
});

test('case-insensitive private filenames block integration while preserving review and ownership', async (t) => {
  const f = await fixture(t),
    task = f.task('Private path guard', { scope: ['.'] });
  const running = await f.workspace.run(task.id, f.member.id);
  await writeFile(path.join(running.worktree!, 'AUTH.JSON'), '{"fixture":true}\n');
  await f.complete(task.id);
  const token = f.store.lease(task.id)!.token;
  const originalHead = await git(f.repo, ['rev-parse', 'HEAD']);
  await assert.rejects(f.workspace.accept(task.id), /private files/);
  assert.equal(f.store.get<Task>('task', task.id).status, 'review');
  assert.equal(f.store.lease(task.id)?.token, token);
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), originalHead);
  assert.equal(await git(f.repo, ['ls-files', '--', 'AUTH.JSON']), '');
});

test('an unbound run ignores stale thread completion and rejects room requests until its own thread is known', async (t) => {
  const f = await fixture(t),
    task = f.task('Bind the new worker thread');
  let releaseThread!: () => void;
  let enteredResolve!: () => void;
  let enteredReject!: (reason: unknown) => void;
  const threadGate = new Promise<void>((resolve) => {
    releaseThread = resolve;
  });
  const threadEntered = new Promise<void>((resolve, reject) => {
    enteredResolve = resolve;
    enteredReject = reject;
  });
  f.client.beforeThreadResponse = async () => {
    enteredResolve();
    await threadGate;
  };
  const pending = f.workspace.run(task.id, f.member.id);
  void pending.catch(enteredReject);
  await threadEntered;
  try {
    const run = f.workspace.running.get(f.member.id)!;
    assert.equal(run.threadId, undefined);
    const messageCount = f.store.all('message').length;
    await f.workspace.notification(f.member.id, 'item/completed', {
      threadId: 'old-thread',
      turnId: 'old-turn',
      item: { type: 'agentMessage', text: 'Stale output from the previous task.' },
    });
    await f.workspace.notification(f.member.id, 'turn/completed', {
      threadId: 'old-thread',
      turn: { id: 'old-turn', status: 'completed' },
    });
    await f.workspace.workerRequest(f.member.id, f.client, {
      id: 'old-room-request',
      method: 'item/tool/call',
      params: {
        threadId: 'old-thread',
        turnId: 'old-turn',
        tool: 'relay_report',
        arguments: { kind: 'handoff', content: 'Stale handoff must not enter the new task.' },
      },
    });
    assert.equal(run.threadId, undefined);
    assert.equal(run.finished, false);
    assert.equal(run.buffer, '');
    assert.equal(f.store.get<Task>('task', task.id).status, 'running');
    assert.equal(f.store.all('message').length, messageCount);
    assert.ok(f.client.rejections.some((rejection) => rejection.id === 'old-room-request'));
  } finally {
    releaseThread();
  }
  const result = await pending;
  assert.equal(result.status, 'running');
  assert.equal(result.threadId, f.client.threadId);
  assert.equal(f.workspace.running.get(f.member.id)?.threadId, f.client.threadId);
});
