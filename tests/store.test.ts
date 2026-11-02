import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import type { Member, Project, Task } from '../shared/types.ts';
import { Store } from '../server/store.ts';
import { normalizeScope, scopesOverlap } from '../server/security.ts';

interface ClaimWorkerData {
  operation: 'claim';
  filename: string;
  taskId: string;
  memberId: string;
  gate: SharedArrayBuffer;
}

// Run the same file as a worker to race two independent SQLite connections.
if (!isMainThread && (workerData as ClaimWorkerData).operation === 'claim') {
  const input = workerData as ClaimWorkerData;
  const store = new Store(input.filename);
  parentPort!.postMessage({ type: 'ready' });
  Atomics.wait(new Int32Array(input.gate), 0, 0);
  try {
    const result = store.claim(input.taskId, input.memberId);
    parentPort!.postMessage({ type: 'result', ok: true, token: result.lease.token });
  } catch (error) {
    parentPort!.postMessage({ type: 'result', ok: false, error: (error as Error).message });
  } finally {
    store.close();
  }
} else {
  async function fixture(t: TestContext) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'relay-store-test-'));
    const filename = path.join(root, 'workspace.sqlite');
    let current = new Store(filename);
    const project: Project = {
      id: 'project-one',
      name: 'Example',
      path: root,
      goal: 'Ship a tested change',
      createdAt: new Date().toISOString(),
    };
    current.put('project', project);
    t.after(async () => {
      current.close();
      const actual = await realpath(root);
      const tempRoot = await realpath(os.tmpdir());
      assert.equal(path.dirname(actual), tempRoot);
      assert.ok(path.basename(actual).startsWith('relay-store-test-'));
      await rm(actual, { recursive: true, force: true });
    });
    return {
      filename,
      project,
      get store() {
        return current;
      },
      reopen() {
        current.close();
        current = new Store(filename);
        return current;
      },
      member(name = 'Engineer') {
        const member = current.addMember({ name, role: 'engineer' });
        return current.updateMember(member.id, {
          status: 'ready',
          account: { type: 'chatgpt', email: `${member.id}@example.test`, planType: 'plus' },
        });
      },
      task(title: string, options: Partial<Parameters<Store['addTask']>[0]> = {}) {
        return current.addTask({
          projectId: project.id,
          title,
          description: 'A bounded task',
          kind: 'code',
          priority: 'medium',
          scope: ['src'],
          dependsOn: [],
          acceptance: 'Tests pass',
          ...options,
        });
      },
    };
  }

  async function concurrentClaims(
    t: TestContext,
    filename: string,
    requests: { taskId: string; memberId: string }[],
  ) {
    const gate = new SharedArrayBuffer(4);
    const ready: Promise<void>[] = [];
    const results: Promise<{ ok: boolean; error?: string; token?: string }>[] = [];
    const exits: Promise<void>[] = [];
    const workers = requests.map((request) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { operation: 'claim', filename, ...request, gate } satisfies ClaimWorkerData,
      });
      ready.push(
        new Promise((resolve, reject) => {
          worker.on('message', (message) => {
            if (message.type === 'ready') resolve();
          });
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Claim worker exited ${code}`));
          });
        }),
      );
      results.push(
        new Promise((resolve, reject) => {
          worker.on('message', (message) => {
            if (message.type === 'result') resolve(message);
          });
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Claim worker exited ${code}`));
          });
        }),
      );
      exits.push(
        new Promise((resolve, reject) => {
          worker.on('error', reject);
          worker.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`Claim worker exited ${code}`)),
          );
        }),
      );
      return worker;
    });
    t.after(async () => {
      await Promise.all(workers.map((worker) => worker.terminate()));
    });
    await Promise.all(ready);
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0, workers.length);
    const output = await Promise.all(results);
    await Promise.all(exits);
    return output;
  }

  test('competing SQLite clients can claim a task only once', { timeout: 20000 }, async (t) => {
    const f = await fixture(t);
    const a = f.member('A'),
      b = f.member('B'),
      task = f.task('Build the parser');
    const results = await concurrentClaims(t, f.filename, [
      { taskId: task.id, memberId: a.id },
      { taskId: task.id, memberId: b.id },
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.equal(f.store.leases().length, 1);
    const saved = f.store.get<Task>('task', task.id);
    assert.equal(saved.status, 'running');
    assert.equal(saved.assignedTo, f.store.lease(task.id)!.memberId);
    assert.equal(f.store.members().filter((member) => member.status === 'working').length, 1);
  });

  test('one profile cannot own two tasks even across projects', async (t) => {
    const f = await fixture(t),
      member = f.member();
    const first = f.task('First', { scope: ['src/a'] });
    const projectTwo = { ...f.project, id: 'project-two' };
    f.store.put('project', projectTwo);
    const second = f.task('Second', { projectId: projectTwo.id, scope: ['src/b'] });
    f.store.claim(first.id, member.id);
    // Even stale UI/runtime state must not override the lease uniqueness rule.
    f.store.updateMember(member.id, { status: 'ready' });
    assert.throws(() => f.store.claim(second.id, member.id), /already owns/);
    assert.equal(f.store.get<Task>('task', second.id).status, 'ready');
    assert.equal(f.store.leases().length, 1);
  });

  test('ancestor scopes conflict while sibling names remain independent', async (t) => {
    const f = await fixture(t),
      a = f.member('A'),
      b = f.member('B');
    const first = f.task('Own src', { scope: ['src/api'] });
    const child = f.task('Child', { scope: ['src/api/routes.ts'] });
    const sibling = f.task('Sibling', { scope: ['src/api-client'] });
    f.store.claim(first.id, a.id);
    assert.throws(() => f.store.claim(child.id, b.id), /Scope overlaps/);
    assert.equal(f.store.get<Member>('member', b.id).status, 'ready');
    f.store.claim(sibling.id, b.id);
    assert.equal(f.store.leases().length, 2);
    assert.equal(scopesOverlap(['.'], ['docs/report.md']), true);
    assert.equal(scopesOverlap(['src/API'], ['src/api/routes.ts']), true);
    assert.equal(scopesOverlap(['src/api-client'], ['src/api']), false);
  });

  test('scope normalization rejects traversal and protected coordination paths', () => {
    assert.equal(normalizeScope(' src\\components/ '), 'src/components');
    assert.equal(normalizeScope('*'), '.');
    for (const scope of [
      '../secrets',
      '/absolute',
      'C:/repo',
      'src/../auth',
      '.git/config',
      'src/.relay/state',
      'src/*',
      'src//api',
      'a\u0000b',
    ]) {
      assert.throws(() => normalizeScope(scope), /Scope must be/);
    }
  });

  test('dependencies block dispatch until accepted as done, including review state', async (t) => {
    const f = await fixture(t),
      member = f.member();
    const upstream = f.task('Contract', { scope: ['contracts'] });
    const downstream = f.task('Client', { scope: ['client'], dependsOn: [upstream.id] });
    for (const status of ['ready', 'running', 'review', 'blocked'] as const) {
      f.store.updateTask(upstream.id, { status });
      assert.throws(
        () => f.store.claim(downstream.id, member.id),
        /Dependencies must be integrated/,
      );
      assert.equal(f.store.leases().length, 0);
    }
    f.store.updateTask(upstream.id, { status: 'done' });
    assert.equal(f.store.claim(downstream.id, member.id).task.status, 'running');
  });

  test('unfinished duplicate titles are rejected after case and whitespace normalization', async (t) => {
    const f = await fixture(t);
    const first = f.task('Build the parser');
    assert.throws(() => f.task('  BUILD   THE  parser  '), /unfinished task/);
    assert.equal(f.store.tasks().length, 1);
    f.store.updateTask(first.id, { status: 'done' });
    assert.notEqual(f.task('Build the parser').id, first.id);
  });

  test('dependency edits reject self cycles, indirect cycles, and another project', async (t) => {
    const f = await fixture(t);
    const a = f.task('A'),
      b = f.task('B', { dependsOn: [a.id] }),
      c = f.task('C', { dependsOn: [b.id] });
    assert.throws(() => f.store.validateDependencies(a.id, [a.id]), /cycle/);
    assert.throws(() => f.store.validateDependencies(a.id, [c.id]), /cycle/);
    assert.doesNotThrow(() => f.store.validateDependencies(c.id, [a.id, b.id]));
    f.store.put('project', { ...f.project, id: 'different-project' });
    const other = f.task('Other', { projectId: 'different-project' });
    assert.throws(() => f.store.validateDependencies(a.id, [other.id]), /different project/);
    assert.throws(
      () => f.task('Bad cross-project task', { dependsOn: [other.id] }),
      /this project/,
    );
  });

  test('a stale fencing token cannot heartbeat or release a newer ownership lease', async (t) => {
    const f = await fixture(t),
      member = f.member(),
      task = f.task('Fenced task');
    const first = f.store.claim(task.id, member.id).lease;
    f.store.release(task.id, first.token);
    f.store.updateTask(task.id, { status: 'ready' });
    f.store.updateMember(member.id, { status: 'ready' });
    const second = f.store.claim(task.id, member.id).lease;
    assert.notEqual(first.token, second.token);
    f.store.db.prepare('UPDATE leases SET heartbeat=42 WHERE taskId=?').run(task.id);
    f.store.heartbeat(task.id, first.token);
    f.store.release(task.id, first.token);
    assert.equal(f.store.lease(task.id)!.heartbeat, 42);
    assert.equal(f.store.owns(task.id, first.token), false);
    assert.equal(f.store.owns(task.id, second.token), true);
    f.store.heartbeat(task.id, second.token);
    assert.ok(f.store.lease(task.id)!.heartbeat > 42);
  });

  test('restart retains orphan locks until explicit recovery and requires authentication again', async (t) => {
    const f = await fixture(t),
      a = f.member('A'),
      b = f.member('B');
    const task = f.task('Interrupted', { scope: ['src'] });
    const other = f.task('Overlapping after restart', { scope: ['src/routes'] });
    const lease = f.store.claim(task.id, a.id).lease;
    f.store.updateTask(task.id, { threadId: 'old-thread', turnId: 'old-turn' });
    f.reopen();
    assert.equal(f.store.orphanAll(), 1);
    assert.equal(f.store.lease(task.id)!.orphaned, 1);
    assert.equal(f.store.owns(task.id, lease.token), false);
    assert.equal(f.store.get<Task>('task', task.id).status, 'blocked');
    assert.equal(
      f.store.members().every((member) => member.account === null && member.status === 'offline'),
      true,
    );
    f.store.updateMember(b.id, { status: 'ready', account: { type: 'chatgpt' } });
    assert.throws(() => f.store.claim(other.id, b.id), /Scope overlaps/);
    f.store.recoverOrphans();
    assert.equal(f.store.leases().length, 0);
    const recovered = f.store.get<Task>('task', task.id);
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.threadId, null);
    assert.equal(recovered.turnId, null);
    assert.throws(() => f.store.claim(task.id, a.id), /signed in and ready/);
    f.store.updateMember(a.id, { status: 'ready', account: { type: 'chatgpt' } });
    assert.equal(f.store.claim(task.id, a.id).task.status, 'running');
  });

  test('a reviewed task keeps its scope reserved across restart and orphan recovery', async (t) => {
    const f = await fixture(t),
      a = f.member('A'),
      b = f.member('B');
    const proposal = f.task('Awaiting review', { scope: ['src/api'] });
    const conflicting = f.task('Would race integration', { scope: ['src/api/routes.ts'] });
    const lease = f.store.claim(proposal.id, a.id).lease;
    f.store.updateTask(proposal.id, {
      status: 'review',
      summary: 'Implementation ready for acceptance.',
    });
    f.reopen();
    assert.equal(f.store.orphanAll(), 0);
    f.store.recoverOrphans();
    assert.equal(f.store.get<Task>('task', proposal.id).status, 'review');
    assert.equal(f.store.lease(proposal.id)!.token, lease.token);
    assert.equal(f.store.lease(proposal.id)!.orphaned, 0);
    f.store.updateMember(b.id, { status: 'ready', account: { type: 'chatgpt' } });
    assert.throws(() => f.store.claim(conflicting.id, b.id), /Scope overlaps/);
  });

  test('project, tasks, room handoffs, and activity survive closing the database', async (t) => {
    const f = await fixture(t),
      member = f.member(),
      task = f.task('Persist this');
    const message = f.store.message({
      projectId: f.project.id,
      taskId: task.id,
      authorId: member.id,
      kind: 'handoff',
      content: 'The contract is documented in docs/api.md.',
    });
    const activity = f.store.activity({
      projectId: f.project.id,
      taskId: task.id,
      memberId: member.id,
      type: 'task.created',
      text: 'Created a bounded task.',
    });
    f.reopen();
    assert.equal(f.store.projects()[0].id, f.project.id);
    assert.equal(f.store.get<Task>('task', task.id).title, 'Persist this');
    assert.deepEqual(f.store.get('message', message.id), message);
    assert.deepEqual(f.store.get('activity', activity.id), activity);
  });

  test('unassigned or signed-out profiles cannot bypass task assignment and readiness', async (t) => {
    const f = await fixture(t),
      a = f.member('A'),
      b = f.member('B');
    const task = f.task('Assigned', { assignedTo: a.id });
    assert.throws(() => f.store.claim(task.id, b.id), /assigned to another/);
    f.store.updateMember(a.id, { account: null });
    assert.throws(() => f.store.claim(task.id, a.id), /signed in and ready/);
    assert.equal(f.store.leases().length, 0);
    assert.equal(f.store.get<Task>('task', task.id).status, 'ready');
  });
}
