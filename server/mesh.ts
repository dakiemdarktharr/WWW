import { randomUUID } from 'node:crypto';
import type {
  CodexSession,
  HumanRequest,
  Member,
  MeshCursor,
  Project,
  RoomMessage,
  Task,
} from '../shared/types.ts';
import { DomainError, Store } from './store.ts';
import { redact } from './security.ts';

interface Host {
  store: Store;
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
  constructor(private host: Host) {}
  private get store() {
    return this.host.store;
  }
  private project(projectId: string) {
    return this.store.get<Project>('project', projectId);
  }
  private member(memberId: string) {
    return this.store.get<Member>('member', memberId);
  }
  private messages(projectId: string): RoomMessage[] {
    // Record order provides a read-compatible view of databases written before sequences existed.
    // Store migrates/persists canonical global sequences for all newly written messages.
    return this.store
      .all<RoomMessage>('message')
      .map((message, index) => ({
        ...message,
        sequence:
          positiveSequence(message.sequence ?? -1) && message.sequence! > 0
            ? message.sequence
            : index + 1,
      }))
      .filter((message) => message.projectId === projectId)
      .sort((a, b) => a.sequence! - b.sequence!);
  }
  private cursor(projectId: string, memberId: string): MeshCursor {
    const key = cursorId(projectId, memberId);
    return (
      this.store.all<MeshCursor>('meshCursor').find((cursor) => cursor.id === key) || {
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
    this.project(projectId);
    const member = this.member(memberId);
    return this.store.transaction(() => {
      const id = cursorId(projectId, memberId);
      const existing = this.store.all<MeshCursor>('meshCursor').find((cursor) => cursor.id === id);
      if (existing) return existing;
      const cursor = this.store.put('meshCursor', this.cursor(projectId, memberId));
      const owner = member.owner?.login || member.owner?.name || 'not linked';
      const plan = member.account?.planType || 'unknown';
      this.store.message({
        projectId,
        taskId: null,
        authorId: memberId,
        kind: 'system',
        content: redact(
          `${member.name} joined. Owner: ${owner}. Plan: ${plan}. Role: ${member.role}. Skills: ${member.skills.slice(0, 12).join(', ') || 'none reported'}. Plugins: ${member.plugins.slice(0, 12).join(', ') || 'none reported'}.`,
        ),
        mentions: [],
        humanCommand: false,
      });
      return cursor;
    });
  }
  post(input: MeshPost): RoomMessage {
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
    for (const member of this.store.members()) {
      const alias = member.name.trim().replace(/\s+/g, '-');
      if (new RegExp(`(^|\\s)@${escapeRegex(alias)}(?=$|[\\s.,:;!?/])`, 'iu').test(content))
        mentions.add(member.id);
    }
    if (/(^|\s)@team(?=$|[\s.,:;!?/])/iu.test(content))
      for (const member of this.store.members()) mentions.add(member.id);
    for (const id of mentions) this.member(id);
    // The host binds authorId from its cookie or active Codex lease. A textual !! never authenticates.
    const human = input.authorId === null && input.kind === 'message';
    if (input.authorId) this.ensureMember(input.projectId, input.authorId);
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
      ...(human ? { requestStatus: 'open' as const, claimedBy: null } : {}),
    });
    return this.messages(input.projectId).find((entry) => entry.id === message.id)!;
  }
  readRoom(projectId: string, memberId: string, options: { after?: number; limit?: number } = {}) {
    const project = this.project(projectId);
    const cursor = this.ensureMember(projectId, memberId);
    const after = options.after ?? cursor.readThrough;
    const limit = options.limit ?? 50;
    if (!positiveSequence(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new DomainError('Use a valid sequence and a page size of 1–100.', 400);
    const all = this.messages(projectId);
    const messages = all.filter((message) => message.sequence! > after).slice(0, limit);
    // Reading a page records delivery, but neither read nor acknowledgement. A client cannot
    // skip unread pages and then falsely acknowledge the omitted history as read-through.
    if (messages.length && after <= cursor.readThrough) {
      this.store.transaction(() => {
        const id = cursor.id;
        const previous = this.store
          .all<Delivery>('meshDelivery')
          .find((delivery) => delivery.id === id);
        this.store.put('meshDelivery', {
          id,
          projectId,
          memberId,
          deliveredThrough: Math.max(previous?.deliveredThrough || 0, messages.at(-1)!.sequence!),
        } satisfies Delivery);
      });
    }
    return {
      project,
      messages,
      cursor,
      unread: all.filter((message) => message.sequence! > cursor.readThrough).length,
      members: this.store.members().map(({ id, name, role, color, status, owner, account }) => ({
        id,
        name,
        role,
        color,
        status,
        owner: owner ? { login: owner.login, name: owner.name } : null,
        plan: account?.planType || null,
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
      (sequence !== 0 && !this.messages(projectId).some((message) => message.sequence === sequence))
    )
      throw new DomainError('The message sequence does not belong to this project.', 400);
  }
  markRead(projectId: string, memberId: string, sequence: number): MeshCursor {
    this.ensureMember(projectId, memberId);
    this.validateSequence(projectId, sequence);
    return this.store.transaction(() => {
      const cursor = this.cursor(projectId, memberId);
      const delivered =
        this.store.all<Delivery>('meshDelivery').find((entry) => entry.id === cursor.id)
          ?.deliveredThrough || 0;
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
  resolve(id: string): HumanRequest {
    return this.store.transaction(() => {
      const request = this.store.get<HumanRequest>('humanRequest', id);
      if (request.status === 'resolved') return request;
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
