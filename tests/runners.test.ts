import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { MachineAgent } from '../server/runner-agent.ts';
import { CodexClient } from '../server/codex.ts';
import { git } from '../server/git.ts';
import {
  exportRunnerFiles,
  applyRunnerFiles,
  validateRunnerFiles,
} from '../server/runner-files.ts';
import type { Project } from '../shared/types.ts';

const file = (name: string, value: string) => ({
  path: name,
  data: Buffer.from(value).toString('base64'),
  hash: createHash('sha256').update(value).digest('hex'),
});
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-machines-'));
  const store = new Store(path.join(root, 'state.db'));
  const host = new Workspace(store, root, root);
  t.after(async () => {
    await host.close();
    store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, store, host };
}
test('machine tokens are scoped, hidden from the roster and cannot bypass the coordinator epoch', async (t) => {
  const { host } = await fixture(t);
  const first = host.runners.add('This computer', 'computer'),
    second = host.runners.add('lattice', 'ssh');
  assert.equal(host.runners.authenticate(`Bearer ${first.token}`).id, first.id);
  assert.throws(() => host.runners.authenticate('Bearer invalid'), /authentication/);
  assert.ok(!JSON.stringify(host.runners.list()).includes(first.token));
  assert.ok(!JSON.stringify(host.runners.list()).includes('tokenHash'));
  assert.throws(() => host.runners.assertReady(first.id), /offline/);
  const reset = await host.runners.exchange(second.id, {
    epoch: 'old',
    ready: true,
    busy: false,
    version: 'test',
    events: [],
  });
  assert.equal(reset.reset, true);
  assert.throws(() => host.runners.assertReady(second.id), /offline/);
  await host.runners.exchange(second.id, {
    epoch: host.runners.epoch,
    ready: true,
    busy: true,
    version: 'test',
    events: [],
  });
  const member = host.autonomy.addAccount();
  host.store.updateMember(member.id, { runnerId: second.id });
  assert.throws(() => host.autonomy.reserve('task', member.id), /busy/);
});
test('remote file transfer rejects traversal, out-of-scope edits, stale bases and private paths', async (t) => {
  const { root } = await fixture(t);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init']);
  await writeFile(path.join(repo, 'safe.txt'), 'base');
  const before = await exportRunnerFiles(repo);
  assert.equal(before.length, 1);
  assert.throws(() => validateRunnerFiles([file('../escape', 'x')]), /path/);
  assert.throws(() => validateRunnerFiles([file('.env', 'x')]), /path/);
  await assert.rejects(
    applyRunnerFiles(repo, before, [file('safe.txt', 'change')], ['other.txt'], () => {}),
    /scope/,
  );
  await writeFile(path.join(repo, 'safe.txt'), 'local edit');
  await assert.rejects(
    applyRunnerFiles(repo, before, [file('safe.txt', 'change')], ['safe.txt'], () => {}),
    /changed/,
  );
  assert.equal(await readFile(path.join(repo, 'safe.txt'), 'utf8'), 'local edit');
});
class ProtocolPeer extends CodexClient {
  calls: { method: string; params: any }[] = [];
  override async start() {}
  override async stop() {}
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.calls.push({ method, params });
    return (
      method === 'thread/start'
        ? { thread: { id: 'real-thread-shape' }, model: params.model, reasoningEffort: 'high' }
        : { ok: true }
    ) as T;
  }
}
test('outbound RPC materializes an owned workspace, preserves model settings, syncs scoped output and never replays delivery', async (t) => {
  const { host, store, root } = await fixture(t);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init']);
  await writeFile(path.join(repo, 'README.md'), 'base');
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Test',
    goal: 'Test',
    path: repo,
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const node = host.runners.add('lattice', 'ssh');
  await host.runners.exchange(node.id, {
    epoch: host.runners.epoch,
    ready: true,
    busy: false,
    version: 'test',
    events: [],
  });
  const member = host.autonomy.addAccount();
  store.updateMember(member.id, {
    runnerId: node.id,
    status: 'ready',
    account: { type: 'chatgpt' },
  });
  const task = store.addTask({
    projectId: project.id,
    title: 'Edit',
    kind: 'code',
    scope: ['README.md'],
    description: 'Edit README',
    priority: 'medium',
    dependsOn: [],
    acceptance: 'Verified',
    status: 'ready',
  });
  store.claim(task.id, member.id);
  const peers: ProtocolPeer[] = [];
  const agent = new MachineAgent(
    {
      origin: 'https://example.test',
      token: node.token,
      id: node.id,
      dataDir: path.join(root, 'machine'),
      slots: 1,
      maxLoad: 1000,
      minFreeMB: 0,
    },
    (home, cwd) => {
      const peer = new ProtocolPeer({ home, cwd });
      peers.push(peer);
      return peer;
    },
  );
  agent.epoch = host.runners.epoch;
  const remote = host.runners.create(member.id, task.id);
  async function pulse() {
    const result = await host.runners.exchange(node.id, {
      epoch: agent.epoch,
      ready: true,
      busy: false,
      version: 'test',
      events: agent.batch(),
    });
    await agent.acknowledge(result.ack, result.applied);
    for (const command of result.commands) await agent.execute(command);
    return result;
  }
  const starting = remote.start();
  await pulse();
  await pulse();
  await starting;
  const request = remote.request('thread/start', {
    cwd: repo,
    sandbox: 'workspace-write',
    model: 'catalog-model',
    config: { model_reasoning_effort: 'high' },
  });
  let delivered = await pulse();
  const deadline = Date.now() + 15000;
  while (!delivered.commands.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    delivered = await pulse();
  }
  assert.equal(delivered.commands.length, 1);
  assert.equal((await pulse()).commands.length, 0);
  await request;
  const params = peers[0].calls[0].params;
  assert.notEqual(params.cwd, repo);
  assert.equal(params.model, 'catalog-model');
  assert.equal(params.config.model_reasoning_effort, 'high');
  assert.equal(await readFile(path.join(params.cwd, 'README.md'), 'utf8'), 'base');
  await writeFile(path.join(params.cwd, 'README.md'), 'remote result');
  peers[0].emit('notification', 'turn/completed', {
    threadId: 'real-thread-shape',
    turn: { id: 'turn', status: 'completed' },
  });
  while (!agent.events.some((event) => event.method === 'turn/completed') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await pulse();
  assert.equal(await readFile(path.join(repo, 'README.md'), 'utf8'), 'remote result');
  const repeated = delivered.commands[0];
  await agent.execute(repeated);
  assert.equal(peers[0].calls.filter((call) => call.method === 'thread/start').length, 1);
  // A late machine result must not write after ownership is revoked.
  const reset = await host.runners.exchange(node.id, {
    epoch: '',
    ready: true,
    busy: false,
    version: 'test',
    events: [],
  });
  assert.equal(reset.reset, true);
  assert.equal(store.lease(task.id)!.orphaned, 1);
  assert.throws(() => host.runners.assertReady(node.id), /offline/);
  await agent.reset(reset.epoch);
  await host.runners.exchange(node.id, {
    epoch: agent.epoch,
    ready: true,
    busy: false,
    version: 'test',
    events: [],
  });
  assert.equal(
    store.lease(task.id)!.orphaned,
    1,
    'Handshake never releases an uncertain task lease.',
  );
  await assert.rejects(remote.request('turn/start', {}), /stopped/);
  store.release(task.id, store.lease(task.id)!.token);
  await writeFile(path.join(params.cwd, 'README.md'), 'late result');
  peers[0].emit('notification', 'turn/completed', {
    threadId: 'real-thread-shape',
    turn: { id: 'late', status: 'completed' },
  });
  while (!agent.events.some((event) => event.method === 'turn/completed') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await pulse();
  assert.equal(await readFile(path.join(repo, 'README.md'), 'utf8'), 'remote result');
  await agent.reset('');
});
