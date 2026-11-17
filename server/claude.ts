import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CodexModel } from '../shared/types.ts';
import { redactCodexError } from './codex.ts';
import {
  ManagedProcess,
  ScopedCliClient,
  managedEnvironment,
  resolveManagedCommand,
  managedInvocation,
} from './managed-process.ts';

const execute = promisify(execFile);
/** Official subscription CLI, controlled through its stream-json host protocol. */
export class ClaudeClient extends ScopedCliClient {
  override readonly provider = 'claude' as const;
  private transport = new ManagedProcess(
    (value) => this.message(value),
    (error) => this.exited(error),
  );
  private launching: Promise<void> | null = null;
  private cliStopping: Promise<void> | null = null;
  private cliPending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private models: CodexModel[] = [];
  private nativeId = randomUUID();
  private resumed = false;
  private selectedModel = 'default';
  private effort: string | undefined;
  private text = '';
  private loginChild: ChildProcess | null = null;
  private reconfiguring = false;
  override get pid() {
    return this.transport.child?.pid;
  }
  override start(): Promise<void> {
    if (this.transport.child) return this.launching || Promise.resolve();
    this.launching ??= this.launchCli()
      .catch(async (error) => {
        await this.stop();
        throw error;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }
  private async launchCli() {
    await this.prepare();
    const cwd = path.join(this.settings.home, 'controlled-workspace');
    await mkdir(cwd, { recursive: true });
    const bridge = await this.toolBridge();
    const config = path.join(this.settings.home, 'kivuno-mcp.json');
    await writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          kivuno: {
            type: 'http',
            url: bridge.url,
            headers: Object.fromEntries(bridge.headers.map((item) => [item.name, item.value])),
          },
        },
      }),
      { mode: 0o600 },
    );
    this.transport.launch(
      this.settings.command || (await resolveManagedCommand('claude')),
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--restricted',
        '--tools',
        '',
        '--setting-sources',
        '',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        config,
        '--settings',
        JSON.stringify({ disableAllHooks: true, autoUpdatesChannel: 'stable' }),
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        'mcp__kivuno__*',
        ...(this.resumed ? ['--resume', this.nativeId] : ['--session-id', this.nativeId]),
        '--model',
        this.selectedModel,
        ...(this.effort ? ['--effort', this.effort] : []),
      ],
      cwd,
      managedEnvironment(this.settings.home),
    );
    try {
      const metadata = await this.control('initialize', { hooks: {} });
      this.models = (metadata.models || [])
        .filter((model: any) => typeof model.value === 'string')
        .map((model: any) => {
          const efforts =
            model.supportsEffort && Array.isArray(model.supportedEffortLevels)
              ? model.supportedEffortLevels.filter((value: unknown) => typeof value === 'string')
              : [];
          return {
            id: model.value,
            model: model.value,
            displayName: model.displayName || model.value,
            isDefault: model.value === 'default',
            defaultReasoningEffort: efforts.includes('medium') ? 'medium' : efforts[0] || '',
            supportedReasoningEfforts: efforts.map((reasoningEffort: string) => ({
              reasoningEffort,
              description: reasoningEffort,
            })),
          };
        });
      if (!this.models.length)
        throw new Error('Claude did not advertise a model catalog. Update the official CLI.');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private control(subtype: string, values: object = {}) {
    const request_id = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cliPending.delete(request_id);
        reject(new Error(`Claude control timed out: ${subtype}`));
      }, 45000);
      timer.unref();
      this.cliPending.set(request_id, { resolve, reject, timer });
      try {
        this.transport.write({
          type: 'control_request',
          request_id,
          request: { subtype, ...values },
        });
      } catch (error) {
        clearTimeout(timer);
        this.cliPending.delete(request_id);
        reject(error);
      }
    });
  }
  private message(value: any) {
    if (value.type === 'control_response') {
      const response = value.response,
        waiting = this.cliPending.get(response?.request_id);
      if (!waiting) return;
      this.cliPending.delete(response.request_id);
      clearTimeout(waiting.timer);
      if (response.subtype === 'error') waiting.reject(new Error(redactCodexError(response.error)));
      else waiting.resolve(response.response || {});
    } else if (value.type === 'control_request') {
      // No native tools, arbitrary hooks, or external service permissions are delegated.
      this.transport.write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: value.request_id,
          response: { behavior: 'deny', message: 'Use scoped Kivuno MCP tools only.' },
        },
      });
    } else if (this.turn && value.type === 'assistant') {
      const text = (value.message?.content || [])
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('\n');
      if (text) {
        this.text = (this.text + text).slice(-30000);
        this.emit('notification', 'item/agentMessage/delta', {
          threadId: this.thread,
          turnId: this.turn,
          itemId: this.turn,
          delta: text,
        });
      }
    } else if (this.turn && value.type === 'result') {
      const id = this.turn;
      this.emit('notification', 'item/completed', {
        threadId: this.thread,
        turnId: id,
        item: { type: 'agentMessage', text: this.text || value.result || '' },
      });
      this.turn = null;
      this.resumed = true;
      this.emit('notification', 'turn/completed', {
        threadId: this.thread,
        turn: {
          id,
          status: value.is_error || value.subtype !== 'success' ? 'failed' : 'completed',
          error:
            value.is_error || value.subtype !== 'success'
              ? {
                  message: redactCodexError(
                    (value.errors || [value.result || value.subtype]).join('; '),
                  ),
                }
              : null,
        },
      });
    }
  }
  private exited(error: Error | null) {
    for (const item of this.cliPending.values()) {
      clearTimeout(item.timer);
      item.reject(error || new Error('Claude stopped.'));
    }
    this.cliPending.clear();
    if (error) this.emit('error', error);
    if (!this.reconfiguring) this.emit('exit', {});
  }
  private async account() {
    await this.prepare();
    try {
      const invocation = managedInvocation(
        this.settings.command || (await resolveManagedCommand('claude')),
        ['auth', 'status'],
      );
      const result = await execute(invocation.command, invocation.args, {
        cwd: this.settings.home,
        env: managedEnvironment(this.settings.home),
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 64000,
      });
      const status = JSON.parse(result.stdout);
      return status.loggedIn && status.authMethod === 'claude.ai'
        ? {
            type: 'claude-subscription',
            planType: status.subscriptionType || 'unknown',
            ...(typeof status.email === 'string' ? { email: status.email } : {}),
          }
        : null;
    } catch (error: any) {
      if (error.code === 1 && error.stdout) return null;
      throw new Error(redactCodexError(error));
    }
  }
  override async request<T = any>(method: string, raw: any = {}): Promise<T> {
    let result: any;
    if (method === 'account/read') result = { account: await this.account() };
    else if (method === 'account/login/start') {
      if (this.loginChild || this.turn)
        throw new Error('Stop the active operation before signing in.');
      await this.prepare();
      const loginId = randomUUID();
      const invocation = managedInvocation(
        this.settings.command || (await resolveManagedCommand('claude')),
        ['auth', 'login'],
      );
      const child = execFile(
        invocation.command,
        invocation.args,
        {
          cwd: this.settings.home,
          env: managedEnvironment(this.settings.home),
          windowsHide: true,
          timeout: 360000,
          maxBuffer: 128000,
        },
        (error) => {
          if (this.loginChild !== child) return;
          this.loginChild = null;
          this.emit('notification', 'account/login/completed', {
            loginId,
            success: !error,
            ...(error ? { error: redactCodexError(error) } : {}),
          });
        },
      );
      this.loginChild = child;
      result = {
        type: 'claudeSubscription',
        loginId,
        instructions:
          'Complete sign-in in the browser opened by the official Claude Code CLI. Use your Claude subscription. API-key fallback is disabled.',
      };
    } else if (method === 'account/login/cancel') {
      await this.cancelLogin();
      result = {};
    } else if (method === 'account/logout') {
      await this.stop();
      const invocation = managedInvocation(
        this.settings.command || (await resolveManagedCommand('claude')),
        ['auth', 'logout'],
      );
      await execute(invocation.command, invocation.args, {
        cwd: this.settings.home,
        env: managedEnvironment(this.settings.home),
        windowsHide: true,
        timeout: 15000,
      });
      result = {};
    } else if (method === 'account/rateLimits/read')
      result = { ordinaryUsageAllowed: null, rateLimits: null };
    else if (method === 'skills/list') result = { data: [{ skills: [], errors: [] }] };
    else if (method === 'plugin/installed') result = { marketplaces: [] };
    else if (method === 'model/list') {
      await this.start();
      result = { data: this.models };
    } else if (method === 'kivuno/policy') {
      this.policy = raw;
      result = {};
    } else if (method === 'thread/start' || method === 'thread/resume') {
      if (this.turn) throw new Error('A Claude turn is already active.');
      this.reconfiguring = true;
      try {
        await this.stop();
      } finally {
        this.reconfiguring = false;
      }
      this.nativeId = raw.threadId || randomUUID();
      this.resumed = Boolean(raw.threadId);
      this.thread = this.nativeId;
      this.dynamicTools = raw.dynamicTools || [];
      this.instructions = raw.developerInstructions || '';
      this.selectedModel = raw.model || 'default';
      this.effort = raw.config?.model_reasoning_effort;
      await this.start();
      result = {
        thread: { id: this.thread },
        model: this.selectedModel,
        reasoningEffort: this.effort,
        toolPolicy: { kind: 'scoped-mcp', readOnly: this.policy.readOnly },
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      };
    } else if (method === 'turn/start') {
      if (!this.thread || this.turn || raw.threadId !== this.thread)
        throw new Error('Invalid Claude turn ownership.');
      if (!(await this.account())) throw new Error('Sign in to this Claude subscription first.');
      const id = randomUUID();
      this.turn = id;
      this.text = '';
      this.emit('notification', 'turn/started', { threadId: this.thread, turn: { id } });
      this.transport.write({
        type: 'user',
        session_id: this.thread,
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content:
            this.instructions +
            '\n\n' +
            (raw.input || [])
              .filter((part: any) => part.type === 'text')
              .map((part: any) => part.text)
              .join('\n') +
            '\nUse Kivuno MCP tools for project files and coordination. The CLI directory contains no project. Read the room before work and report progress. Do not invoke slash commands or other agents.',
        },
      });
      result = { turn: { id } };
    } else if (method === 'turn/interrupt') {
      await this.control('interrupt');
      result = {};
    } else if (method === 'turn/steer')
      throw new Error(
        'Read the MESH inbox at the next tool boundary; a second prompt would create another turn.',
      );
    else throw new Error(`Unsupported Claude capability: ${method}`);
    return result as T;
  }
  private async cancelLogin() {
    const child = this.loginChild;
    this.loginChild = null;
    if (!child) return;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    if (child.pid && process.platform === 'win32')
      await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      }).catch(() => child.kill());
    else child.kill();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Claude sign-in termination is uncertain.')),
            3000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  override stop(): Promise<void> {
    this.cliStopping ??= (async () => {
      await this.cancelLogin();
      await this.transport.stop();
      await this.closeTools();
    })().finally(() => {
      this.cliStopping = null;
    });
    return this.cliStopping;
  }
}
