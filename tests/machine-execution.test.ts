import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { MachineExecutor, type ExecutionGrant } from '../server/machine-execution.ts';
import { MachineAgent, runMachine } from '../server/runner-agent.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { machineTool } from '../server/machine-tools.ts';
import { git } from '../server/git.ts';
import type { CodexSession, Project } from '../shared/types.ts';

const file = (name: string, value: string) => ({
  path: name,
  data: Buffer.from(value).toString('base64'),
  hash: createHash('sha256').update(value).digest('hex'),
});
const grant = (extra: Partial<ExecutionGrant> = {}): ExecutionGrant => ({
  id: randomUUID(),
  projectId: randomUUID(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  fullAccess: true,
  ...extra,
});

test(
  'host shutdown aborts an in-flight exchange instead of delaying permission revocation',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const previous = globalThis.fetch;
    let seen!: () => void;
    const started = new Promise<void>((resolve) => {
      seen = resolve;
    });
    globalThis.fetch = async (_input, options) => {
      const signal = options?.signal;
      assert.ok(signal);
      seen();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    const running = runMachine({
      origin: 'https://example.test',
      token: 'a'.repeat(43),
      id: randomUUID(),
      dataDir: path.join(f.root, 'agent'),
      slots: 1,
      maxLoad: 1000,
      minFreeMB: 0,
      executionGrant: f.executor.grant,
    });
    try {
      await started;
      process.emit('SIGTERM');
      await running;
      await assert.rejects(readFile(path.join(f.root, 'agent', 'runner-active.json')), {
        code: 'ENOENT',
      });
    } finally {
      globalThis.fetch = previous;
    }
  },
);
async function fixture(t: TestContext, permission: ExecutionGrant | undefined = grant()) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'Kivuno máy thử-')));
  const executor = new MachineExecutor(root, permission);
  const cleanups: Array<() => Promise<void> | void> = [];
  const taskId = randomUUID();
  const params = (operation: string, args: unknown = {}) => ({
    grantId: permission?.id || randomUUID(),
    projectId: permission?.projectId || randomUUID(),
    taskId,
    operation,
    args,
  });
  const run = (operation: string, args: unknown = {}) =>
    executor.perform(randomUUID(), params(operation, args));
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await executor.stop();
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, executor, taskId, params, run, cleanups };
}

test(
  'machine owner grant binds project, expiry and explicit full access',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, grant({ fullAccess: false }));
    await assert.rejects(
      f.executor.perform(randomUUID(), { ...f.params('info'), projectId: randomUUID() }),
      /not granted/,
    );
    await assert.rejects(f.run('run', { command: 'node', args: ['--version'] }), /full-access/);
    await f.run('sync', { files: [file('sample.txt', 'base')] });
    const read: any = await f.run('read', { path: 'sample.txt' });
    assert.ok(JSON.stringify(read).includes('base'));
    await assert.rejects(f.run('write', { path: 'sample.txt', content: 'bad' }), /full-access/);
    await assert.rejects(f.run('read', { path: '../outside' }), /path|scope|outside/i);
    const expired = await fixture(t, grant({ expiresAt: new Date(0).toISOString() }));
    await assert.rejects(expired.run('info'), /not granted/);
    const absent = new MachineExecutor(path.join(f.root, 'absent'));
    t.after(() => absent.stop());
    await assert.rejects(absent.perform(randomUUID(), f.params('info')), /not granted/);
  },
);

test(
  'real child execution reports actual OS, strips credentials and prevents persistent replay',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    await f.run('sync', { files: [file('sample.txt', 'base')] });
    const id = randomUUID();
    const input = f.params('run', {
      command: 'node',
      args: [
        '-e',
        "require('fs').appendFileSync('sample.txt',' once'); console.log(JSON.stringify({platform:process.platform,auth:process.env.OPENAI_API_KEY,home:process.env.HOME,cwd:process.cwd()}))",
      ],
    });
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'fixture-not-a-key';
    let result: any;
    try {
      result = await f.executor.perform(id, input);
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
    assert.equal(result.code, 0);
    assert.equal(result.platform, process.platform);
    const output = JSON.parse(result.stdout);
    assert.equal(output.platform, process.platform);
    assert.equal(output.auth, undefined);
    assert.notEqual(output.home, os.homedir());
    await assert.rejects(f.executor.perform(id, input), /already accepted/);
    await f.executor.stop();
    const restarted = new MachineExecutor(f.root, f.executor.grant);
    t.after(() => restarted.stop());
    await assert.rejects(restarted.perform(id, input), /already accepted/);
    assert.equal(
      await readFile(path.join(f.root, 'remote-workspaces', f.taskId, 'sample.txt'), 'utf8'),
      'base once',
    );
  },
);

test(
  'remote sync rejects stale snapshots and private profile files',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    await f.run('sync', { files: [file('sample.txt', 'base')] });
    await f.run('write', { path: 'sample.txt', content: 'remote edit' });
    await assert.rejects(
      f.run('sync', {
        before: [file('sample.txt', 'base')],
        files: [file('sample.txt', 'overwrite')],
      }),
      /changed/,
    );
    for (const name of ['.claude/settings.json', '.gemini/oauth_creds.json', '.env', '../escape'])
      await assert.rejects(f.run('sync', { files: [file(name, 'private')] }), /path/);
    const snapshot: any = await f.run('export');
    assert.deepEqual(snapshot.files, [file('sample.txt', 'remote edit')]);
  },
);

test(
  'revoking access stops an active command and blocks later commands',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    await f.run('sync', { files: [file('sample.txt', 'base')] });
    const marker = path.join(f.root, 'remote-workspaces', f.taskId, 'started.txt');
    const running = assert.rejects(
      f.run('run', {
        command: 'node',
        args: [
          '-e',
          "require('fs').writeFileSync('started.txt',String(process.pid)); setInterval(()=>{},1000)",
        ],
        timeoutMs: 15000,
      }),
      /not granted/,
    );
    let pid = 0;
    for (let i = 0; i < 150 && !pid; i++) {
      pid = await readFile(marker, 'utf8').then(Number, () => 0);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, 'the actual subprocess started');
    await f.executor.stop();
    await running;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(f.run('info'), /not granted/);
  },
);

test('expiry kills execution and bounds output/command duration', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  await f.run('sync', { files: [] });
  const output: any = await f.run('run', {
    command: 'node',
    args: ['-e', "console.log('x'.repeat(200000));setInterval(()=>{},1000)"],
  });
  assert.equal(output.outputTruncated, true);
  const timed: any = await f.run('run', {
    command: 'node',
    args: ['-e', 'setInterval(()=>{},1000)'],
    timeoutMs: 150,
  });
  assert.equal(timed.timedOut, true);
  const expiring = await fixture(t, grant());
  await expiring.run('sync', { files: [] });
  expiring.executor.grant!.expiresAt = new Date(Date.now() + 500).toISOString();
  await assert.rejects(
    expiring.run('run', { command: 'node', args: ['-e', 'setInterval(()=>{},1000)'] }),
    /not granted/,
  );
  assert.equal(expiring.executor.metadata(), undefined);
});

test(
  'Sade uses a tool-only paired machine, pulls only owned changes and never starts an AI client',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const store = new Store(path.join(f.root, 'state.db'));
    const host = new Workspace(store, f.root, f.root);
    f.cleanups.push(async () => {
      await host.close();
      store.close();
    });
    const repo = path.join(f.root, 'source');
    await mkdir(repo);
    await git(repo, ['init']);
    await writeFile(path.join(repo, 'sample.txt'), 'base');
    await writeFile(path.join(repo, 'outside.txt'), 'outside');
    await mkdir(path.join(repo, '.claude'));
    await writeFile(path.join(repo, '.claude', 'settings.json'), 'private');
    const project = store.put('project', {
      id: f.executor.grant!.projectId,
      name: 'Cross-machine demo',
      goal: 'test',
      path: repo,
      createdAt: new Date().toISOString(),
    } satisfies Project);
    const member = host.autonomy.addAccount();
    store.updateMember(member.id, { status: 'ready', account: { type: 'chatgpt' } });
    const task = store.addTask({
      projectId: project.id,
      title: 'Mac debug',
      kind: 'code',
      scope: ['sample.txt'],
      description: '',
      priority: 'medium',
      dependsOn: [],
      acceptance: 'test',
      status: 'ready',
    });
    store.claim(task.id, member.id);
    store.updateTask(task.id, { worktree: repo });
    const session = {
      id: randomUUID(),
      memberId: member.id,
      taskId: task.id,
      projectId: project.id,
      readOnly: false,
    } as CodexSession;
    // Quota/lease logic has its own tests; this test explicitly controls revocation.
    let authorized = true;
    host.quota.assertCanRun = () => {
      if (!authorized) throw new Error('quota revoked');
      return host.quota.current(member.id);
    };
    const guard = () => {
      if (!authorized) throw new Error('lease revoked');
    };
    const node = host.runners.add('Actual test OS', 'computer', project.id);
    const agent = new MachineAgent(
      {
        origin: 'https://example.test',
        token: node.token,
        id: node.id,
        dataDir: path.join(f.root, 'target'),
        slots: 1,
        maxLoad: 1000,
        minFreeMB: 0,
        executionGrant: f.executor.grant,
      },
      () => {
        throw new Error('Tool-only machine must not start an AI client');
      },
    );
    agent.epoch = host.runners.epoch;
    f.cleanups.push(async () => {
      await agent.reset('');
      await agent.executor.stop();
    });
    let exchanging = false;
    async function pulse() {
      if (exchanging) return;
      exchanging = true;
      try {
        const result = await host.runners.exchange(node.id, {
          epoch: agent.epoch,
          ready: true,
          busy: false,
          version: 'tools-test',
          events: agent.batch(),
          execution: agent.executor.metadata(),
        });
        await agent.acknowledge(result.ack, result.applied);
        for (const command of result.commands) void agent.execute(command);
      } finally {
        exchanging = false;
      }
    }
    await pulse();
    const pump = setInterval(() => void pulse(), 20);
    f.cleanups.push(() => clearInterval(pump));
    const use = (operation: string, args = {}) =>
      machineTool(host, session, 'machine_use', { runnerId: node.id, operation, args }, guard);
    const machines: any = await machineTool(host, session, 'machine_list', {}, guard);
    assert.equal(machines[0].platform, process.platform);
    await use('sync');
    const target = path.join(f.root, 'target', 'remote-workspaces', task.id);
    await assert.rejects(readFile(path.join(target, '.claude', 'settings.json')), {
      code: 'ENOENT',
    });
    const result: any = await use('run', {
      command: 'node',
      args: [
        '-e',
        "require('fs').writeFileSync('sample.txt','fixed on '+process.platform);console.log(process.platform)",
      ],
    });
    assert.equal(result.stdout.trim(), process.platform);
    await use('pull');
    assert.equal(
      await readFile(path.join(repo, 'sample.txt'), 'utf8'),
      'fixed on ' + process.platform,
    );
    await use('write', { path: 'outside.txt', content: 'out of scope' });
    await assert.rejects(use('pull'), /scope/);
    assert.equal(await readFile(path.join(repo, 'outside.txt'), 'utf8'), 'outside');
    await assert.rejects(
      machineTool(
        host,
        { ...session, readOnly: true },
        'machine_use',
        { runnerId: node.id, operation: 'run', args: { command: 'node' } },
        guard,
      ),
      /Read-only/,
    );
    authorized = false;
    await assert.rejects(use('info'), /revoked/);
  },
);
