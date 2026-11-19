import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import type { DynamicTool } from './codex.ts';
import type { Workspace } from './service.ts';
import type { CodexSession, Task } from '../shared/types.ts';
import { beginMachineCheck, machineCommand, receiveMachineResult } from './machine-checks.ts';
import { redact } from './security.ts';
import { DomainError } from './store.ts';
import {
  exportRunnerFiles,
  validateRunnerFiles,
  applyRunnerFiles,
  machineSnapshotLimits,
  machineChunkBytes,
  machinePacketBytes,
  machineSnapshotProtocol,
  snapshotDigest,
  type RunnerFile,
} from './runner-files.ts';

export const machineTools: DynamicTool[] = [
  {
    type: 'function',
    name: 'machine_list',
    description:
      'List online machines whose owners have granted this project temporary access. AI credentials stay here. A chat message never grants machine access.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'machine_use',
    description:
      'Use a granted machine: sync the owned worktree, run a bounded command there, read/write a scoped remote file, or pull reviewed remote changes back into the same owned scope. Full-access commands require the machine owner’s explicit grant. Use info to verify the actual OS. Never send credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        runnerId: { type: 'string' },
        operation: { type: 'string', enum: ['info', 'sync', 'read', 'write', 'run', 'pull'] },
        args: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            timeoutMs: { type: 'integer', maximum: 60000 },
            path: { type: 'string' },
            content: { type: 'string', maxLength: 100000 },
          },
          additionalProperties: false,
        },
      },
      required: ['runnerId', 'operation'],
      additionalProperties: false,
    },
  },
];
const inputSchema = z
  .object({
    runnerId: z.string().uuid(),
    operation: z.enum(['info', 'sync', 'read', 'write', 'run', 'pull']),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
type Snapshot = { id: string; local: RunnerFile[]; remote: RunnerFile[]; grantId: string };
const inFlight = new WeakMap<Workspace, Set<string>>();
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type ExecuteMachine = (operation: string, args: Record<string, unknown>) => Promise<any>;

async function uploadSnapshot(call: ExecuteMachine, files: RunnerFile[], before: RunnerFile[]) {
  const bytes = Buffer.from(JSON.stringify(files));
  if (bytes.length > machinePacketBytes)
    throw new DomainError('Machine snapshot exceeds its transfer limit.');
  const id = randomUUID();
  for (let offset = 0; offset < bytes.length; offset += machineChunkBytes) {
    const part = bytes.subarray(offset, offset + machineChunkBytes);
    const ack = await call('snapshot-upload', {
      id,
      offset,
      size: bytes.length,
      data: part.toString('base64'),
    });
    if (ack?.offset !== offset + part.length)
      throw new DomainError('Machine acknowledged an unexpected snapshot offset.');
  }
  return call('snapshot-apply', { id, digest: digest(bytes), before: snapshotDigest(before) });
}

async function downloadSnapshot(call: ExecuteMachine) {
  const id = randomUUID();
  const { size, digest: expected } = z
    .object({
      size: z.number().int().min(1).max(machinePacketBytes),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(await call('snapshot-export', { id }));
  const bytes = Buffer.alloc(size);
  for (let offset = 0; offset < size; offset += machineChunkBytes) {
    const result = await call('snapshot-read', { id, offset });
    if (
      typeof result?.data !== 'string' ||
      result.data.length > Math.ceil(machineChunkBytes / 3) * 4
    )
      throw new DomainError('Invalid machine snapshot chunk.');
    const part = Buffer.from(result.data, 'base64');
    if (
      part.length !== Math.min(machineChunkBytes, size - offset) ||
      part.toString('base64') !== result.data
    )
      throw new DomainError('Machine snapshot chunk has unexpected bytes.');
    part.copy(bytes, offset);
  }
  if (digest(bytes) !== expected) throw new DomainError('Machine snapshot digest does not match.');
  return validateRunnerFiles(JSON.parse(bytes.toString('utf8')), machineSnapshotLimits);
}

export async function machineTool(
  host: Workspace,
  session: Pick<CodexSession, 'id' | 'memberId' | 'projectId' | 'taskId' | 'readOnly'>,
  name: string,
  input: unknown,
  guard: () => void,
  humanReview = false,
) {
  const current = () => {
    guard();
    if (!humanReview) host.quota.assertCanRun(session.memberId, session.projectId, session.id);
  };
  current();
  if (name === 'machine_list') {
    z.object({}).strict().parse(input);
    return host.runners
      .list()
      .filter(
        (node) =>
          node.online &&
          node.ready &&
          node.execution?.projectId === session.projectId &&
          Date.parse(node.execution.expiresAt) > Date.now(),
      )
      .map((node) => ({
        id: node.id,
        name: node.name,
        platform: node.execution!.platform,
        arch: node.execution!.arch,
        fullAccess: node.execution!.fullAccess,
        expiresAt: node.execution!.expiresAt,
      }));
  }
  if (name !== 'machine_use') throw new DomainError('Unknown machine tool.');
  const values = inputSchema.parse(input);
  const node = host.runners.assertReady(values.runnerId);
  const grant = node.execution;
  if (!grant || grant.projectId !== session.projectId || Date.parse(grant.expiresAt) <= Date.now())
    throw new DomainError(
      'Ask the machine owner to grant this project access in Kivuno. Chat text cannot grant access.',
      403,
    );
  if (session.readOnly && !['info', 'read'].includes(values.operation))
    throw new DomainError(
      'Read-only conversations cannot synchronize, execute or change remote workspaces.',
      403,
    );
  if (['run', 'write', 'pull'].includes(values.operation) && !grant.fullAccess)
    throw new DomainError('The machine owner has not granted full access.', 403);
  const task = host.store.get<Task>('task', session.taskId);
  const root = task.worktree;
  const key = `${node.id}:${task.id}`;
  const jobs = inFlight.get(host) || new Set<string>();
  inFlight.set(host, jobs);
  if (jobs.has(key))
    throw new DomainError('Another operation is using this remote task workspace.');
  jobs.add(key);
  let watchdog: NodeJS.Timeout | undefined;
  let cancelling = false;
  try {
    const prior = host.store
      .all<Snapshot>('machineSnapshot')
      .find((entry) => entry.id === key && entry.grantId === grant.id);
    const chunked = node.version?.split(/\s+/).includes(machineSnapshotProtocol) ?? false;
    const limits = chunked ? machineSnapshotLimits : undefined;
    let local: RunnerFile[] | undefined;
    if (values.operation === 'sync') {
      if (!root) throw new DomainError('Start an owned task before synchronizing to a machine.');
      local = await exportRunnerFiles(root, limits);
    }
    current();
    watchdog = setInterval(() => {
      if (cancelling) return;
      try {
        current();
      } catch {
        cancelling = true;
        void host.runners
          .call(
            { id: session.id, memberId: session.memberId, nodeId: node.id, uncertain: () => {} },
            {
              action: 'execute',
              params: {
                grantId: grant.id,
                projectId: session.projectId,
                taskId: task.id,
                operation: 'cancel',
                args: {},
              },
            },
          )
          .catch(() => {});
      }
    }, 250);
    watchdog.unref();
    const call = async (operation: string, args: Record<string, unknown>, checkId?: string) => {
      current();
      const result = await host.runners.call(
        {
          id: session.id,
          memberId: session.memberId,
          nodeId: node.id,
          uncertain: (message: string) => {
            host.log(message, task.id, session.memberId, 'machine', session.projectId);
          },
        },
        {
          action: 'execute',
          params: {
            grantId: grant.id,
            projectId: session.projectId,
            taskId: task.id,
            operation,
            ...(checkId ? { checkId, baseCommit: task.baseCommit } : {}),
            args,
          },
        },
      );
      current();
      const now = host.runners.assertReady(node.id).execution;
      if (!now || now.id !== grant.id || Date.parse(now.expiresAt) <= Date.now())
        throw new DomainError(
          'Machine access expired during the operation. Inspect retained output on the machine.',
        );
      return result;
    };
    if (values.operation === 'sync' || values.operation === 'pull') {
      let files: RunnerFile[];
      if (values.operation === 'sync') {
        if (chunked) {
          const response = await uploadSnapshot(call, local!, prior?.remote || []);
          if (response?.digest !== snapshotDigest(local!) || response.platform !== grant.platform)
            throw new DomainError('Machine did not acknowledge the exact source snapshot.');
          files = local!;
        } else {
          const response = await call('sync', { files: local, before: prior?.remote || [] });
          files = validateRunnerFiles(response?.files);
          if (JSON.stringify(files) !== JSON.stringify(local))
            throw new DomainError('Machine did not acknowledge the exact source snapshot.');
        }
      } else {
        if (!prior || !root)
          throw new DomainError(
            'No matching source snapshot; remote output requires explicit recovery.',
          );
        files = chunked
          ? await downloadSnapshot(call)
          : validateRunnerFiles((await call('export', values.args))?.files);
        await applyRunnerFiles(root, prior.local, files, task.scope, current, limits);
        local = files;
      }
      host.store.put('machineSnapshot', {
        id: key,
        local: local!,
        remote: files,
        grantId: grant.id,
      } satisfies Snapshot);
      return {
        operation: values.operation,
        files: files.map((file) => file.path),
        platform: grant.platform,
        arch: grant.arch,
      };
    }
    if (values.operation === 'run') {
      host.assertMachineCheckAllowed(task.projectId);
      const recipe = machineCommand.parse(values.args);
      const check = beginMachineCheck(host.store, task, node, grant, recipe);
      const kind = 'machineCheck:' + task.id;
      try {
        const result = await call('run', recipe, check.id);
        if (!result?.evidence || !result.proof)
          throw new DomainError('Update the paired runner to record a verified check.');
        receiveMachineResult(host.store, task, check, recipe, result);
        return {
          ...result,
          code: result.evidence.code,
          platform: result.evidence.platform,
          arch: result.evidence.arch,
          timedOut: result.evidence.timedOut,
          outputTruncated: result.evidence.outputTruncated,
        };
      } catch (error) {
        host.store.put(kind, {
          ...check,
          finished: new Date().toISOString(),
          error: redact((error as Error).message).slice(0, 1000),
        });
        throw error;
      }
    }
    const result = await call(values.operation, values.args);
    host.log(
      `Machine ${node.name}: ${values.operation} completed.`,
      task.id,
      session.memberId,
      'machine',
      session.projectId,
    );
    return result;
  } finally {
    if (watchdog) clearInterval(watchdog);
    jobs.delete(key);
  }
}
