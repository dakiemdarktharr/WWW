import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CodexClient, probeCodex, localSkillRoots } from './codex.ts';
import { privateDirectory, redact } from './security.ts';
import {
  applyRunnerFiles,
  exportRunnerFiles,
  validateRunnerFiles,
  machineSnapshotProtocol,
  type RunnerFile,
} from './runner-files.ts';
import { git } from './git.ts';
import type { RunnerCommand, RunnerEvent } from './runners.ts';
import { exportSkills, installSkills } from './skill-sharing.ts';
import { MachineExecutor, type ExecutionGrant } from './machine-execution.ts';
import { setTimeout as wait } from 'node:timers/promises';
import { checkRecoveryProtocol, MachineCheckOutbox } from './machine-check-outbox.ts';

export interface RunnerConfig {
  origin: string;
  token: string;
  id: string;
  dataDir: string;
  slots: number;
  maxLoad: number;
  minFreeMB: number;
  exchangeUrl?: string;
  bridgeKey?: string;
  executionGrant?: ExecutionGrant;
}
interface Peer {
  client: CodexClient;
  memberId: string;
  root?: string;
  files?: RunnerFile[];
  active: boolean;
  stopping: boolean;
  chain: Promise<void>;
}
const uuid = /^[a-f0-9-]{36}$/;

export class MachineAgent {
  executor: MachineExecutor;
  readonly events: RunnerEvent[] = [];
  private peers = new Map<string, Peer>();
  private commands = new Set<string>();
  private operations = new Set<Promise<void>>();
  private outbox?: MachineCheckOutbox;
  private checkOutbox() {
    return (this.outbox ??= new MachineCheckOutbox(this.config.dataDir, this.config.id));
  }
  private snapshots = new Map<string, { marker: string; files: RunnerFile[] }>();
  epoch = '';
  constructor(
    readonly config: RunnerConfig,
    private factory = (home: string, cwd: string) =>
      new CodexClient({ home, cwd, skillRoots: localSkillRoots() }),
  ) {
    this.executor = new MachineExecutor(config.dataDir, config.executionGrant);
  }
  get busy() {
    return (
      os.freemem() / 1024 / 1024 < this.config.minFreeMB ||
      (process.platform !== 'win32' && os.loadavg()[0] > this.config.maxLoad)
    );
  }
  private push(clientId: string, event: Omit<RunnerEvent, 'id' | 'clientId'>) {
    // Backpressure stops admission; retain completion/output events for acknowledged delivery.
    const id = randomUUID();
    this.events.push({ id, clientId, ...event });
    const root = this.peers.get(clientId)?.root;
    if (event.files && root)
      this.snapshots.set(id, {
        marker: path.join(this.config.dataDir, 'manifests', `${path.basename(root)}.json`),
        files: event.files,
      });
  }
  batch() {
    const result: RunnerEvent[] = [];
    let bytes = 0;
    const receipts = this.config.executionGrant ? this.checkOutbox().batch() : [];
    let events = this.events;
    if (receipts.length) {
      const queued = new Map(this.events.map((event) => [event.id, event]));
      const saved = receipts.map((receipt) => {
        const event = queued.get(receipt.id) ?? receipt;
        queued.delete(receipt.id);
        return event;
      });
      events = [...saved, ...queued.values()];
    }
    for (const event of events) {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (result.length && bytes + size > 3_500_000) break;
      result.push(event);
      bytes += size;
      if (result.length >= 40) break;
    }
    return result;
  }
  async acknowledge(ids: string[], applied: string[] = []) {
    if (ids.length) this.outbox?.acknowledge(ids);
    const accepted = new Set(applied);
    for (const id of ids) {
      const snapshot = this.snapshots.get(id);
      if (snapshot && accepted.has(id))
        await writeFile(snapshot.marker, JSON.stringify(snapshot.files), { mode: 0o600 });
      this.snapshots.delete(id);
    }
    const ack = new Set(ids);
    for (let index = this.events.length - 1; index >= 0; index--)
      if (ack.has(this.events[index].id)) this.events.splice(index, 1);
  }
  execute(command: RunnerCommand) {
    if (this.commands.has(command.id)) return; // Even transport retries cannot start a turn twice.
    this.commands.add(command.id);
    const operation = this.handle(command)
      .catch((error) =>
        this.push(command.clientId, {
          type: 'result',
          commandId: command.id,
          error: redact(error),
        }),
      )
      .finally(() => this.operations.delete(operation));
    this.operations.add(operation);
    return operation;
  }
  private async handle(command: RunnerCommand) {
    if (!uuid.test(command.clientId) || !uuid.test(command.memberId) || !uuid.test(command.id))
      throw new Error('Invalid machine command identity.');
    if (command.action === 'execute') {
      if (
        command.method === checkRecoveryProtocol &&
        command.params?.operation === 'run' &&
        this.config.executionGrant &&
        command.params.checkId === command.id
      ) {
        const event: RunnerEvent = {
          id: command.id,
          commandId: command.id,
          type: 'result',
          clientId: command.clientId,
          method: checkRecoveryProtocol,
          params: { taskId: command.params.taskId },
        };
        const outbox = this.checkOutbox();
        if (!outbox.claim(event)) return;
        try {
          event.result = await this.executor.perform(command.id, command.params);
        } catch (error) {
          event.error = redact(error).slice(0, 1000);
        }
        outbox.finish(event);
        this.events.push(event);
        return;
      }
      const result = await this.executor.perform(command.id, command.params);
      this.push(command.clientId, { type: 'result', commandId: command.id, result });
      return;
    }
    if (this.config.executionGrant)
      throw new Error(
        'This machine is paired for tools only; AI sign-in and model RPC are not permitted.',
      );
    let peer = this.peers.get(command.clientId);
    let result: any = {};
    let files: RunnerFile[] | undefined;
    if (command.action === 'start') {
      if (peer) throw new Error('RPC peer already exists.');
      if (this.peers.size >= 32) throw new Error('Too many Codex processes on this machine.');
      const home = path.join(this.config.dataDir, 'profiles', command.memberId),
        cwd = path.join(this.config.dataDir, 'idle');
      await privateDirectory(home);
      await mkdir(cwd, { recursive: true });
      const client = this.factory(home, cwd);
      peer = {
        client,
        memberId: command.memberId,
        active: false,
        stopping: false,
        chain: Promise.resolve(),
      };
      this.peers.set(command.clientId, peer);
      const owned = peer;
      client.on('notification', (method: string, params: any) => {
        owned.chain = owned.chain
          .then(async () => {
            let snapshot: RunnerFile[] | undefined;
            if (method === 'turn/completed') {
              owned.active = false;
              try {
                if (owned.root) snapshot = await exportRunnerFiles(owned.root);
              } catch (error) {
                params = {
                  ...params,
                  turn: {
                    ...params.turn,
                    status: 'failed',
                    error: { message: `Output retained on machine: ${redact(error)}` },
                  },
                };
              }
            }
            this.push(command.clientId, { type: 'notification', method, params, files: snapshot });
          })
          .catch((error) => this.push(command.clientId, { type: 'error', error: redact(error) }));
      });
      client.on('request', (params) => this.push(command.clientId, { type: 'request', params }));
      client.on('error', (error) =>
        this.push(command.clientId, { type: 'error', error: redact(error) }),
      );
      client.on('exit', (params) => {
        owned.active = false;
        if (!owned.stopping) this.push(command.clientId, { type: 'exit', params });
      });
      await client.start();
      if (client.pid && process.platform !== 'win32') os.setPriority(client.pid, 15);
    } else {
      if (!peer && command.action === 'stop') {
        this.push(command.clientId, {
          type: 'result',
          commandId: command.id,
          result: { stopped: true },
        });
        return;
      }
      if (!peer || peer.memberId !== command.memberId) throw new Error('Unknown account RPC peer.');
      if (command.action === 'request') {
        const home = path.join(this.config.dataDir, 'profiles', command.memberId);
        if (command.method === 'relay/skills/export') result = await exportSkills(home);
        else if (command.method === 'relay/skills/install')
          result = await installSkills(home, command.params);
        else if (command.method === 'relay/skills/import')
          result = await installSkills(
            home,
            await exportSkills(path.join(os.homedir(), '.codex')),
            true,
          );
        else {
          const params = structuredClone(command.params || {});
          if (command.method === 'thread/start' || command.method === 'thread/resume') {
            if (!command.workspace || !uuid.test(command.workspace) || !command.files)
              throw new Error('Missing owned workspace.');
            if (peer.active) throw new Error('Cannot replace a running workspace.');
            files = validateRunnerFiles(command.files);
            const root = path.join(this.config.dataDir, 'workspaces', command.workspace);
            const marker = path.join(this.config.dataDir, 'manifests', `${command.workspace}.json`);
            let before: RunnerFile[] = [];
            try {
              before = validateRunnerFiles(JSON.parse(await readFile(marker, 'utf8')));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            await mkdir(root, { recursive: true });
            // If an acknowledgement was lost, an identical cloud snapshot still
            // proves the output arrived. Never overwrite divergent local output.
            if (before.length) {
              const current = await exportRunnerFiles(root);
              if (JSON.stringify(current) === JSON.stringify(files)) before = current;
            }
            await git(root, ['init']);
            await applyRunnerFiles(root, before, files, ['.'], () => {});
            await git(root, ['add', '--all']);
            await git(root, [
              '-c',
              'user.name=RELAY transport',
              '-c',
              'user.email=transport@relay.invalid',
              'commit',
              '--allow-empty',
              '-m',
              'Materialize owned task snapshot',
            ]);
            await mkdir(path.dirname(marker), { recursive: true });
            await writeFile(marker, JSON.stringify(files), { mode: 0o600 });
            peer.root = root;
            peer.files = files;
            params.cwd = root;
          } else if (command.method === 'skills/list') params.cwds = peer.root ? [peer.root] : [];
          else if (command.method === 'plugin/installed') params.cwds = [];
          if (command.method === 'turn/start') {
            if (
              this.busy ||
              this.events.length > 1000 ||
              [...this.peers.values()].filter((peer) => peer.active).length >= this.config.slots
            )
              throw new Error('Machine is busy; task remains queued for explicit retry.');
            peer.active = true;
          }
          if (peer.stopping) throw new Error('Codex process was stopped before this command.');
          try {
            result = await peer.client.request(command.method!, params);
          } catch (error) {
            if (command.method === 'turn/start') peer.active = false;
            throw error;
          }
          files = undefined;
        }
      } else if (command.action === 'respond')
        peer.client.respond(command.params.id, command.params.result);
      else if (command.action === 'reject')
        peer.client.rejectRequest(command.params.id, command.params.message);
      else if (command.action === 'stop') {
        peer.stopping = true;
        await peer.client.stop();
        await peer.chain;
        if (peer.root) files = await exportRunnerFiles(peer.root);
      } else throw new Error('Unknown machine command.');
    }
    this.push(command.clientId, { type: 'result', commandId: command.id, result, files });
    if (command.action === 'stop') this.peers.delete(command.clientId);
  }
  async reset(epoch: string) {
    await this.executor.stop();
    // First stop owned processes; acknowledge a new coordinator only after this succeeds.
    await Promise.all(
      [...this.peers.values()].map(async (peer) => {
        peer.stopping = true;
        await peer.client.stop();
      }),
    );
    await Promise.allSettled([...this.operations]);
    this.peers.clear();
    this.commands.clear();
    this.events.length = 0;
    this.outbox?.close();
    this.outbox = undefined;
    this.epoch = epoch;
    this.executor = new MachineExecutor(this.config.dataDir, this.config.executionGrant);
  }
}

export async function runMachine(config: RunnerConfig) {
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/')
    throw new Error('Machine requires an HTTPS workspace origin.');
  const exchange = new URL(config.exchangeUrl || `${origin.origin}/api/runner/exchange`);
  if (
    exchange.origin !== origin.origin ||
    exchange.username ||
    exchange.password ||
    exchange.hash ||
    !['/api/runner/exchange', '/api/desktop/bridge/exchange'].includes(exchange.pathname)
  )
    throw new Error('Machine exchange must use the configured HTTPS workspace.');
  if (
    exchange.pathname === '/api/desktop/bridge/exchange' &&
    (!uuid.test(exchange.searchParams.get('host') || '') ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(config.bridgeKey || ''))
  )
    throw new Error('Desktop machine connection requires its private bridge key.');
  if (!path.isAbsolute(config.dataDir) || config.token.length < 40 || !uuid.test(config.id))
    throw new Error('Invalid machine configuration.');
  config.slots = Math.max(1, Math.min(4, config.slots || 1));
  await privateDirectory(config.dataDir);
  const lock = path.join(config.dataDir, 'runner-active.json');
  await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
    flag: 'wx',
    mode: 0o600,
  }).catch(() => {
    throw new Error(
      'Machine has an existing run marker. Confirm its old processes stopped before removing runner-active.json.',
    );
  });
  process.env.RELAY_RUNNER_NO_GPU = '1';
  const agent = new MachineAgent(config),
    probe = config.executionGrant
      ? { available: true, version: `Kivuno tools / Node ${process.version}` }
      : await probeCodex();
  if (!probe.available) {
    await unlink(lock);
    throw new Error(probe.version);
  }
  const diagnostic = new CodexClient({
    home: path.join(config.dataDir, 'diagnostic'),
    cwd: config.dataDir,
  });
  if (!config.executionGrant)
    try {
      await diagnostic.start();
      await diagnostic.request('account/read', {});
    } finally {
      await diagnostic.stop();
    }
  let stopping = false,
    lastContact = Date.now();
  const shutdown = new AbortController();
  const stop = () => {
    stopping = true;
    shutdown.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (process.send)
    process.on('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'relay:shutdown'
      )
        stop();
    });
  try {
    while (!stopping) {
      let delay = 1500;
      try {
        const response = await fetch(exchange, {
          method: 'POST',
          headers: {
            Origin: origin.origin,
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
            ...(config.bridgeKey ? { 'X-Relay-Bridge-Key': config.bridgeKey } : {}),
          },
          body: JSON.stringify({
            epoch: agent.epoch,
            ready: true,
            busy: agent.busy,
            version: [machineSnapshotProtocol, checkRecoveryProtocol, probe.version]
              .filter(Boolean)
              .join(' '),
            execution: agent.executor.metadata(),
            events: agent.batch(),
          }),
          signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(28_000)]),
          redirect: 'error',
        });
        if (response.status === 204) {
          await agent.reset('');
          delay = 60_000;
        } else if (response.status === 401 || response.status === 403)
          throw new Error('Machine authorization rejected.');
        else if (!response.ok)
          throw new Error(`Machine exchange unavailable (${response.status}).`);
        else {
          const body = await response.json();
          lastContact = Date.now();
          if (body.reset) await agent.reset(body.epoch);
          else {
            await agent.acknowledge(body.ack || [], body.applied || []);
            for (const command of body.commands || []) void agent.execute(command);
          }
        }
      } catch (error) {
        // No stale owner continues running when the cloud can no longer renew contact.
        if (Date.now() - lastContact > 45_000) await agent.reset('');
        delay = 15_000;
      }
      if (!stopping)
        await wait(delay, undefined, { signal: shutdown.signal }).catch((error) => {
          if (error.name !== 'AbortError') throw error;
        });
    }
  } finally {
    await agent.reset('');
    await agent.executor.stop();
    await unlink(lock);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      'Usage: node --import tsx server/runner-agent.ts /absolute/private-config.json',
    );
  const config = JSON.parse(await readFile(path.resolve(file), 'utf8')) as RunnerConfig;
  await runMachine(config);
}
