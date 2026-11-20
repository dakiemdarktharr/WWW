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
import { buildApp } from '../server/app.ts';
import { signerFingerprint, verifyMachineSignature } from '../server/machine-signature.ts';
import { machineTool } from '../server/machine-tools.ts';
import { checkRecoveryProtocol, MachineCheckOutbox } from '../server/machine-check-outbox.ts';
import { beginMachineCheck } from '../server/machine-checks.ts';
import { pairedTestRecipe } from '../server/paired-test-recipe.ts';
import { MachineDeliveryInterrupted, type RunnerEvent } from '../server/runners.ts';
import { createWorktree, git } from '../server/git.ts';
import type { CodexSession, Project } from '../shared/types.ts';
import type { SharedDelivery, SharedFinish } from '../server/group-sade.ts';
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
  'a paired test runs only the owner-approved file and signs an unchanged source snapshot',
  { timeout: 20_000 },
  async (t) => {
    const approved = 'tests/one.test.cjs';
    const other = 'tests/two.test.cjs';
    const f = await fixture(t, grant({ testFile: approved }));
    const testBody = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('approved read-only check', () => {
  assert.equal(fs.readFileSync('source.txt', 'utf8'), 'original');
  assert.throws(() => fs.writeFileSync('source.txt', 'changed'), { code: 'ERR_ACCESS_DENIED' });
});`;
    await f.run('sync', {
      files: [
        file('source.txt', 'original'),
        file(approved, testBody),
        file(other, 'process.exit(77)'),
      ],
    });
    const checkId = randomUUID();
    const baseCommit = 'a'.repeat(40);
    const command = (args: object) => ({ ...f.params('test', args), checkId, baseCommit });
    await assert.rejects(
      f.executor.perform(randomUUID(), command({ file: other })),
      /exact test file/,
    );
    await assert.rejects(
      f.executor.perform(randomUUID(), command({ file: approved, command: 'sh' })),
      /Unrecognized key/,
    );
    await assert.rejects(f.run('test', { file: approved }), /exact source revision and check/);
    const result = await f.executor.perform(checkId, command({ file: approved }));
    assert.ok('evidence' in result);
    assert.equal(result.code, 0);
    assert.equal(result.evidence.checkId, checkId);
    assert.equal(result.evidence.baseCommit, baseCommit);
    assert.equal(result.evidence.input, result.evidence.after);
    assert.match(result.stdout, /approved read-only check/);
    assert.deepEqual(pairedTestRecipe(approved).args.slice(-2), ['--', approved]);
    verifyMachineSignature(
      result.evidence,
      result.proof,
      signerFingerprint(result.proof.publicKey),
    );
    assert.equal(
      await readFile(path.join(f.root, 'remote-workspaces', f.taskId, 'source.txt'), 'utf8'),
      'original',
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
    assert.equal(machines[0].recoverableChecks, false);
    await use('sync');
    const target = path.join(f.root, 'target', 'remote-workspaces', task.id);
    assert.ok((await readFile(path.join(target, 'project-asset.png'))).equals(asset));
    await assert.rejects(readFile(path.join(target, '.claude', 'settings.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(
      machineTool(
        host,
        session,
        'machine_run',
        { runnerId: node.id, executable: 'node --version' },
        guard,
      ),
      /argv/,
    );
    const result: any = await machineTool(
      host,
      session,
      'machine_run',
      {
        runnerId: node.id,
        executable: 'node',
        argv: [
          '-e',
          "require('fs').writeFileSync('sample.txt','fixed on '+process.platform);console.log(process.platform)",
        ],
      },
      guard,
    );
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
        'machine_run',
        { runnerId: node.id, executable: 'node', argv: [] },
        guard,
      ),
      /Read-only/,
    );
    authorized = false;
    await assert.rejects(use('info'), /revoked/);
  },
);

async function reviewFixture(t: TestContext, ignoredCounter?: string, permission = grant()) {
  const f = await fixture(t, permission);
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
  if (ignoredCounter) await writeFile(path.join(repo, '.gitignore'), ignoredCounter + '\n');
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
  'the paired test worker produces a signed result without opening a model session',
  { timeout: 20_000 },
  async (t) => {
    const file = 'tests/node-smoke.test.cjs';
    const { f, store, host, repo, project, owner, node } = await reviewFixture(
      t,
      undefined,
      grant({ testFile: file }),
    );
    await mkdir(path.join(repo, 'tests'));
    await writeFile(
      path.join(repo, file),
      "require('node:test')('smoke', () => require('node:assert/strict').equal(require('node:fs').readFileSync('value.txt', 'utf8'), 'base'));\n",
    );
    await git(repo, ['add', file]);
    await git(repo, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.org',
      'commit',
      '-m',
      'approved scoped smoke test',
    ]);
    await git(repo, ['remote', 'add', 'origin', 'https://example.test/paired-tests.git']);
    await host.runners.exchange(node.id, {
      epoch: host.runners.epoch,
      ready: true,
      busy: false,
      version: 'fixture',
      events: [],
      execution: f.executor.metadata(),
    });
    const operations: string[] = [];
    t.mock.method(
      host.runners,
      'call',
      async (_peer: unknown, command: { params: { operation: string } }) => {
        operations.push(command.params.operation);
        return f.executor.perform(randomUUID(), command.params);
      },
    );
    const sessions = t.mock.method(host.sessions, 'create', async () => {
      throw new Error('The test must not start a model session.');
    });
    const groupId = randomUUID();
    const grantId = randomUUID();
    const assignment = (await host.sharedSade.execute({
      action: 'grant',
      id: grantId,
      groupId,
      projectId: project.id,
      teammateId: owner.id,
      allowWrites: true,
      turns: 1,
      machineId: node.id,
    })) as { projectKey: string };
    const jobId = randomUUID();
    await host.sharedSade.execute({
      action: 'exchange',
      active: [],
      acknowledged: [],
      delivery: {
        id: jobId,
        grantId,
        groupId,
        projectKey: assignment.projectKey,
        phase: 'task',
        request: 'Run the approved test file on this paired machine.',
        team: [],
        prerequisites: [],
        task: {
          key: 'node-smoke',
          title: 'Run the smoke test',
          description: 'Run one named test file on the paired machine.',
          acceptance: 'Report the signed result without making any changes.',
          kind: 'code',
          scope: [file],
          effort: 1,
          stage: 'Verify',
          dependsOn: [],
          preferredMemberId: grantId,
          requiredPairedMachineName: 'Fixture machine',
          requiredPlatform: f.executor.metadata()!.platform as 'win32' | 'darwin' | 'linux',
          testOnly: true,
        },
      } satisfies SharedDelivery,
    });
    const receipt = () =>
      store.get<{ result?: SharedFinish }>('sharedSadeLocalReceipt', jobId).result;
    const deadline = Date.now() + 12_000;
    while (!receipt() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receipt()?.kind, 'test-result', JSON.stringify(receipt()));
    assert.equal(sessions.mock.callCount(), 0);
    assert.deepEqual(operations, ['sync', 'test']);
    assert.equal(await git(repo, ['status', '--porcelain']), '');
  },
);

if (process.env.KIVUNO_PAIRED_RECOVERY === '1')
  test(
    'Windows Reviews recovers a finished check from a disconnected Mac',
    { timeout: 650_000 },
    async (t) => {
      assert.equal(process.platform, 'win32');
      const { chromium, expect } = await import('@playwright/test');
      const { startCrossHostBridge } = await import('./fixtures/shared-sade-cross-host.ts');
      const counter = 'runner-invocations.txt';
      const { f, host, repo, checkout, project, task, session, node } = await reviewFixture(
        t,
        counter,
      );
      const directory = process.env.KIVUNO_RECOVERY_EVIDENCE_DIR!;
      await mkdir(directory, { recursive: true });
      const nonce = randomUUID();
      let first: RunnerEvent | undefined;
      let cutAt = 0,
        reopenedAt = 0,
        disconnectedRequests = 0;
      const bridge = await startCrossHostBridge(host, project.id, node, {
        origin: process.env.KIVUNO_CROSS_HOST_ORIGIN!,
        port: Number(process.env.KIVUNO_CROSS_HOST_PORT),
        workflowRef: process.env.KIVUNO_MAC_WORKFLOW_REF!,
        sha: process.env.GITHUB_SHA!,
        runId: process.env.KIVUNO_MAC_RUN_ID!,
        dropExchange(body) {
          if (reopenedAt) return false;
          const receipt = body.events.find(
            (event) =>
              event.method === checkRecoveryProtocol && event.result?.evidence?.taskId === task.id,
          );
          if (!first) {
            if (!receipt) return false;
            first = receipt;
            cutAt = Date.now();
            console.log(
              'Dropping Mac exchange after command completion and before coordinator delivery.',
            );
          }
          // A blank epoch after the cut is the runner's reconnect handshake. Its
          // compact outbox receipt survives the loss of the in-memory output.
          if (!body.epoch && receipt?.id === first.id && receipt.result?.stdout === undefined) {
            reopenedAt = Date.now();
            return false;
          }
          disconnectedRequests++;
          return true;
        },
      });
      f.cleanups.push(bridge.close);
      const uiPort = 58175;
      const ui = await buildApp(host, { port: uiPort, distDir: path.resolve('dist') });
      f.cleanups.push(() => ui.close());
      await ui.listen({ host: '127.0.0.1', port: uiPort });
      const browser = await chromium.launch();
      f.cleanups.push(() => browser.close());
      const page = await browser.newPage();
      await page.addInitScript(() => sessionStorage.setItem('kivuno-guide-v3', 'seen'));
      await page.goto(`http://127.0.0.1:${uiPort}/#reviews`);
      const card = page.locator('.review-card').filter({ hasText: task.title });
      await expect(card).toBeVisible();
      const grant = await bridge.ready();
      assert.equal(grant.platform, 'darwin');
      const target = path.join(checkout.worktree, 'value.txt');
      await writeFile(target, 'tested');
      const use = (operation: string, args = {}) =>
        machineTool(
          host,
          session,
          'machine_use',
          { runnerId: node.id, operation, args },
          () => {},
          true,
        );
      await use('sync');
      const command = [
        "const fs = require('node:fs'), assert = require('node:assert/strict')",
        "assert.equal(process.platform, 'darwin')",
        `fs.appendFileSync('${counter}', process.argv[1] + '\\n')`,
        "assert.equal(fs.readFileSync('value.txt','utf8'), 'tested')",
        'console.log(process.argv[1])',
      ].join(';');
      const result = use('run', { command: 'node', args: ['-e', command, nonce] }).then(
        () => undefined,
        (error: Error) => error,
      );
      await card.getByRole('button').click();
      const checks = page.getByRole('region', { name: 'Paired-machine checks' });
      const integrate = page.getByRole('button', { name: 'Accept & integrate' });
      await expect.poll(() => cutAt, { timeout: 35_000 }).toBeGreaterThan(0);
      assert.equal(first!.result.stdout.trim(), nonce);
      assert.equal(first!.result.evidence.code, 0);
      await expect(checks).toContainText('awaiting result');
      await expect(integrate).toBeDisabled();
      assert.equal((await host.reviewDiff(task.id)).machineChecks!.attempts[0].finished, undefined);
      await checks.screenshot({ path: path.join(directory, 'disconnected.png') });
      await expect(checks).toContainText('· passed', { timeout: 110_000 });
      await expect(integrate).toBeEnabled();
      assert.ok(reopenedAt > cutAt && disconnectedRequests > 0);
      const outcome = await result;
      if (outcome && !(outcome instanceof MachineDeliveryInterrupted)) throw outcome;
      const rows = (await host.reviewDiff(task.id)).machineChecks!.attempts;
      assert.equal(rows.length, 1);
      const manifest = host.machineCheckManifest(task.id, rows[0].id);
      assert.deepEqual(manifest.evidence, first!.result.evidence);
      assert.deepEqual(manifest.proof, first!.result.proof);
      verifyMachineSignature(manifest.evidence, manifest.proof, manifest.fingerprint);
      const readCounter = async () => (await use('read', { path: counter })).content;
      assert.equal(await readCounter(), nonce + '\n');
      await checks.screenshot({ path: path.join(directory, 'recovered.png') });
      await writeFile(target, 'edited after the Mac check');
      await checks.getByRole('button', { name: 'Refresh checks' }).click();
      await expect(checks).toContainText('· stale');
      await expect(integrate).toBeDisabled();
      const api = `http://127.0.0.1:${uiPort}/api`;
      const { token } = await (await page.request.get(api + '/session')).json();
      const response = await page.request.post(`${api}/tasks/${task.id}/accept`, {
        headers: { 'x-relay-token': token, 'content-type': 'application/json' },
        data: {},
      });
      const rejection = (await response.json()).error;
      assert.equal(response.status(), 409, rejection);
      assert.match(rejection, /passing paired-machine check/);
      assert.equal(await git(repo, ['rev-parse', 'HEAD']), checkout.baseCommit);
      assert.equal(await readFile(path.join(repo, 'value.txt'), 'utf8'), 'base');
      assert.equal(await readCounter(), nonce + '\n');
      await checks.screenshot({ path: path.join(directory, 'edited.png') });
      const summary = {
        coordinator: process.platform,
        coordinatorRelease: os.release(),
        runner: grant.platform,
        arch: grant.arch,
        runnerRelease: manifest.evidence.release,
        checkId: rows[0].id,
        disconnectedRequests,
        disconnectedMs: reopenedAt - cutAt,
        invocations: 1,
        reviewAttempts: rows.length,
        reviewStates: ['awaiting result', 'passed', 'stale'],
        integrationHttpStatus: response.status(),
        rejection,
        unchangedHead: checkout.baseCommit,
        revision: process.env.GITHUB_SHA,
      };
      await writeFile(
        path.join(directory, 'signed-result.json'),
        JSON.stringify(manifest, null, 2),
      );
      await bridge.finish();
      await writeFile(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary));
    },
  );

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
    const listed = await machineTool(host, session, 'machine_list', {}, () => {}, true);
    assert.equal(listed[0].recoverableChecks, true);
    await host.runners.exchange(node.id, {
      epoch: host.runners.epoch,
      ready: true,
      busy: false,
      version: checkRecoveryProtocol,
      events: [],
      execution: { ...agent.executor.metadata()!, fullAccess: false },
    });
    const readOnly = await machineTool(host, session, 'machine_list', {}, () => {}, true);
    assert.equal(readOnly[0].recoverableChecks, false);
    await exchange();
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
    const differentId = randomUUID();
    await agent.execute({ ...lost, id: differentId });
    const malformed = agent.batch().find((event) => event.commandId === differentId)!;
    assert.match(malformed.error!, /check identity/);
    await agent.acknowledge([malformed.id]);
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
    const requestId = randomUUID();
    const rerunning = coordinator.repeatMachineCheck(task.id, lost.id, requestId);
    const concurrent = await coordinator.repeatMachineCheck(task.id, lost.id, requestId);
    assert.equal(concurrent.machineChecks?.attempts.at(-1)?.status, 'preparing');
    assert.equal(concurrent.machineChecks?.attempts.length, 2);
    // Deliver the explicit new sync and check through the ordinary exchange path.
    await deliverOne();
    await deliverOne();
    const completed = await rerunning;
    assert.equal(completed.attemptId, concurrent.attemptId);
    assert.ok(completed.machineChecks?.passed);
    const repeatedRequest = await coordinator.repeatMachineCheck(task.id, lost.id, requestId);
    assert.equal(repeatedRequest.attemptId, completed.attemptId);
    assert.equal(repeatedRequest.machineChecks?.attempts.length, 2);
    await assert.rejects(
      coordinator.repeatMachineCheck(task.id, completed.attemptId, requestId),
      /different check/,
    );
    assert.deepEqual((await exchange()).commands, []);
    await writeFile(target, 'changed again');
    // An HTTP retry after a restart can inspect the original attempt with the runner offline.
    const offlineStore = new Store(path.join(f.root, 'check.db'));
    const offline = new Workspace(offlineStore, f.root, f.root);
    const app = await buildApp(offline, { port: 4317 });
    try {
      const host = '127.0.0.1:4317';
      const bootstrap = await app.inject({ url: '/api/session', headers: { host } });
      const headers = {
        host,
        cookie: String(bootstrap.headers['set-cookie']).split(';')[0],
        'x-relay-token': bootstrap.json().token,
      };
      const submit = (checkId: string) =>
        app.inject({
          method: 'POST',
          url: '/api/tasks/' + task.id + '/machine-check',
          headers,
          payload: { checkId, clientRequestId: requestId },
        });
      const afterEdit = await submit(lost.id);
      assert.equal(afterEdit.statusCode, 200);
      assert.equal(afterEdit.json().attemptId, completed.attemptId);
      assert.equal(afterEdit.json().machineChecks.attempts.at(-1).status, 'stale');
      assert.equal((await submit(completed.attemptId)).statusCode, 409);
    } finally {
      await app.close();
      await offline.close();
      offlineStore.close();
    }
    await assert.rejects(coordinator.accept(task.id), /passing paired-machine/);
    await writeFile(target, 'changed after the run');
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

test('a repeated Review request after failed synchronization reports the same error without dispatching a command', async (t) => {
  const { f, store, host, node, task } = await reviewFixture(t);
  const grant = f.executor.metadata()!;
  await host.runners.exchange(node.id, {
    epoch: host.runners.epoch,
    ready: true,
    busy: false,
    version: checkRecoveryProtocol,
    events: [],
    execution: grant,
  });
  const original = beginMachineCheck(store, task, { id: node.id, name: 'Fixture machine' }, grant, {
    command: 'node',
    args: ['--version'],
    timeoutMs: 1000,
  });
  const calls = t.mock.method(
    host.runners,
    'call',
    async (_peer: unknown, command: { params: { operation: string } }) => {
      assert.equal(command.params.operation, 'sync');
      throw new Error('Remote files changed.');
    },
  );
  const key = randomUUID();
  await assert.rejects(host.repeatMachineCheck(task.id, original.id, key), /Remote files changed/);
  const replay = await host.repeatMachineCheck(task.id, original.id, key);
  const attempt = replay.machineChecks!.attempts.at(-1)!;
  assert.equal(attempt.id, replay.attemptId);
  assert.equal(attempt.status, 'unconfirmed');
  assert.match(attempt.error!, /Remote files changed/);
  assert.equal(calls.mock.callCount(), 1);
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
    await use('sync');
    const diagnostic = await machineTool(
      host,
      session,
      'machine_run',
      { runnerId: node.id, executable: recipe.command, argv: recipe.args, purpose: 'diagnostic' },
      guard,
      true,
    );
    assert.equal(diagnostic.code, 0);
    const afterDiagnostic = (await host.reviewDiff(task.id)).machineChecks!;
    assert.equal(
      afterDiagnostic.passed,
      false,
      'a diagnostic cannot supersede failed verification',
    );
    const diagnosticAttempt = afterDiagnostic.attempts.at(-1)!;
    assert.equal(diagnosticAttempt.purpose, 'diagnostic');
    assert.equal(diagnosticAttempt.status, 'passed');
    assert.equal(
      afterDiagnostic.attempts.find(({ id }) => id === failed.attempts.at(-1)?.id)?.current,
      true,
    );
    const repeatedDiagnostic = await host.repeatMachineCheck(task.id, diagnosticAttempt.id);
    assert.equal(repeatedDiagnostic.machineChecks?.attempts.at(-1)?.purpose, 'diagnostic');
    assert.equal(repeatedDiagnostic.machineChecks?.passed, false);
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
