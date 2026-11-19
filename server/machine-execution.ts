import path from 'node:path';
import os from 'node:os';
import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { codexEnvironment } from './codex.ts';
import { providerFileTool } from './provider-files.ts';
import {
  machineInput,
  applyRunnerFiles,
  exportRunnerFiles,
  validateRunnerFiles,
  snapshotDigest,
  machineSnapshotLimits,
  machineChunkBytes,
  machinePacketBytes,
} from './runner-files.ts';
import { createHash } from 'node:crypto';
import { git } from './git.ts';
import { machineSigningKey, signMachineResult } from './machine-signature.ts';
import { machineCommand, evidenceHash, type MachineCommand } from './machine-checks.ts';
import { redact } from './security.ts';

export const executionGrantSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
    fullAccess: z.boolean(),
  })
  .strict();
export type ExecutionGrant = z.infer<typeof executionGrantSchema>;
export const executionMetadataSchema = executionGrantSchema.extend({
  platform: z.enum(['win32', 'darwin', 'linux']),
  arch: z.string().max(30),
});
const commandSchema = z
  .object({
    grantId: z.string().uuid(),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    checkId: z.string().uuid().optional(),
    baseCommit: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .nullable()
      .optional(),
    operation: z.enum([
      'sync',
      'read',
      'write',
      'run',
      'export',
      'info',
      'cancel',
      'snapshot-upload',
      'snapshot-apply',
      'snapshot-export',
      'snapshot-read',
    ]),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const execute = promisify(execFile);
const transferOffset = z.number().int().min(0).max(machinePacketBytes);
const transferId = z.string().uuid();
const snapshotHash = z.string().regex(/^[a-f0-9]{64}$/);
const hashPacket = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const transferLease = 30_000;

/** Executes tools, never an AI login. Authority is granted locally by the machine owner. */
export class MachineExecutor {
  private active = new Map<
    string,
    { child: ChildProcess; closed: Promise<void>; taskId: string }
  >();
  private busy = new Map<string, AbortController>();
  private snapshots = new Map<
    string,
    { id: string; bytes: Buffer; offset: number; expires: number; direction: 'upload' | 'download' }
  >();
  private stopping = false;
  private watchdog: NodeJS.Timeout;
  constructor(
    private dataDir: string,
    readonly grant?: ExecutionGrant,
  ) {
    if (grant) executionGrantSchema.parse(grant);
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const [taskId, snapshot] of this.snapshots)
        if (snapshot.expires <= now) this.snapshots.delete(taskId);
      if (this.grant && Date.parse(this.grant.expiresAt) <= Date.now())
        void this.stop().catch(() => {});
    }, 250);
    this.watchdog.unref();
  }
  metadata() {
    if (!this.grant || this.stopping || Date.parse(this.grant.expiresAt) <= Date.now())
      return undefined;
    return {
      ...this.grant,
      platform: process.platform,
      arch: process.arch,
    };
  }
  private assert(grantId: string, projectId: string, fullAccess = false) {
    if (
      !this.grant ||
      this.stopping ||
      grantId !== this.grant.id ||
      projectId !== this.grant.projectId ||
      Date.parse(this.grant.expiresAt) <= Date.now()
    )
      throw new Error('This machine has not granted current access to this project.');
    if (fullAccess && !this.grant.fullAccess)
      throw new Error('The machine owner has not granted full-access execution.');
  }
  async perform(commandId: string, input: unknown) {
    z.string().uuid().parse(commandId);
    const values = commandSchema.parse(input);
    const { grantId, projectId, taskId, operation, args } = values;
    this.assert(grantId, projectId, ['write', 'run'].includes(operation));
    if (operation === 'cancel') {
      this.snapshots.delete(taskId);
      this.busy.get(taskId)?.abort(new Error('Machine operation was cancelled.'));
      await Promise.all(
        [...this.active]
          .filter(([, value]) => value.taskId === taskId)
          .map(([id]) => this.terminate(id)),
      );
      return { stopped: true };
    }
    if (this.busy.has(taskId) || this.busy.size >= 2)
      throw new Error('The machine workspace is busy.');
    const controller = new AbortController();
    this.busy.set(taskId, controller);
    const current = (full = false) => {
      this.assert(grantId, projectId, full);
      controller.signal.throwIfAborted();
    };
    try {
      const receipts = path.join(this.dataDir, 'execution-receipts', grantId);
      await mkdir(receipts, { recursive: true, mode: 0o700 });
      // A lost acknowledgement or process restart cannot execute a mutation twice.
      await writeFile(
        path.join(receipts, commandId + '.json'),
        JSON.stringify({ ...values, args: undefined, state: 'accepted' }),
        { flag: 'wx', mode: 0o600 },
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST')
          throw new Error(
            'This command was already accepted; its outcome must be recovered, not replayed.',
          );
        throw error;
      });
      current();
      const root = path.join(this.dataDir, 'remote-workspaces', taskId);
      for (const folder of [this.dataDir, path.dirname(root), root]) {
        const info = await lstat(folder).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (info?.isSymbolicLink() || (info && !info.isDirectory()))
          throw new Error('Machine workspace is not a regular directory.');
      }
      if (operation === 'info')
        return {
          platform: process.platform,
          arch: process.arch,
          release: os.release(),
          fullAccess: this.grant!.fullAccess,
        };
      if (
        operation === 'snapshot-upload' ||
        operation === 'snapshot-apply' ||
        operation === 'snapshot-export' ||
        operation === 'snapshot-read'
      )
        return await this.transfer(root, values, operation, current);
      if (operation === 'sync') {
        const files = validateRunnerFiles(args.files);
        await mkdir(root, { recursive: true, mode: 0o700 });
        await git(root, ['init']);
        const before = await exportRunnerFiles(root);
        // A later sync must carry the exact last observed remote files, otherwise
        // the coordinator could overwrite edits made on this machine.
        const expected = validateRunnerFiles(args.before || []);
        if (JSON.stringify(before) !== JSON.stringify(expected))
          throw new Error('Remote files changed; inspect/export them before synchronizing again.');
        await applyRunnerFiles(root, before, files, ['.'], current);
        return {
          files: await exportRunnerFiles(root),
          platform: process.platform,
          arch: process.arch,
        };
      }
      if (!(await lstat(root)).isDirectory())
        throw new Error('Synchronize the project before using this workspace.');
      if (operation === 'export') return { files: await exportRunnerFiles(root) };
      if (operation === 'read' || operation === 'write')
        return providerFileTool(
          operation === 'read' ? 'workspace_read_file' : 'workspace_write_file',
          args,
          { cwd: root, readOnly: operation === 'read', scopes: ['.'] },
          () => current(operation === 'write'),
        );
      const run = machineCommand.parse(args);
      return await this.run(
        commandId,
        values.checkId ?? commandId,
        values.baseCommit ?? null,
        root,
        run,
        () => current(true),
      );
    } finally {
      this.busy.delete(taskId);
    }
  }
  private async transfer(
    root: string,
    values: Pick<z.infer<typeof commandSchema>, 'taskId' | 'args'>,
    operation: 'snapshot-upload' | 'snapshot-apply' | 'snapshot-export' | 'snapshot-read',
    current: () => void,
  ) {
    const { taskId, args } = values;
    const existing = this.snapshots.get(taskId);
    if (operation === 'snapshot-upload') {
      const part = z
        .object({
          id: transferId,
          offset: transferOffset,
          size: transferOffset.min(1),
          data: z
            .string()
            .min(1)
            .max(Math.ceil(machineChunkBytes / 3) * 4),
        })
        .strict()
        .parse(args);
      const bytes = Buffer.from(part.data, 'base64');
      if (
        !bytes.length ||
        bytes.toString('base64') !== part.data ||
        part.offset + bytes.length > part.size
      )
        throw new Error('Invalid snapshot chunk.');
      current();
      if (part.offset === 0 && existing?.id !== part.id) {
        if (!existing && this.snapshots.size >= 2)
          throw new Error('Machine snapshot transfer is busy.');
        this.snapshots.set(taskId, {
          id: part.id,
          bytes: Buffer.alloc(part.size),
          offset: 0,
          expires: Date.now() + transferLease,
          direction: 'upload',
        });
      }
      const upload = this.snapshots.get(taskId);
      if (
        !upload ||
        upload.direction !== 'upload' ||
        upload.expires <= Date.now() ||
        upload.id !== part.id ||
        upload.bytes.length !== part.size ||
        upload.offset !== part.offset
      )
        throw new Error('Snapshot upload has an unexpected chunk offset.');
      bytes.copy(upload.bytes, upload.offset);
      upload.offset += bytes.length;
      upload.expires = Date.now() + transferLease;
      return { offset: upload.offset };
    }
    if (operation === 'snapshot-apply') {
      const commit = z
        .object({ id: transferId, digest: snapshotHash, before: snapshotHash })
        .strict()
        .parse(args);
      if (
        !existing ||
        existing.direction !== 'upload' ||
        existing.expires <= Date.now() ||
        existing.id !== commit.id ||
        existing.offset !== existing.bytes.length ||
        hashPacket(existing.bytes) !== commit.digest
      )
        throw new Error('Snapshot upload is incomplete or invalid.');
      this.snapshots.delete(taskId);
      const files = validateRunnerFiles(
        JSON.parse(existing.bytes.toString('utf8')),
        machineSnapshotLimits,
      );
      current();
      await mkdir(root, { recursive: true, mode: 0o700 });
      await git(root, ['init']);
      const before = await exportRunnerFiles(root, machineSnapshotLimits);
      if (snapshotDigest(before) !== commit.before)
        throw new Error('Remote files changed; inspect/export them before synchronizing again.');
      await applyRunnerFiles(root, before, files, ['.'], current, machineSnapshotLimits);
      const digest = snapshotDigest(await exportRunnerFiles(root, machineSnapshotLimits));
      current();
      return { digest, platform: process.platform, arch: process.arch };
    }
    if (operation === 'snapshot-export') {
      const { id } = z.object({ id: transferId }).strict().parse(args);
      const bytes = Buffer.from(
        JSON.stringify(await exportRunnerFiles(root, machineSnapshotLimits)),
      );
      if (bytes.length > machinePacketBytes)
        throw new Error('Machine snapshot exceeds its transfer limit.');
      current();
      if (!this.snapshots.has(taskId) && this.snapshots.size >= 2)
        throw new Error('Machine snapshot transfer is busy.');
      this.snapshots.set(taskId, {
        id,
        bytes,
        offset: 0,
        expires: Date.now() + transferLease,
        direction: 'download',
      });
      return { size: bytes.length, digest: hashPacket(bytes) };
    }
    const next = z.object({ id: transferId, offset: transferOffset }).strict().parse(args);
    if (
      !existing ||
      existing.direction !== 'download' ||
      existing.expires <= Date.now() ||
      existing.id !== next.id ||
      existing.offset !== next.offset
    )
      throw new Error('Snapshot download has an unexpected chunk offset.');
    current();
    const bytes = existing.bytes.subarray(next.offset, next.offset + machineChunkBytes);
    existing.offset += bytes.length;
    existing.expires = Date.now() + transferLease;
    if (existing.offset === existing.bytes.length) this.snapshots.delete(taskId);
    return { data: bytes.toString('base64') };
  }
  private async run(
    id: string,
    checkId: string,
    baseCommit: string | null,
    root: string,
    input: MachineCommand,
    assertCurrent: () => void,
  ) {
    assertCurrent();
    const home = path.join(this.dataDir, 'execution-home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    const env = codexEnvironment(home);
    delete env.CODEX_HOME;
    env.HOME = home;
    env.USERPROFILE = home;
    // Full access is explicitly chosen by the host. cwd is not an OS sandbox.
    const inputDigest = await machineInput(root);
    assertCurrent();
    const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
    const child = spawn(input.command === 'node' ? process.execPath : input.command, input.args, {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      exceeded = false,
      timedOut = false;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    this.active.set(id, { child, closed, taskId: path.basename(root) });
    const capture = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      hashes[kind].update(chunk);
      bytes += chunk.length;
      if (bytes > 128000) {
        exceeded = true;
        void this.terminate(id).catch(() => {});
        return;
      }
      if (kind === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      void this.terminate(id).catch(() => {});
    }, input.timeoutMs);
    timer.unref();
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assertCurrent();
      clearTimeout(timer);
      const after = await machineInput(root);
      assertCurrent();
      const evidence = {
        version: 1,
        baseCommit,
        runId: id,
        checkId,
        taskId: path.basename(root),
        projectId: this.grant!.projectId,
        grantId: this.grant!.id,
        platform: process.platform,
        arch: process.arch,
        code,
        timedOut,
        outputTruncated: exceeded,
        completedAt: new Date().toISOString(),
        recipe: evidenceHash(input),
        input: inputDigest,
        after,
        output: evidenceHash([hashes.stdout.digest('hex'), hashes.stderr.digest('hex')]),
        release: os.release(),
        runtime: process.version,
      };
      const proof = signMachineResult(await machineSigningKey(this.dataDir), evidence);
      assertCurrent();
      return {
        evidence,
        proof,
        code,
        stdout: redact(stdout).slice(0, 20000),
        stderr: redact(stderr).slice(0, 20000),
        timedOut,
        outputTruncated: exceeded,
        platform: process.platform,
        arch: process.arch,
      };
    } finally {
      clearTimeout(timer);
      this.active.delete(id);
    }
  }
  private async terminate(id: string) {
    const active = this.active.get(id);
    if (!active) return;
    const { child, closed } = active;
    if (child.pid && process.platform === 'win32')
      await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      }).catch(() => child.kill());
    else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else child.kill();
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Machine command termination is uncertain.')), 3000),
      ),
    ]);
  }
  async stop() {
    this.snapshots.clear();
    this.stopping = true;
    for (const controller of this.busy.values()) controller.abort(new Error('Machine stopped.'));
    clearInterval(this.watchdog);
    await Promise.all([...this.active.keys()].map((id) => this.terminate(id)));
  }
}
