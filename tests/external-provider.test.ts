import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExternalProviders } from '../server/external-provider.ts';
import { Workspace } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { createWorktree, git } from '../server/git.ts';
import type { CodexSession, Project, Task, Workflow } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

async function fixture(t: TestContext, provider: 'claude' | 'antigravity' = 'claude') {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kivuno-external-')));
  const repo = path.join(root, 'repo'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# Initial\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'Initial',
  ]);
  await git(root, ['init', '--bare', 'remote.git']);
  await git(repo, ['remote', 'add', 'origin', path.join(root, 'remote.git')]);
  const store = new Store(path.join(data, 'state.db'));
  const workspace = new Workspace(store, data, repo);
  const raw = store.addMember({ name: 'Claude reviewer', role: 'reviewer' });
  const member = store.updateMember(raw.id, {
    provider,
    integration: 'external',
    owner: { login: 'owner', name: 'Task Owner', email: 'owner@example.test' },
  });
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Mixed team',
    path: repo,
    goal: 'Shared ownership',
    memberIds: [member.id],
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const external = new ExternalProviders(workspace);
  const beforeCleanup: (() => Promise<unknown>)[] = [];
  t.after(async () => {
    for (const close of beforeCleanup) await close();
    external.close();
    await workspace.close();
    store.close();
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('kivuno-external-'));
    await rm(root, { recursive: true, force: true });
  });
  const connect = (options = {}) => {
    const result = external.create({ memberId: member.id, projectId: project.id, ...options });
    const config = Object.values(result.config.mcpServers)[0];
    return { result, header: `Bearer ${config.env.KIVUNO_MCP_TOKEN}`, config };
  };
  const invoke = async (header: string, name: string, args = {}) => {
    const result: any = await external.rpc(header, {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    assert.equal(result.result.isError, false, result.result.content[0].text);
    return JSON.parse(result.result.content[0].text);
  };
  const failure = async (header: string, name: string, args: unknown, pattern: RegExp) => {
    const result: any = await external.rpc(header, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, pattern);
  };
  const task = (title = 'Implement README', scope = ['README.md']) =>
    store.addTask({
      projectId: project.id,
      title,
      description: 'Focused change',
      kind: 'code',
      priority: 'medium',
      scope,
      dependsOn: [],
      acceptance: 'Document verified behavior',
      assignedTo: member.id,
    });
  return {
    root,
    repo,
    store,
    workspace,
    external,
    member,
    project,
    connect,
    invoke,
    failure,
    task,
    beforeCleanup,
  };
}

test('Claude web reads one active project and excludes accounts, paths and secrets', async (t) => {
  const { external, member, project, store, workspace, connect } = await fixture(t);
  const issue = {
    action: 'create',
    memberId: member.id,
    projectId: project.id,
    durationMinutes: 15,
  };
  const grant: any = await external.claudeWeb(issue);
  assert.equal(grant.transport, 'claude-web');
  assert.equal(grant.config, undefined);
  assert.equal(grant.allowTaskClaims, false);
  const token = 'kwc_' + 'b'.repeat(43);
  workspace.mesh.post({
    projectId: project.id,
    authorId: null,
    kind: 'message',
    content: 'Project progress. Bearer ' + token,
  });
  const read = {
    action: 'read',
    connectionId: grant.id,
    projectId: project.id,
    memberId: member.id,
  };
  const reply: any = await external.claudeWeb(read);
  const data = reply.content[0].text;
  assert.match(data, /Project progress/);
  assert.match(data, /REDACTED/);
  assert.ok(
    !data.includes(token) && !data.includes(project.path) && !data.includes('owner@example.test'),
  );
  assert.deepEqual(Object.keys(JSON.parse(data)).sort(), ['messages', 'nextAfter', 'project']);
  const initial = JSON.parse(data);
  const sample = [
    'Review sample: the landing page draft is complete.',
    'Review sample: the demo is blocked until the team chooses a meeting time.',
    'Review sample: the next handoff is to check keyboard navigation.',
  ];
  const added = Array.from({ length: 13 }, (_, index) =>
    workspace.mesh.post({
      projectId: project.id,
      authorId: null,
      kind: 'message',
      content: sample[index] ?? `Review note ${index}`,
    }),
  );
  const readPage = async (after: number) => {
    const page: any = await external.claudeWeb({ ...read, after });
    assert.equal(page.isError, false);
    return JSON.parse(page.content[0].text);
  };
  const firstPage = await readPage(initial.nextAfter);
  assert.deepEqual(firstPage.project, { name: project.name });
  assert.equal(firstPage.messages.length, 12);
  assert.deepEqual(
    firstPage.messages.slice(0, 3).map(({ content }: { content: string }) => content),
    sample,
  );
  assert.equal(firstPage.nextAfter, added[11].sequence);
  const next = await readPage(firstPage.nextAfter);
  assert.deepEqual(next.messages, [
    { sequence: added[12].sequence, kind: 'message', content: added[12].content },
  ]);
  assert.equal(next.nextAfter, added[12].sequence);
  assert.deepEqual((await readPage(next.nextAfter)).messages, []);
  await assert.rejects(external.claudeWeb({ ...read, projectId: randomUUID() }), /another project/);
  await assert.rejects(
    external.claudeWeb({ ...read, connectionId: connect().result.id }),
    /not found/,
  );
  await assert.rejects(
    external.claudeWeb({ ...read, method: 'tools/call', arguments: { name: 'task_claim' } }),
  );
  store.updateMember(member.id, { entitlementLocked: true });
  await assert.rejects(external.claudeWeb(read), /locked/);
  store.updateMember(member.id, { entitlementLocked: false });
  store.put('project', { ...project, memberIds: [] });
  await assert.rejects(external.claudeWeb(read), /group first/);
  store.put('project', project);
  await external.claudeWeb({ action: 'revoke', connectionId: grant.id });
  await assert.rejects(external.claudeWeb(read), /expired or revoked/);
});

test('Sade queues one scoped external review and publishes the reviewer session under its owner', async (t) => {
  const f = await fixture(t);
  const author = f.store.addMember({ name: 'Codex author', role: 'engineer' });
  f.store.put('project', { ...f.project, memberIds: [author.id, f.member.id] });
  const now = new Date().toISOString();
  const workflow = f.store.put('workflow', {
    id: randomUUID(),
    orchestrator: 'sade',
    controlVersion: 0,
    projectId: f.project.id,
    prompt: 'Check the roster',
    status: 'review',
    phase: 'execution',
    leadId: author.id,
    memberIds: [author.id, f.member.id],
    contributions: [],
    plan: null,
    hierarchy: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Workflow);
  const source = f.store.addTask({
    projectId: f.project.id,
    title: 'Roster count',
    description: 'Read the roster.',
    kind: 'research',
    priority: 'medium',
    scope: ['README.md'],
    dependsOn: [],
    acceptance: 'Say how many entries there are.',
    assignedTo: author.id,
    workflowId: workflow.id,
    phase: 'execution',
  });
  f.store.updateTask(source.id, { status: 'review', summary: 'Two entries.' });
  const authorSession = f.workspace.sessions.adopt(source.id, author.id, true);
  f.workspace.sessions.event(authorSession.id, 'agent', 'I found two entries.');
  f.workspace.sessions.event(
    authorSession.id,
    'command',
    'Private tool output should not be shared.',
  );
  const grant = f.workspace.external.create({
    memberId: f.member.id,
    projectId: f.project.id,
    allowTaskClaims: true,
    allowUnknownQuota: true,
    sadeTurns: 1,
  });
  const config = Object.values(grant.config.mcpServers)[0];
  const auth = `Bearer ${config.env.KIVUNO_MCP_TOKEN}`;
  const call = async (name: string, args: unknown = {}) => {
    const result = await f.workspace.external.rpc(auth, {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args, _meta: { progressToken: 'qa' } },
    });
    return (result as any).result;
  };
  const ok = async (name: string, args?: unknown) => {
    const reply = await call(name, args);
    assert.equal(reply.isError, false, reply.content[0].text);
    return JSON.parse(reply.content[0].text);
  };
  assert.deepEqual(await ok('sade_next', { wait: false, take: false }), { available: false });
  await f.workspace.sade.schedule(f.store.get<Task>('task', source.id));
  const offered = await ok('sade_next', { wait: false, take: false });
  assert.equal(offered.available, true);
  assert.equal(f.store.lease(offered.taskId), undefined);
  const review = await ok('sade_next', { wait: false });
  assert.equal(review.session.memberId, f.member.id);
  assert.equal(review.session.readOnly, true);
  assert.equal(review.task.reviewOfTaskId, source.id);
  assert.equal((await ok('sade_next', { wait: false })).session.id, review.session.id);
  const shared = await ok('relay_session_read', { sessionId: authorSession.id });
  assert.equal(shared.session.teammate, author.name);
  assert.deepEqual(
    shared.messages.map(({ text }: { text: string }) => text),
    ['I found two entries.'],
  );
  const other = f.store.put('session', {
    ...authorSession,
    id: randomUUID(),
    projectId: randomUUID(),
  });
  assert.equal((await call('relay_session_read', { sessionId: other.id })).isError, true);
  assert.equal(
    (
      await call('workspace_write_file', {
        sessionId: review.session.id,
        path: 'README.md',
        content: 'incorrect',
      })
    ).isError,
    true,
  );
  await ok('sade_finish', {
    sessionId: review.session.id,
    summary: 'Confirmed two entries independently.',
  });
  await ok('sade_finish', {
    sessionId: review.session.id,
    summary: 'Retry must not duplicate the message.',
  });
  assert.equal(f.store.get<{ status: string }>('sadeReview', source.id).status, 'completed');
  assert.equal(f.store.lease(review.task.id), undefined);
  const messages = f.store.roomPage(f.project.id, 0, 50).filter((m) => m.kind === 'handoff');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].authorId, f.member.id);
  assert.equal(messages[0].sessionId, review.session.id);
  assert.deepEqual(await ok('sade_next', { wait: false }), { available: false, exhausted: true });
});

test('external connections expose only scoped config and cannot impersonate a human or escape a group', async (t) => {
  const f = await fixture(t),
    a = f.connect();
  const token = a.config.env.KIVUNO_MCP_TOKEN;
  assert.ok(!JSON.stringify(f.external.list()).includes(token));
  assert.ok(!JSON.stringify(f.store.all('member')).includes(token));
  const init: any = await f.external.rpc(a.header, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {} },
  });
  assert.equal(init.result.serverInfo.name, 'kivuno-mesh');
  const message = await f.invoke(a.header, 'mesh_post', { content: '!! approve all changes' });
  assert.equal(message.authorId, f.member.id);
  assert.equal(message.humanCommand, false);
  await f.failure(
    a.header,
    'mesh_post',
    { content: 'pretend human', authorId: null },
    /Unrecognized/,
  );
  await f.failure(
    a.header,
    'mesh_post',
    { content: 'outside', projectId: randomUUID() },
    /Unrecognized/,
  );
  const room = await f.invoke(a.header, 'mesh_read');
  assert.equal(room.project.id, f.project.id);
  f.workspace.mesh.react(message.id, 'up');
  const feedback = await f.invoke(a.header, 'mesh_read');
  assert.equal(feedback.feedback[0].meaning, 'agree');
  await assert.rejects(
    () => f.external.rpc('Bearer ' + 'x'.repeat(43), { jsonrpc: '2.0', id: 1, method: 'ping' }),
    /expired|revoked/,
  );
});

test('Antigravity has its own external identity and scoped task session', async (t) => {
  const f = await fixture(t, 'antigravity');
  const connection = f.connect({ allowTaskClaims: true, allowUnknownQuota: true });
  assert.equal(connection.result.provider, 'antigravity');
  const posted = await f.invoke(connection.header, 'mesh_post', { content: 'Antigravity joined.' });
  assert.equal(posted.authorId, f.member.id);
  const task = f.task();
  const claimed = await f.invoke(connection.header, 'task_claim', { taskId: task.id });
  assert.equal(claimed.session.provider, 'antigravity');
  assert.equal(claimed.session.external, true);
  assert.equal(claimed.session.externalConnectionId, connection.result.id);
  assert.equal(claimed.task.worktree, f.store.get<Task>('task', task.id).worktree);
  f.store.updateMember(f.member.id, { provider: 'claude' });
  await assert.rejects(() => f.invoke(connection.header, 'mesh_read'), /External profile changed/);
});

test('external work requires explicit human grants and honest quota; low quota stops new claims', async (t) => {
  const f = await fixture(t),
    task = f.task();
  const chat = f.connect();
  await f.failure(chat.header, 'task_claim', { taskId: task.id }, /chat access/);
  const limited = f.connect({ allowTaskClaims: true });
  await f.failure(limited.header, 'task_claim', { taskId: task.id }, /Quota is unknown/);
  await f.invoke(limited.header, 'usage_report', { remainingPercent: 49, resetsAt: null });
  const allowed = f.connect({ allowTaskClaims: true, allowUnknownQuota: true });
  await f.failure(allowed.header, 'task_claim', { taskId: task.id }, /50%/);
  assert.equal(f.store.all('humanRequest').length, 1);
  assert.equal(f.store.leases().length, 0);
  await f.invoke(limited.header, 'usage_report', { remainingPercent: 80 });
  const claimed = await f.invoke(limited.header, 'task_claim', { taskId: task.id });
  assert.equal(claimed.session.provider, 'claude');
  assert.ok(claimed.task.worktree.startsWith(path.join(f.root, 'data', 'worktrees')));
});

test('external claims are atomic, scoped and cannot overwrite another session', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    b = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task();
  const response = (await Promise.all(
    [a, b].map((c) =>
      f.external.rpc(c.header, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'task_claim', arguments: { taskId: task.id } },
      }),
    ),
  )) as any[];
  assert.equal(response.filter((r) => !r.result.isError).length, 1);
  const lease = f.store.lease(task.id)!;
  assert.equal(f.store.get<Task>('task', task.id).sessionId, lease.sessionId);
  assert.equal(f.store.sessions().length, 1);
  const winner = [a, b][response.findIndex((r) => !r.result.isError)];
  const again = await f.invoke(winner.header, 'task_claim', { taskId: task.id });
  assert.equal(again.session.id, lease.sessionId);
  await f.failure(
    winner.header,
    'task_claim',
    { taskId: f.task('Overlapping change').id },
    /overlap/,
  );
  assert.equal(f.store.sessions().length, 1);
});

test('revocation retains ownership and fences the external worker until manual recovery', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task();
  const claim = await f.invoke(a.header, 'task_claim', { taskId: task.id });
  f.external.revoke(a.result.id);
  assert.equal(f.store.lease(task.id)?.orphaned, 1);
  assert.equal(f.store.get<CodexSession>('session', claim.session.id).status, 'interrupted');
  assert.equal(f.store.get<Task>('task', task.id).status, 'blocked');
  await assert.rejects(
    () => f.external.rpc(a.header, { jsonrpc: '2.0', id: 1, method: 'ping' }),
    /expired|revoked/,
  );
  const b = f.connect({ allowTaskClaims: true, allowUnknownQuota: true });
  await f.failure(b.header, 'task_claim', { taskId: task.id }, /claimed|not ready/);
});

test('external submit checkpoints with owner attribution and retains lease for human review', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task();
  const claimed = await f.invoke(a.header, 'task_claim', { taskId: task.id });
  await writeFile(path.join(claimed.task.worktree, 'README.md'), '# Verified feature\n');
  const submitted = await f.invoke(a.header, 'task_submit', {
    sessionId: claimed.session.id,
    summary: 'README completed',
    testEvidence: 'Reviewed content',
    stoppedWriting: true,
  });
  assert.equal(submitted.needsHumanReview, true);
  assert.equal(f.store.get<Task>('task', task.id).status, 'review');
  assert.ok(f.store.lease(task.id));
  assert.equal(
    await git(claimed.task.worktree, ['show', '-s', '--format=%an <%ae>', 'HEAD']),
    'Task Owner <owner@example.test>',
  );
  assert.ok(
    (await git(f.repo, ['ls-remote', 'origin', `refs/heads/${claimed.task.branch}`])).startsWith(
      submitted.checkpoint.commitSha,
    ),
  );
  assert.equal(await git(f.repo, ['show', 'HEAD:README.md']), '# Initial');
  await f.failure(
    a.header,
    'task_submit',
    { sessionId: claimed.session.id, summary: 'x', testEvidence: 'x', stoppedWriting: false },
    /true/,
  );
});

test('external submit rejects changed files outside assigned scope', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task();
  const claimed = await f.invoke(a.header, 'task_claim', { taskId: task.id });
  await writeFile(path.join(claimed.task.worktree, 'other.txt'), 'Outside scope');
  await f.failure(
    a.header,
    'task_submit',
    { sessionId: claimed.session.id, summary: 'x', testEvidence: 'x', stoppedWriting: true },
    /outside the task scope/,
  );
  assert.equal(f.store.get<Task>('task', task.id).status, 'running');
  assert.ok(f.store.lease(task.id));
});

test('revoked connection during asynchronous authorization cannot obtain a lease', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task();
  let release!: () => void;
  f.workspace.aegis.assertCanRun = async () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const pending = f.external.rpc(a.header, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'task_claim', arguments: { taskId: task.id } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  f.external.revoke(a.result.id);
  release();
  assert.equal(((await pending) as any).result.isError, true);
  assert.equal(f.store.leases().length, 0);
  assert.equal(f.store.sessions().length, 0);
});

test('external wait wakes for a new group message and returns scoped replies', async (t) => {
  const f = await fixture(t),
    a = f.connect();
  const room = await f.invoke(a.header, 'mesh_read');
  const after = Math.max(0, ...room.messages.map((m: any) => m.sequence));
  const waiting = f.invoke(a.header, 'mesh_wait', { after });
  await new Promise((resolve) => setImmediate(resolve));
  const message = f.workspace.mesh.post({
    projectId: f.project.id,
    authorId: null,
    kind: 'message',
    content: 'Please review this idea.',
  });
  const next = await waiting;
  assert.ok(next.messages.some((m: any) => m.id === message.id));
  const reply = await f.invoke(a.header, 'mesh_post', {
    replyTo: message.id,
    content: 'Reviewing the same context.',
  });
  assert.equal(reply.replyTo, message.id);
});

test('external wait returns existing project backlog even after 1001 messages in another room', async (t) => {
  const f = await fixture(t);
  const { header } = f.connect();
  const { messages } = await f.invoke(header, 'mesh_read');
  const after = messages.at(-1)?.sequence ?? 0;
  const message = f.store.message({
    projectId: f.project.id,
    taskId: null,
    authorId: null,
    kind: 'system',
    content: 'Already here.',
  });
  f.store.transaction(() => {
    for (let i = 0; i < 1001; i++)
      f.store.message({
        projectId: 'another-room',
        taskId: null,
        authorId: null,
        kind: 'system',
        content: String(i),
      });
  });
  const next = await Promise.race([
    f.invoke(header, 'mesh_wait', { after }),
    new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined))),
  ]);
  assert.ok(next, 'an available page must return without waiting for a notification');
  assert.deepEqual(
    next.messages.map((entry: { id: string }) => entry.id),
    [message.id],
  );
});

test('external claim preserves a worktree created while its connection is revoked', async (t) => {
  const f = await fixture(t),
    task = f.task();
  let created!: () => void, release!: () => void;
  const prepared = new Promise<void>((resolve) => {
    created = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const external = new ExternalProviders(f.workspace, async (...args) => {
    const result = await createWorktree(...args);
    created();
    await resume;
    return result;
  });
  f.beforeCleanup.push(async () => external.close());
  const connection = external.create({
    memberId: f.member.id,
    projectId: f.project.id,
    allowTaskClaims: true,
    allowUnknownQuota: true,
  });
  const config = Object.values(connection.config.mcpServers)[0];
  const pending = external.rpc(`Bearer ${config.env.KIVUNO_MCP_TOKEN}`, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'task_claim', arguments: { taskId: task.id } },
  });
  await prepared;
  const pendingSession = f.store.get<Task>('task', task.id).sessionId!;
  await assert.rejects(
    () => f.workspace.sessions.recover(pendingSession, { confirmedStopped: true }),
    /recovery|progress/i,
  );
  external.revoke(connection.id);
  await assert.rejects(
    () => f.workspace.sessions.recover(pendingSession, { confirmedStopped: true }),
    /progress/i,
  );
  release();
  assert.equal(((await pending) as any).result.isError, true);
  const preserved = f.store.get<Task>('task', task.id);
  assert.ok(preserved.worktree);
  assert.ok(preserved.branch);
  assert.equal(preserved.status, 'ready');
  const next = f.connect({ allowTaskClaims: true, allowUnknownQuota: true });
  const claimed = await f.invoke(next.header, 'task_claim', { taskId: task.id });
  assert.equal(claimed.task.worktree, preserved.worktree);
});

test('provider credential files and OAuth token content cannot be pushed by external tasks', async (t) => {
  const f = await fixture(t),
    a = f.connect({ allowTaskClaims: true, allowUnknownQuota: true }),
    task = f.task('Broad scope', ['.']);
  const claimed = await f.invoke(a.header, 'task_claim', { taskId: task.id });
  for (const name of [
    '.gemini/oauth_creds.json',
    '.claude/.credentials.json',
    '.mcp.json',
    '.agents/mcp_config.json',
    'oauth_creds.json',
    'copied-settings.json',
    'copied-mesh.json',
  ]) {
    const target = path.join(claimed.task.worktree, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({
        [name === 'copied-mesh.json' ? 'KIVUNO_MCP_TOKEN' : 'refresh_token']:
          'controlled-fixture-not-a-real-token-0123456789',
      }),
    );
    await f.failure(
      a.header,
      'task_submit',
      {
        sessionId: claimed.session.id,
        summary: 'should block',
        testEvidence: 'fixture',
        stoppedWriting: true,
      },
      /private|credentials/i,
    );
    assert.equal(
      await git(f.repo, ['ls-remote', 'origin', `refs/heads/${claimed.task.branch}`]),
      '',
    );
    await rm(target);
  }
});

test('real stdio MCP transport authenticates a scoped local HTTP endpoint without desktop credentials', async (t) => {
  const f = await fixture(t);
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const desktopSecret = 'test-desktop-secret-' + randomUUID();
  const app = await buildApp(f.workspace, { port, desktopSecret });
  f.beforeCleanup.push(() => app.close());
  await app.listen({ port, host: '127.0.0.1' });
  const headers = { host: `127.0.0.1:${port}`, 'x-relay-desktop': desktopSecret };
  const login = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.equal(login.statusCode, 200);
  const ownerHeaders = {
    ...headers,
    cookie: login.headers['set-cookie']!.toString().split(';')[0],
    'x-relay-token': login.json().token,
    'content-type': 'application/json',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/external-connections',
    headers: ownerHeaders,
    payload: { memberId: f.member.id, projectId: f.project.id },
  });
  assert.equal(created.statusCode, 200, created.body);
  const config: any = Object.values(created.json().config.mcpServers)[0];
  const bearer = `Bearer ${config.env.KIVUNO_MCP_TOKEN}`;
  const rpc = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const extra of [
    { origin: `http://127.0.0.1:${port}` },
    { host: 'evil.example' },
    { authorization: 'Bearer ' + 'x'.repeat(43) },
  ]) {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/external-agent/rpc',
      headers: { host: headers.host, authorization: bearer, ...extra },
      payload: rpc,
    });
    assert.ok([401, 403].includes(denied.statusCode), denied.body);
  }
  const remote = await app.inject({
    method: 'POST',
    url: '/api/external-agent/rpc',
    headers: { host: headers.host, authorization: bearer },
    remoteAddress: '10.1.2.3',
    payload: rpc,
  });
  assert.equal(remote.statusCode, 403);
  for (let count = 0; count < 100; count++) {
    const ping = await app.inject({
      method: 'POST',
      url: '/api/external-agent/rpc',
      headers: { host: headers.host, authorization: bearer },
      payload: rpc,
    });
    assert.equal(ping.statusCode, 200, `One HTTP request consumes one rate-limit slot: ${count}`);
  }
  const state = await app.inject({
    method: 'GET',
    url: '/api/state',
    headers: { host: headers.host, authorization: bearer },
  });
  assert.equal(state.statusCode, 403);
  const child = spawn(config.command, config.args, {
    windowsHide: true,
    stdio: 'pipe',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...config.env },
  });
  t.after(() => {
    child.kill();
  });
  const responses = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const value = JSON.parse(line);
    responses.get(value.id)?.resolve(value);
    responses.delete(value.id);
  });
  let sequence = 0;
  const request = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const number = ++sequence;
      const timer = setTimeout(() => reject(new Error('MCP transport timed out')), 15000);
      responses.set(number, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject,
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: number, method, ...(params ? { params } : {}) }) +
          '\n',
      );
    });
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'controlled-fixture', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'kivuno-mesh');
  const listed = await request('tools/list');
  assert.ok(listed.result.tools.some((tool: any) => tool.name === 'task_claim'));
  assert.ok(!listed.result.tools.some((tool: any) => /merge|approve|spend/.test(tool.name)));
  const post = await request('tools/call', {
    name: 'mesh_post',
    arguments: { content: 'Cross-provider protocol verified' },
    _meta: { progressToken: 'claude-request-1' },
  });
  assert.equal(post.result.isError, false);
  assert.equal(JSON.parse(post.result.content[0].text).authorId, f.member.id);
  const unexpectedArgument = await request('tools/call', {
    name: 'mesh_post',
    arguments: { content: 'Invalid tool argument', _meta: { progressToken: 'nested' } },
    _meta: { progressToken: 'claude-request-2' },
  });
  assert.equal(unexpectedArgument.result.isError, true);
  const revoke = await app.inject({
    method: 'POST',
    url: `/api/external-connections/${created.json().id}/revoke`,
    headers: ownerHeaders,
    payload: {},
  });
  assert.equal(revoke.statusCode, 200);
  const denied = await request('ping');
  assert.match(denied.error.message, /expired/);
  child.stdin.end();
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
});
