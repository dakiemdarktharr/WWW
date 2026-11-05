import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, lstat, utimes, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireCoordinatorLock, processIdentity } from '../server/coordinator-lock.ts';

const moduleUrl = new URL('../server/coordinator-lock.ts', import.meta.url).href;
const children = new Set<ChildProcess>();
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-coordinator-test-'));
  try {
    await run(directory);
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await exited;
      }
    children.clear();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('kivuno-coordinator-test-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
async function contender(directory: string) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { acquireCoordinatorLock } from ${JSON.stringify(moduleUrl)};
    try {
      const lock = await acquireCoordinatorLock(process.argv[1]);
      process.on('message', async () => { await lock.release(); process.exit(0); });
      process.send({ ready: true });
    } catch (error) { process.send({ ready: false, error: error.message }, () => process.exit(2)); }
  `,
      directory,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  children.add(child);
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk).slice(0, 2048);
  });
  const result = await new Promise<{ ready: boolean; error?: string }>((resolve, reject) => {
    let received = false;
    const timer = setTimeout(() => reject(new Error('Child startup timed out. ' + stderr)), 25000);
    child.once('message', (message) => {
      received = true;
      clearTimeout(timer);
      resolve(message as any);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!received) {
        clearTimeout(timer);
        reject(new Error(`Child exited before reporting (${code}): ${stderr}`));
      }
    });
  });
  return { child, result };
}

test('kernel start identity is stable and a live coordinator cannot be opened twice', () =>
  fixture(async (directory) => {
    const identity = await processIdentity(process.pid);
    assert.ok(identity?.token, 'The actual operating system must return a process start identity.');
    assert.equal((await processIdentity(process.pid))?.token, identity.token);
    const lock = await acquireCoordinatorLock(directory);
    try {
      assert.equal(
        Number(await readFile(path.join(directory, 'coordinator.lock'), 'utf8')),
        process.pid,
        'older releases still see a numeric live PID',
      );
      const metadata = JSON.parse(
        await readFile(path.join(directory, 'coordinator.identity.json'), 'utf8'),
      );
      const info = await lstat(path.join(directory, 'coordinator.lock'));
      assert.equal(metadata.start, identity.token);
      assert.deepEqual(metadata.file, {
        dev: info.dev,
        ino: info.ino,
        birthtimeMs: info.birthtimeMs,
        mtimeMs: info.mtimeMs,
        size: info.size,
      });
      await assert.rejects(acquireCoordinatorLock(directory), /already open|lock is unavailable/);
    } finally {
      await lock.release();
      await lock.release();
    }
    const next = await acquireCoordinatorLock(directory);
    await next.release();
  }));

test('real concurrent processes have one winner and abrupt exit is recoverable', () =>
  fixture(async (directory) => {
    const attempts = await Promise.all([contender(directory), contender(directory)]);
    assert.equal(attempts.filter((entry) => entry.result.ready).length, 1);
    const winner = attempts.find((entry) => entry.result.ready)!;
    assert.equal(
      Number(await readFile(path.join(directory, 'coordinator.lock'), 'utf8')),
      winner.child.pid,
    );
    const exited = new Promise<void>((resolve) => winner.child.once('exit', () => resolve()));
    winner.child.kill('SIGKILL');
    await exited;
    const recovered = await acquireCoordinatorLock(directory);
    await recovered.release();
  }));

test('kernel identity detects a reused live PID without terminating that process', () =>
  fixture(async (directory) => {
    const lock = await acquireCoordinatorLock(directory);
    const file = path.join(directory, 'coordinator.lock');
    const identityFile = path.join(directory, 'coordinator.identity.json');
    const metadata = JSON.parse(await readFile(identityFile, 'utf8'));
    await lock.release();
    await writeFile(file, String(process.pid));
    const info = await lstat(file);
    metadata.start += ':previous-incarnation';
    metadata.file = {
      dev: info.dev,
      ino: info.ino,
      birthtimeMs: info.birthtimeMs,
      mtimeMs: info.mtimeMs,
      size: info.size,
    };
    await writeFile(identityFile, JSON.stringify(metadata));
    const recovered = await acquireCoordinatorLock(directory);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
    await recovered.release();
  }));

test('legacy numeric ownership is preserved unless the kernel proves a newer process', () =>
  fixture(async (directory) => {
    const file = path.join(directory, 'coordinator.lock');
    await writeFile(file, String(process.pid));
    await assert.rejects(acquireCoordinatorLock(directory), /already running/);
    assert.equal(await readFile(file, 'utf8'), String(process.pid));
    const identity = await processIdentity(process.pid);
    assert.ok(identity?.startedAt);
    const old = new Date(identity.startedAt - 10000);
    await utimes(file, old, old);
    const recovered = await acquireCoordinatorLock(directory);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
    await recovered.release();
  }));

test('release never deletes a replacement lock, and ambiguous records fail closed', () =>
  fixture(async (directory) => {
    const file = path.join(directory, 'coordinator.lock');
    const lock = await acquireCoordinatorLock(directory);
    await writeFile(file, 'replacement-owner');
    await lock.release();
    assert.equal(await readFile(file, 'utf8'), 'replacement-owner');
    await assert.rejects(acquireCoordinatorLock(directory), /manual recovery/);
    await rm(file);
    await mkdir(file);
    await assert.rejects(acquireCoordinatorLock(directory), /file type is invalid/);
  }));

test(
  'Windows EPERM requires an OS absence check and never reclaims a present owner',
  { skip: process.platform !== 'win32' },
  () =>
    fixture(async (directory) => {
      const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      const deadPid = dead.pid!;
      await new Promise<void>((resolve) => dead.once('exit', () => resolve()));
      const original = process.kill;
      // Reproduce Windows' retained-handle EPERM while the actual OS probe
      // distinguishes an exited PID from this still-running test process.
      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0 && (pid === deadPid || pid === process.pid))
          throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
        return original(pid, signal);
      }) as typeof process.kill;
      try {
        const file = path.join(directory, 'coordinator.lock');
        await writeFile(file, String(process.pid));
        await assert.rejects(acquireCoordinatorLock(directory), /already running/);
        assert.equal(await readFile(file, 'utf8'), String(process.pid));
        await writeFile(file, String(deadPid));
        const recovered = await acquireCoordinatorLock(directory);
        await recovered.release();
      } finally {
        process.kill = original;
      }
    }),
);

test(
  'a different Linux boot releases old cloud ownership despite a reused PID',
  { skip: process.platform !== 'linux' },
  () =>
    fixture(async (directory) => {
      const file = path.join(directory, 'coordinator.lock');
      await writeFile(file, String(process.pid));
      await writeFile(path.join(directory, 'coordinator.boot'), 'another-microvm-boot');
      const recovered = await acquireCoordinatorLock(directory);
      await recovered.release();
    }),
);
