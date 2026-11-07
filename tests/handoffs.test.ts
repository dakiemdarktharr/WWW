import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CodexSession, Handoff, Project, Task } from '../shared/types.ts';
import type { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { Mesh } from '../server/mesh.ts';
import { QuotaManager } from '../server/quota.ts';
import { Handoffs } from '../server/handoffs.ts';
import { Aegis } from '../server/aegis.ts';
import { createWorktree, git } from '../server/git.ts';

const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test'];

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-handoff-test-'));
  const repo = path.join(root, 'repo'),
    remote = path.join(root, 'remote.git'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# Controlled fixture\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [...identity, 'commit', '-m', 'Initial fixture']);
  await git(root, ['init', '--bare', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  const store = new Store(path.join(data, 'state.sqlite'));
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Handoff fixture',
    path: repo,
    goal: 'Preserve ownership without account usage.',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const [sender, recipient] = ['Atlas', 'Vega'].map((name, index) => {
    const member = store.addMember({ name, role: 'engineer' });
    return store.updateMember(member.id, {
      status: 'ready',
      maxSessions: 2,
      account: { type: 'chatgpt', planType: 'plus' },
      owner: {
        login: `owner-${index}`,
        name: `Owner ${index}`,
        email: `owner-${index}@example.test`,
      },
    });
  });
  const task = store.addTask({
    projectId: project.id,
    title: 'Implement handoff artifact',
    description: 'Write one source artifact.',
    kind: 'code',
    priority: 'medium',
    scope: ['src'],
    dependsOn: [],
    acceptance: 'The artifact exists and is verified.',
    assignedTo: sender.id,
  });
  const worktree = await createWorktree(repo, data, task.id);
  store.updateTask(task.id, worktree);
  const source = store.put('session', {
    id: randomUUID(),
    memberId: sender.id,
    projectId: project.id,
    taskId: task.id,
    title: 'Atlas implementation',
    status: 'running',
    readOnly: false,
    threadId: 'controlled-thread',
    turnId: 'controlled-turn',
    pid: 1234,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies CodexSession);
  const lease = store.claim(task.id, sender.id, source.id).lease;
  await mkdir(path.join(worktree.worktree, 'src'));
  await writeFile(
    path.join(worktree.worktree, 'src', 'result.txt'),
    'A reviewable progress checkpoint.\n',
  );
  const client = {
    start: async () => {},
    request: async () => ({
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      },
    }),
  } as unknown as CodexClient;
  const quota = new QuotaManager({
    store,
    closing: false,
    client: async () => client,
    log: () => {},
  });
  for (const member of [sender, recipient])
    quota.ingest(member.id, {
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      },
    });
  store.put('project', { ...project, memberIds: [sender.id, recipient.id] });
  const mesh = new Mesh({ store });
  let interruptions = 0;
  const host = {
    store,
    quota,
    mesh,
    aegis: new Aegis(store, data),
    log: () => {},
    sessions: {
      interrupt: async (id: string) => {
        interruptions++;
        return store.updateSession(id, { status: 'paused', pid: null });
      },
      resume: async (id: string) => store.updateSession(id, { status: 'running' }),
    },
  };
  const handoffs = new Handoffs(host);
  t.after(async () => {
    await quota.close();
    host.aegis.close();
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-handoff-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  return {
    root,
    repo,
    remote,
    data,
    store,
    project,
    sender,
    recipient,
    source,
    lease,
    worktree,
    quota,
    mesh,
    host,
    handoffs,
    get interruptions() {
      return interruptions;
    },
    create() {
      return handoffs.create({
        sessionId: source.id,
        toMemberId: recipient.id,
        summary: 'Source artifact implemented; final tests remain.',
        nextSteps: 'Read src/result.txt, run the acceptance checks, then complete review.',
        testEvidence: 'No fabricated application tests: fixture change only.',
      });
    },
    task() {
      return store.get<Task>('task', task.id);
    },
    handoff(id: string) {
      return store.get<Handoff>('handoff', id);
    },
  };
}

test('a real owner-attributed checkpoint is confirmed on the remote before recipient ACK rotates ownership once', async (t) => {
  const f = await fixture(t);
  const handoff = await f.create();
  assert.equal(handoff.status, 'awaiting_ack');
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
  assert.equal(f.store.get<CodexSession>('session', f.source.id).status, 'handoff');
  assert.equal(f.store.get<CodexSession>('session', f.source.id).pid, null);
  assert.equal(
    (await git(f.worktree.worktree, ['ls-remote', 'origin', `refs/heads/${handoff.branch}`])).split(
      /\s+/,
    )[0],
    handoff.commitSha,
  );
  assert.equal(
    await git(f.worktree.worktree, ['show', '-s', '--format=%an|%ae|%cn', handoff.commitSha!]),
    `${f.sender.owner!.name}|${f.sender.owner!.email}|RELAY`,
  );
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), f.worktree.baseCommit);
  const results = await Promise.allSettled([
    f.handoffs.accept(handoff.id),
    f.handoffs.accept(handoff.id),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const accepted = f.handoff(handoff.id),
    replacement = f.store.lease(f.source.taskId)!;
  assert.equal(accepted.status, 'accepted');
  assert.ok(accepted.toSessionId);
  assert.equal(replacement.memberId, f.recipient.id);
  assert.equal(replacement.sessionId, accepted.toSessionId);
  assert.notEqual(replacement.token, f.lease.token);
  f.store.release(f.source.taskId, f.lease.token);
  assert.equal(f.store.lease(f.source.taskId)!.token, replacement.token);
  assert.equal(f.task().assignedTo, f.recipient.id);
  assert.equal(f.task().worktree, f.worktree.worktree);
  assert.match(f.task().description, /Read src\/result/);
  assert.equal(f.store.get<CodexSession>('session', accepted.toSessionId!).status, 'paused');
  await assert.rejects(f.handoffs.accept(handoff.id), /not ready/);
});

test('failed push keeps the source lease and checkpoint, and an explicit retry can recover', async (t) => {
  const f = await fixture(t);
  await git(f.repo, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  const failed = await f.create();
  assert.equal(failed.status, 'blocked');
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
  assert.equal(f.task().assignedTo, f.sender.id);
  assert.equal(await git(f.root, ['ls-remote', f.remote, `refs/heads/${f.worktree.branch}`]), '');
  assert.notEqual(await git(f.worktree.worktree, ['rev-parse', 'HEAD']), f.worktree.baseCommit);
  await assert.rejects(f.handoffs.accept(failed.id), /not ready/);
  await git(f.repo, ['remote', 'set-url', 'origin', f.remote]);
  assert.equal((await f.handoffs.retry(failed.id)).status, 'awaiting_ack');
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
});

test('uncertain worker termination blocks checkpointing before any Git commit or lease transfer', async (t) => {
  const f = await fixture(t);
  f.host.sessions.interrupt = async () => f.store.get<CodexSession>('session', f.source.id);
  const blocked = await f.create();
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error!, /not confirmed termination/);
  assert.equal(await git(f.worktree.worktree, ['rev-parse', 'HEAD']), f.worktree.baseCommit);
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
  assert.equal(f.store.get<CodexSession>('session', f.source.id).pid, 1234);
});

test('a stale source session cannot checkpoint a newer same-account session ownership', async (t) => {
  const f = await fixture(t),
    newerId = randomUUID(),
    newerToken = randomUUID();
  f.store.put('session', { ...f.source, id: newerId });
  f.store.db
    .prepare('UPDATE leases SET sessionId=?,token=? WHERE taskId=?')
    .run(newerId, newerToken, f.source.taskId);
  f.store.updateTask(f.source.taskId, { sessionId: newerId });
  const blocked = await f.create();
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error!, /ownership changed/);
  assert.equal(f.interruptions, 0);
  assert.equal(f.store.lease(f.source.taskId)!.token, newerToken);
  assert.equal(f.store.lease(f.source.taskId)!.sessionId, newerId);
  assert.equal(await git(f.worktree.worktree, ['rev-parse', 'HEAD']), f.worktree.baseCommit);
});

test('ownership rotated while stopping or awaiting acknowledgement cannot be stolen by the old handoff', async (t) => {
  const f = await fixture(t);
  const handoff = await f.create();
  const newerToken = randomUUID();
  f.store.db.prepare('UPDATE leases SET token=? WHERE taskId=?').run(newerToken, f.source.taskId);
  await assert.rejects(f.handoffs.accept(handoff.id), /ownership changed/);
  assert.equal(f.store.lease(f.source.taskId)!.token, newerToken);
  assert.equal(f.store.sessions().length, 1);
  f.handoffs.cancel(handoff.id);
  assert.equal(f.handoff(handoff.id).status, 'cancelled');
  assert.equal(f.store.lease(f.source.taskId)!.token, newerToken);
  const stop = f.host.sessions.interrupt;
  const rotatedDuringStop = randomUUID();
  f.host.sessions.interrupt = async (id) => {
    const session = await stop(id);
    f.store.db
      .prepare('UPDATE leases SET token=? WHERE taskId=?')
      .run(rotatedDuringStop, f.source.taskId);
    return session;
  };
  const blocked = await f.create();
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error!, /ownership changed/);
  assert.equal(f.store.lease(f.source.taskId)!.token, rotatedDuringStop);
});

test('commit hooks cannot smuggle an out-of-scope file into a pushed checkpoint', async (t) => {
  const f = await fixture(t);
  const hooks = await git(f.worktree.worktree, ['rev-parse', '--git-path', 'hooks']);
  await writeFile(
    path.resolve(f.worktree.worktree, hooks, 'pre-commit'),
    '#!/bin/sh\nprintf "hook change\\n" > outside.txt\ngit add outside.txt\n',
    { mode: 0o755 },
  );
  const blocked = await f.create();
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error!, /outside the task scope/);
  assert.equal(await git(f.root, ['ls-remote', f.remote, `refs/heads/${f.worktree.branch}`]), '');
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
});

test('private paths in root or merge ancestry cannot be pushed even when absent from the final tree', async (t) => {
  const f = await fixture(t);
  const hidden = path.join(f.root, 'hidden-history');
  await mkdir(hidden);
  await git(hidden, ['init', '-b', 'main']);
  await writeFile(path.join(hidden, 'auth.json'), '{"fixture":"not-a-real-credential"}\n');
  await git(hidden, ['add', 'auth.json']);
  await git(hidden, [...identity, 'commit', '-m', 'Unrelated root with private filename']);
  const hiddenSha = await git(hidden, ['rev-parse', 'HEAD']);
  await git(f.worktree.worktree, ['fetch', hidden, 'main']);
  await git(f.worktree.worktree, [
    ...identity,
    'merge',
    '--allow-unrelated-histories',
    '-s',
    'ours',
    '--no-edit',
    hiddenSha,
  ]);
  const blocked = await f.create();
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error!, /Private|outside the task scope/);
  assert.equal(await git(f.root, ['ls-remote', f.remote, `refs/heads/${f.worktree.branch}`]), '');
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
});

test('restart marks incomplete checkpoints blocked without resuming a worker or changing its lease', async (t) => {
  const f = await fixture(t);
  const handoff = await f.create();
  f.store.put('handoff', { ...handoff, status: 'checkpointing' });
  const stops = f.interruptions;
  new Handoffs(f.host);
  const recovered = f.handoff(handoff.id);
  assert.equal(recovered.status, 'blocked');
  assert.match(recovered.error!, /restarted during checkpoint/);
  assert.equal(f.interruptions, stops);
  assert.equal(f.store.lease(f.source.taskId)!.token, f.lease.token);
});

test('automatic handoff checkpoints, transfers the pending chat claim and resumes one recipient', async (t) => {
  const f = await fixture(t);
  const message = f.mesh.post({
    projectId: f.project.id,
    authorId: null,
    kind: 'message',
    content: 'Finish the assigned artifact.',
  });
  f.mesh.claim(message.id, f.sender.id);
  f.store.put('meshDispatch', {
    id: message.id,
    sessionId: f.source.id,
    memberId: f.sender.id,
    projectId: f.project.id,
    status: 'running',
  });
  const result = await f.handoffs.automatic(f.source.id);
  assert.equal(result?.status, 'accepted');
  assert.ok(result?.commitSha);
  assert.equal(f.store.get<CodexSession>('session', result!.toSessionId!).status, 'running');
  assert.equal(f.store.get<any>('meshDispatch', message.id).memberId, f.recipient.id);
  assert.equal(f.store.get<any>('message', message.id).claimedBy, f.recipient.id);
  assert.equal(f.store.get<CodexSession>('session', f.source.id).status, 'stopped');
});

test('read-only automatic handoff preserves saved conversation without fabricating a Git checkpoint', async (t) => {
  const f = await fixture(t);
  f.store.release(f.source.taskId, f.lease.token);
  f.store.updateSession(f.source.id, { readOnly: true });
  f.store.put('sessionEvent', {
    id: randomUUID(),
    sessionId: f.source.id,
    kind: 'user',
    text: 'Compare installer recovery options.',
  });
  const result = await f.handoffs.automatic(f.source.id);
  assert.equal(result?.status, 'accepted');
  assert.equal(result?.commitSha, null);
  assert.match(result!.nextSteps, /Compare installer recovery options/);
  assert.equal(f.store.get<CodexSession>('session', result!.toSessionId!).readOnly, true);
});
