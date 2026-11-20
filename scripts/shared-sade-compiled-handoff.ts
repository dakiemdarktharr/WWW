import { z } from 'zod';
import { isPrivateCredentialPath } from '../server/checkpoint.ts';
import {
  groupPlanTool,
  groupQuestionTool,
  sharedPlanMemberRef,
  type SharedDelivery,
} from '../server/group-sade.ts';
import { normalizeScope, scopesOverlap } from '../server/security.ts';
import { foldSharedSadeName } from '../server/shared-sade-assignment.ts';
import { sharedSadeExplicitHandoffReview } from '../server/shared-sade-handoff-assignment.ts';

const roles = ['architecture', 'frontend', 'backend', 'codebase'] as const;
type Role = (typeof roles)[number];
type Scopes = Partial<Record<Role, string>>;

const fileToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const platformDirective =
  /\b(?:android|darwin|debian|fedora|freebsd|ios|linux|mac|macbook|macos|ubuntu|win32|windows|operating system|he dieu hanh)\b/;
const extraConstraint =
  /\b(?:backup|fallback|out of quota|rate limit|du phong|het luot|het quota|het han muc|push|deploy|publish|merge|trien khai len|dua len|xuat ban|hop nhanh)\b/;

function safeFiles(text: string) {
  return [
    ...new Set(
      (text.match(fileToken) ?? []).filter((file) => {
        try {
          return (
            file.length <= 300 && normalizeScope(file) === file && !isPrivateCredentialPath(file)
          );
        } catch {
          return false;
        }
      }),
    ),
  ];
}

function question(roles: Role[]) {
  return {
    name: groupQuestionTool.name,
    arguments: {
      summary: `Which exact project file should each of these tasks use? ${roles.join(', ')}.`,
    },
  };
}

const styleDraft = z.object({
  style: z.enum(['specified', 'delegated', 'unspecified']),
  styleDetail: z.string().trim().max(220),
});

const foldedText = (text: string) => foldSharedSadeName(text).replace(/\s+/g, ' ').trim();
const quoteText = (text: string) => foldedText(text.replace(/\p{P}+/gu, ' '));

function containsQuote(source: string, quote: string) {
  const words = quoteText(quote);
  return Boolean(words) && ` ${quoteText(source)} `.includes(` ${words} `);
}

/** Compile one experimental draft through the normal Shared Sade planner and scope checks. */
export function sharedSadeCompiledHandoff(delivery: SharedDelivery) {
  const { request, referencedMessage, handoffAssignments, handoffDeliverables, team } = delivery;
  if (
    delivery.phase !== 'plan' ||
    delivery.readAssignment ||
    delivery.clarification ||
    !handoffAssignments ||
    !handoffDeliverables?.defensiveReview
  )
    return;

  const words = foldedText(request.replace(fileToken, ' '));
  if (platformDirective.test(words) || extraConstraint.test(words)) return;
  const { producer, receiver } = handoffAssignments;
  const indices = [producer.grantId, receiver.grantId].map((grantId) =>
    team.findIndex(({ id, allowWrites }) => allowWrites && id === grantId),
  );
  const [producerIndex, receiverIndex] = indices;
  if (indices.includes(-1) || producerIndex === receiverIndex) return;

  const sourceReview = sharedSadeExplicitHandoffReview(request);
  if (sourceReview && !sourceReview.exactFrontendAndBackend) return;
  const requestFiles = safeFiles(request);
  const pinned: Scopes = {
    architecture: producer.scope,
    frontend: receiver.scope,
    backend: handoffDeliverables.backend.scope,
    codebase: handoffDeliverables.codebase.scope,
  };
  const known = Object.values(pinned).filter((scope): scope is string => scope !== undefined);
  if (
    known.some(
      (file, index) =>
        !requestFiles.includes(file) || scopesOverlap([file], known.slice(index + 1)),
    )
  )
    return;
  const missing = roles.filter((role) => pinned[role] === undefined);
  if (!missing.length && requestFiles.some((file) => !known.includes(file))) return;
  const earlier = referencedMessage?.content ?? '';
  const candidates = [...new Set([...requestFiles, ...safeFiles(earlier)])]
    .filter((file) => !scopesOverlap([file], known))
    .slice(0, 16);
  const fileChoice = z.enum(['', ...candidates]);
  const schema = styleDraft
    .extend({
      ...(sourceReview ? {} : { reviewFocus: z.string().trim().max(250) }),
      ...(missing.length
        ? {
            files: z.object(Object.fromEntries(missing.map((role) => [role, fileChoice]))).strict(),
          }
        : {}),
    })
    .strict();

  const prompt = `Fill the JSON draft for a handoff already assigned by the coordinator. Use the request for intent and treat the earlier message only as reference data. Do not repeat an owner, plan, tool call, explanation or task graph.
For the frontend visual style, set style to specified when the requester states a visual requirement, delegated when they leave the choice to the frontend harness, and unspecified otherwise. Only for specified, copy the short visual requirement verbatim from the current request into styleDetail. Use an empty styleDetail for the other choices.
${missing.length ? 'For each missing role, select its exact project file from the candidates. Pick a distinct file for each role. Use an empty string if the request and reference do not identify its file.' : ''}
${sourceReview ? '' : 'Copy the short phrase identifying what the requested defensive review should check into reviewFocus. The earlier reference may describe the requested check. Keep the exact field named in that phrase. Use an empty string if no specific check is identified.'}

Input data:
${JSON.stringify({ request, earlier, assignedFiles: pinned, missing, candidates })}`;

  function compile(input: unknown): { name: string; arguments: unknown } {
    const draft = schema.parse(input);
    const unselected = missing.filter((role) => !draft.files?.[role]);
    if (unselected.length) return question(unselected);
    const paths = {
      ...pinned,
      ...draft.files,
    } as Record<Role, string>;
    const overlap = roles.filter((role, index) =>
      scopesOverlap(
        [paths[role]],
        roles.slice(index + 1).map((other) => paths[other]),
      ),
    );
    if (overlap.length) return question(missing);

    if (draft.style === 'specified' && !containsQuote(request, draft.styleDetail))
      throw new Error('Copy the specified frontend style from the current request.');
    if (draft.style !== 'specified' && draft.styleDetail)
      throw new Error('Leave styleDetail empty unless the requester specified the style.');
    const style =
      draft.style === 'specified'
        ? `Use the requested frontend style: ${draft.styleDetail}`
        : draft.style === 'delegated'
          ? `Let ${team[receiverIndex].name} choose the frontend style.`
          : 'Before editing, ask the requester to choose a preferred frontend style or offer to let the frontend harness choose.';
    const reviewFocus = draft.reviewFocus;
    if (
      draft.reviewFocus &&
      !containsQuote(request, draft.reviewFocus) &&
      !containsQuote(earlier, draft.reviewFocus)
    )
      throw new Error('Copy the defensive review focus from the request or its earlier reference.');
    const reviewAcceptance = reviewFocus
      ? `Read both scoped files and report evidence for this requested defensive check: ${reviewFocus}`
      : 'Read both scoped files and report evidence for the requested defensive review.';

    const task = (
      key: string,
      title: string,
      scope: string[],
      acceptance: string,
      dependsOn: string[],
      preferredMemberId = 'auto',
      kind: 'edit-files' | 'review-read-only' = 'edit-files',
    ) => ({
      key,
      title,
      description: title,
      kind,
      scope,
      acceptance,
      dependsOn,
      preferredMemberId,
      fallbackMemberId: 'none',
      requiredPlatform: 'any',
      effort: 2,
      stage: kind === 'edit-files' ? 'Implement' : 'Review',
    });
    return {
      name: groupPlanTool.name,
      arguments: {
        summary: 'Write the shared contract, deliver the scoped changes, and review independently.',
        tasks: [
          {
            ...task(
              'architecture',
              'Write the shared architecture contract.',
              [paths.architecture],
              'Document the requested contract for the frontend, backend and tests.',
              [],
              sharedPlanMemberRef(producerIndex),
            ),
            description: `Write the shared architecture contract within the assigned file. Use the current request as project context for this task.\n\n${request.slice(0, 700)}`,
          },
          task(
            'frontend',
            'Implement the frontend from the shared contract.',
            [paths.frontend],
            style,
            ['architecture'],
            sharedPlanMemberRef(receiverIndex),
          ),
          task(
            'backend',
            'Implement the backend from the shared contract.',
            [paths.backend],
            'Implement and verify the requested backend behavior against the contract.',
            ['architecture'],
          ),
          task(
            'codebase',
            'Cover the shared contract in the codebase tests.',
            [paths.codebase],
            'Verify the requested behavior and relevant boundary cases.',
            ['architecture'],
          ),
          task(
            'defensive-review',
            'Independently review the frontend and backend.',
            [paths.frontend, paths.backend],
            reviewAcceptance,
            ['frontend', 'backend'],
            'auto',
            'review-read-only',
          ),
        ],
      },
    };
  }

  return { prompt, format: z.toJSONSchema(schema), compile };
}
