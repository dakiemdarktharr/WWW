import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Member, Task } from '../shared/types.ts';
import { CodexClient } from './codex.ts';
import { DomainError } from './store.ts';
import type { Workspace } from './service.ts';
import {
  applyRunnerFiles,
  exportRunnerFiles,
  validateRunnerFiles,
  type RunnerFile,
} from './runner-files.ts';
import { redact, safeEqual } from './security.ts';

export interface RunnerNode {
  id: string;
  name: string;
  kind: 'computer' | 'ssh';
  slots: number;
  tokenHash: string;
  createdAt: string;
  lastSeen?: string;
  epoch?: string;
  ready?: boolean;
  busy?: boolean;
  version?: string;
}
export interface RunnerCommand {
  id: string;
  clientId: string;
  memberId: string;
  action: 'start' | 'request' | 'respond' | 'reject' | 'stop';
  method?: string;
  params?: any;
  files?: RunnerFile[];
  workspace?: string;
}
export interface RunnerEvent {
  id: string;
  clientId: string;
  type: 'result' | 'notification' | 'request' | 'exit' | 'error';
  commandId?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
  files?: RunnerFile[];
}
type Waiting = {
  command: RunnerCommand;
  nodeId: string;
  delivered: boolean;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Outbound machines are separate principals. A token can only operate its own RPC peers. */
export class Runners {
  readonly epoch = randomUUID();
  private peers = new Map<string, RemoteCodexClient>();
  private pending = new Map<string, Waiting>();
  private seen = new Set<string>();
  private polling = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private host: Workspace) {}
  start() {
    this.timer = setInterval(() => {
      for (const peer of this.peers.values()) {
        try {
          this.assertReady(peer.nodeId);
        } catch {
          peer.uncertain(
            'Execution machine disconnected. Its files are retained on that machine; reconnect and recover explicitly.',
          );
        }
      }
    }, 10000);
    this.timer.unref();
  }
  list() {
    return this.host.store.all<RunnerNode>('runner').map(({ tokenHash, ...node }) => ({
      ...node,
      online:
        !!node.lastSeen &&
        Date.now() - Date.parse(node.lastSeen) < 30_000 &&
        node.epoch === this.epoch,
      ready: node.ready && node.epoch === this.epoch,
    }));
  }
  add(name: string, kind: RunnerNode['kind']) {
    if (this.host.store.all('runner').length >= 8)
      throw new DomainError('At most eight machines can be paired.');
    const token = randomBytes(32).toString('base64url');
    const node = this.host.store.put('runner', {
      id: randomUUID(),
      name,
      kind,
      slots: kind === 'ssh' ? 1 : 2,
      tokenHash: hash(token),
      createdAt: new Date().toISOString(),
    } satisfies RunnerNode);
    return { id: node.id, token };
  }
  authenticate(authorization: unknown) {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer '))
      throw new DomainError('Machine authentication required.', 401);
    const digest = hash(authorization.slice(7));
    const node = this.host.store
      .all<RunnerNode>('runner')
      .find((node) => safeEqual(node.tokenHash, digest));
    if (!node) throw new DomainError('Machine authentication failed.', 401);
    return node;
  }
  assertReady(nodeId: string) {
    const node = this.list().find((node) => node.id === nodeId);
    if (!node?.online || !node.ready)
      throw new DomainError('This machine is offline or needs process recovery.');
    return node;
  }
  assertRecovered(memberId: string) {
    const member = this.host.store.get<Member>('member', memberId);
    if (member.runnerId) this.assertReady(member.runnerId);
  }
  create(memberId: string, taskId?: string) {
    const member = this.host.store.get<Member>('member', memberId);
    if (!member.runnerId) throw new DomainError('Account has no execution machine.');
    this.assertReady(member.runnerId);
    const peer = new RemoteCodexClient(this, this.host, member.runnerId, memberId, taskId);
    this.peers.set(peer.id, peer);
    return peer;
  }
  call(peer: RemoteCodexClient, input: Omit<RunnerCommand, 'id' | 'clientId' | 'memberId'>) {
    this.assertReady(peer.nodeId);
    if (this.pending.size >= 128) throw new DomainError('Machine command queue is full.');
    const command = { ...input, id: randomUUID(), clientId: peer.id, memberId: peer.memberId };
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        const message =
          'Machine did not acknowledge the command. It will not be replayed; recover explicitly.';
        peer.uncertain(message);
        reject(new Error(message));
      }, 90_000);
      timer.unref();
      this.pending.set(command.id, {
        command,
        nodeId: peer.nodeId,
        delivered: false,
        resolve,
        reject,
        timer,
      });
    });
  }
  async exchange(
    nodeId: string,
    body: { epoch?: string; ready: boolean; busy: boolean; version: string; events: RunnerEvent[] },
  ) {
    if (this.polling.has(nodeId))
      throw new DomainError('Machine exchange already in progress.', 409);
    this.polling.add(nodeId);
    try {
      const node = this.host.store.get<RunnerNode>('runner', nodeId);
      if (body.epoch !== this.epoch)
        return { epoch: this.epoch, reset: true, commands: [], ack: [], applied: [] };
      this.host.store.put('runner', {
        ...node,
        epoch: this.epoch,
        ready: body.ready,
        busy: body.busy,
        lastSeen: new Date().toISOString(),
        version: body.version.slice(0, 180),
      });
      if (body.ready && (node.epoch !== this.epoch || !node.ready))
        void this.host.restoreAccounts(nodeId).catch(() => {});
      const ack: string[] = [];
      const applied: string[] = [];
      for (const event of body.events) {
        const key = `${nodeId}:${event.id}`;
        if (this.seen.has(key)) {
          ack.push(event.id);
          continue;
        }
        const peer = this.peers.get(event.clientId);
        // Unknown peers belong to an old coordinator; never bind them to a new lease.
        if (!peer || peer.nodeId !== nodeId) {
          ack.push(event.id);
          continue;
        }
        if ((await peer.receive(event)) && event.files) applied.push(event.id);
        this.seen.add(key);
        ack.push(event.id);
        if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!);
      }
      const next = [...this.pending.values()].find(
        (item) => item.nodeId === nodeId && !item.delivered,
      );
      if (next) next.delivered = true; // Lost response is uncertain, never redeliver a mutation.
      return {
        epoch: this.epoch,
        reset: false,
        commands: next ? [next.command] : [],
        ack,
        applied,
      };
    } finally {
      this.polling.delete(nodeId);
    }
  }
  result(peer: RemoteCodexClient, event: RunnerEvent) {
    const item = event.commandId ? this.pending.get(event.commandId) : undefined;
    if (!item || item.command.clientId !== peer.id || item.nodeId !== peer.nodeId) return;
    clearTimeout(item.timer);
    this.pending.delete(item.command.id);
    if (event.error) item.reject(new Error(redact(event.error)));
    else item.resolve(event.result);
  }
  isStop(event: RunnerEvent) {
    return !!event.commandId && this.pending.get(event.commandId)?.command.action === 'stop';
  }
  retire(id: string) {
    this.peers.delete(id);
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('Coordinator closed.'));
    }
    this.pending.clear();
  }
}

/** Same official stdio App Server, executed on the paired machine instead of in this VM. */
export class RemoteCodexClient extends CodexClient {
  readonly id = randomUUID();
  private launched = false;
  private launching: Promise<void> | null = null;
  private halted = false;
  private context: {
    root: string;
    taskId: string;
    token: string;
    before: RunnerFile[];
    readOnly: boolean;
  } | null = null;
  constructor(
    private broker: Runners,
    private host: Workspace,
    readonly nodeId: string,
    readonly memberId: string,
    private taskId?: string,
  ) {
    super({ home: host.home(memberId), cwd: host.defaultCwd });
  }
  override get pid() {
    return undefined;
  }
  override async start() {
    if (this.halted) throw new Error('Remote Codex has been stopped.');
    if (!this.launched) {
      this.launching ??= this.broker
        .call(this, { action: 'start' })
        .then(() => {
          this.launched = true;
        })
        .finally(() => {
          this.launching = null;
        });
      await this.launching;
    }
  }
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    await this.start();
    if (this.halted) throw new Error('Remote Codex was stopped during startup.');
    let files: RunnerFile[] | undefined, workspace: string | undefined;
    if (method === 'thread/start' || method === 'thread/resume') {
      const task = this.host.store
        .tasks()
        .find(
          (task) =>
            task.id === (this.taskId || this.host.running.get(this.memberId)?.taskId) &&
            task.assignedTo === this.memberId &&
            task.status === 'running' &&
            (task.worktree === params.cwd ||
              (!task.worktree &&
                this.host.store.projects().find((project) => project.id === task.projectId)
                  ?.path === params.cwd)),
        );
      const lease = task ? this.host.store.lease(task.id) : undefined;
      if (!task || !lease || lease.orphaned)
        throw new DomainError('Remote conversation needs a current task lease.');
      files = await exportRunnerFiles(params.cwd);
      workspace = task.id;
      if (!this.host.store.owns(task.id, lease.token))
        throw new DomainError('Task ownership changed during machine preparation.');
      this.context = {
        root: params.cwd,
        taskId: task.id,
        token: lease.token,
        before: files,
        readOnly: params.sandbox === 'read-only',
      };
    }
    return this.broker.call(this, { action: 'request', method, params, files, workspace });
  }
  override respond(id: string | number, result: unknown) {
    void this.broker
      .call(this, { action: 'respond', params: { id, result } })
      .catch((error) => this.emit('error', error));
  }
  override rejectRequest(id: string | number, message?: string) {
    void this.broker
      .call(this, { action: 'reject', params: { id, message } })
      .catch((error) => this.emit('error', error));
  }
  override async stop() {
    this.halted = true;
    if (this.launching) await this.launching;
    if (!this.launched) return;
    await this.broker.call(this, { action: 'stop' });
    this.launched = false;
    this.broker.retire(this.id);
    this.emit('exit', { code: 0 });
  }
  uncertain(message: string) {
    const context = this.context;
    if (!context || !this.host.store.owns(context.taskId, context.token)) return;
    const task = this.host.store.get<Task>('task', context.taskId);
    if (task.status !== 'running') return;
    this.halted = true;
    this.host.store.db
      .prepare('UPDATE leases SET orphaned=1 WHERE taskId=? AND token=?')
      .run(context.taskId, context.token);
    this.host.store.updateTask(context.taskId, { status: 'blocked', error: message });
    const session = this.host.sessions.all().find((session) => session.taskId === context.taskId);
    if (session) {
      this.host.sessions.update(session.id, { status: 'interrupted', error: message });
      const active = this.host.sessions.active.get(session.id);
      if (active) {
        clearInterval(active.heartbeat);
        active.finished = true;
      }
    }
    const run = this.host.running.get(this.memberId);
    if (run?.taskId === context.taskId) {
      clearInterval(run.heartbeat);
      run.stopping = true;
    }
    this.host.mesh.ask(task.projectId, this.memberId, 'Execution machine needs recovery', message);
  }
  async receive(event: RunnerEvent) {
    try {
      if (event.files) {
        const context = this.context;
        if (!context) throw new DomainError('No owned remote workspace for returned files.');
        const after = validateRunnerFiles(event.files);
        const guard = () => {
          if (!this.host.store.owns(context.taskId, context.token))
            throw new DomainError('Stale remote workspace cannot modify this task.');
        };
        guard();
        if (!context.readOnly)
          await applyRunnerFiles(
            context.root,
            context.before,
            after,
            this.host.store.get<Task>('task', context.taskId).scope,
            guard,
          );
        context.before = after;
      }
      if (event.type === 'result') this.broker.result(this, event);
      else if (event.type === 'notification') this.emit('notification', event.method, event.params);
      else if (event.type === 'request') this.emit('request', event.params);
      else if (event.type === 'exit') {
        this.launched = false;
        this.emit('exit', event.params);
      } else if (event.type === 'error') this.emit('error', new Error(redact(event.error)));
      return true;
    } catch (error) {
      // An output-sync failure must not masquerade as a successfully completed turn.
      if (event.files && this.context) {
        try {
          const files = validateRunnerFiles(event.files);
          this.host.store.put('remoteRecovery', {
            id: this.context.taskId,
            nodeId: this.nodeId,
            files,
            reason: redact(error),
            receivedAt: new Date().toISOString(),
          });
        } catch {
          /* Malformed packets are acknowledged as failed, never replayed forever. */
        }
      }
      if (event.type === 'result' && this.broker.isStop(event)) this.broker.result(this, event);
      else if (event.type === 'result')
        this.broker.result(this, { ...event, error: redact(error) });
      else if (event.type === 'notification' && event.method === 'turn/completed')
        this.emit('notification', 'turn/completed', {
          ...event.params,
          turn: {
            ...event.params?.turn,
            status: 'failed',
            error: { message: `Remote output needs recovery: ${redact(error)}` },
          },
        });
      else this.emit('error', error);
      return false;
    }
  }
}
