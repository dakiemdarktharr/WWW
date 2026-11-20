import { z } from 'zod';
import { groupNoWorkTool, groupPlanTool, groupQuestionTool } from '../server/group-sade.ts';

const taskKey = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const stages = {
  'edit-files': 'Implement',
  'edit-design': 'Design',
  'research-read-only': 'Research',
  'review-read-only': 'Review',
} as const;

const draftSchema = z
  .object({
    decision: z.enum(['plan', 'question', 'no-work']),
    summary: z.string().trim().min(1).max(500),
    tasks: z
      .array(
        z
          .object({
            key: taskKey,
            kind: z.enum(Object.keys(stages) as (keyof typeof stages)[]),
            scope: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
            by: z
              .string()
              .max(36)
              .regex(/^(?:auto|member-[1-9][0-9]*)$/),
            after: z.array(taskKey).max(31),
            action: z.string().trim().min(10).max(300),
            acceptance: z.string().trim().min(10).max(500),
            fallback: z
              .string()
              .max(36)
              .regex(/^(?:none|auto|member-[1-9][0-9]*)$/),
            platform: z.enum(['any', 'darwin', 'win32', 'linux']),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export const handoffDraftSchema = z.toJSONSchema(draftSchema);

/** Expand the experimental model output into the ordinary Shared Groups planning tools. */
export function parseHandoffDraft(content: string): { name: string; arguments: unknown } {
  const { decision, summary, tasks } = draftSchema.parse(JSON.parse(content));
  if (decision !== 'plan') {
    if (tasks.length) throw new Error('Only a plan can contain tasks.');
    return {
      name: decision === 'question' ? groupQuestionTool.name : groupNoWorkTool.name,
      arguments: { summary },
    };
  }
  if (!tasks.length) throw new Error('A plan requires at least one task.');
  return {
    name: groupPlanTool.name,
    arguments: {
      summary,
      tasks: tasks.map(
        ({ key, kind, scope, by, after, action, acceptance, fallback, platform }) => ({
          key,
          title: `${key} ${action}`.slice(0, 140),
          description: action,
          kind,
          scope,
          preferredMemberId: by,
          dependsOn: after,
          acceptance,
          fallbackMemberId: fallback,
          requiredPlatform: platform,
          effort: 2,
          stage: stages[kind],
        }),
      ),
    },
  };
}
