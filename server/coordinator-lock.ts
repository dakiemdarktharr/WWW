import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:net';
import { readFile, realpath, lstat, open, unlink, writeFile, rename } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
type ProcessIdentity = { token: string; startedAt?: number };
let ownIdentity: ProcessIdentity | null = null;
type FileIdentity = Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'mtimeMs' | 'size'>;
type LockRecord = {
  version: 2;
  pid: number;
  start: string | null;
  boot: string;
  nonce: string;
  file: FileIdentity;
};
const fileIdentity = (info: Stats): FileIdentity => ({
  dev: info.dev,
  ino: info.ino,
  birthtimeMs: info.birthtimeMs,
  mtimeMs: info.mtimeMs,
  size: info.size,
});
const sameFile = (a: FileIdentity, b: FileIdentity) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.birthtimeMs === b.birthtimeMs &&
  a.mtimeMs === b.mtimeMs &&
  a.size === b.size;

// Read kernel process identity only: never inspect command lines or credentials.
export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  // Our own start identity cannot change during this process. Do not spawn a
  // PowerShell instance for every workspace check, especially on busy machines.
  // Other PIDs are always queried afresh because Windows can reuse them.
  if (pid === process.pid && ownIdentity) return ownIdentity;
  const identity = await readProcessIdentity(pid);
  if (pid === process.pid && identity) ownIdentity = identity;
  return identity;
}

async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  try {
    if (process.platform === 'win32') {
      const shell = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      );
      const { stdout } = await execute(
        shell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `try { [Console]::Out.Write((Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks) } catch { exit 3 }`,
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 4096 },
      );
      const ticks = stdout.trim();
      if (!/^\d{15,20}$/.test(ticks)) return null;
      return {
        token: `windows:${ticks}`,
        startedAt: Number(BigInt(ticks) / 10000n) - 62135596800000,
      };
    }
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      if (!/^\d+$/.test(ticks)) return null;
      let startedAt: number | undefined;
      try {
        const { stdout } = await execute('getconf', ['CLK_TCK'], {
          timeout: 2000,
          maxBuffer: 4096,
        });
        const rate = Number(stdout.trim());
        if (rate > 0) startedAt = Date.now() - (os.uptime() - Number(ticks) / rate) * 1000;
      } catch {
        /* The start token remains sufficient for version 2 locks. */
      }
      return { token: `linux:${ticks}`, startedAt };
    }
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {
      timeout: 2000,
      maxBuffer: 4096,
      env: { ...process.env, LC_ALL: 'C' },
    });
    const value = stdout.trim();
    const startedAt = Date.parse(value);
    return value && Number.isFinite(startedAt) ? { token: `unix:${value}`, startedAt } : null;
  } catch {
    return null;
  }
}

async function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // Windows can retain an exited PID's kernel object and return EPERM to
    // kill(pid, 0). Only an explicit OS "no process" result proves it is stale;
    // access denial, timeout and unknown errors must still preserve the lock.
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      try {
        const shell = path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        );
        const { stdout } = await execute(
          shell,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `try { $null = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write('present') } catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { [Console]::Out.Write('absent') } else { exit 3 } }`,
          ],
          { windowsHide: true, timeout: 15000, maxBuffer: 4096 },
        );
        if (stdout.trim() === 'absent') return false;
      } catch {
        /* Ambiguous ownership is never reclaimed. */
      }
    }
    return true;
  }
}

async function currentBoot() {
  if (process.platform !== 'linux') return '';
  try {
    return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  } catch {
    return '';
  }
}

function closeGuard(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function reserveGuard(directory: string) {
  const key = createHash('sha256')
    .update(process.platform === 'win32' ? directory.toLowerCase() : directory)
    .digest('hex');
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      const options =
        process.platform === 'win32'
          ? { path: `\\\\.\\pipe\\kivuno-coordinator-${key}` }
          : process.platform === 'linux'
            ? { path: `\0kivuno-coordinator-${key}` }
            : // macOS has no abstract sockets. A collision fails closed; it never shares a lock.
              {
                host: '127.0.0.1',
                port: 49152 + (parseInt(key.slice(0, 4), 16) % 16384),
                exclusive: true,
              };
      server.listen(options, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    server.unref();
    return server;
  } catch {
    await closeGuard(server);
    throw new Error(
      'This Kivuno workspace is already open, or its local coordinator lock is unavailable.',
    );
  }
}

/** One live coordinator per state directory, even while recovering a stale PID file. */
export async function acquireCoordinatorLock(directory: string) {
  const actual = await realpath(directory);
  const guard = await reserveGuard(actual);
  const file = path.join(actual, 'coordinator.lock');
  const identityFile = path.join(actual, 'coordinator.identity.json');
  const bootFile = path.join(actual, 'coordinator.boot');
  const boot = await currentBoot();
  let content = '';
  let metadata = '';
  let ownedFile: FileIdentity | null = null;
  let released = false;
  const ownsFile = async () => {
    const info = await lstat(file);
    return Boolean(
      ownedFile &&
      info.isFile() &&
      sameFile(fileIdentity(info), ownedFile) &&
      (await readFile(file, 'utf8')) === content,
    );
  };
  try {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
        throw new Error('The coordinator lock needs manual recovery; its file type is invalid.');
      const previous = await readFile(file, 'utf8');
      const pid = Number(previous);
      if (!/^\d+\s*$/.test(previous) || !Number.isSafeInteger(pid) || pid <= 0)
        throw new Error('The coordinator lock needs manual recovery; its identity is invalid.');
      let record: LockRecord | null = null;
      try {
        const metadataInfo = await lstat(identityFile);
        if (metadataInfo.isFile() && !metadataInfo.isSymbolicLink() && metadataInfo.size <= 4096) {
          const candidate = JSON.parse(await readFile(identityFile, 'utf8')) as LockRecord;
          if (
            candidate?.version === 2 &&
            candidate.pid === pid &&
            candidate.file &&
            typeof candidate.nonce === 'string' &&
            typeof candidate.boot === 'string' &&
            (candidate.start === null || typeof candidate.start === 'string') &&
            sameFile(candidate.file, fileIdentity(info))
          )
            record = candidate;
        }
      } catch {
        /* Missing/unknown metadata is handled as a legacy numeric record. */
      }
      let oldBoot = record?.boot || '';
      if (!record && boot) {
        try {
          oldBoot = (await readFile(bootFile, 'utf8')).trim();
        } catch {
          /* Pre-cloud lock. */
        }
      }
      let stale = Boolean(boot && oldBoot && boot !== oldBoot) || !(await processAlive(pid));
      if (!stale) {
        const identity = await processIdentity(pid);
        if (record?.start && identity) stale = record.start !== identity.token;
        // Old numeric records have no kernel identity. Only a definitely newer process
        // proves PID reuse; unreadable/ambiguous live owners are kept, never killed.
        else if (!record?.start && identity?.startedAt)
          stale = identity.startedAt > info.mtimeMs + 2000;
      }
      if (!stale) throw new Error(`Kivuno is already running for this workspace (process ${pid}).`);
      // The OS guard serializes new coordinators. Recheck before deleting a legacy record.
      if (
        (await readFile(file, 'utf8')) !== previous ||
        !sameFile(fileIdentity(await lstat(file)), fileIdentity(info))
      )
        throw new Error('The coordinator lock changed during recovery. Retry opening Kivuno.');
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const identity = await processIdentity(process.pid);
    // Keep the PID file numeric: old Kivuno releases must still recognize a live owner.
    content = String(process.pid);
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
      ownedFile = fileIdentity(await handle.stat());
    } finally {
      await handle.close();
    }
    // Windows can finalize LastWriteTime when the writing handle is closed.
    ownedFile = fileIdentity(await lstat(file));
    const record: LockRecord = {
      version: 2,
      pid: process.pid,
      start: identity?.token || null,
      boot,
      nonce: randomUUID(),
      file: ownedFile,
    };
    metadata = JSON.stringify(record);
    const temporary = path.join(actual, `coordinator.identity.${record.nonce}.tmp`);
    try {
      await writeFile(temporary, metadata, { flag: 'wx', mode: 0o600 });
      await rename(temporary, identityFile);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    // Kept for compatibility with pre-v2 cloud coordinators restored from snapshots.
    if (boot) await writeFile(bootFile, boot, { mode: 0o600 });
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          if (await ownsFile()) {
            await unlink(file);
            if ((await readFile(identityFile, 'utf8')) === metadata) await unlink(identityFile);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        } finally {
          await closeGuard(guard);
        }
      },
    };
  } catch (error) {
    if (ownedFile) {
      try {
        if (await ownsFile()) {
          await unlink(file);
          if ((await readFile(identityFile, 'utf8')) === metadata) await unlink(identityFile);
        }
      } catch {
        /* Preserve unknown records. */
      }
    }
    await closeGuard(guard);
    throw error;
  }
}
