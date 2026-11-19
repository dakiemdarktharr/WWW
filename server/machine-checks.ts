import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MachineCheckView, Task } from '../shared/types.ts';
import { signerFingerprint, verifyMachineSignature } from './machine-signature.ts';
import { canonicalJson } from './canonical-json.ts';
import { machineInput } from './runner-files.ts';
import { redact } from './security.ts';
import { DomainError, type Store } from './store.ts';

export const machineCommand = z
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
export type MachineCommand = z.infer<typeof machineCommand>;
export function evidenceHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const runnerEvidence = z
  .object({
    version: z.literal(1),
    baseCommit: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .nullable(),
    checkId: z.string().uuid(),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    grantId: z.string().uuid(),
    platform: z.string(),
    arch: z.string(),
    code: z.number().int().nullable(),
    timedOut: z.boolean(),
    outputTruncated: z.boolean(),
    completedAt: z.iso.datetime(),
    runId: z.string().uuid(),
    recipe: sha,
    input: sha,
    after: sha,
    output: sha,
    release: z.string(),
    runtime: z.string(),
  })
  .strict();
type Evidence = z.infer<typeof runnerEvidence>;
export interface MachineCheck {
  id: string;
  key: string;
  runnerId: string;
  runnerName: string;
  grantId: string;
  platform: string;
  arch: string;
  base: string | null;
  started: string;
  finished?: string;
  command: string;
  repeat?: MachineCommand;
  evidence?: Evidence;
  proof?: { publicKey: string; signature: string };
  code?: number | null;
  timedOut?: boolean;
  truncated?: boolean;
  error?: string;
}
export function beginMachineCheck(
  store: Store,
  task: Task,
  runner: {
    id: string;
    name: string;
  },
  grant: { id: string; platform: string; arch: string },
  recipe: MachineCommand,
) {
  const parts = [recipe.command, ...recipe.args];
  const safe = parts.every(
    (arg) =>
      redact(arg) === arg &&
      !/^--?(?:password|secret|token|api[-_]?key|authorization|access[-_]?token)$/i.test(arg),
  );
  const check: MachineCheck = {
    id: randomUUID(),
    key: evidenceHash([runner.id, recipe]),
    runnerId: runner.id,
    runnerName: runner.name,
    grantId: grant.id,
    platform: grant.platform,
    arch: grant.arch,
    base: task.baseCommit,
    started: new Date().toISOString(),
    command: safe
      ? parts.map((s) => JSON.stringify(s)).join(' ')
      : redact(recipe.command) + ' [private arguments omitted]',
    ...(safe ? { repeat: recipe } : {}),
  };
  return store.put('machineCheck:' + task.id, check);
}
export function receiveMachineResult(
  store: Store,
  task: Task,
  check: MachineCheck,
  recipe: MachineCommand,
  raw: unknown,
) {
  const { evidence, proof } = z
    .object({
      evidence: runnerEvidence,
      proof: z.object({ publicKey: z.string().max(128), signature: z.string().max(128) }),
    })
    .parse(raw);
  if (
    evidence.checkId !== check.id ||
    evidence.baseCommit !== check.base ||
    evidence.taskId !== task.id ||
    evidence.projectId !== task.projectId ||
    evidence.grantId !== check.grantId ||
    evidence.platform !== check.platform ||
    evidence.arch !== check.arch ||
    evidence.recipe !== evidenceHash(recipe)
  )
    throw new DomainError('The paired runner did not confirm this request, machine and command.');
  const pin = store.db
    .prepare("SELECT data FROM records WHERE kind='machineCheckSigner' AND id=?")
    .get(check.runnerId) as { data: string } | undefined;
  const fingerprint = pin ? JSON.parse(pin.data).fingerprint : signerFingerprint(proof.publicKey);
  verifyMachineSignature(evidence, proof, fingerprint);
  if (!pin) store.put('machineCheckSigner', { id: check.runnerId, fingerprint });
  store.put('machineCheck:' + task.id, {
    ...check,
    evidence,
    proof,
    code: evidence.code,
    timedOut: evidence.timedOut,
    truncated: evidence.outputTruncated,
    finished: evidence.completedAt,
  });
}
export async function inspectMachineChecks(store: Store, task: Task, required: boolean) {
  const records = store.all<MachineCheck>('machineCheck:' + task.id);
  if (!records.length && !required) return undefined;
  const latest = new Map(records.map((row) => [row.key, row.id]));
  const input = records.length && task.worktree ? await machineInput(task.worktree) : undefined;
  const attempts: MachineCheckView[] = records.map((row) => {
    const ev = row.evidence;
    const status =
      !row.finished || row.error || !ev
        ? 'unconfirmed'
        : row.code !== 0 || row.timedOut || row.truncated
          ? 'failed'
          : ev.input !== ev.after || ev.input !== input || task.baseCommit !== row.base
            ? 'stale'
            : 'passed';
    return {
      id: row.id,
      current: latest.get(row.key) === row.id,
      status,
      runner: row.runnerName,
      platform: row.platform,
      arch: row.arch,
      command: row.command,
      started: row.started,
      finished: row.finished,
      input: ev?.input,
      output: ev?.output,
      runId: ev?.runId,
      recipe: ev?.recipe,
      release: ev?.release,
      runtime: ev?.runtime,
      code: row.code,
      timedOut: row.timedOut,
      error: row.error,
      repeatable: !!row.repeat,
    };
  });
  return {
    passed: attempts.length > 0 && attempts.every((a) => !a.current || a.status === 'passed'),
    attempts,
  };
}
export async function assertMachineChecks(store: Store, task: Task, required: boolean) {
  const checks = await inspectMachineChecks(store, task, required);
  if (checks && !checks.passed)
    throw new DomainError(
      'This patch needs a passing paired-machine check on its current files. Open Reviews to inspect or rerun the check.',
    );
  return !!checks;
}
