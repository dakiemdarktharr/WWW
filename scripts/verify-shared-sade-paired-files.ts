import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Task } from '../shared/types.ts';
import { git } from '../server/git.ts';
import {
  assertMachineChecks,
  beginMachineCheck,
  evidenceHash,
  inspectMachineChecks,
  receiveMachineResult,
  type MachineCheck,
  type MachineCommand,
} from '../server/machine-checks.ts';
import {
  MachineExecutor,
  executionGrantSchema,
  type ExecutionGrant,
} from '../server/machine-execution.ts';
import {
  applyRunnerFiles,
  exportRunnerFiles,
  snapshotDigest,
  validateRunnerFiles,
  type RunnerFile,
} from '../server/runner-files.ts';
import { Store } from '../server/store.ts';
import {
  pathProgram,
  portablePathProgram,
  smokeProgram,
} from '../tests/fixtures/shared-sade-path-check.ts';

const [stage, outputDirectory] = process.argv.slice(2);
assert.ok(stage === 'prepare' || stage === 'macos' || stage === 'verify');
assert.ok(outputDirectory, 'Provide a directory for the fixture artifacts.');
assert.equal(process.platform, stage === 'macos' ? 'darwin' : 'win32');
const directory = path.resolve(outputDirectory);
await mkdir(directory, { recursive: true });
const sha = await git(process.cwd(), ['rev-parse', 'HEAD']);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kivuno-paired-files-')));
const store = new Store(':memory:');
const runner = { id: randomUUID(), name: 'macOS tool runner' };
const diagnostic: MachineCommand = {
  command: 'node',
  args: ['-e', 'require("./platform-smoke.cjs")'],
  timeoutMs: 10000,
};
const verification: MachineCommand = {
  command: 'node',
  args: ['platform-smoke.cjs'],
  timeoutMs: 10000,
};
type Transfer = {
  sha: string;
  grant: ExecutionGrant;
  task: Task;
  files: RunnerFile[];
  checks: { diagnostic: MachineCheck; verification: MachineCheck };
};

async function save(name: string, value: unknown) {
  await writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
}
const read = async (name: string) => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
function validatedFiles(input: unknown, fixed = false) {
  const files = validateRunnerFiles(input);
  assert.deepEqual(files.map(({ path }) => path).sort(), ['path-label.cjs', 'platform-smoke.cjs']);
  assert.equal(
    Buffer.from(files.find(({ path }) => path === 'path-label.cjs')!.data, 'base64').toString(),
    fixed ? portablePathProgram : pathProgram,
  );
  assert.equal(
    Buffer.from(files.find(({ path }) => path === 'platform-smoke.cjs')!.data, 'base64').toString(),
    smokeProgram,
  );
  return files;
}
async function source() {
  await git(root, ['init']);
  await writeFile(path.join(root, 'path-label.cjs'), pathProgram);
  await writeFile(path.join(root, 'platform-smoke.cjs'), smokeProgram);
  await writeFile(path.join(root, '.env.local'), 'LOCAL_FIXTURE=kept-on-windows\n');
  assert.equal(
    execFileSync(process.execPath, verification.args, { cwd: root, encoding: 'utf8' }).trim(),
    'win32',
  );
  return validatedFiles(await exportRunnerFiles(root));
}

try {
  if (stage === 'prepare') {
    const files = await source();
    const project = store.put('project', {
      id: randomUUID(),
      name: 'Cross-platform path fixture',
      path: root,
      goal: 'Verify the path helper without exposing local settings.',
      createdAt: new Date().toISOString(),
    });
    const seeded = store.addTask({
      projectId: project.id,
      title: 'Test a Windows path on macOS',
      kind: 'code',
      description: '',
      status: 'ready',
      priority: 'medium',
      dependsOn: [],
      scope: ['path-label.cjs'],
      acceptance: 'Use the path component after either type of separator.',
    });
    const task = store.updateTask(seeded.id, {
      status: 'review',
      sharedSadeJobId: randomUUID(),
    });
    const grant = {
      id: randomUUID(),
      projectId: project.id,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      fullAccess: true,
    };
    const approval = { ...grant, platform: 'darwin', arch: 'arm64' };
    const checks = {
      diagnostic: beginMachineCheck(store, task, runner, approval, diagnostic, {
        purpose: 'diagnostic',
      }),
      verification: beginMachineCheck(store, task, runner, approval, verification),
    };
    await save('windows-source.json', { sha, grant, task, checks, files } satisfies Transfer);
    console.log(`Windows baseline passed. Approved source digest ${snapshotDigest(files)}.`);
  } else {
    const transfer: Transfer = await read('windows-source.json');
    assert.equal(transfer.sha, sha);
    const grant = executionGrantSchema.parse(transfer.grant);
    const current = () =>
      assert.ok(Date.parse(grant.expiresAt) > Date.now(), 'Machine permission expired.');
    current();
    const original = validatedFiles(transfer.files);
    const { checks, task } = transfer;
    assert.equal(task.projectId, grant.projectId);
    assert.deepEqual(task.scope, ['path-label.cjs']);
    assert.equal(task.worktree, null);
    if (stage === 'macos') {
      assert.equal(process.arch, 'arm64');
      const machine = new MachineExecutor(path.join(root, 'worker'), grant);
      const context = { projectId: grant.projectId, grantId: grant.id, taskId: task.id };
      const run = (check: MachineCheck, recipe: MachineCommand) =>
        machine.perform(check.id, {
          ...context,
          checkId: check.id,
          baseCommit: task.baseCommit,
          operation: 'run',
          args: recipe,
        });
      try {
        await machine.perform(randomUUID(), {
          ...context,
          operation: 'sync',
          args: { files: original, before: [] },
        });
        const failed = await run(checks.diagnostic, diagnostic);
        assert.ok('evidence' in failed && failed.evidence && failed.proof);
        assert.equal(failed.evidence.code, 1);
        assert.match(failed.stderr, /registration/);
        assert.equal(failed.evidence.input, snapshotDigest(original));
        await machine.perform(randomUUID(), {
          ...context,
          operation: 'write',
          args: { path: 'path-label.cjs', content: portablePathProgram },
        });
        const passed = await run(checks.verification, verification);
        assert.ok('evidence' in passed && passed.evidence && passed.proof);
        assert.equal(passed.evidence.code, 0, passed.stderr);
        assert.equal(passed.stdout.trim(), 'darwin');
        const exported = await machine.perform(randomUUID(), { ...context, operation: 'export' });
        assert.ok('files' in exported);
        const files = validatedFiles(exported.files, true);
        assert.equal(passed.evidence.input, snapshotDigest(files));
        await save('macos-results.json', {
          sha,
          files,
          diagnostic: { evidence: failed.evidence, proof: failed.proof },
          verification: { evidence: passed.evidence, proof: passed.proof },
        });
        console.log('macOS arm64 reproduced the path error and verified the edited helper.');
      } finally {
        await machine.stop();
      }
    } else {
      const result = await read('macos-results.json');
      assert.equal(result.sha, sha);
      const fixed = validatedFiles(result.files, true);
      assert.deepEqual(await source(), original);
      const working = { ...task, worktree: root };
      const kind = 'machineCheck:' + task.id;
      store.put(kind, checks.diagnostic);
      receiveMachineResult(
        store,
        working,
        checks.diagnostic,
        evidenceHash(diagnostic),
        result.diagnostic,
      );
      const before = await inspectMachineChecks(store, working, true);
      assert.equal(before?.attempts[0]?.status, 'failed');
      assert.equal(before?.attempts[0]?.purpose, 'diagnostic');
      assert.equal(before?.passed, false);
      store.put(kind, checks.verification);
      receiveMachineResult(
        store,
        working,
        checks.verification,
        evidenceHash(verification),
        result.verification,
      );
      const stale = await inspectMachineChecks(store, working, true);
      assert.equal(stale?.attempts.at(-1)?.status, 'stale');
      assert.equal(stale?.passed, false);
      await applyRunnerFiles(root, original, fixed, task.scope, current);
      assert.deepEqual(await exportRunnerFiles(root), fixed);
      assert.equal(await assertMachineChecks(store, working, true), true);
      const complete = await inspectMachineChecks(store, working, true);
      assert.equal(complete?.attempts[0]?.status, 'failed');
      assert.equal(complete?.attempts.at(-1)?.status, 'passed');
      assert.equal(complete?.attempts[0]?.signer, complete?.attempts.at(-1)?.signer);
      assert.equal(
        await readFile(path.join(root, '.env.local'), 'utf8'),
        'LOCAL_FIXTURE=kept-on-windows\n',
      );
      assert.equal(
        execFileSync(process.execPath, verification.args, { cwd: root, encoding: 'utf8' }).trim(),
        'win32',
      );
      const summary = {
        sha,
        input: snapshotDigest(original),
        verifiedInput: snapshotDigest(fixed),
        returnedPaths: task.scope,
        verificationBeforePull: stale?.attempts.at(-1)?.status,
        checks: complete,
      };
      await save('windows-verification.json', summary);
      console.log(JSON.stringify(summary));
    }
  }
} finally {
  store.close();
  assert.equal(path.dirname(root), await realpath(os.tmpdir()));
  await rm(root, { recursive: true, force: true });
}
