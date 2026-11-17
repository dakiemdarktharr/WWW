import path from 'node:path';
import os from 'node:os';
import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { codexEnvironment } from './codex.ts';
import { providerFileTool } from './provider-files.ts';
import { applyRunnerFiles, exportRunnerFiles, validateRunnerFiles } from './runner-files.ts';
import { git } from './git.ts';
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
    operation: z.enum(['sync', 'read', 'write', 'run', 'export', 'info', 'cancel']),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const runSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(1000)
      .refine((value) => !/[\r\n\0]/.test(value)),
    args: z.array(z.string().max(10000)).max(64).default([]),
    timeoutMs: z.number().int().min(100).max(60000).default(30000),
  })
  .strict();
const execute = promisify(execFile);

/** Executes tools, never an AI login. Authority is granted locally by the machine owner. */
export class MachineExecutor {
  private active = new Map<
    string,
    { child: ChildProcess; closed: Promise<void>; taskId: string }
  >();
  private busy = new Set<string>();
  private stopping = false;
  private watchdog: NodeJS.Timeout;
  constructor(
    private dataDir: string,
    readonly grant?: ExecutionGrant,
  ) {
    if (grant) executionGrantSchema.parse(grant);
    this.watchdog = setInterval(() => {
      if (this.grant && Date.parse(this.grant.expiresAt) <= Date.now())
        void this.stop().catch(() => {});
    }, 250);
    this.watchdog.unref();
  }
  metadata() {
    if (!this.grant || this.stopping || Date.parse(this.grant.expiresAt) <= Date.now())
      return undefined;
    return { ...this.grant, platform: process.platform, arch: process.arch };
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
      await Promise.all(
        [...this.active]
          .filter(([, value]) => value.taskId === taskId)
          .map(([id]) => this.terminate(id)),
      );
      return { stopped: true };
    }
    if (this.busy.has(taskId) || this.busy.size >= 2)
      throw new Error('The machine workspace is busy.');
    this.busy.add(taskId);
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
      this.assert(grantId, projectId);
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
        await applyRunnerFiles(root, before, files, ['.'], () => this.assert(grantId, projectId));
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
          () => this.assert(grantId, projectId, operation === 'write'),
        );
      const run = runSchema.parse(args);
      return await this.run(commandId, root, run, () => this.assert(grantId, projectId, true));
    } finally {
      this.busy.delete(taskId);
    }
  }
  private async run(
    id: string,
    root: string,
    input: z.infer<typeof runSchema>,
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
      return {
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
    this.stopping = true;
    clearInterval(this.watchdog);
    await Promise.all([...this.active.keys()].map((id) => this.terminate(id)));
  }
}
