import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CodexClient, codexEnvironment, redactCodexError, type DynamicTool } from './codex.ts';
import { GeminiTools } from './gemini-tools.ts';
import { providerFileTools } from './provider-files.ts';

const execute = promisify(execFile);
export function managedInvocation(command: string, args: string[]) {
  return /\.[cm]?js$/i.test(command)
    ? { command: process.execPath, args: [command, ...args] }
    : { command, args };
}
export async function resolveManagedCommand(provider: 'claude' | 'antigravity') {
  const name = provider === 'claude' ? 'claude' : 'agy';
  const override = process.env[`RELAY_${provider.toUpperCase()}_COMMAND`];
  const candidates = override
    ? [override]
    : [
        path.join(
          os.homedir(),
          '.local',
          'bin',
          name + (process.platform === 'win32' ? '.exe' : ''),
        ),
        ...(provider === 'antigravity' && process.platform === 'win32'
          ? [
              path.join(
                process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
                'agy',
                'bin',
                'agy.exe',
              ),
            ]
          : []),
        ...(provider === 'claude' && process.platform !== 'win32'
          ? [path.join(os.homedir(), '.claude', 'local', 'claude')]
          : []),
        ...(process.env.PATH || process.env.Path || '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((dir) =>
            path.join(
              dir.replace(/^"|"$/g, ''),
              name + (process.platform === 'win32' ? '.exe' : ''),
            ),
          ),
      ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || /\.(?:cmd|bat|ps1)$/i.test(candidate)) continue;
    if (
      await stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return candidate;
  }
  throw new Error(`Install the official ${name} CLI on this computer first.`);
}

export function managedEnvironment(home: string) {
  const env = codexEnvironment(home);
  delete env.CODEX_HOME;
  env.HOME = home;
  env.USERPROFILE = home;
  env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
  env.CLAUDE_CODE_ENABLE_TELEMETRY = '0';
  env.DISABLE_AUTOUPDATER = '1';
  env.GEMINI_CLI_HOME = home;
  // Dedicated homes, clean environment, no inherited provider keys or account tokens.
  return env;
}

/** Owned subprocess with bounded framing and confirmed process-tree termination. */
export class ManagedProcess {
  child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private closed: Promise<void> = Promise.resolve();
  private stopping = false;
  private diagnostics = '';
  constructor(
    private onMessage: (message: any) => void,
    private onExit: (error: Error | null) => void,
  ) {}
  launch(command: string, args: string[], home: string, env = managedEnvironment(home)) {
    if (this.child) throw new Error('Managed process is already running.');
    this.stopping = false;
    this.buffer = '';
    this.diagnostics = '';
    const js = /\.[cm]?js$/i.test(command);
    const child = spawn(js ? process.execPath : command, js ? [command, ...args] : args, {
      cwd: home,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.closed = new Promise((resolve) => child.once('close', () => resolve()));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.diagnostics = redactCodexError((this.diagnostics + chunk).slice(-2000));
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => this.onExit(new Error(redactCodexError(error))));
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.onExit(new Error('Managed CLI exceeded its frame limit.'));
        void this.stop().catch(() => {});
        return;
      }
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        try {
          this.onMessage(JSON.parse(line));
        } catch (error) {
          this.onExit(new Error(`Invalid managed CLI response: ${redactCodexError(error)}`));
          void this.stop().catch(() => {});
          break;
        }
      }
    });
    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      this.onExit(
        this.stopping ? null : new Error(`Managed CLI exited (${code}): ${this.diagnostics}`),
      );
    });
  }
  write(value: unknown) {
    const frame = JSON.stringify(value);
    if (Buffer.byteLength(frame) > 8 * 1024 * 1024)
      throw new Error('Managed CLI request is too large.');
    if (!this.child?.stdin.writable) throw new Error('Managed CLI transport is closed.');
    this.child.stdin.write(frame + '\n');
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const pid = child.pid;
    if (pid && process.platform === 'win32') {
      await execute('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      }).catch(() => child.kill());
    } else if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill();
      }
    } else child.kill();
    await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (this.child === child) {
      if (pid && process.platform !== 'win32') {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (this.child === child)
      throw new Error('Process termination is uncertain; keep the task locked.');
  }
}

/** MCP file operations share the same lease, approval and quota checks as Gemini. */
export abstract class ScopedCliClient extends CodexClient {
  protected policy = { cwd: '', readOnly: true, scopes: ['.'] };
  protected thread: string | null = null;
  protected turn: string | null = null;
  protected dynamicTools: readonly DynamicTool[] = [];
  protected instructions = '';
  protected bridge: GeminiTools | null = null;
  private toolWaiters = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(protected settings: { home: string; cwd: string; command?: string }) {
    super(settings);
    this.policy.cwd = settings.cwd;
  }
  protected async toolBridge() {
    if (this.bridge) throw new Error('Tool bridge already exists.');
    this.bridge = new GeminiTools(
      () => [
        ...this.dynamicTools,
        ...providerFileTools.filter(
          (tool) => !this.policy.readOnly || tool.name !== 'workspace_write_file',
        ),
      ],
      async (name, args) => {
        if (!this.thread || !this.turn) throw new Error('No active owned turn.');
        if (name === 'workspace_write_file') {
          if (this.policy.readOnly) throw new Error('This conversation is read-only.');
          const approval = await this.ask('item/fileChange/requestApproval', {
            reason: `${this.provider} requests a scoped file edit.`,
            changes: [args],
          });
          if (approval.decision !== 'accept') throw new Error('File edit was declined.');
        }
        return this.ask('item/tool/call', { tool: name, arguments: args });
      },
    );
    return this.bridge.start();
  }
  protected ask(method: string, params: object): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.toolWaiters.delete(id);
        reject(new Error('Tool request expired.'));
      }, 120000);
      timer.unref();
      this.toolWaiters.set(id, { resolve, reject, timer });
      this.emit('request', {
        id,
        method,
        params: { ...params, threadId: this.thread, turnId: this.turn },
      });
    });
  }
  override respond(id: string | number, result: any) {
    const pending = this.toolWaiters.get(String(id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.toolWaiters.delete(String(id));
    if (result.success === false)
      pending.reject(new Error(result.contentItems?.[0]?.text || 'Tool failed.'));
    else if (result.contentItems) {
      try {
        pending.resolve(JSON.parse(result.contentItems[0]?.text || '{}'));
      } catch {
        pending.resolve(result);
      }
    } else pending.resolve(result);
  }
  override rejectRequest(id: string | number, message = 'Tool request rejected.') {
    const pending = this.toolWaiters.get(String(id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.toolWaiters.delete(String(id));
    pending.reject(new Error(message));
  }
  protected async closeTools() {
    for (const id of this.toolWaiters.keys()) this.rejectRequest(id, 'Session stopped.');
    await this.bridge?.close();
    this.bridge = null;
    this.turn = null;
  }
  protected async prepare() {
    await mkdir(this.settings.home, { recursive: true, mode: 0o700 });
  }
}
