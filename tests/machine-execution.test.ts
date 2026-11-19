import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { MachineExecutor, type ExecutionGrant } from '../server/machine-execution.ts';
import { MachineAgent, runMachine } from '../server/runner-agent.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { verifyMachineSignature } from '../server/machine-signature.ts';
import { machineTool } from '../server/machine-tools.ts';
import { checkRecoveryProtocol, MachineCheckOutbox } from '../server/machine-check-outbox.ts';
import type { RunnerEvent } from '../server/runners.ts';
import { createWorktree, git } from '../server/git.ts';
import type { CodexSession, Project } from '../shared/types.ts';
import {
  machineChunkBytes,
  machineSnapshotProtocol,
  snapshotDigest,
} from '../server/runner-files.ts';

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

    const id = randomUUID();
    const packet = Buffer.from(JSON.stringify([file('sample.txt', 'incomplete fixture')]));
    await f.run('snapshot-upload', {
      id,
      offset: 0,
      size: packet.length,
      data: packet.subarray(0, 8).toString('base64'),
    });
    await assert.rejects(
      f.run('snapshot-apply', {
        id,
        before: snapshotDigest(snapshot.files),
        digest: createHash('sha256').update(packet).digest('hex'),
      }),
      /incomplete/,
    );
    await f.run('cancel');
    await assert.rejects(
      f.run('snapshot-upload', {
        id,
        offset: 8,
        size: packet.length,
        data: packet.subarray(8).toString('base64'),
      }),
      /unexpected chunk offset/,
    );
    assert.deepEqual(await f.run('export'), snapshot);
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
    const asset = Buffer.alloc(3 * 1024 * 1024, 0xa3);
    await writeFile(path.join(repo, 'project-asset.png'), asset);
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
    const operations: string[] = [];
    async function pulse() {
      if (exchanging) return;
      exchanging = true;
      try {
        const result = await host.runners.exchange(node.id, {
          epoch: agent.epoch,
          ready: true,
          busy: false,
          version: machineSnapshotProtocol,
          events: agent.batch(),
          execution: agent.executor.metadata(),
        });
        await agent.acknowledge(result.ack, result.applied);
        for (const command of result.commands) {
          const operation = command.params?.operation;
          if (operation) operations.push(operation);
          assert.ok(Buffer.byteLength(JSON.stringify(command)) < 2 * machineChunkBytes);
          void agent.execute(command);
        }
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
    assert.ok((await readFile(path.join(target, 'project-asset.png'))).equals(asset));
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
    await assert.rejects(use('sync'), /Remote files changed/);
    assert.equal(
      await readFile(path.join(target, 'sample.txt'), 'utf8'),
      'fixed on ' + process.platform,
    );
    await use('pull');
    assert.ok(operations.filter((operation) => operation === 'snapshot-upload').length > 1);
    assert.ok(operations.filter((operation) => operation === 'snapshot-read').length > 1);
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

async function reviewFixture(t: TestContext) {
  const f = await fixture(t);
  const store = new Store(path.join(f.root, 'check.db'));
  const host = new Workspace(store, f.root, f.root);
  f.cleanups.push(async () => {
    await host.close();
    store.close();
  });
  const repo = path.join(f.root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(repo, 'value.txt'), 'base');
  await git(repo, ['add', '.']);
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=t@example.org',
    'commit',
    '-m',
    'base',
  ]);
  const permission = f.executor.grant!;
  const project = store.put('project', {
    id: permission.projectId,
    name: 'Check fixture',
    path: repo,
    goal: '',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const owner = host.autonomy.addAccount();
  store.updateMember(owner.id, { status: 'ready', account: { type: 'chatgpt' } });
  const task = store.addTask({
    projectId: project.id,
    title: 'Checked change',
    kind: 'code',
    scope: ['value.txt'],
    description: '',
    priority: 'medium',
    dependsOn: [],
    acceptance: '',
    status: 'ready',
  });
  store.claim(task.id, owner.id);
  const checkout = await createWorktree(repo, f.root, task.id);
  store.updateTask(task.id, { ...checkout, status: 'review' });
  const session = {
    id: randomUUID(),
    projectId: project.id,
    taskId: task.id,
    memberId: owner.id,
    readOnly: false,
  };
  const node = host.runners.add('Fixture machine', 'computer', project.id);
  return { f, store, host, repo, project, owner, task, checkout, session, node };
}

test(
  'lost command delivery, both endpoints restarting and a lost receipt ACK run the check once and recover it in Reviews',
  { timeout: 30000 },
  async (t) => {
    const { f, host, repo, project, task, checkout, session, node } = await reviewFixture(t);
    const config = {
      origin: 'https://example.test',
      token: node.token,
      id: node.id,
      dataDir: path.join(f.root, 'peer'),
      slots: 1,
      maxLoad: 1000,
      minFreeMB: 0,
      executionGrant: f.executor.grant,
    };
    let agent = new MachineAgent(config);
    let coordinator = host;
    f.cleanups.push(async () => {
      await agent.reset('');
      await agent.executor.stop();
    });
    const exchange = (
      events: RunnerEvent[] = [],
      nodeId = node.id,
      epoch: string = coordinator.runners.epoch,
    ) =>
      coordinator.runners.exchange(nodeId, {
        epoch,
        ready: true,
        busy: false,
        version: checkRecoveryProtocol,
        events,
        execution: agent.executor.metadata(),
      });
    await exchange();
    const target = path.join(checkout.worktree, 'value.txt');
    await writeFile(target, 'tested');
    async function deliverOne() {
      let delivered = await exchange();
      const deadline = Date.now() + 5000;
      while (!delivered.commands.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        delivered = await exchange();
      }
      assert.equal(delivered.commands.length, 1);
      await agent.execute(delivered.commands[0]);
      const accepted = await exchange(agent.batch());
      await agent.acknowledge(accepted.ack);
    }
    const syncing = machineTool(
      host,
      session,
      'machine_use',
      { runnerId: node.id, operation: 'sync' },
      () => {},
      true,
    );
    await deliverOne();
    await syncing;
    const checking = machineTool(
      host,
      session,
      'machine_use',
      {
        runnerId: node.id,
        operation: 'run',
        args: {
          command: 'node',
          args: [
            '-e',
            "require('fs').appendFileSync(require('path').join(process.env.HOME,'count'),'1');console.log('test output')",
          ],
        },
      },
      () => {},
      true,
    );
    const interrupted = assert.rejects(checking, /Coordinator closed/);
    const [lost] = (await exchange()).commands;
    const [retry] = (await exchange()).commands;
    assert.ok(lost);
    assert.deepEqual(retry, lost);
    await Promise.all([agent.execute(retry), agent.execute(lost)]);
    assert.equal(agent.batch()[0].result.stdout.trim(), 'test output');
    const count = path.join(config.dataDir, 'execution-home', 'count');
    assert.equal(await readFile(count, 'utf8'), '1');
    await host.close();
    await interrupted;
    await agent.reset('');
    await agent.executor.stop();
    agent = new MachineAgent(config);
    const reopened = new Store(path.join(f.root, 'check.db'));
    coordinator = new Workspace(reopened, f.root, f.root);
    f.cleanups.push(async () => {
      await coordinator.close();
      reopened.close();
    });
    assert.equal(
      (await coordinator.reviewDiff(task.id)).machineChecks?.attempts[0].status,
      'awaiting result',
    );
    const reset = await exchange(agent.batch(), node.id, '');
    assert.ok(reset.reset);
    await agent.reset(reset.epoch);
    await agent.execute(lost);
    const [receipt] = agent.batch();
    assert.equal(receipt.result.stdout, undefined);
    assert.equal(receipt.result.evidence.runId, lost.id);
    const stranger = coordinator.runners.add('Different runner', 'computer', project.id);
    await exchange([receipt], stranger.id);
    assert.equal((await coordinator.reviewDiff(task.id)).machineChecks?.passed, false);
    const first = await exchange([receipt]);
    assert.deepEqual(first.ack, [lost.id]);
    assert.equal((await coordinator.reviewDiff(task.id)).machineChecks?.passed, true);
    await writeFile(target, 'changed after the run');
    const replay = await exchange(agent.batch());
    await agent.acknowledge(replay.ack);
    assert.deepEqual(agent.batch(), []);
    const checks = (await coordinator.reviewDiff(task.id)).machineChecks!;
    assert.equal(checks.attempts.length, 1);
    assert.equal(checks.attempts[0].status, 'stale');
    await assert.rejects(coordinator.accept(task.id), /passing paired-machine/);
    assert.equal(await git(repo, ['rev-parse', 'HEAD']), checkout.baseCommit);
    assert.equal(await readFile(count, 'utf8'), '1');
    const rerunning = coordinator.repeatMachineCheck(task.id, lost.id);
    // Deliver the explicit new sync and check through the ordinary exchange path.
    await deliverOne();
    await deliverOne();
    assert.ok((await rerunning).machineChecks?.passed);
    assert.equal((await coordinator.accept(task.id)).status, 'done');
    assert.equal(await readFile(count, 'utf8'), '11');
  },
);

test('a runner crash before a signed outcome leaves an unconfirmed receipt and prevents replay', async (t) => {
  const f = await fixture(t);
  const runner = randomUUID();
  const id = randomUUID();
  const event: RunnerEvent = {
    id,
    clientId: randomUUID(),
    type: 'result',
    commandId: id,
    method: checkRecoveryProtocol,
    params: { taskId: f.taskId },
  };
  const original = new MachineCheckOutbox(f.root, runner);
  assert.ok(original.claim(event));
  assert.deepEqual(original.batch(), []);
  original.close();
  const next = new MachineCheckOutbox(f.root, runner);
  try {
    assert.equal(next.claim(event), false);
    assert.match(next.batch()[0].error!, /before saving a signed result/);
    next.acknowledge([id]);
    assert.equal(next.claim(event), false);
    assert.deepEqual(next.batch(), []);
  } finally {
    next.close();
  }
});

test(
  'Reviews binds a real paired check to the exact patch, preserves failed attempts and requires a fresh pass to integrate',
  { timeout: 45000 },
  async (t) => {
    const { f, store, host, repo, task, checkout, session, node } = await reviewFixture(t);
    await host.runners.exchange(node.id, {
      epoch: host.runners.epoch,
      ready: true,
      busy: false,
      version: 'fixture',
      events: [],
      execution: f.executor.metadata(),
    });
    let legacy = true;
    t.mock.method(
      host.runners,
      'call',
      async (_peer: unknown, command: { params: { operation: string } }) => {
        const result = await f.executor.perform(randomUUID(), command.params);
        if (legacy && command.params.operation === 'run')
          return { code: 0, platform: process.platform };
        return result;
      },
    );
    const target = path.join(checkout.worktree, 'value.txt');
    const guard = () => {};
    async function use(operation: string, args: object = {}) {
      return machineTool(
        host,
        session,
        'machine_use',
        { runnerId: node.id, operation, args },
        guard,
        true,
      );
    }
    await writeFile(target, 'good v1');
    await use('sync');
    const recipe = {
      command: 'node',
      args: [
        '-e',
        "process.exit(require('fs').readFileSync('value.txt','utf8').startsWith('good') ? 0 : 1)",
      ],
    };
    await assert.rejects(use('run', recipe), /Update the paired runner/);
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.attempts[0].status, 'unconfirmed');
    await assert.rejects(host.accept(task.id), /passing paired-machine/);
    legacy = false;
    await use('run', recipe);
    const check = (await host.reviewDiff(task.id)).machineChecks!;
    assert.equal(check.passed, true);
    const original = check.attempts.at(-1)!;
    if (process.platform === 'win32')
      await git(checkout.worktree, ['update-index', '--chmod=+x', 'value.txt']);
    else await chmod(target, 0o755);
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.passed, false);
    if (process.platform === 'win32')
      await git(checkout.worktree, ['update-index', '--chmod=-x', 'value.txt']);
    else await chmod(target, 0o644);
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.passed, true);
    const manifest = host.machineCheckManifest(task.id, original.id);
    verifyMachineSignature(manifest.evidence, manifest.proof, manifest.fingerprint);
    assert.throws(
      () =>
        verifyMachineSignature(
          { ...manifest.evidence, input: '0'.repeat(64) },
          manifest.proof,
          manifest.fingerprint,
        ),
      /signature/,
    );
    assert.throws(
      () => verifyMachineSignature(manifest.evidence, manifest.proof, 'f'.repeat(64)),
      /key/,
    );
    await writeFile(target, 'broken v2');
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.attempts.at(-1)?.status, 'stale');
    await assert.rejects(host.accept(task.id), /passing paired-machine/);
    assert.equal(await git(repo, ['rev-parse', 'HEAD']), checkout.baseCommit);
    const failed = (await host.repeatMachineCheck(task.id, original.id)).machineChecks!;
    assert.equal(failed.attempts.length, 3);
    assert.equal(failed.attempts.at(-1)?.status, 'failed');
    assert.equal(failed.attempts[0].current, false);
    await use('run', { command: 'node', args: ['--version'] });
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.passed, false);
    await assert.rejects(host.accept(task.id), /passing paired-machine/);
    const second = (await host.reviewDiff(task.id)).machineChecks!.attempts.at(-1)!;
    await writeFile(target, 'good v3');
    await host.repeatMachineCheck(task.id, second.id);
    const passed = (await host.repeatMachineCheck(task.id, original.id)).machineChecks!;
    assert.equal(passed.passed, true);
    assert.notEqual(passed.attempts.at(-1)?.input, original.input);
    // An unrelated commit on the destination creates a merge tree the runner never saw.
    await writeFile(path.join(repo, 'other.txt'), 'changed target');
    await git(repo, ['add', 'other.txt']);
    await git(repo, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.org',
      'commit',
      '-m',
      'new target',
    ]);
    const newHead = await git(repo, ['rev-parse', 'HEAD']);
    await assert.rejects(host.accept(task.id), /integration tree differs/);
    assert.equal(await git(repo, ['rev-parse', 'HEAD']), newHead);
    assert.equal(await readFile(path.join(repo, 'value.txt'), 'utf8'), 'base');
    await git(checkout.worktree, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.org',
      'merge',
      '--no-edit',
      newHead,
    ]);
    // Keep the task's diff relative to its updated base after the target has been incorporated.
    store.updateTask(task.id, { baseCommit: newHead });
    assert.equal((await host.reviewDiff(task.id)).machineChecks!.passed, false);
    await host.repeatMachineCheck(task.id, original.id);
    await host.repeatMachineCheck(task.id, second.id);
    assert.equal((await host.accept(task.id)).status, 'done');
    assert.equal(await readFile(path.join(repo, 'value.txt'), 'utf8'), 'good v3');
  },
);
