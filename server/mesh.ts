import { randomUUID } from 'node:crypto';
import type {
  CodexSession,
  HumanRequest,
  Member,
  MeshCursor,
  Project,
  RoomMessage,
  Task,
  ChatConfig,
  CodexModel,
  MessageReaction,
} from '../shared/types.ts';
import { DomainError, Store } from './store.ts';
import { redact } from './security.ts';
import { chatRecipients } from './chat-intent.ts';
import {
  assertGroupMember,
  groupMembers,
  introduce,
  memberPresence,
  workingAgreement,
  type PresenceHost,
} from './groups.ts';

interface Host extends PresenceHost {
  store: Store;
  notifyMesh?: (projectId: string) => void;
  log?: (
    text: string,
    taskId?: string | null,
    memberId?: string | null,
    type?: string,
    projectId?: string | null,
  ) => unknown;
}
interface Delivery {
  id: string;
  projectId: string;
  memberId: string;
  deliveredThrough: number;
}
export interface MeshPost {
  projectId: string;
  authorId: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  kind: RoomMessage['kind'];
  content: string;
  replyTo?: string | null;
  mentions?: string[];
}

const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const cursorId = (projectId: string, memberId: string) => `${projectId}:${memberId}`;
const positiveSequence = (value: number) => Number.isSafeInteger(value) && value >= 0;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Durable project inboxes. Caller identity is supplied by the authenticated host, never tool input. */
export class Mesh {
  constructor(private host: Host) {
    // Existing groups retain their durable membership, rather than acquiring every global account.
    for (const project of host.store.projects())
      if (!project.memberIds) {
        const memberIds = [
          ...new Set(
            host.store
              .all<MeshCursor>('meshCursor')
              .filter((cursor) => cursor.projectId === project.id)
              .map((cursor) => cursor.memberId),
          ),
        ].filter((id) => host.store.members().some((member) => member.id === id));
        if (project.ownerMemberId && !memberIds.includes(project.ownerMemberId))
          memberIds.push(project.ownerMemberId);
        host.store.put('project', { ...project, memberIds });
      }
  }
  private get store() {
    return this.host.store;
  }
  private project(projectId: string) {
    return this.store.get<Project>('project', projectId);
  }
  private member(memberId: string) {
    const member = this.store.get<Member>('member', memberId);
    if (member.removedAt) throw new DomainError('This teammate was removed.', 410);
    return member;
  }
  private cursor(projectId: string, memberId: string): MeshCursor {
    const key = cursorId(projectId, memberId);
    return (
      this.store.lookup<MeshCursor>('meshCursor', key) || {
        id: key,
        projectId,
        memberId,
        readThrough: 0,
        acknowledgedThrough: 0,
        updatedAt: new Date().toISOString(),
      }
    );
  }
  ensureMember(projectId: string, memberId: string): MeshCursor {
    assertGroupMember(this.store, projectId, memberId);
    this.member(memberId);
    return this.store.transaction(() => {
      const id = cursorId(projectId, memberId);
      const existing = this.store.lookup<MeshCursor>('meshCursor', id);
      introduce(this.store, projectId, memberId);
      if (existing) return existing;
      const cursor = this.store.put('meshCursor', this.cursor(projectId, memberId));
      return cursor;
    });
  }
  setMembers(projectId: string, memberIds: string[]) {
    if (
      !Array.isArray(memberIds) ||
      memberIds.length > 16 ||
      new Set(memberIds).size !== memberIds.length
    )
      throw new DomainError('Choose up to 16 distinct teammates.', 400);
    memberIds.forEach((id) => this.member(id));
    return this.store.transaction(() => {
      const project = this.project(projectId);
      const removed = groupMembers(this.store, projectId).filter(
        (member) => !memberIds.includes(member.id),
      );
      for (const member of removed) {
        if (
          this.store
            .leases()
            .some((lease) => lease.projectId === projectId && lease.memberId === member.id) ||
          this.store
            .sessions()
            .some(
              (session) =>
                session.projectId === projectId &&
                session.memberId === member.id &&
                ['starting', 'running', 'interrupted'].includes(session.status),
            ) ||
          this.store
            .workflows()
            .some(
              (workflow) =>
                workflow.projectId === projectId &&
                !['completed', 'cancelled'].includes(workflow.status) &&
                workflow.memberIds.includes(member.id),
            )
        )
          throw new DomainError(
            'Pause and resolve active sessions or workflows before removing this teammate.',
          );
      }
      const updated = this.store.put('project', { ...project, memberIds });
      for (const id of memberIds) this.ensureMember(projectId, id);
      for (const member of removed)
        this.store.remove('groupIntroduction', cursorId(projectId, member.id));
      return updated;
    });
  }
  heartbeat(projectId: string) {
    this.project(projectId);
    return this.store.put('humanPresence', {
      id: projectId,
      projectId,
      lastSeen: new Date().toISOString(),
      status: 'online' as const,
    });
  }
  react(messageId: string, emoji: MessageReaction['emoji']) {
    if (!['heart', 'up', 'down'].includes(emoji)) throw new DomainError('Unknown reaction.', 400);
    return this.store.transaction(() => {
      const message = this.store.get<RoomMessage>('message', messageId);
      const reactions = message.reactions || [];
      const existing = reactions.some(
        (reaction) => reaction.emoji === emoji && reaction.actorId === 'human',
      );
      const meaning = ({ heart: 'understood', up: 'agree', down: 'disagree' } as const)[emoji];
      const updated = this.store.put('message', {
        ...message,
        reactions: existing
          ? reactions.filter((reaction) => reaction.emoji !== emoji || reaction.actorId !== 'human')
          : [
              ...reactions,
              { emoji, actorId: 'human' as const, meaning, createdAt: new Date().toISOString() },
            ],
      });
      if (message.authorId)
        this.store.put('meshFeedback', {
          id: `${message.id}:human:${emoji}`,
          projectId: message.projectId,
          memberId: message.authorId,
          sessionId: message.sessionId || null,
          messageId,
          emoji,
          meaning,
          removed: existing,
          delivered: false,
          revision: randomUUID(),
          createdAt: new Date().toISOString(),
        });
      return updated;
    });
  }
  post(input: MeshPost, catalog: CodexModel[] = []): RoomMessage {
    this.project(input.projectId);
    if (!['message', 'progress', 'handoff', 'blocker', 'system'].includes(input.kind))
      throw new DomainError('Invalid message kind.', 400);
    if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10000)
      throw new DomainError('Messages must contain 1–10,000 characters.', 400);
    if (input.authorId !== null) this.member(input.authorId);
    let taskId = input.taskId || null;
    if (taskId && this.store.get<Task>('task', taskId).projectId !== input.projectId)
      throw new DomainError('The task belongs to another project.');
    if (input.sessionId) {
      const session = this.store.get<CodexSession>('session', input.sessionId);
      if (session.projectId !== input.projectId || session.memberId !== input.authorId)
        throw new DomainError('The session does not belong to this sender and project.');
      if (taskId && taskId !== session.taskId)
        throw new DomainError('This session is bound to another task.');
      taskId = session.taskId;
    }
    if (
      input.replyTo &&
      this.store.get<RoomMessage>('message', input.replyTo).projectId !== input.projectId
    )
      throw new DomainError('Replies must stay inside their project group.');
    if (
      input.mentions &&
      (!Array.isArray(input.mentions) ||
        input.mentions.length > 16 ||
        input.mentions.some((id) => typeof id !== 'string'))
    )
      throw new DomainError('Mention at most 16 known teammates.', 400);
    const mentions = new Set(input.mentions || []);
    const content = redact(input.content.trim());
    if (input.authorId === null && input.kind === 'message')
      for (const id of chatRecipients(content, groupMembers(this.store, input.projectId)))
        mentions.add(id);
    for (const member of input.authorId === null && input.kind === 'message'
      ? []
      : groupMembers(this.store, input.projectId)) {
      const alias = member.name.trim().replace(/\s+/g, '-');
      if (new RegExp(`(^|\\s)@${escapeRegex(alias)}(?=$|[\\s.,:;!?/])`, 'iu').test(content))
        mentions.add(member.id);
    }
    if (/(^|\s)@team(?=$|[\s.,:;!?/])/iu.test(content))
      for (const member of groupMembers(this.store, input.projectId)) mentions.add(member.id);
    for (const id of mentions) {
      this.member(id);
      assertGroupMember(this.store, input.projectId, id);
    }
    // The host binds authorId from its cookie or active Codex lease. A textual !! never authenticates.
    const human = input.authorId === null && input.kind === 'message';
    if (input.authorId) this.ensureMember(input.projectId, input.authorId);
    const command = human ? this.command(input.projectId, content, catalog) : undefined;
    const message = this.store.message({
      projectId: input.projectId,
      authorId: input.authorId,
      sessionId: input.sessionId || null,
      taskId,
      kind: input.kind,
      content,
      replyTo: input.replyTo || null,
      mentions: [...mentions],
      humanCommand: human && content.startsWith('!!'),
      ...(human
        ? {
            requestStatus: command?.configureOnly ? ('done' as const) : ('open' as const),
            claimedBy: null,
            effectiveConfig: command?.config || this.project(input.projectId).chatConfig || {},
            ...(command ? { command: command.name } : {}),
          }
        : {}),
    });
    this.notify(message);
    this.host.notifyMesh?.(input.projectId);
    return this.store.get<RoomMessage>('message', message.id);
  }
  private command(projectId: string, content: string, catalog: CodexModel[]) {
    const match = /^(?:!!\s*)?\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(content);
    if (!match) return;
    const name = match[1].toLowerCase(),
      value = (match[2] || '').trim();
    const project = this.project(projectId);
    let config: ChatConfig = { ...project.chatConfig };
    const available = [
      ...new Set(groupMembers(this.store, projectId).flatMap((member) => member.skills)),
    ];
    if (name === 'goal') {
      if (!value) throw new DomainError('Use /goal followed by what you want to build.', 400);
    } else if (name === 'model') {
      if (value === 'auto') {
        delete config.model;
        delete config.reasoningEffort;
      } else {
        const model = catalog.find((entry) => entry.id === value || entry.model === value);
        if (!model)
          throw new DomainError(
            'Choose an available model from a connected group teammate, or use /model auto.',
            400,
          );
        config.model = model.model;
        if (
          config.reasoningEffort &&
          !model.supportedReasoningEfforts.some(
            (effort) => effort.reasoningEffort === config.reasoningEffort,
          )
        )
          throw new DomainError(
            'This model does not support the current reasoning level. Set /reasoning auto first.',
            400,
          );
      }
    } else if (name === 'reasoning') {
      if (value === 'auto') delete config.reasoningEffort;
      else {
        const models = catalog.filter(
          (model) => !config.model || model.model === config.model || model.id === config.model,
        );
        if (
          !models.some((model) =>
            model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === value),
          )
        )
          throw new DomainError(
            'Choose a reasoning level supported by an available group model, or use /reasoning auto.',
            400,
          );
        config.reasoningEffort = value;
      }
    } else if (name === 'skills') {
      const selected = value === 'none' ? [] : value.split(/[\s,]+/).filter(Boolean);
      if (!selected.length && value !== 'none')
        throw new DomainError(
          `Use /skills followed by installed names, or none. Available: ${available.join(', ') || 'none'}.`,
          400,
        );
      if (selected.some((skill) => !available.includes(skill)))
        throw new DomainError('A requested skill is not installed in this group.', 400);
      config.skills = [...new Set(selected)];
    } else {
      const skill = available.find((skill) => skill.toLowerCase() === name);
      if (!skill)
        throw new DomainError(
          `Unknown command /${name}. Use /goal, /model, /reasoning, /skills or an installed skill name.`,
          400,
        );
      if (!value) throw new DomainError(`Add a request after /${name}.`, 400);
      config = { ...config, skills: [...new Set([...(config.skills || []), skill])] };
      return { name, config, configureOnly: false };
    }
    this.store.put('project', {
      ...project,
      chatConfig: config,
      ...(name === 'goal' ? { goal: value } : {}),
    });
    return { name, config, configureOnly: name !== 'goal' };
  }
  private notify(message: RoomMessage) {
    // Notifications can steer an existing turn, but can never spawn turns or transfer ownership.
    const members = groupMembers(this.store, message.projectId).filter(
      (member) => member.id !== message.authorId,
    );
    const eligible = members
      .map((member) => ({ ...member, ...memberPresence(this.host, member) }))
      .filter(
        (member) =>
          member.presence !== 'offline' &&
          !this.store
            .all<any>('quota')
            .some(
              (quota) =>
                quota.memberId === member.id &&
                ['reserve', 'blocked', 'stale', 'unknown'].includes(quota.status),
            ),
      )
      .sort(
        (a, b) =>
          Number(a.presence === 'busy') - Number(b.presence === 'busy') ||
          (a.activeSessions || 0) - (b.activeSessions || 0) ||
          a.id.localeCompare(b.id),
      );
    const hasUnbusy = eligible.some((member) => member.presence === 'online');
    const sender =
      message.authorId && message.mentions?.length
        ? this.store.get<Member>('member', message.authorId)
        : null;
    const selfFallback =
      sender &&
      memberPresence(this.host, sender).presence !== 'offline' &&
      !this.store
        .all<any>('quota')
        .some((quota) => quota.memberId === sender.id && quota.status !== 'available')
        ? sender
        : null;
    const recipients = new Set<string>();
    const requested = message.mentions?.length
      ? message.mentions
      : members.map((member) => member.id);
    for (const requestedId of requested) {
      const candidate =
        (message.authorId === null && message.kind === 'message' && message.mentions?.length
          ? members.find((member) => member.id === requestedId)
          : undefined) ||
        eligible.find(
          (member) => member.id === requestedId && (!hasUnbusy || member.presence !== 'busy'),
        ) ||
        eligible[0] ||
        selfFallback;
      const target = candidate?.id || requestedId;
      if (!recipients.has(target)) {
        recipients.add(target);
        this.store.put('meshNotification', {
          id: `${message.id}:${target}`,
          projectId: message.projectId,
          memberId: target,
          originalMemberId: requestedId,
          messageId: message.id,
          sequence: message.sequence,
          delivered: false,
          createdAt: message.createdAt,
        });
      }
    }
  }
  signals(projectId: string, memberId: string, sessionId?: string) {
    assertGroupMember(this.store, projectId, memberId);
    const pending = (kind: string) =>
      this.store
        .all<any>(kind)
        .filter(
          (entry) =>
            entry.projectId === projectId &&
            entry.memberId === memberId &&
            !entry.delivered &&
            (!sessionId || !entry.sessionId || entry.sessionId === sessionId),
        )
        .slice(-50);
    return { notifications: pending('meshNotification'), feedback: pending('meshFeedback') };
  }
  deliveredSignals(signals: ReturnType<Mesh['signals']>) {
    for (const [kind, records] of [
      ['meshNotification', signals.notifications],
      ['meshFeedback', signals.feedback],
    ] as const)
      for (const entry of records) {
        const current = this.store.get<any>(kind, entry.id);
        // A newer reaction replacement must not be acknowledged by an earlier delivery.
        if (
          current.createdAt === entry.createdAt &&
          current.removed === entry.removed &&
          current.revision === entry.revision
        )
          this.store.put(kind, { ...current, delivered: true });
      }
  }
  readRoom(
    projectId: string,
    memberId: string,
    options: { after?: number; limit?: number; sessionId?: string } = {},
  ) {
    const project = this.project(projectId);
    const page = this.store.transaction(() => {
      const cursor = this.ensureMember(projectId, memberId);
      const after = options.after ?? cursor.readThrough;
      const limit = options.limit ?? 50;
      if (!positiveSequence(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new DomainError('Use a valid sequence and a page size of 1–100.', 400);
      const messages = this.store.roomPage(projectId, after, limit);
      // Only contiguous delivery can advance the range eligible for acknowledgement.
      if (messages.length && after <= cursor.readThrough) {
        const id = cursor.id;
        const previous = this.store.lookup<Delivery>('meshDelivery', id);
        this.store.put('meshDelivery', {
          id,
          projectId,
          memberId,
          deliveredThrough: Math.max(previous?.deliveredThrough || 0, messages.at(-1)!.sequence!),
        } satisfies Delivery);
      }
      return { messages, cursor, unread: this.store.unreadMessages(projectId, cursor.readThrough) };
    });
    return {
      project,
      agreement: workingAgreement,
      introductions: this.store
        .all<any>('groupIntroduction')
        .filter(
          (entry) =>
            entry.projectId === projectId &&
            groupMembers(this.store, projectId).some((member) => member.id === entry.memberId),
        ),
      ...page,
      ...this.signals(projectId, memberId, options.sessionId),
      members: groupMembers(this.store, projectId).map((member) => ({
        ...(({ id, name, role, color, status, owner, account }) => ({
          id,
          name,
          role,
          color,
          status,
          owner: owner ? { login: owner.login, name: owner.name } : null,
          plan: account?.planType || null,
        }))(member),
        ...memberPresence(this.host, member),
      })),
      assignments: this.store
        .tasks()
        .filter((task) => task.projectId === projectId)
        .slice(-100)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          assignedTo: task.assignedTo,
          sessionId: task.sessionId || null,
          dependsOn: task.dependsOn,
          scope: task.scope.slice(0, 12),
          summary: task.summary?.slice(0, 1200) || null,
        })),
    };
  }
  private validateSequence(projectId: string, sequence: number) {
    if (
      !positiveSequence(sequence) ||
      (sequence !== 0 && !this.store.roomHasSequence(projectId, sequence))
    )
      throw new DomainError('The message sequence does not belong to this project.', 400);
  }
  markRead(projectId: string, memberId: string, sequence: number): MeshCursor {
    this.ensureMember(projectId, memberId);
    this.validateSequence(projectId, sequence);
    return this.store.transaction(() => {
      const cursor = this.cursor(projectId, memberId);
      const delivered =
        this.store.lookup<Delivery>('meshDelivery', cursor.id)?.deliveredThrough || 0;
      if (sequence > delivered)
        throw new DomainError('Read the inbox page before marking it read.');
      return this.store.put('meshCursor', {
        ...cursor,
        readThrough: Math.max(cursor.readThrough, sequence),
        updatedAt: new Date().toISOString(),
      });
    });
  }
  ack(projectId: string, memberId: string, sequence: number): MeshCursor {
    this.ensureMember(projectId, memberId);
    this.validateSequence(projectId, sequence);
    return this.store.transaction(() => {
      const cursor = this.cursor(projectId, memberId);
      if (sequence > cursor.readThrough)
        throw new DomainError('Acknowledge messages only after reading them.');
      return this.store.put('meshCursor', {
        ...cursor,
        acknowledgedThrough: Math.max(cursor.acknowledgedThrough, sequence),
        updatedAt: new Date().toISOString(),
      });
    });
  }
  claim(messageId: string, memberId: string): RoomMessage {
    const member = this.member(memberId);
    const original = this.store.get<RoomMessage>('message', messageId);
    this.ensureMember(original.projectId, memberId);
    return this.store.transaction(() => {
      const message = this.store.get<RoomMessage>('message', messageId);
      if (message.authorId !== null || message.kind !== 'message')
        throw new DomainError('Only a human request can be claimed.');
      if (message.requestStatus === 'claimed' && message.claimedBy === memberId) return message;
      if (message.requestStatus && message.requestStatus !== 'open')
        throw new DomainError('Another teammate already accepted this request.');
      const claimed = this.store.put('message', {
        ...message,
        requestStatus: 'claimed' as const,
        claimedBy: memberId,
      });
      this.store.message({
        projectId: message.projectId,
        taskId: message.taskId,
        authorId: memberId,
        kind: 'progress',
        content: `${redact(member.name)} accepted this request.`,
        replyTo: message.id,
        humanCommand: false,
      });
      return claimed;
    });
  }
  ask(projectId: string, memberId: string, title: string, content: string): HumanRequest {
    this.ensureMember(projectId, memberId);
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 200 ||
      typeof content !== 'string' ||
      !content.trim() ||
      content.length > 10000
    )
      throw new DomainError('Provide a question title and details within the size limits.', 400);
    return this.store.transaction(() => {
      const existing = this.store
        .all<HumanRequest>('humanRequest')
        .find(
          (request) =>
            request.projectId === projectId &&
            request.kind === 'question' &&
            request.status === 'open' &&
            normalized(request.title) === normalized(redact(title)),
        );
      if (existing) return existing;
      const request = this.store.put('humanRequest', {
        id: randomUUID(),
        projectId,
        kind: 'question',
        title: redact(title.trim()),
        content: redact(content.trim()),
        status: 'open',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      } satisfies HumanRequest);
      this.store.message({
        projectId,
        taskId: null,
        authorId: memberId,
        kind: 'blocker',
        content: `Needs you: ${request.title}\n${request.content}`,
        humanCommand: false,
      });
      return request;
    });
  }
  resolve(id: string, answer?: string): HumanRequest {
    return this.store.transaction(() => {
      const request = this.store.get<HumanRequest>('humanRequest', id);
      if (request.status === 'resolved') return request;
      if (answer?.trim()) {
        if (request.kind !== 'question' || answer.length > 4000)
          throw new DomainError('Answer a question in up to 4,000 characters.', 400);
        this.store.message({
          projectId: request.projectId,
          taskId: null,
          authorId: null,
          kind: 'message',
          content: `Answer to “${request.title}”\n${redact(answer.trim())}`,
          humanCommand: false,
        });
      }
      const resolved = this.store.put('humanRequest', {
        ...request,
        status: 'resolved' as const,
        resolvedAt: new Date().toISOString(),
      });
      this.store.message({
        projectId: request.projectId,
        taskId: null,
        authorId: null,
        kind: 'system',
        content: `Resolved: ${request.title}`,
        humanCommand: false,
      });
      return resolved;
    });
  }
}
