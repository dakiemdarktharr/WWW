import { EventEmitter } from 'node:events';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import type { CodexModel, LoginResult, Member, ProviderId } from '../shared/types.ts';

const execFileAsync = promisify(execFile);
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
type RpcId = string | number;
type RpcRequest = { id: RpcId; method: string; params: any };
type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Same-machine skill libraries only; authentication and plugin authorization stay per profile. */
export function localSkillRoots(): string[] {
  return [
    path.join(os.homedir(), '.codex', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
  ];
}

/** Hide likely credentials even when a provider puts them in an error message. */
export function redactCodexError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|secret)["']?\s*[=:]\s*["']?)[^\s,"'\]}]+/gi,
      '$1[redacted]',
    )
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]+/g, '$1?[redacted]')
    .slice(0, 2000);
}

/** Deliberately do not inherit provider keys, WIF, CODEX auth tokens, or arbitrary app secrets. */
export function codexEnvironment(
  home: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'APPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'COLORTERM',
    'SHELL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source))
    if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  env.CODEX_HOME = path.resolve(home);
  env.NO_COLOR = '1';
  env.RUST_LOG = 'error';
  if (source.RELAY_RUNNER_NO_GPU === '1') {
    env.CUDA_VISIBLE_DEVICES = '-1';
    env.ROCR_VISIBLE_DEVICES = '-1';
    env.HIP_VISIBLE_DEVICES = '-1';
    env.OMP_NUM_THREADS = '1';
    env.MKL_NUM_THREADS = '1';
  }
  return env;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve native binaries or the npm JS launcher without invoking a command shell. */
export async function resolveCodexCommand(): Promise<string> {
  const configured = process.env.RELAY_CODEX_COMMAND;
  if (configured) {
    if (!path.isAbsolute(configured) || /\.(?:cmd|bat|ps1)$/i.test(configured))
      throw new Error(
        'RELAY_CODEX_COMMAND must be an absolute Codex executable or JavaScript launcher path.',
      );
    if (!(await isFile(configured))) throw new Error('Configured Codex executable does not exist.');
    return configured;
  }
  const providerHome = process.env.RELAY_PROVIDER_HOME;
  if (providerHome && path.isAbsolute(providerHome)) {
    const candidate = path.join(
      providerHome,
      'codex',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (await isFile(candidate)) return candidate;
  }
  const envPath = process.env.PATH ?? process.env.Path ?? '';
  for (const segment of envPath.split(path.delimiter)) {
    const directory = segment.replace(/^"|"$/g, '');
    if (!directory || !path.isAbsolute(directory)) continue;
    for (const name of process.platform === 'win32' ? ['codex.exe'] : ['codex']) {
      const candidate = path.join(directory, name);
      if (await isFile(candidate)) return candidate;
    }
    if (process.platform === 'win32') {
      for (const candidate of [
        path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
        path.resolve(directory, '..', '@openai', 'codex', 'bin', 'codex.js'),
      ]) {
        if (await isFile(candidate)) return candidate;
      }
    }
  }
  for (const root of [process.cwd(), path.resolve(import.meta.dirname, '..')]) {
    const candidate = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (await isFile(candidate)) return candidate;
  }
  // The desktop app adds its private CLI directory to its own PATH. A user
  // launching RELAY from Explorer may not have that injected PATH entry.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const desktopBin = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = await Promise.all(
        (await readdir(desktopBin, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
          .map(async (entry) => {
            const command = path.join(desktopBin, entry.name, 'codex.exe');
            try {
              const info = await stat(command);
              return info.isFile() ? { command, modified: info.mtimeMs } : null;
            } catch {
              return null;
            }
          }),
      );
      const newest = candidates
        .filter((entry): entry is { command: string; modified: number } => entry !== null)
        .sort((a, b) => b.modified - a.modified)[0];
      if (newest) return newest.command;
    } catch {
      /* The desktop application is not installed in its standard location. */
    }
  }
  throw new Error(
    'Codex CLI was not found. Install @openai/codex or set RELAY_CODEX_COMMAND to its executable.',
  );
}

function commandParts(command: string, args: string[]): { command: string; args: string[] } {
  if (/\.(?:cmd|bat|ps1)$/i.test(command))
    throw new Error('Shell launchers are not accepted. Select the Codex executable or codex.js.');
  return /\.[cm]?js$/i.test(command)
    ? { command: process.execPath, args: [command, ...args] }
    : { command, args };
}

export async function probeCodex(): Promise<{ available: boolean; version: string }> {
  try {
    const parts = commandParts(await resolveCodexCommand(), ['--version']);
    const { stdout } = await execFileAsync(parts.command, parts.args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return { available: true, version: stdout.trim().slice(0, 180) };
  } catch (error) {
    return { available: false, version: redactCodexError(error) };
  }
}

/** One stdio App Server, owned by one isolated account profile. Never connects to a shared daemon. */
export class CodexClient extends EventEmitter {
  readonly provider: ProviderId = 'codex';
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<RpcId, Pending>();
  private nextId = 1;
  private buffer = '';
  private starting: Promise<void> | null = null;
  private initialized = false;
  private closing = false;
  private closed: Promise<void> = Promise.resolve();
  private resolveClosed: (() => void) | null = null;
  private stopping: Promise<void> | null = null;
  private internalRestart = false;
  private launchEpoch = 0;

  constructor(
    private readonly options: {
      home: string;
      cwd: string;
      command?: string;
      skillRoots?: string[];
    },
  ) {
    super();
    // EventEmitter's special error event must not crash the host before its owner attaches a listener.
    this.on('error', () => {});
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): Promise<void> {
    if (this.stopping) return this.stopping.then(() => this.start());
    if (this.initialized) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.launch(false, ++this.launchEpoch).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(afterSandboxSetup = false, epoch = this.launchEpoch): Promise<void> {
    if (!path.isAbsolute(this.options.home) || !path.isAbsolute(this.options.cwd))
      throw new Error('Codex home and working directory must be absolute.');
    await mkdir(this.options.home, { recursive: true, mode: 0o700 });
    const parts = commandParts(this.options.command ?? (await resolveCodexCommand()), [
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'cli_auth_credentials_store="file"',
      '-c',
      'forced_login_method="chatgpt"',
      '-c',
      'analytics.enabled=false',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      'approval_policy="on-request"',
    ]);
    this.closing = false;
    this.buffer = '';
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    const child = spawn(parts.command, parts.args, {
      cwd: this.options.cwd,
      env: codexEnvironment(this.options.home),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(String(chunk)));
    // Drain stderr without retaining it: it can contain local paths, OAuth state, or plugin secrets.
    child.stderr.resume();
    child.stdin.on('error', (error) => {
      if (!this.closing)
        this.fail(new Error(`Codex input stream failed: ${redactCodexError(error)}`));
    });
    child.on('error', (error) =>
      this.fail(new Error(`Could not start Codex: ${redactCodexError(error)}`)),
    );
    child.on('close', (code, signal) => {
      const wasClosing = this.closing;
      this.initialized = false;
      if (this.child === child) this.child = null;
      this.rejectPending(
        new Error(
          wasClosing
            ? 'Codex was stopped.'
            : `Codex App Server exited (${code ?? signal ?? 'unknown'}).`,
        ),
      );
      this.resolveClosed?.();
      this.resolveClosed = null;
      // Preparing a new Windows profile is part of start(), not a disconnected account.
      // Keep the Workspace client reference and global sign-in lock during this restart.
      if (!this.internalRestart) this.emit('exit', { code, signal });
    });
    try {
      await this.request('initialize', {
        clientInfo: { name: 'relay_workspace', title: 'RELAY', version: '0.1.0' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          explicitGatewayOauth: true,
        },
      });
      this.write({ method: 'initialized', params: {} });
      this.assertStarting(epoch);
      if (process.platform === 'win32') {
        const readiness = await this.request('windowsSandbox/readiness', {});
        if (readiness.status === 'notConfigured' && !afterSandboxSetup) {
          await this.prepareWindowsSandbox();
          this.assertStarting(epoch);
          this.internalRestart = true;
          let restartEpoch: number;
          try {
            const stopped = this.stop();
            restartEpoch = this.launchEpoch;
            await stopped;
            this.assertStarting(restartEpoch);
          } finally {
            this.internalRestart = false;
          }
          // command/exec uses startup configuration; a fresh process must load the
          // sandbox that setup persisted before any tools may be requested.
          await this.launch(true, restartEpoch!);
          return;
        }
        if (readiness.status !== 'ready')
          throw new Error(
            'Codex Windows sandbox is not ready. Complete sandbox setup in this profile before running tasks; Kivuno will not run tools without it.',
          );
      }
      this.assertStarting(epoch);
      if (this.options.skillRoots?.length) {
        const extraRoots: string[] = [];
        for (const root of this.options.skillRoots)
          if (
            await stat(root)
              .then((info) => info.isDirectory())
              .catch(() => false)
          )
            extraRoots.push(path.resolve(root));
        await this.request('skills/extraRoots/set', { extraRoots });
        this.assertStarting(epoch);
      }
      this.initialized = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private assertStarting(epoch: number): void {
    if (epoch !== this.launchEpoch) throw new Error('Codex startup was cancelled.');
  }

  private async prepareWindowsSandbox(): Promise<void> {
    let onNotification: (method: string, params: any) => void;
    let onExit: () => void;
    let timer: NodeJS.Timeout;
    const completed = new Promise<void>((resolve, reject) => {
      onNotification = (method, params) => {
        if (method !== 'windowsSandbox/setupCompleted') return;
        if (params.mode === 'unelevated' && params.success === true) resolve();
        else
          reject(
            new Error(
              `Codex Windows sandbox setup failed: ${redactCodexError(params.error || 'setup was not completed')}`,
            ),
          );
      };
      onExit = () => reject(new Error('Codex exited while preparing its Windows sandbox.'));
      this.on('notification', onNotification);
      this.once('exit', onExit);
      timer = setTimeout(
        () =>
          reject(
            new Error('Codex Windows sandbox setup timed out. Restart this profile to retry.'),
          ),
        REQUEST_TIMEOUT_MS,
      );
      timer.unref();
    });
    // Attach immediately: a setup notification can arrive before the RPC response.
    void completed.catch(() => {});
    try {
      const started = await this.request('windowsSandbox/setupStart', {
        mode: 'unelevated',
        cwd: this.options.cwd,
      });
      if (started.started !== true) throw new Error('Codex Windows sandbox setup did not start.');
      await completed;
    } finally {
      clearTimeout(timer!);
      this.off('notification', onNotification!);
      this.off('exit', onExit!);
    }
  }

  request<T = any>(method: string, params: unknown = {}): Promise<T> {
    if (
      (method === 'thread/start' || method === 'thread/resume') &&
      params &&
      typeof params === 'object' &&
      'kivunoSharedGroup' in params &&
      params.kivunoSharedGroup === true
    )
      return this.sharedGroupThread<T>(method, params);
    return this.sendNativeRequest<T>(method, params);
  }

  private async sharedGroupThread<T>(
    method: 'thread/start' | 'thread/resume',
    {
      kivunoSharedGroup: _shared,
      ...params
    }: { kivunoSharedGroup: unknown; [key: string]: unknown },
  ): Promise<T> {
    // Read the configuration on the machine that owns the provider account.
    // The managed-runner transport receives only the resulting thread metadata.
    const profile = await this.sendNativeRequest<{
      config?: { mcp_servers?: Record<string, unknown> };
    }>('config/read', { cwd: params.cwd });
    const config: Record<string, unknown> = {
      ...(params.config as Record<string, unknown> | undefined),
      'features.apps': false,
      'features.plugins': false,
      'features.remote_plugin': false,
      'features.hooks': false,
    };
    for (const name of Object.keys(profile.config?.mcp_servers || {})) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name))
        throw new Error('A configured MCP server cannot be isolated for a Shared Groups task.');
      config[`mcp_servers.${name}.enabled`] = false;
    }
    const result = await this.sendNativeRequest(method, { ...params, config });
    const threadId = result.thread?.id;
    if (typeof threadId !== 'string') throw new Error('Codex did not return a thread ID.');
    const inventory = await this.sendNativeRequest<{
      nextCursor?: string | null;
      data: {
        tools?: Record<string, unknown>;
        resources?: unknown[];
        resourceTemplates?: unknown[];
      }[];
    }>('mcpServerStatus/list', { threadId });
    if (
      !Array.isArray(inventory.data) ||
      inventory.nextCursor ||
      inventory.data.some(
        ({ tools, resources, resourceTemplates }) =>
          Object.keys(tools || {}).length || resources?.length || resourceTemplates?.length,
      )
    )
      throw new Error('Codex still has external tools available for this Shared Groups task.');
    return { ...result, kivunoSharedGroupToolsScoped: true };
  }

  private sendNativeRequest<T = any>(method: string, params: unknown): Promise<T> {
    if (!this.child || this.child.exitCode !== null || this.closing)
      return Promise.reject(new Error('Codex App Server is not running.'));
    if (this.pending.size >= 128)
      return Promise.reject(new Error('Too many pending Codex requests.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  rejectRequest(id: RpcId, message = 'This request is not supported by RELAY.'): void {
    this.write({ id, error: { code: -32601, message } });
  }

  private write(message: unknown): void {
    if (!this.child || this.child.stdin.destroyed || !this.child.stdin.writable)
      throw new Error('Codex input stream is closed.');
    const frame = JSON.stringify(message);
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
      throw new Error('Codex request exceeds the transport limit.');
    this.child.stdin.write(frame + '\n');
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!frame.trim()) continue;
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
        this.abortTransport(new Error('Codex response exceeded the transport limit.'));
        return;
      }
      let message: any;
      try {
        message = JSON.parse(frame);
      } catch {
        this.abortTransport(new Error('Codex sent an invalid JSON frame.'));
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        this.abortTransport(new Error('Codex sent an invalid protocol message.'));
        return;
      }
      if (typeof message.method === 'string') {
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          const request: RpcRequest = {
            id: message.id,
            method: message.method,
            params: message.params ?? {},
          };
          if (this.listenerCount('request')) this.emit('request', request);
          else this.rejectRequest(request.id);
        } else this.emit('notification', message.method, message.params ?? {});
      } else if (typeof message.id === 'number' || typeof message.id === 'string') {
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error)
          request.reject(
            new Error(redactCodexError(message.error.message ?? 'Codex request failed.')),
          );
        else request.resolve(message.result);
      }
    }
    if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES)
      this.abortTransport(new Error('Codex response exceeded the transport limit.'));
  }

  private rejectPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: Error): void {
    this.rejectPending(error);
    this.emit('error', error);
  }

  private abortTransport(error: Error): void {
    this.fail(error);
    void this.stop().catch((stopError) => this.emit('error', stopError));
  }

  stop(): Promise<void> {
    this.launchEpoch++;
    if (this.stopping) return this.stopping;
    this.stopping = this.terminate().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private async terminate(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    this.initialized = false;
    this.rejectPending(new Error('Codex was stopped.'));
    const pid = child.pid;
    if (pid && process.platform === 'win32') {
      // Kill only the process tree created by this client, including shell/tool children.
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 64 * 1024,
        });
      } catch {
        child.kill();
      }
    } else if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else child.kill();
    await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (this.child === child && pid) {
      if (process.platform !== 'win32') {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else child.kill('SIGKILL');
      await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (this.child === child)
      throw new Error(
        'Codex process did not stop. Keep its task locked until the process is terminated.',
      );
  }
}

export interface DynamicTool {
  type: 'function';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const relayDynamicTools = [
  {
    type: 'function',
    name: 'relay_read_room',
    description:
      "Read current project room messages, teammate progress and task ownership. Use before starting work and before making assumptions about another agent's work.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'relay_report',
    description:
      'Post a concise progress update, blocker, or handoff to teammates in this project room. Reports do not alter task ownership or grant permission to do another task.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['progress', 'blocker', 'handoff'] },
        content: { type: 'string', minLength: 1, maxLength: 6000 },
      },
      required: ['kind', 'content'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly DynamicTool[];

export function dynamicToolResult(
  value: unknown,
  success = true,
): { contentItems: { type: 'inputText'; text: string }[]; success: boolean } {
  return {
    contentItems: [
      { type: 'inputText', text: typeof value === 'string' ? value : JSON.stringify(value) },
    ],
    success,
  };
}

export async function loginAccount(
  client: CodexClient,
  method: 'browser' | 'device',
): Promise<LoginResult> {
  await client.start();
  return client.request<LoginResult>(
    'account/login/start',
    method === 'device' ? { type: 'chatgptDeviceCode' } : { type: 'chatgpt' },
  );
}

export async function readAccount(client: CodexClient): Promise<Member['account']> {
  await client.start();
  const result = await client.request('account/read', { refreshToken: false });
  const account = result?.account;
  if (!account) return null;
  const expected = {
    codex: 'chatgpt',
    gemini: 'gemini-google',
    claude: 'claude-subscription',
    antigravity: 'antigravity-google',
  }[client.provider];
  if (account.type !== expected)
    throw new Error(
      'This profile requires its provider account sign-in. API-key accounts are not used.',
    );
  return {
    type: account.type,
    ...(typeof account.email === 'string' ? { email: account.email } : {}),
    ...(typeof account.planType === 'string' ? { planType: account.planType } : {}),
  };
}

export async function readCapabilities(
  client: CodexClient,
  cwd: string,
): Promise<{ skills: string[]; plugins: string[]; errors: string[] }> {
  await client.start();
  // Installed plugins can materialize their skill files. Scan after that completes
  // so a newly restored account has its plugin skills on the first refresh.
  const [pluginResult] = await Promise.allSettled([
    // Team needs installed capabilities, not the full remote marketplace catalog.
    // The catalog can exceed the bounded stdio frame and disconnect a healthy account.
    client.request('plugin/installed', { cwds: [cwd] }),
  ]);
  const [skillResult] = await Promise.allSettled([
    client.request('skills/list', { cwds: [cwd], forceReload: true }),
  ]);
  const skills = new Set<string>(),
    plugins = new Set<string>(),
    errors: string[] = [];
  if (skillResult.status === 'fulfilled') {
    for (const entry of skillResult.value?.data ?? []) {
      for (const skill of entry.skills ?? [])
        if (skill.enabled && typeof skill.name === 'string') skills.add(skill.name);
      for (const error of entry.errors ?? []) errors.push(redactCodexError(error.message));
    }
  } else errors.push(`Skills: ${redactCodexError(skillResult.reason)}`);
  if (pluginResult.status === 'fulfilled') {
    for (const market of pluginResult.value?.marketplaces ?? [])
      for (const plugin of market.plugins ?? []) {
        if (
          plugin.installed &&
          plugin.enabled &&
          !plugin.disabledReason &&
          plugin.availability !== 'DISABLED_BY_ADMIN' &&
          typeof plugin.name === 'string'
        )
          plugins.add(plugin.name);
        else if (
          plugin.installed &&
          (plugin.disabledReason || plugin.availability === 'DISABLED_BY_ADMIN')
        )
          errors.push(
            `Plugin ${String(plugin.name).slice(0, 100)}: ${redactCodexError(plugin.disabledReason ? (typeof plugin.disabledReason === 'string' ? plugin.disabledReason : JSON.stringify(plugin.disabledReason)) : 'Disabled by administrator')}`,
          );
      }
    for (const error of pluginResult.value?.marketplaceLoadErrors ?? [])
      errors.push(redactCodexError(error.message));
  } else errors.push(`Plugins: ${redactCodexError(pluginResult.reason)}`);
  return { skills: [...skills].sort(), plugins: [...plugins].sort(), errors: errors.slice(0, 20) };
}

export async function readRateLimits(client: CodexClient): Promise<unknown> {
  await client.start();
  const result = await client.request('account/rateLimits/read', {});
  // Account IDs and upsell payloads are unnecessary for the workspace UI.
  return {
    rateLimits: result.rateLimits ?? null,
    rateLimitsByLimitId: result.rateLimitsByLimitId ?? null,
    ordinaryUsageAllowed: result.ordinaryUsageAllowed ?? null,
  };
}

export async function readModels(client: CodexClient): Promise<CodexModel[]> {
  await client.start();
  if (!(await readAccount(client)))
    throw new Error('Sign in to this Codex account to read its available models.');
  const models: CodexModel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await client.request('model/list', {
      includeHidden: false,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of result.data ?? []) {
      if (item.hidden || typeof item.model !== 'string' || typeof item.id !== 'string') continue;
      models.push({
        id: item.id,
        model: item.model,
        displayName: String(item.displayName || item.model),
        isDefault: !!item.isDefault,
        defaultReasoningEffort: String(item.defaultReasoningEffort || ''),
        supportedReasoningEfforts: (item.supportedReasoningEfforts || [])
          .filter((option: any) => typeof option.reasoningEffort === 'string')
          .map((option: any) => ({
            reasoningEffort: option.reasoningEffort,
            description: String(option.description || ''),
          })),
      });
    }
    if (!result.nextCursor) return models;
    if (result.nextCursor === cursor)
      throw new Error('Codex model catalog returned a repeated cursor.');
    cursor = result.nextCursor;
  }
  throw new Error('Codex model catalog exceeded its page limit.');
}

export async function verifyModelSettings(
  client: CodexClient,
  options: { model?: string | null; reasoningEffort?: string | null },
) {
  if (!options.model && !options.reasoningEffort) return;
  const models = await readModels(client);
  const model = options.model
    ? models.find((model) => model.model === options.model)
    : models.find((model) => model.isDefault);
  if (!model) throw new Error('This model is not available to the selected Codex account.');
  if (
    options.reasoningEffort &&
    !model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === options.reasoningEffort,
    )
  )
    throw new Error('This model does not support the selected reasoning level.');
}

export async function startTask(
  client: CodexClient,
  options: {
    cwd: string;
    prompt: string;
    developerInstructions?: string;
    sharedGroup?: boolean;
    model?: string;
    reasoningEffort?: string;
    readOnly?: boolean;
    dynamicTools?: readonly DynamicTool[];
    resumeThreadId?: string;
    onThread?: (threadId: string) => void;
    scopes?: string[];
  },
): Promise<{ threadId: string; turnId: string; model?: string; reasoningEffort?: string }> {
  await client.start();
  if (!(await readAccount(client)))
    throw new Error("Sign in to this member's ChatGPT account before running a task.");
  await verifyModelSettings(client, options);
  if (client.provider !== 'codex')
    await client.request('kivuno/policy', {
      cwd: options.cwd,
      readOnly: !!options.readOnly,
      scopes: options.scopes || ['.'],
    });
  const sharedCodex = options.sharedGroup && client.provider === 'codex';
  const result = await client.request(options.resumeThreadId ? 'thread/resume' : 'thread/start', {
    ...(options.resumeThreadId ? { threadId: options.resumeThreadId } : {}),
    cwd: options.cwd,
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort
      ? { config: { model_reasoning_effort: options.reasoningEffort } }
      : {}),
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: options.readOnly ? 'read-only' : 'workspace-write',
    ...(sharedCodex ? { kivunoSharedGroup: true } : {}),
    ...(!options.resumeThreadId ? { serviceName: 'relay_workspace' } : {}),
    developerInstructions: options.developerInstructions ?? null,
    ...(!options.resumeThreadId || client.provider !== 'codex'
      ? { dynamicTools: options.dynamicTools ?? relayDynamicTools }
      : {}),
  });
  if (
    (client.provider !== 'codex'
      ? result.toolPolicy?.readOnly !== !!options.readOnly ||
        result.toolPolicy?.kind !== 'scoped-mcp'
      : result.sandbox?.type !== (options.readOnly ? 'readOnly' : 'workspaceWrite')) ||
    result.approvalPolicy !== 'on-request' ||
    result.approvalsReviewer !== 'user'
  ) {
    throw new Error(
      'Codex did not honor the requested sandbox and human approval policy. Task was not started.',
    );
  }
  const threadId = result.thread?.id;
  if (options.model && result.model !== options.model)
    throw new Error('Codex did not honor the selected model. No turn was started.');
  if (options.reasoningEffort && result.reasoningEffort !== options.reasoningEffort)
    throw new Error('Codex did not honor the selected reasoning level. No turn was started.');
  if (sharedCodex && result.kivunoSharedGroupToolsScoped !== true)
    throw new Error('Update Kivuno on this harness to run a Shared Groups task with scoped tools.');
  if (typeof threadId !== 'string') throw new Error('Codex did not return a thread ID.');
  // Bind ownership before turn/start can emit notifications, including an immediate completion.
  options.onThread?.(threadId);
  const turn = await client.request('turn/start', {
    threadId,
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
    input: [{ type: 'text', text: options.prompt, text_elements: [] }],
  });
  const turnId = turn.turn?.id;
  if (typeof turnId !== 'string') throw new Error('Codex did not return a turn ID.');
  return {
    threadId,
    turnId,
    ...(typeof result.model === 'string' ? { model: result.model } : {}),
    ...(typeof result.reasoningEffort === 'string'
      ? { reasoningEffort: result.reasoningEffort }
      : {}),
  };
}
