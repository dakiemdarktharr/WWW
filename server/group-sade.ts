import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  SharedGroup,
  SharedHarnessGrant,
  SharedMessage,
  SharedSadeJob,
  SharedSadeRun,
} from '../shared/collaboration.ts';
import type { PlanTask, TaskDiff } from '../shared/types.ts';
import { allocatePlan, collectPrerequisites, parseTeamPlan, planTool } from './workflow-plan.ts';
import { redact, scopesOverlap } from './security.ts';
import { DomainError, type Store } from './store.ts';
import { reviewDigest } from './sade.ts';

const id = z.string().uuid();
export const projectKey = z.string().regex(/^[a-f0-9]{64}$/);
const short = z.string().trim().min(1).max(100);
const platform = z.enum(['win32', 'darwin', 'linux']);
export const groupSadeGrant = z
  .object({
    action: z.literal('sade-grant'),
    id,
    groupId: id,
    teammateId: id,
    projectKey,
    projectName: short,
    role: z.enum(['engineer', 'designer', 'researcher', 'reviewer']),
    platform,
    pairedPlatform: platform.optional(),
    patchHandoff: z.literal(true).optional(),
    allowWrites: z.boolean(),
    turns: z.number().int().min(1).max(10),
  })
  .strict();
export const sharedDiffInput = z
  .object({
    files: z.array(z.string().max(500)).max(100),
    diff: z.string().max(12000),
    stat: z.string().max(6000),
    truncated: z.boolean(),
  })
  .strict();
export const maxPortableDiff = 64 * 1024;
const revisionInput = z.string().regex(/^[a-f0-9]{40,64}$/);
export const sharedPrerequisite = z
  .object({
    title: z.string().max(140),
    summary: z.string().max(4000).optional(),
    revision: revisionInput.optional(),
    patch: z.object({ change: sharedDiffInput, digest: projectKey }).strict().optional(),
  })
  .strict();
export const maxTaskUpdates = 8;
const maxTaskUpdateLength = 1000;
export const taskUpdateSequence = z.number().int().min(0).max(maxTaskUpdates);
export const sharedSadeUpdate = z
  .object({
    id,
    sequence: taskUpdateSequence.min(1),
    author: z.string().min(1).max(200),
    text: z.string().min(1).max(maxTaskUpdateLength),
  })
  .strict();
export const sharedSadeUpdates = z.array(sharedSadeUpdate).max(maxTaskUpdates);
export const taskUpdateAck = z.object({ jobId: id, through: taskUpdateSequence }).strict();
const syncPrerequisiteSummary =
  'Sync the prerequisite Git revision into this desktop’s linked project. Sade will continue after the revision is available.';
export const sharedFinish = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), plan: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal('done'),
      summary: z.string().trim().min(1).max(4000),
      revision: revisionInput.optional(),
      published: z.literal(true).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('blocked'), summary: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('provider-unavailable') }).strict(),
  z.object({ kind: z.literal('question'), summary: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      kind: z.literal('unchanged'),
      summary: z.string().trim().min(1).max(4000),
      revision: revisionInput.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('change'),
      diff: sharedDiffInput,
      portable: z.literal(true).optional(),
      summary: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('review'),
      verdict: z.enum(['approved', 'changes']),
      summary: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);
export const groupSadeCommands = [
  groupSadeGrant,
  z.object({ action: z.literal('sade-revoke'), groupId: id, grantId: id }).strict(),
  z.object({ action: z.literal('sade-cancel'), groupId: id, runId: id }).strict(),
  z
    .object({
      action: z.literal('sade-update-task'),
      groupId: id,
      runId: id,
      jobId: id,
      id,
      text: z.string().trim().min(1).max(maxTaskUpdateLength),
    })
    .strict(),
  z
    .object({
      action: z.literal('sade-answer'),
      groupId: id,
      runId: id,
      jobId: id,
      answer: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('sade-poll'),
      grants: z.array(id).max(32),
      active: z.array(id).max(4),
      patchHandoff: z.literal(true).optional(),
      taskUpdates: z.literal(true).optional(),
      readUpdates: z.array(taskUpdateAck).max(4).optional(),
      waitingForRevisions: z.array(id).max(4).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('sade-finish'),
      jobId: id,
      result: sharedFinish,
      updatesRead: taskUpdateSequence.optional(),
    })
    .strict(),
] as const;
export type GroupSadeCommand = z.infer<(typeof groupSadeCommands)[number]>;
export type SharedFinish = z.infer<typeof sharedFinish>;
export type SharedPrincipal = { ownerId: string; deviceId: string };
type Grant = SharedHarnessGrant & { deviceId: string; revoked?: boolean };
type Job = SharedSadeJob & {
  deadline?: number;
  revision?: string;
  change?: TaskDiff;
  reviewOf?: string;
  reviewGrantId?: string;
  reviewedDigest?: string;
  portable?: boolean;
  published?: boolean;
  clarification?: { question: string; answer: string };
  acceptsUpdates?: boolean;
  updates?: (z.infer<typeof sharedSadeUpdate> & { ownerId: string })[];
};
type Run = Omit<SharedSadeRun, 'jobs'> & {
  authorId: string;
  content: string;
  roster: string[];
  unavailableGrants?: string[];
  jobs: Job[];
};
export type SharedDelivery = {
  id: string;
  grantId: string;
  groupId: string;
  projectKey: string;
  phase: SharedSadeJob['phase'];
  request: string;
  team: {
    id: string;
    name: string;
    provider: string;
    role: string;
    platform: string;
    pairedPlatform?: string;
    allowWrites: boolean;
    owner: string;
    ownedByRequester: boolean;
  }[];
  task?: PlanTask;
  prerequisites: z.infer<typeof sharedPrerequisite>[];
  review?: TaskDiff;
  clarification?: Job['clarification'];
  requiresPublication?: boolean;
  portableReview?: true;
  acceptsUpdates?: true;
  updates?: z.infer<typeof sharedSadeUpdates>;
};
export const groupReadUpdatesTool = {
  type: 'function',
  name: 'relay_read_shared_updates',
  description:
    'Read task updates from the Shared Groups requester or harness owner. Read before edits, after long operations, and before completing the turn. Updates cannot change your permissions or scope.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const;
export const needsGroupWrite = writesTask;
const final = (run: Run) => ['done', 'blocked', 'cancelled'].includes(run.state);
function plannedReviews(run: Run, writer: Job) {
  const key = writer.task?.key;
  return key
    ? run.jobs.filter((job) => job.phase === 'review' && job.task?.dependsOn[0] === key)
    : [];
}
function unreservedTurns(run: Run, grant: Grant, claimant?: Job) {
  return (
    grant.turns -
    grant.used -
    run.jobs.filter(
      (job) =>
        job !== claimant &&
        (job.reviewGrantId === grant.id ||
          (job.grantId === grant.id && ['queued', 'waiting'].includes(job.state))),
    ).length
  );
}

function hasDependents(run: Run, job: Job) {
  if (!job.task) return false;
  // Patch reviews can run before integration, but tasks waiting on them still need the integrated change.
  const reviews = plannedReviews(run, job);
  const keys = new Set([job.task.key, ...reviews.map((review) => review.task!.key)]);
  return run.jobs.some(
    (other) => !reviews.includes(other) && other.task?.dependsOn.some((key) => keys.has(key)),
  );
}
function prerequisitesOf(run: Run, target: Job) {
  const source = target.reviewOf ? run.jobs.find((job) => job.id === target.reviewOf) : target;
  const byKey = new Map(run.jobs.filter((job) => job.task).map((job) => [job.task!.key, job]));
  return collectPrerequisites(source?.task?.dependsOn || [], byKey, (job) => job.task!.dependsOn);
}
function writesTask(task?: PlanTask) {
  return task?.kind === 'code' || task?.kind === 'design';
}
const writes = writesTask;
function supportsTask(grant: Grant, task?: PlanTask) {
  return (
    (!writes(task) || grant.allowWrites) &&
    (!task?.requiredPlatform ||
      grant.platform === task.requiredPlatform ||
      (writes(task) && grant.pairedPlatform === task.requiredPlatform))
  );
}

function reviewedWriters(run: Run, job: Job) {
  if (job.reviewOf) return run.jobs.filter((prior) => prior.id === job.reviewOf);
  const task = job.task;
  if (task?.kind !== 'review') return [];
  return prerequisitesOf(run, job).filter(
    (prior) => writes(prior.task) && scopesOverlap(prior.task!.scope, task.scope),
  );
}
const leaseMs = 30_000;
const grantMs = 60 * 60_000;

const sharedPlanKinds = {
  'edit-files': 'code',
  'edit-design': 'design',
  'research-read-only': 'research',
  'review-read-only': 'review',
} as const satisfies Record<string, PlanTask['kind']>;

export const groupPlanTool = {
  ...planTool,
  description:
    'Submit the scoped tasks requested by the user. At least one task is required. Preserve named owners, dependencies and required platforms.',
  inputSchema: {
    ...planTool.inputSchema,
    properties: {
      ...planTool.inputSchema.properties,
      tasks: {
        ...planTool.inputSchema.properties.tasks,
        items: {
          ...planTool.inputSchema.properties.tasks.items,
          properties: {
            ...planTool.inputSchema.properties.tasks.items.properties,
            kind: {
              ...planTool.inputSchema.properties.tasks.items.properties.kind,
              enum: Object.keys(sharedPlanKinds),
              description:
                'Choose by action and permissions: edit-files creates or updates files such as docs, code or config, or uses paired OS tools. edit-design edits visual assets. research-read-only investigates without editing. review-read-only inspects existing work without editing.',
            },
            preferredMemberId: {
              type: 'string',
              minLength: 4,
              maxLength: 36,
              description:
                'Copy the exact ref of the named teammate from team. Use auto only if the requester did not name a teammate.',
            },
            requiredPlatform: {
              type: 'string',
              enum: ['any', 'win32', 'darwin', 'linux'],
              description:
                'Use darwin for a Mac or macOS requirement even if unavailable. Use any when no OS is required.',
            },
          },
          required: [
            ...planTool.inputSchema.properties.tasks.items.required,
            'preferredMemberId',
            'requiredPlatform',
          ],
        },
      },
    },
  },
};

const sharedPlanRouting = z
  .object({
    kind: z.string(),
    preferredMemberId: z.string().min(4).max(36),
    requiredPlatform: z
      .enum(['any', 'win32', 'darwin', 'linux'])
      .transform((value) => (value === 'any' ? undefined : value)),
  })
  .passthrough();
const sharedPlanInput = z
  .object({ tasks: z.array(sharedPlanRouting).min(1).max(32) })
  .passthrough();
export const sharedPlanMemberRef = (index: number) => `member-${index + 1}`;

export function parseSharedGroupPlan(input: unknown, roster: readonly string[]) {
  const plan = sharedPlanInput.parse(input);
  const tasks = plan.tasks.map((task) => {
    const choice = task.preferredMemberId;
    const member = roster.find(
      (id, index) => choice === id || choice === sharedPlanMemberRef(index),
    );
    if (choice !== 'auto' && !member)
      throw new DomainError('Use a teammate reference from the supplied team or auto.');
    const kind = Object.entries(sharedPlanKinds).find(([action]) => action === task.kind)?.[1];
    return { ...task, kind: kind ?? task.kind, preferredMemberId: member };
  });
  return parseTeamPlan({ ...plan, tasks });
}

export const groupNoWorkTool = {
  type: 'function',
  name: 'relay_finish_shared_without_work',
  description:
    'Close planning when the message only shares information or explicitly requests no action. Use the planning tool for requested work, including work that needs an unavailable machine.',
  inputSchema: {
    type: 'object',
    properties: { summary: planTool.inputSchema.properties.summary },
    required: ['summary'],
    additionalProperties: false,
  },
} as const;

export function parseGroupNoWork(input: unknown) {
  const result = z.object({ summary: z.string() }).strict().parse(input);
  return parseTeamPlan({ ...result, tasks: [] }, { allowEmpty: true });
}

export const groupReviewTool = {
  type: 'function',
  name: 'relay_submit_shared_review',
  description:
    'Report independent review findings for the supplied diff. Approve only if the change is ready for human integration.',
  inputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['approved', 'changes'] },
      summary: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    required: ['verdict', 'summary'],
    additionalProperties: false,
  },
} as const;

export const groupQuestionTool = {
  type: 'function',
  name: 'relay_ask_shared_requester',
  description:
    'Ask the group requester one necessary question before making any file changes, then end this turn. A reply consumes another granted turn.',
  inputSchema: {
    type: 'object',
    properties: { summary: { type: 'string', minLength: 1, maxLength: 500 } },
    required: ['summary'],
    additionalProperties: false,
  },
} as const;

/** The cloud schedules bounded jobs. It has no provider credential or command-execution API. */
export class GroupSade {
  constructor(
    private store: Store,
    private now: () => number = Date.now,
  ) {
    store.db.exec(`
      CREATE INDEX IF NOT EXISTS shared_sade_grant_group ON records(json_extract(data,'$.groupId')) WHERE kind='sharedSadeGrant';
      CREATE INDEX IF NOT EXISTS shared_sade_run_group ON records(json_extract(data,'$.groupId')) WHERE kind='sharedSadeRun';
      CREATE INDEX IF NOT EXISTS shared_sade_active ON records(json_extract(data,'$.groupId'))
        WHERE kind='sharedSadeRun' AND json_extract(data,'$.state') IN ('planning','running');
    `);
  }
  private grants(group: SharedGroup) {
    return this.store.db
      .prepare(
        "SELECT data FROM records WHERE kind='sharedSadeGrant' AND json_extract(data,'$.groupId')=? ORDER BY rowid",
      )
      .all(group.id)
      .map((row) => JSON.parse(String(row.data)) as Grant);
  }
  private runs(group: SharedGroup) {
    return this.store.db
      .prepare(
        "SELECT data FROM records WHERE kind='sharedSadeRun' AND json_extract(data,'$.groupId')=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(group.id)
      .reverse()
      .map((row) => JSON.parse(String(row.data)) as Run);
  }
  private usable(grant: Grant, group: SharedGroup, checkBudget = true) {
    let device;
    try {
      device = this.store.get<{ revoked: boolean; expiresAt: string }>(
        'desktopDevice',
        grant.deviceId,
      );
    } catch {
      return false;
    }
    return Boolean(
      device &&
      !device.revoked &&
      Date.parse(device.expiresAt) > this.now() &&
      !grant.revoked &&
      grant.expiresAt > this.now() &&
      (!checkBudget || grant.used < grant.turns) &&
      group.people.some((person) => person.id === grant.ownerId && person.state === 'active') &&
      group.teammates.some(
        (member) => member.ownerId === grant.ownerId && member.localId === grant.teammateId,
      ),
    );
  }
  view(group: SharedGroup, ownerId?: string) {
    const grants = this.grants(group);
    return {
      sadeGrants: grants
        .filter((grant) => this.usable(grant, group, false))
        .map(({ deviceId, revoked, ...view }) => view),
      sadeRuns: this.runs(group).map(
        ({ authorId, content, roster, unavailableGrants, ...run }) => ({
          ...run,
          canAnswer: ownerId === authorId,
          jobs: run.jobs.map(
            ({
              deadline,
              revision,
              change,
              reviewOf,
              reviewGrantId,
              reviewedDigest,
              clarification,
              portable,
              published,
              acceptsUpdates,
              updates,
              ...job
            }) => ({
              ...job,
              canUpdate: Boolean(
                ownerId &&
                acceptsUpdates &&
                job.state === 'running' &&
                (deadline || 0) > this.now() &&
                (job.updateCount || 0) < maxTaskUpdates &&
                run.state === 'running' &&
                this.canUpdate(
                  group,
                  authorId,
                  grants.find((grant) => grant.id === job.grantId),
                  ownerId,
                ),
              ),
            }),
          ),
        }),
      ),
    };
  }
  private canUpdate(
    group: SharedGroup,
    requester: string,
    grant: Grant | undefined,
    owner: string,
  ) {
    return Boolean(
      grant &&
      this.usable(grant, group, false) &&
      (owner === requester || owner === grant.ownerId || owner === group.ownerId),
    );
  }
  start(group: SharedGroup, message: SharedMessage) {
    if (!message.sade) return;
    const grants = this.grants(group).filter(
      (grant) => grant.projectKey === message.sade?.projectKey && this.usable(grant, group),
    );
    if (!grants.some((grant) => grant.ownerId === message.ownerId))
      throw new DomainError('Link your project and grant a teammate access before asking Sade.');
    const similar = this.store
      .all<Run>('sharedSadeRun')
      .filter((run) => run.projectKey === message.sade?.projectKey || run.groupId === group.id);
    if (similar.some((run) => !final(run)))
      throw new DomainError(
        'Finish or cancel the active Sade request for this group or project first.',
      );
    if (
      similar.some(
        (run) =>
          run.state !== 'done' && run.jobs.some((job) => job.deadline && job.deadline > this.now()),
      )
    )
      throw new DomainError(
        'The previous Sade request is stopping. Wait for its desktop lease to expire before starting again.',
        409,
      );
    const lead = grants.find((grant) => grant.ownerId === message.ownerId)!;
    this.store.put('sharedSadeRun', {
      id: message.id,
      groupId: group.id,
      projectKey: message.sade.projectKey,
      authorId: message.ownerId,
      content: redact(message.content),
      roster: grants.map((grant) => grant.id),
      state: 'planning',
      jobs: [
        { id: randomUUID(), runId: message.id, grantId: lead.id, phase: 'plan', state: 'queued' },
      ],
    } satisfies Run);
  }
  groupCommand(
    group: SharedGroup,
    actor: SharedPrincipal,
    command: Extract<GroupSadeCommand, { groupId: string }>,
  ) {
    if (command.action === 'sade-grant') {
      const member = group.teammates.find(
        (person) => person.ownerId === actor.ownerId && person.localId === command.teammateId,
      );
      if (!member) throw new DomainError('Share your own teammate in this group first.', 403);
      const existing = this.grants(group).find((grant) => grant.id === command.id);
      if (existing) {
        if (
          existing.ownerId !== actor.ownerId ||
          existing.deviceId !== actor.deviceId ||
          existing.teammateId !== command.teammateId ||
          existing.projectKey !== command.projectKey ||
          existing.projectName !== command.projectName ||
          existing.role !== command.role ||
          existing.platform !== command.platform ||
          existing.pairedPlatform !== command.pairedPlatform ||
          existing.patchHandoff !== command.patchHandoff ||
          existing.allowWrites !== command.allowWrites ||
          existing.turns !== command.turns
        )
          throw new DomainError('Grant ID already used.', 409);
        return this.view(group, actor.ownerId);
      }
      if (this.store.all<Grant>('sharedSadeGrant').some((grant) => grant.id === command.id))
        throw new DomainError('Grant ID already used.');
      for (const previous of this.grants(group))
        if (
          previous.ownerId === actor.ownerId &&
          previous.teammateId === member.localId &&
          previous.projectKey === command.projectKey &&
          !previous.revoked
        )
          this.store.put('sharedSadeGrant', { ...previous, revoked: true });
      const { action, ...grant } = command;
      this.store.put('sharedSadeGrant', {
        ...grant,
        ...actor,
        label: member.name,
        expiresAt: this.now() + grantMs,
        used: 0,
      } satisfies Grant);
      return this.view(group, actor.ownerId);
    }
    if (command.action === 'sade-revoke') {
      const grant = this.grants(group).find((item) => item.id === command.grantId);
      if (!grant || grant.ownerId !== actor.ownerId)
        throw new DomainError('Only this harness owner can revoke its grant.', 403);
      this.store.put('sharedSadeGrant', { ...grant, revoked: true });
    } else {
      const run = this.store.get<Run>('sharedSadeRun', command.runId);
      if (run.groupId !== group.id)
        throw new DomainError('Shared request is unavailable in this group.', 404);
      if (command.action === 'sade-update-task') {
        const job = run.jobs.find((item) => item.id === command.jobId);
        const grant = job && this.grants(group).find((item) => item.id === job.grantId);
        if (!this.canUpdate(group, run.authorId, grant, actor.ownerId))
          throw new DomainError(
            'Only the request author, group owner or assigned harness owner can update this task.',
            403,
          );
        const text = redact(command.text).slice(0, maxTaskUpdateLength);
        const existing = job?.updates?.find((entry) => entry.id === command.id);
        if (existing) {
          if (existing.ownerId !== actor.ownerId || existing.text !== text)
            throw new DomainError('Task update ID already used.', 409);
          return this.view(group, actor.ownerId);
        }
        if (
          !job?.acceptsUpdates ||
          job.phase !== 'task' ||
          job.state !== 'running' ||
          run.state !== 'running' ||
          (job.deadline || 0) <= this.now()
        )
          throw new DomainError('This task is no longer accepting updates.', 409);
        const sequence = (job.updateCount || 0) + 1;
        if (sequence > maxTaskUpdates)
          throw new DomainError('This task has reached its update limit.', 409);
        const person = group.people.find((entry) => entry.id === actor.ownerId)!;
        job.updates = [
          ...(job.updates || []),
          {
            id: command.id,
            sequence,
            ownerId: actor.ownerId,
            author: person.name.slice(0, 200),
            text,
          },
        ];
        job.updateCount = sequence;
        this.store.put('sharedSadeRun', run);
      } else if (command.action === 'sade-answer') {
        if (run.authorId !== actor.ownerId)
          throw new DomainError('Only the request author can answer this question.', 403);
        const job = run.jobs.find((item) => item.id === command.jobId);
        if (!job || job.state !== 'waiting' || !job.summary || final(run))
          throw new DomainError('This question is no longer waiting.', 409);
        const grant = this.grants(group).find((item) => item.id === job.grantId);
        if (!grant || !this.usable(grant, group) || unreservedTurns(run, grant, job) < 1)
          throw new DomainError('The harness needs a remaining granted turn to continue.', 409);
        // Each attempt has its own receipt. The task key still identifies dependencies.
        run.jobs[run.jobs.indexOf(job)] = {
          ...job,
          id: randomUUID(),
          state: 'queued',
          deadline: undefined,
          summary: undefined,
          clarification: { question: job.summary, answer: redact(command.answer) },
          updatesRead: undefined,
        };
        this.store.put('sharedSadeRun', run);
      } else {
        if (run.authorId !== actor.ownerId && group.ownerId !== actor.ownerId)
          throw new DomainError(
            'Only the request author or group owner can cancel this request.',
            403,
          );
        if (!final(run))
          this.store.put('sharedSadeRun', {
            ...run,
            state: 'cancelled',
            jobs: run.jobs.map((job) => ({
              ...job,
              change: undefined,
              updates: undefined,
              reviewGrantId: undefined,
              state: job.state === 'done' ? 'done' : 'cancelled',
            })),
          } satisfies Run);
      }
    }
    return this.view(group, actor.ownerId);
  }
  private actorGrant(grant: Grant, actor: SharedPrincipal) {
    return grant.ownerId === actor.ownerId && grant.deviceId === actor.deviceId;
  }
  private reviewGrants(run: Run, writer: Grant, grants: Iterable<Grant>) {
    return [...grants].filter(
      (grant) => run.roster.includes(grant.id) && grant.ownerId !== writer.ownerId,
    );
  }
  private availableReviewer(run: Run, job: Job, group: SharedGroup, grants: Grant[]) {
    return grants
      .filter(
        (grant) => this.usableForRun(grant, group, run) && unreservedTurns(run, grant, job) > 0,
      )
      .sort(
        (a, b) =>
          Number(b.id === job.reviewGrantId) - Number(a.id === job.reviewGrantId) ||
          Number(b.role === 'reviewer') - Number(a.role === 'reviewer') ||
          a.used - b.used,
      )[0];
  }
  private usableForRun(grant: Grant, group: SharedGroup, run: Run) {
    return !run.unavailableGrants?.includes(grant.id) && this.usable(grant, group);
  }
  private handleUnavailableProvider(
    run: Run,
    job: Job,
    group: SharedGroup,
    grant: Grant,
    grants: Grant[],
  ) {
    if (job.phase === 'plan' || job.state !== 'running' || job.change || !grant.used)
      throw new DomainError('Only work that did not start can be reassigned.', 409);

    this.store.put('sharedSadeGrant', { ...grant, used: grant.used - 1 });
    run.unavailableGrants = [...new Set([...(run.unavailableGrants || []), grant.id])];
    if (job.task?.preferredMemberId) {
      this.block(run, job, 'The requested harness did not have enough provider quota to start.');
      return;
    }

    const byId = new Map(grants.map((entry) => [entry.id, entry]));
    const authorOwners = new Set(
      reviewedWriters(run, job).map((prior) => byId.get(prior.grantId)?.ownerId),
    );
    const writer = writes(job.task);
    const reviewerOwners = new Set(
      writer
        ? run.jobs
            .filter((other) => reviewedWriters(run, other).includes(job))
            .map((other) => byId.get(other.grantId)?.ownerId)
        : [],
    );
    const planned = writer ? plannedReviews(run, job) : [];
    const replacement = grants
      .filter(
        (entry) =>
          run.roster.includes(entry.id) &&
          this.usableForRun(entry, group, run) &&
          unreservedTurns(run, entry, job) > 0 &&
          supportsTask(entry, job.task) &&
          !authorOwners.has(entry.ownerId) &&
          !reviewerOwners.has(entry.ownerId) &&
          (!writer || !grant.patchHandoff || entry.patchHandoff || !hasDependents(run, job)),
      )
      .sort(
        (a, b) => Number(b.role === grant.role) - Number(a.role === grant.role) || a.used - b.used,
      )
      .find((entry) => {
        if (!writer) return true;
        if (planned.length)
          return planned.every((review) => {
            const peer = byId.get(review.grantId);
            return peer && this.usableForRun(peer, group, run);
          });
        return this.availableReviewer(run, job, group, this.reviewGrants(run, entry, grants));
      });
    if (!replacement) {
      this.block(
        run,
        job,
        'The harness could not start within its provider quota. No eligible granted teammate can take over this task.',
      );
      return;
    }
    run.jobs[run.jobs.indexOf(job)] = {
      ...job,
      id: randomUUID(),
      grantId: replacement.id,
      state: 'queued',
      deadline: undefined,
      summary: 'Waiting for another granted teammate after a provider quota check.',
      reviewGrantId: undefined,
      acceptsUpdates: undefined,
      updatesRead: undefined,
    };
    this.store.put('sharedSadeRun', run);
  }
  private block(run: Run, job: Job, reason: string) {
    run.state = 'blocked';
    run.error = redact(reason);
    job.state = 'blocked';
    job.summary = run.error;
    for (const item of run.jobs) {
      item.change = undefined;
      item.updates = undefined;
      item.reviewGrantId = undefined;
    }
    this.store.put('sharedSadeRun', run);
  }
  poll(actor: SharedPrincipal, command: Extract<GroupSadeCommand, { action: 'sade-poll' }>) {
    const active: string[] = [];
    const reviews: { jobId: string; digest: string }[] = [];
    const updates: { jobId: string; notes: z.infer<typeof sharedSadeUpdates> }[] = [];
    let delivery: SharedDelivery | undefined;
    const runs = this.store.db
      .prepare(
        "SELECT data FROM records WHERE kind='sharedSadeRun' AND json_extract(data,'$.state') IN ('planning','running') ORDER BY rowid",
      )
      .all()
      .map((row) => JSON.parse(String(row.data)) as Run);
    const supplied = new Set(command.grants);
    const held = new Set(command.active);
    const waiting = new Set(command.waitingForRevisions);
    for (const run of runs) {
      const group = this.store.get<SharedGroup>('sharedGroup', run.groupId);
      const grants = new Map(this.grants(group).map((grant) => [grant.id, grant]));
      if (
        !run.jobs.some(
          (job) =>
            supplied.has(job.grantId) &&
            grants.has(job.grantId) &&
            this.actorGrant(grants.get(job.grantId)!, actor),
        )
      )
        continue;
      const invalid = run.jobs.find((job) => {
        if (!['queued', 'running', 'reviewing', 'waiting'].includes(job.state)) return false;
        const grant = grants.get(job.grantId);
        return (
          !grant ||
          !this.usable(grant, group, ['queued', 'waiting'].includes(job.state)) ||
          (['running', 'reviewing'].includes(job.state) && (job.deadline || 0) <= this.now())
        );
      });
      if (invalid) {
        this.block(
          run,
          invalid,
          'A harness grant expired, ran out of turns, was revoked, or lost contact. Work stays on its owner’s desktop.',
        );
        continue;
      }
      const dependencies = new Map(
        run.jobs
          .filter((job) => job.state === 'queued')
          .map((job) => [job, prerequisitesOf(run, job)]),
      );
      const withdrawn = [...dependencies].find(([, predecessors]) =>
        predecessors.some((other) => {
          if (other.state !== 'done' || !other.portable || other.published) return false;
          const owner = grants.get(other.grantId);
          return !owner || !this.usable(owner, group, false);
        }),
      );
      if (withdrawn) {
        this.block(
          run,
          withdrawn[0],
          'A prerequisite owner withdrew permission before the reviewed patch was handed off.',
        );
        continue;
      }
      let touched = false;
      for (const job of run.jobs) {
        if (!['queued', 'running', 'reviewing'].includes(job.state)) continue;
        const grant = grants.get(job.grantId)!;
        if (!this.actorGrant(grant, actor) || !supplied.has(grant.id)) continue;
        if (job.state !== 'queued') {
          if (held.has(job.id)) {
            job.deadline = this.now() + leaseMs;
            active.push(job.id);
            if (
              job.state === 'running' &&
              waiting.has(job.id) &&
              prerequisitesOf(run, job).some(
                (prior) => prior.revision && (!prior.portable || prior.published),
              )
            )
              job.summary = syncPrerequisiteSummary;
            else if (job.summary === syncPrerequisiteSummary) job.summary = undefined;
            if (job.reviewedDigest) reviews.push({ jobId: job.id, digest: job.reviewedDigest });
            if (job.acceptsUpdates && command.taskUpdates && job.state === 'running') {
              const read =
                command.readUpdates?.find((entry) => entry.jobId === job.id)?.through || 0;
              if (read > (job.updatesRead || 0) && read <= (job.updateCount || 0))
                job.updatesRead = read;
              if (job.updates && (job.updatesRead || 0) < job.updates.length)
                updates.push({
                  jobId: job.id,
                  notes: job.updates.map(({ ownerId, ...note }) => note),
                });
            }
            touched = true;
          }
          continue;
        }
        if (
          delivery ||
          command.active.length >= 4 ||
          run.jobs.some(
            (other) =>
              other.state === 'running' && grants.get(other.grantId)?.deviceId === actor.deviceId,
          )
        )
          continue;
        if (job.phase === 'review' && !job.reviewOf) continue;
        const predecessors = dependencies.get(job) || [];
        if (predecessors.some((other) => other.state !== 'done')) continue;
        if (
          job.phase === 'task' &&
          job.task?.kind === 'review' &&
          reviewedWriters(run, job).some(
            (prior) => grants.get(prior.grantId)?.ownerId === grant.ownerId,
          )
        ) {
          this.block(
            run,
            job,
            'This review needs a teammate who did not write the files under review.',
          );
          break;
        }
        if (job.updateCount && !command.taskUpdates) {
          const summary = 'Update this desktop to continue a task with Shared Sade updates.';
          if (job.summary !== summary) {
            job.summary = summary;
            touched = true;
          }
          continue;
        }
        if (
          !command.patchHandoff &&
          predecessors.some((other) => other.portable && !other.published)
        ) {
          const summary = 'Update this desktop to receive a reviewed Shared Sade patch.';
          if (job.summary !== summary) {
            job.summary = summary;
            touched = true;
          }
          continue;
        }
        if (
          job.task &&
          run.jobs.some(
            (other) =>
              ['running', 'reviewing'].includes(other.state) &&
              other.task &&
              writes(other.task) &&
              writes(job.task) &&
              scopesOverlap(other.task.scope, job.task!.scope),
          )
        )
          continue;
        if (writes(job.task) && !plannedReviews(run, job).length) {
          const peers = this.reviewGrants(run, grant, grants.values());
          const reviewer = this.availableReviewer(run, job, group, peers);
          if (!reviewer && peers.length) {
            if (
              run.jobs.some(
                (other) =>
                  other !== job && ['running', 'reviewing', 'waiting'].includes(other.state),
              )
            ) {
              const summary = 'Waiting for an independent review turn while other work is active.';
              if (job.summary !== summary) {
                job.summary = summary;
                touched = true;
              }
              continue;
            }
            this.block(
              run,
              job,
              'This plan has no spare independent review turn for the change. Retry with another owner’s remaining review turn.',
            );
            break;
          }
          job.reviewGrantId = reviewer?.id;
        }
        job.state = 'running';
        job.acceptsUpdates = job.phase === 'task' && Boolean(command.taskUpdates);
        job.summary = undefined;
        job.deadline = this.now() + leaseMs;
        this.store.put('sharedSadeGrant', { ...grant, used: grant.used + 1 });
        touched = true;
        const team = run.roster.flatMap((grantId) => {
          const entry = grants.get(grantId);
          const teammate = group.teammates.find(
            (member) => member.ownerId === entry?.ownerId && member.localId === entry?.teammateId,
          );
          return entry && teammate && this.usable(entry, group, false)
            ? [
                {
                  id: entry.id,
                  name: entry.label,
                  provider: teammate.provider,
                  role: entry.role,
                  platform: entry.platform,
                  pairedPlatform: entry.pairedPlatform,
                  allowWrites: entry.allowWrites,
                  owner: group.people.find((person) => person.id === entry.ownerId)!.name,
                  ownedByRequester: entry.ownerId === run.authorId,
                },
              ]
            : [];
        });
        const reviewedJob = job.reviewOf
          ? run.jobs.find((other) => other.id === job.reviewOf)
          : undefined;
        const reviewedTask = reviewedJob?.task;
        const reviewedClarification = reviewedJob?.clarification;
        const reviewRequirements = reviewedTask
          ? [
              `Task: ${redact(reviewedTask.title).slice(0, 140)}`,
              `Description: ${redact(reviewedTask.description).slice(0, 2000)}`,
              `Acceptance: ${redact(reviewedTask.acceptance).slice(0, 3000)}`,
              ...(reviewedClarification
                ? [
                    `Question: ${redact(reviewedClarification.question).slice(0, 500)}`,
                    `Answer: ${redact(reviewedClarification.answer).slice(0, 1000)}`,
                  ]
                : []),
            ].join('\n')
          : undefined;
        delivery = {
          id: job.id,
          grantId: grant.id,
          groupId: group.id,
          projectKey: run.projectKey,
          phase: job.phase,
          request: reviewRequirements ?? run.content,
          team,
          task: job.task,
          prerequisites: predecessors.map((other) => ({
            title: other.task!.title,
            summary: other.summary?.slice(0, 500),
            revision: other.revision,
            ...(other.portable && !other.published && other.change && other.reviewedDigest
              ? { patch: { change: other.change, digest: other.reviewedDigest } }
              : {}),
          })),
          clarification: job.clarification,
          ...(job.acceptsUpdates
            ? { acceptsUpdates: true, updates: job.updates?.map(({ ownerId, ...note }) => note) }
            : {}),
          requiresPublication:
            writes(job.task) &&
            hasDependents(run, job) &&
            !(command.patchHandoff && grant.patchHandoff),
          portableReview:
            writes(job.task) && command.patchHandoff && grant.patchHandoff ? true : undefined,
          ...(reviewedJob ? { review: reviewedJob.change } : {}),
        };
      }
      if (touched) this.store.put('sharedSadeRun', run);
    }
    return {
      active,
      delivery,
      reviews,
      revisionHandoff: true as const,
      quotaFailover: true as const,
      ...(command.taskUpdates ? { updates } : {}),
    };
  }
  finish(actor: SharedPrincipal, command: Extract<GroupSadeCommand, { action: 'sade-finish' }>) {
    const run = this.store
      .all<Run>('sharedSadeRun')
      .find((item) => item.jobs.some((job) => job.id === command.jobId));
    if (!run) throw new DomainError('Shared job is unavailable.', 404);
    const job = run.jobs.find((item) => item.id === command.jobId)!;
    const group = this.store.get<SharedGroup>('sharedGroup', run.groupId);
    const grants = this.grants(group);
    const grant = grants.find((item) => item.id === job.grantId)!;
    if (!grant || !this.actorGrant(grant, actor) || !this.usable(grant, group, false))
      throw new DomainError('The harness grant is no longer valid.', 403);
    if (job.state === 'done' || (job.state === 'waiting' && command.result.kind === 'question'))
      return { accepted: true };
    if (
      !['running', 'reviewing'].includes(job.state) ||
      final(run) ||
      (job.deadline || 0) <= this.now()
    )
      throw new DomainError('This job is no longer running. Recover locally.', 409);
    const result = command.result;
    if (result.kind === 'provider-unavailable') {
      this.handleUnavailableProvider(run, job, group, grant, grants);
      return { accepted: true };
    }
    const read = Math.max(job.updatesRead || 0, command.updatesRead || 0);
    if (read > (job.updateCount || 0))
      throw new DomainError('Task update acknowledgement is out of date.', 409);
    if (read < (job.updateCount || 0) && result.kind !== 'blocked') {
      this.block(
        run,
        job,
        'The harness finished before reading the latest task update. Its work remains on its owner’s desktop.',
      );
      return { accepted: true };
    }
    if (read) job.updatesRead = read;
    if (result.kind !== 'question') job.updates = undefined;
    if (result.kind === 'blocked') this.block(run, job, result.summary);
    else if (result.kind === 'question') {
      if (job.phase === 'review' || job.state !== 'running' || job.clarification)
        throw new DomainError('This job cannot ask another question.', 409);
      if (unreservedTurns(run, grant) < 1)
        this.block(run, job, 'The harness has no spare granted turn for a clarification.');
      else {
        job.state = 'waiting';
        job.deadline = undefined;
        job.summary = redact(result.summary);
        this.store.put('sharedSadeRun', run);
      }
    } else if (result.kind === 'plan') {
      if (job.phase !== 'plan') throw new DomainError('Only the planner can submit a plan.');
      try {
        const plan = parseTeamPlan(result.plan, { allowEmpty: true });
        if (plan.tasks.length === 0) {
          job.state = 'done';
          job.summary = redact(plan.summary);
          run.state = 'done';
          this.store.put('sharedSadeRun', run);
          return { accepted: true };
        }
        const eligible = grants.filter(
          (entry) => run.roster.includes(entry.id) && this.usable(entry, group),
        );
        const ownerByGrant = new Map(eligible.map((entry) => [entry.id, entry.ownerId]));
        const allocations = allocatePlan(
          plan,
          eligible.map((entry) => ({ id: entry.id, role: entry.role })),
          {
            preferSpecialists: true,
            ownerByMember: ownerByGrant,
            turns: new Map(eligible.map((entry) => [entry.id, entry.turns - entry.used])),
            supports: (grantId, task) =>
              eligible.some((entry) => entry.id === grantId && supportsTask(entry, task)),
          },
        );
        job.state = 'done';
        job.summary = redact(plan.summary);
        const planned = plan.tasks.map((task, index): Job => ({
          id: randomUUID(),
          runId: run.id,
          grantId: allocations[index].memberId,
          phase: 'task',
          task: {
            ...task,
            description: redact(task.description),
            acceptance: redact(task.acceptance),
          },
          state: 'queued',
        }));
        const byKey = new Map(planned.map((item) => [item.task!.key, item]));
        for (const item of planned) {
          const task = item.task!;
          if (task.kind !== 'review' || task.dependsOn.length !== 1) continue;
          const source = byKey.get(task.dependsOn[0]);
          if (
            source?.task &&
            writes(source.task) &&
            ownerByGrant.get(source.grantId) !== ownerByGrant.get(item.grantId) &&
            task.scope.length === source.task.scope.length &&
            task.scope.every((scope) => source.task!.scope.includes(scope))
          )
            item.phase = 'review';
        }
        run.jobs.push(...planned);
        run.state = 'running';
        this.store.put('sharedSadeRun', run);
      } catch (error) {
        this.block(run, job, error instanceof Error ? error.message : 'Sade rejected the plan.');
      }
    } else if (result.kind === 'change') {
      if (job.phase !== 'task' || !writes(job.task) || !grant.allowWrites)
        throw new DomainError('Only a granted writing task can share a diff.');
      if (result.portable && !grant.patchHandoff)
        throw new DomainError('The author has not granted reviewed patch handoff.', 403);
      if (result.portable && Buffer.byteLength(JSON.stringify(result.diff)) > maxPortableDiff)
        throw new DomainError('The reviewed patch exceeds the Shared Groups handoff limit.');
      let digest: string;
      try {
        digest = reviewDigest(result.diff);
      } catch {
        this.block(
          run,
          job,
          'The diff cannot be safely shared for review. Inspect the change locally.',
        );
        return { accepted: true };
      }
      if (job.state === 'reviewing') {
        if (!job.change || reviewDigest(job.change) !== digest)
          throw new DomainError('The diff changed after review submission.');
        return { accepted: true };
      }
      if (
        result.diff.files.some(
          (file) =>
            !job.task!.scope.some(
              (scope) => scope === '.' || file === scope || file.startsWith(`${scope}/`),
            ),
        )
      ) {
        this.block(run, job, 'A changed file falls outside the task scope.');
        return { accepted: true };
      }
      const scheduled = plannedReviews(run, job);
      if (
        scheduled.some((review) => {
          const entry = grants.find((item) => item.id === review.grantId);
          return !entry || entry.ownerId === grant.ownerId || !this.usable(entry, group);
        })
      ) {
        this.block(
          run,
          job,
          'A planned reviewer lost access or ran out of turns. The change stays local.',
        );
        return { accepted: true };
      }
      const reviewer = scheduled.length
        ? undefined
        : this.availableReviewer(run, job, group, this.reviewGrants(run, grant, grants));
      if (!scheduled.length && !reviewer) {
        this.block(
          run,
          job,
          'Independent review needs another owner’s teammate with a remaining turn. The change stays local.',
        );
        return { accepted: true };
      }
      job.state = 'reviewing';
      job.reviewGrantId = undefined;
      job.change = result.diff;
      job.portable = result.portable;
      job.summary = 'Waiting for independent review.';
      for (const review of scheduled) review.reviewOf = job.id;
      if (reviewer)
        run.jobs.push({
          id: randomUUID(),
          runId: run.id,
          grantId: reviewer.id,
          phase: 'review',
          reviewOf: job.id,
          state: 'queued',
        });
      this.store.put('sharedSadeRun', run);
    } else if (result.kind === 'review') {
      const source = run.jobs.find((item) => item.id === job.reviewOf);
      if (job.phase !== 'review' || !source?.change || source.state !== 'reviewing')
        throw new DomainError('No current change to review.');
      job.state = 'done';
      job.summary = redact(result.summary);
      if (result.verdict === 'changes')
        this.block(
          run,
          source,
          'Independent reviewer requested changes. Read the review before continuing.',
        );
      else {
        if (run.jobs.every((other) => other.reviewOf !== source.id || other.state === 'done')) {
          source.reviewedDigest = reviewDigest(source.change);
          source.summary =
            hasDependents(run, source) && !source.portable
              ? 'Reviewed. Integrate and share the Git revision from the author’s workspace.'
              : 'Reviewed. The author can integrate the changes locally.';
        }
        this.store.put('sharedSadeRun', run);
      }
    } else if (result.kind === 'unchanged') {
      if (job.phase !== 'task' || !writes(job.task) || job.state !== 'running')
        throw new DomainError('Only a running writing task can report an unchanged worktree.', 409);
      const hasNextTask = run.jobs.some((other) => other.task?.dependsOn.includes(job.task!.key));
      if (hasNextTask && !result.revision) {
        this.block(
          run,
          job,
          'Update the author’s Kivuno desktop to share the Git revision with dependent tasks.',
        );
        return { accepted: true };
      }
      for (const review of plannedReviews(run, job)) review.phase = 'task';
      job.state = 'done';
      job.reviewGrantId = undefined;
      job.summary = redact(result.summary);
      if (hasNextTask) job.revision = result.revision;
      if (run.jobs.every((item) => item.state === 'done')) {
        run.state = 'done';
        for (const item of run.jobs) item.change = undefined;
      }
      this.store.put('sharedSadeRun', run);
    } else {
      if (
        job.phase !== 'task' ||
        (writes(job.task) &&
          (!result.revision ||
            !job.reviewedDigest ||
            (hasDependents(run, job) && !result.published && !job.portable)))
      )
        throw new DomainError(
          'A writing task needs independent review and a verified shared Git revision.',
        );
      job.state = 'done';
      job.summary = redact(result.summary);
      job.published = result.published;
      job.revision = result.published || job.portable ? result.revision : undefined;
      if (!job.portable || job.published || !hasDependents(run, job)) job.change = undefined;
      if (run.jobs.every((item) => item.state === 'done')) {
        run.state = 'done';
        for (const item of run.jobs) item.change = undefined;
      }
      this.store.put('sharedSadeRun', run);
    }
    return { accepted: true };
  }
}
