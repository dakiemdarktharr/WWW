import { z } from 'zod';
import type { Member, PlanTask, Proposal, TeamPlan } from '../shared/types.ts';
import { DomainError } from './store.ts';
import { normalizeScope } from './security.ts';

const kinds = ['code', 'research', 'design', 'review'] as const;
const keyPattern = /^[a-z][a-z0-9_-]{0,47}$/;
const title = z.string().trim().min(3).max(140);
const summary = z.string().trim().min(10).max(6000);
const acceptance = z.string().trim().min(10).max(3000);
const effort = z.number().int().min(1).max(8);
const scopes = z.array(z.string().trim().min(1).max(300)).min(1).max(12);
const suggestion = z
  .object({ title, kind: z.enum(kinds), scope: scopes, acceptance, effort })
  .strict();
const proposalSchema = z
  .object({
    summary,
    risks: z.array(z.string().trim().min(3).max(500)).max(12),
    suggestions: z.array(suggestion).max(12),
  })
  .strict();
const planTaskSchema = suggestion
  .extend({
    key: z.string().regex(keyPattern),
    description: z.string().trim().min(10).max(6000),
    dependsOn: z.array(z.string().regex(keyPattern)).max(31),
    stage: z.string().trim().min(1).max(60),
    preferredMemberId: z.string().min(1).max(100).optional(),
  })
  .strict();
const planSchema = z.object({ summary, tasks: z.array(planTaskSchema).min(1).max(32) }).strict();

function normalizePlanScopes(values: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const value of values) {
    let scope: string;
    try {
      if (value === '*') throw new Error('Use a concrete path or . for the whole project.');
      scope = normalizeScope(value);
    } catch (error) {
      throw new DomainError(`Invalid scope “${value}”: ${(error as Error).message}`, 400);
    }
    if (/(^|\/)(?:auth\.json|\.env(?:\.[^/]*)?|\.(?:aws|ssh|codex))(?:\/|$)/i.test(scope))
      throw new DomainError(
        `Private credentials or profile state cannot be assigned: ${scope}`,
        400,
      );
    normalized.set(scope.toLowerCase(), scope);
  }
  return normalized.has('.') ? ['.'] : [...normalized.values()];
}

/** Accept only a bounded, structured proposal; agents cannot inject task ownership fields. */
export function parseProposal(input: unknown): Proposal {
  const proposal = proposalSchema.parse(input);
  return {
    ...proposal,
    suggestions: proposal.suggestions.map((item) => ({
      ...item,
      scope: normalizePlanScopes(item.scope),
    })),
  };
}

/** Validate the entire DAG before the coordinator persists any execution tasks. */
export function parseTeamPlan(input: unknown): TeamPlan {
  const parsed = planSchema.parse(input);
  const tasks = parsed.tasks.map((task) => ({ ...task, scope: normalizePlanScopes(task.scope) }));
  const byKey = new Map<string, PlanTask>();
  const titles = new Set<string>();
  for (const task of tasks) {
    if (byKey.has(task.key)) throw new DomainError(`Duplicate task key: ${task.key}`, 400);
    byKey.set(task.key, task);
    const normalizedTitle = task.title.replace(/\s+/g, ' ').toLowerCase();
    if (titles.has(normalizedTitle))
      throw new DomainError(`Duplicate task title: ${task.title}`, 400);
    titles.add(normalizedTitle);
  }
  for (const task of tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length)
      throw new DomainError(`Duplicate dependency in task: ${task.key}`, 400);
    for (const dependency of task.dependsOn) {
      if (!byKey.has(dependency))
        throw new DomainError(`Unknown dependency “${dependency}” in task “${task.key}”.`, 400);
      if (dependency === task.key)
        throw new DomainError(`Task “${task.key}” cannot depend on itself.`, 400);
    }
  }
  const ordered: PlanTask[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: PlanTask) => {
    if (visiting.has(task.key))
      throw new DomainError(`Task dependencies contain a cycle at “${task.key}”.`, 400);
    if (visited.has(task.key)) return;
    visiting.add(task.key);
    for (const key of task.dependsOn) visit(byKey.get(key)!);
    visiting.delete(task.key);
    visited.add(task.key);
    ordered.push(task);
  };
  tasks.forEach(visit);
  return { summary: parsed.summary, tasks: ordered };
}

const roleForKind: Record<PlanTask['kind'], Member['role']> = {
  code: 'engineer',
  research: 'researcher',
  design: 'designer',
  review: 'reviewer',
};
const compareKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Balance estimated effort first; specialism only breaks equal-load ties. */
export function allocatePlan(
  plan: TeamPlan,
  members: Member[],
): { key: string; memberId: string }[] {
  if (!members.length) throw new DomainError('A workflow needs at least one teammate.', 400);
  if (new Set(members.map((member) => member.id)).size !== members.length)
    throw new DomainError('The workflow roster contains a duplicate teammate.', 400);
  const load = new Map(members.map((member) => [member.id, 0]));
  const assignments = new Map<string, string>();
  // Allocate implementations first so reviews can exclude their authors.
  const byEffort = [...plan.tasks].sort(
    (a, b) =>
      Number(a.kind === 'review') - Number(b.kind === 'review') ||
      b.effort - a.effort ||
      compareKey(a.key, b.key),
  );
  for (const task of byEffort) {
    const authors = new Set(
      task.kind === 'review' ? task.dependsOn.map((key) => assignments.get(key)) : [],
    );
    const eligible = members.filter((member) => !authors.has(member.id));
    if (!eligible.length)
      throw new DomainError('Independent review needs another connected teammate.');
    if (task.preferredMemberId && !eligible.some((member) => member.id === task.preferredMemberId))
      throw new DomainError(
        'The requested teammate is unavailable or would review their own work.',
      );
    const member = [...eligible].sort(
      (a, b) =>
        Number(b.id === task.preferredMemberId) - Number(a.id === task.preferredMemberId) ||
        load.get(a.id)! - load.get(b.id)! ||
        Number(b.role === roleForKind[task.kind]) - Number(a.role === roleForKind[task.kind]) ||
        compareKey(a.id, b.id),
    )[0];
    assignments.set(task.key, member.id);
    load.set(member.id, load.get(member.id)! + task.effort);
  }
  return plan.tasks.map((task) => ({ key: task.key, memberId: assignments.get(task.key)! }));
}

// The public tool schemas use the same bounds as the runtime validator above.
const titleProperty = { type: 'string', minLength: 3, maxLength: 140 } as const;
const summaryProperty = { type: 'string', minLength: 10, maxLength: 6000 } as const;
const suggestionProperties = {
  title: titleProperty,
  kind: { type: 'string', enum: kinds },
  scope: {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 300 },
    minItems: 1,
    maxItems: 12,
    description:
      'Relative file or directory paths; no credentials or private state. Use . only when the entire project is needed.',
  },
  acceptance: { type: 'string', minLength: 10, maxLength: 3000 },
  effort: { type: 'integer', minimum: 1, maximum: 8 },
} as const;
const keyProperty = { type: 'string', pattern: keyPattern.source } as const;

export const proposalTool = {
  type: 'function',
  name: 'relay_submit_proposal',
  description:
    'Submit your bounded planning contribution to the team lead. Suggest concrete scoped work and risks. This does not create execution tasks or change ownership. Required before completing your proposal turn.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: summaryProperty,
      risks: {
        type: 'array',
        items: { type: 'string', minLength: 3, maxLength: 500 },
        maxItems: 12,
      },
      suggestions: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: suggestionProperties,
          required: ['title', 'kind', 'scope', 'acceptance', 'effort'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'risks', 'suggestions'],
    additionalProperties: false,
  },
} as const;

export const planTool = {
  type: 'function',
  name: 'relay_submit_plan',
  description:
    'Submit the final team workflow as a directed acyclic task graph. Incorporate every teammate’s proposal, use distinct task keys and titles, explicit dependencies, precise scopes and estimated effort. The coordinator assigns owners by balanced effort. Required before completing the lead planning turn.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: summaryProperty,
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: {
          type: 'object',
          properties: {
            ...suggestionProperties,
            key: keyProperty,
            description: { type: 'string', minLength: 10, maxLength: 6000 },
            dependsOn: { type: 'array', items: keyProperty, maxItems: 31 },
            stage: { type: 'string', minLength: 1, maxLength: 60 },
            preferredMemberId: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              description:
                'Optional ID from the connected team, only when the human requested this teammate for this task.',
            },
          },
          required: [
            'key',
            'title',
            'description',
            'kind',
            'scope',
            'dependsOn',
            'acceptance',
            'effort',
            'stage',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'tasks'],
    additionalProperties: false,
  },
} as const;
