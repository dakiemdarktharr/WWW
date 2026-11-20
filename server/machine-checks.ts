import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MachineCheckPurpose, MachineCheckView, Task } from '../shared/types.ts';
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
  sharedSadeJobId?: string;
  purpose?: MachineCheckPurpose;
  platform: string;
  arch: string;
  base: string | null;
  started: string;
  finished?: string;
  command: string;
  repeat?: MachineCommand;
  delivery?: { clientId: string; recipe: string; expiresAt: string };
  preparingEpoch?: string;
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
  {
    delivery,
    preparingEpoch,
    purpose,
  }: {
    delivery?: { clientId: string; expiresAt: string };
    preparingEpoch?: string;
    purpose?: MachineCheckPurpose;
  } = {},
) {
  const parts = [recipe.command, ...recipe.args];
  const safe = parts.every(
    (arg) =>
      redact(arg) === arg &&
      !/^--?(?:password|secret|token|api[-_]?key|authorization|access[-_]?token)$/i.test(arg),
  );
  const check: MachineCheck = {
    id: randomUUID(),
    key: evidenceHash(
      purpose === 'diagnostic' ? [runner.id, recipe, purpose] : [runner.id, recipe],
    ),
    runnerId: runner.id,
    runnerName: runner.name,
    grantId: grant.id,
    ...(task.sharedSadeJobId ? { sharedSadeJobId: task.sharedSadeJobId } : {}),
    ...(purpose ? { purpose } : {}),
    platform: grant.platform,
    arch: grant.arch,
    base: task.baseCommit,
    started: new Date().toISOString(),
    command: safe
      ? parts.map((s) => JSON.stringify(s)).join(' ')
      : redact(recipe.command) + ' [private arguments omitted]',
    ...(safe ? { repeat: recipe } : {}),
    ...(delivery ? { delivery: { ...delivery, recipe: evidenceHash(recipe) } } : {}),
    ...(preparingEpoch ? { preparingEpoch } : {}),
  };
  return store.put('machineCheck:' + task.id, check);
}
export function receiveMachineResult(
  store: Store,
  task: Task,
  check: MachineCheck,
  recipeDigest: string,
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
    evidence.recipe !== recipeDigest ||
    (check.delivery && evidence.runId !== check.id)
  )
    throw new DomainError('The paired runner did not confirm this request, machine and command.');
  const pin = store.lookup<{ fingerprint: string }>('machineCheckSigner', check.runnerId);
  const fingerprint = pin ? pin.fingerprint : signerFingerprint(proof.publicKey);
  verifyMachineSignature(evidence, proof, fingerprint);
  if (!pin) store.put('machineCheckSigner', { id: check.runnerId, fingerprint });
  store.put('machineCheck:' + task.id, {
    ...check,
    error: undefined,
    evidence,
    proof,
    code: evidence.code,
    timedOut: evidence.timedOut,
    truncated: evidence.outputTruncated,
    finished: evidence.completedAt,
  });
}
export function failMachineCheck(store: Store, taskId: string, checkId: string, error: unknown) {
  const kind = 'machineCheck:' + taskId;
  const row = store.get<MachineCheck>(kind, checkId);
  if (!row.finished)
    store.put(kind, {
      ...row,
      finished: new Date().toISOString(),
      error: redact(error instanceof Error ? error.message : error).slice(0, 1000),
    });
}
export async function inspectMachineChecks(
  store: Store,
  task: Task,
  required: boolean,
  epoch?: string,
) {
  const records = store.all<MachineCheck>('machineCheck:' + task.id);
  if (!records.length && !required) return undefined;
  const latest = new Map(records.map((row) => [row.key, row.id]));
  const input =
    task.worktree && records.some((row) => row.evidence)
      ? await machineInput(task.worktree)
      : undefined;
  const attempts: MachineCheckView[] = records.map((row) => {
    const ev = row.evidence;
    let status: MachineCheckView['status'] = 'unconfirmed';
    let error = row.error;
    if (!row.finished) {
      if (row.preparingEpoch) {
        if (row.preparingEpoch === epoch) status = 'preparing';
        else error = 'The coordinator restarted before dispatch. Rerun this check.';
      } else if (row.delivery && Date.parse(row.delivery.expiresAt) > Date.now())
        status = 'awaiting result';
    } else if (!error && ev) {
      if (row.code !== 0 || row.timedOut || row.truncated) status = 'failed';
      else if (ev.input !== ev.after || ev.input !== input || task.baseCommit !== row.base)
        status = 'stale';
      else status = 'passed';
      if (row.truncated) error = 'The command exceeded the runner output limit.';
      else if (ev.input !== ev.after) error = 'The command modified the tested source files.';
    }
    return {
      id: row.id,
      current: latest.get(row.key) === row.id,
      purpose: row.purpose ?? 'verification',
      status,
      runner: row.runnerName,
      platform: row.platform,
      arch: row.arch,
      command: row.command,
      started: row.started,
      finished: row.finished,
      input: ev?.input,
      base: ev?.baseCommit,
      signer: row.proof && signerFingerprint(row.proof.publicKey),
      output: ev?.output,
      runId: ev?.runId,
      recipe: ev?.recipe,
      release: ev?.release,
      runtime: ev?.runtime,
      code: row.code,
      timedOut: row.timedOut,
      error,
      repeatable: !!row.repeat,
    };
  });
  const verification = attempts.filter((row) => row.current && row.purpose !== 'diagnostic');
  const verificationRequired = required || verification.length > 0;
  return {
    verificationRequired,
    passed:
      !verificationRequired ||
      (verification.length > 0 && verification.every((row) => row.status === 'passed')),
    attempts,
  };
}
export async function assertMachineChecks(store: Store, task: Task, required: boolean) {
  const checks = await inspectMachineChecks(store, task, required);
  if (checks && !checks.passed)
    throw new DomainError(
      'This patch needs a passing paired-machine check on its current files. Open Reviews to inspect or rerun the check.',
    );
  return Boolean(checks?.verificationRequired);
}
