import type { Workspace } from './service.ts';
import type { CodexModel, HumanRequest, RoomMessage, QuotaGrant } from '../shared/types.ts';
import { groupMembers } from './groups.ts';
import { chatRecipients, reserveIntent } from './chat-intent.ts';
import { DomainError } from './store.ts';
import { competitionLink } from './competition-research.ts';

/** Only the authenticated human route calls this; agent tools never grant usage. */
export function postHumanChat(
  host: Workspace,
  input: {
    projectId: string;
    content: string;
    mentions?: string[];
    replyTo?: string | null;
    taskId?: string | null;
    clientRequestId?: string;
  },
  catalog: CodexModel[],
) {
  const members = groupMembers(host.store, input.projectId);
  const history = host.store
    .all<RoomMessage>('message')
    .filter((message) => message.projectId === input.projectId)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  if (input.clientRequestId) {
    const previous = history.find(
      (message) => message.clientRequestId === input.clientRequestId && message.authorId === null,
    );
    if (previous) {
      if (previous.content !== input.content.trim())
        throw new DomainError('Message retry content changed.');
      return previous;
    }
  }
  const waiting = host.store
    .all<HumanRequest>('humanRequest')
    .some(
      (item) =>
        item.projectId === input.projectId && item.kind === 'quota' && item.status === 'open',
    );
  const intent = reserveIntent(input.content, waiting);
  let targets = [
    ...new Set([...(input.mentions || []), ...chatRecipients(input.content, members, !!intent)]),
  ];
  if (!targets.length && input.replyTo) {
    const reply = history.find((entry) => entry.id === input.replyTo);
    const target = reply?.authorId || reply?.claimedBy;
    if (target && members.some((entry) => entry.id === target)) targets = [target];
  }
  if (intent && !targets.length) {
    const reply = history.find((message) => message.id === input.replyTo);
    const context =
      reply ||
      (waiting
        ? [...history]
            .reverse()
            .find(
              (message) =>
                message.authorId === null &&
                message.kind === 'message' &&
                message.mentions?.length &&
                Date.now() - Date.parse(message.createdAt) < 10 * 60000,
            )
        : undefined);
    targets = context?.authorId ? [context.authorId] : context?.mentions || [];
    if (!targets.length && members.length === 1) targets = [members[0].id];
  }
  return host.store.transaction(() => {
    let message = host.mesh.post(
      { ...input, mentions: targets, authorId: null, kind: 'message' },
      catalog,
    );
    if (input.clientRequestId)
      message = host.store.put('message', { ...message, clientRequestId: input.clientRequestId });
    if (!intent) {
      if (!message.command) {
        const project = host.store.get<any>('project', input.projectId);
        const url = competitionLink(input.content, project.competition?.url);
        if (url) {
          const dossier = host.research.ensure(input.projectId, url);
          if (dossier.status === 'queued')
            host.mesh.post({
              projectId: input.projectId,
              authorId: null,
              kind: 'system',
              content:
                'Researching competition sources. Rules, judging, submission requirements and prior entries will be shared in Research.',
            });
        }
      }
      return message;
    }
    message = host.store.put('message', { ...message, command: 'quota', requestStatus: 'done' });
    const member = members.find((entry) => entry.id === targets[0]);
    let error = intent.error;
    if (!error && (targets.length !== 1 || !member))
      error = 'Name or @mention exactly one group teammate to allow reserve usage.';
    if (!error && member?.provider && member.provider !== 'codex')
      error =
        'This provider needs its own bounded prompt allowance in Usage; it does not report Codex quota.';
    if (error || !member || intent.floor === undefined || intent.minutes === undefined) {
      host.mesh.post({
        projectId: input.projectId,
        authorId: null,
        kind: 'system',
        replyTo: message.id,
        content: error || 'Specify the teammate and remaining-usage limit.',
      });
      return message;
    }
    for (const previous of host.store.all<QuotaGrant>('quotaGrant'))
      if (
        previous.memberId === member.id &&
        previous.projectId === input.projectId &&
        !previous.revokedAt
      )
        host.store.put('quotaGrant', { ...previous, revokedAt: new Date().toISOString() });
    const grant = host.quota.grant(member.id, {
      projectId: input.projectId,
      floor: intent.floor,
      expiresAt: new Date(Date.now() + intent.minutes * 60000).toISOString(),
    });
    const pending = history.find(
      (entry) =>
        entry.authorId === null &&
        entry.kind === 'message' &&
        entry.requestStatus === 'open' &&
        (!entry.mentions?.length || entry.mentions.includes(member.id)),
    );
    if (pending) host.store.put('message', { ...pending, mentions: [member.id] });
    let runnable = false;
    try {
      host.quota.assertCanRun(member.id, input.projectId);
      runnable = true;
    } catch {
      /* Permission is not proof that usage is available. */
    }
    const waitingWork =
      pending ||
      host.store
        .sessions()
        .some(
          (session) =>
            session.projectId === input.projectId &&
            session.memberId === member.id &&
            session.pausedFor === 'quota',
        );
    host.mesh.post({
      projectId: input.projectId,
      authorId: null,
      kind: 'system',
      replyTo: message.id,
      content: `@${member.name}: permission saved until ${intent.floor}% remaining for ${intent.minutes} minutes (expires ${grant.expiresAt}). ${!runnable ? host.quota.grantIssue(member.id, intent.floor) || 'Work remains paused until provider usage is verified.' : waitingWork ? 'Eligible queued work can now be dispatched.' : 'No queued request found. Send a task to this teammate.'}`,
    });
    return message;
  });
}
