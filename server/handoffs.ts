import { isExternalMember } from '../shared/providers.ts';
import { randomUUID } from 'node:crypto';
import type { CodexSession, Handoff, Member, Task, Workflow } from '../shared/types.ts';
import { Store, DomainError } from './store.ts';
import { redact } from './security.ts';
import { checkpointProgress } from './checkpoint.ts';
import type { QuotaManager } from './quota.ts';
import type { Mesh } from './mesh.ts';
import type { Aegis } from './aegis.ts';
import { assertGroupMember, groupMembers, memberPresence, type PresenceHost } from './groups.ts';

interface Host extends PresenceHost {
  store: Store;
  quota: QuotaManager;
  mesh: Mesh;
  aegis: Pick<Aegis, 'recordHandoff' | 'assertHandoff' | 'assertCanRun'>;
  sessions: {
    interrupt(id: string, reason?: string): Promise<CodexSession>;
    resume(id: string): Promise<CodexSession>;
  };
  log(
    text: string,
    taskId?: string | null,
    memberId?: string | null,
    type?: string,
    projectId?: string | null,
  ): unknown;
}
export class Handoffs {
  private busy = new Set<string>();
  constructor(private host: Host) {
    for (const handoff of host.store.all<Handoff>('handoff'))
      if (handoff.status === 'checkpointing')
        host.store.put('handoff', {
          ...handoff,
          status: 'blocked',
          error: 'Coordinator restarted during checkpoint. Retry after session recovery.',
          updatedAt: new Date().toISOString(),
        });
  }
  private fence(handoff: Handoff) {
    const source = this.host.store.get<CodexSession>('session', handoff.fromSessionId);
    const task = this.host.store.get<Task>('task', handoff.taskId);
    const anchor = this.host.store.get<{
      id: string;
      token: string | null;
      sessionId: string | null;
    }>('handoffLease', handoff.id);
    const lease = this.host.store.lease(task.id);
    if (
      task.sessionId !== source.id ||
      task.assignedTo !== source.memberId ||
      (anchor.token
        ? !lease ||
          lease.orphaned ||
          lease.token !== anchor.token ||
          lease.sessionId !== anchor.sessionId ||
          lease.memberId !== source.memberId
        : !!lease || !source.readOnly)
    )
      throw new DomainError(
        'Source ownership changed. The handoff is fenced; inspect recovery before retrying.',
      );
    return source;
  }
  async create(input: {
    sessionId: string;
    toMemberId: string;
    summary: string;
    nextSteps: string;
    testEvidence: string;
  }): Promise<Handoff> {
    const source = this.host.store.get<CodexSession>('session', input.sessionId);
    const sourceTask = this.host.store.get<Task>('task', source.taskId);
    if (sourceTask.phase === 'proposal' || sourceTask.phase === 'plan')
      throw new DomainError(
        'Planning ownership belongs to the team workflow. Resume that workflow instead.',
      );
    this.host.store.get<Member>('member', input.toMemberId);
    const recipientProfile = this.host.store.get<Member>('member', input.toMemberId);
    if (isExternalMember(recipientProfile))
      throw new DomainError(
        'Use a reviewed Git checkpoint and assign the ready task through the external MESH bridge for this teammate.',
      );
    assertGroupMember(this.host.store, source.projectId, source.memberId);
    assertGroupMember(this.host.store, source.projectId, input.toMemberId);
    if (source.memberId === input.toMemberId)
      throw new DomainError('Choose a different account for handoff.');
    if (
      this.host.store
        .all<Handoff>('handoff')
        .some(
          (entry) =>
            entry.taskId === source.taskId && !['accepted', 'cancelled'].includes(entry.status),
        )
    )
      throw new DomainError('This task already has a pending handoff. Retry it instead.');
    const now = new Date().toISOString();
    const handoff = this.host.store.put('handoff', {
      id: randomUUID(),
      projectId: source.projectId,
      taskId: source.taskId,
      fromSessionId: source.id,
      toMemberId: input.toMemberId,
      toSessionId: null,
      status: 'checkpointing',
      branch: null,
      commitSha: null,
      remote: null,
      summary: redact(input.summary),
      nextSteps: redact(input.nextSteps),
      testEvidence: redact(input.testEvidence),
      quota: this.host.quota.current(source.memberId),
      error: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Handoff);
    const lease = this.host.store.lease(source.taskId);
    this.host.store.put('handoffLease', {
      id: handoff.id,
      token: lease?.token || null,
      sessionId: lease?.sessionId || null,
    });
    return this.checkpoint(handoff.id);
  }
  async retry(id: string) {
    const handoff = this.host.store.get<Handoff>('handoff', id);
    if (handoff.status !== 'blocked')
      throw new DomainError('Only a blocked handoff can be retried.');
    return this.checkpoint(id);
  }
  private async checkpoint(id: string): Promise<Handoff> {
    if (this.busy.has(id)) throw new DomainError('This checkpoint is already running.');
    this.busy.add(id);
    try {
      let handoff = this.host.store.get<Handoff>('handoff', id);
      const session = this.host.store.get<CodexSession>('session', handoff.fromSessionId);
      this.fence(handoff);
      await this.host.sessions.interrupt(session.id, 'Preparing a handoff checkpoint.');
      this.fence(handoff);
      const stopped = this.host.store.get<CodexSession>('session', session.id);
      if (
        stopped.pid !== null ||
        !['paused', 'stopped', 'interrupted', 'review', 'idle'].includes(stopped.status)
      )
        throw new DomainError('The old worker has not confirmed termination. Recover it first.');
      if (this.host.store.lease(session.taskId)?.orphaned)
        throw new DomainError('Recover the old worker before checkpointing.');
      const task = this.host.store.get<Task>('task', session.taskId);
      if (!session.readOnly && !this.host.store.lease(task.id))
        throw new DomainError('The source task no longer has its ownership lease.');
      const owner = this.host.store.get<Member>('member', session.memberId).owner;
      const checkpoint = session.readOnly
        ? {
            branch: null,
            commitSha: null,
            remote: null,
            testEvidence: 'Read-only conversation checkpoint is persisted in MESH/session events.',
          }
        : await checkpointProgress(task, owner);
      this.fence(handoff);
      handoff = this.host.store.put('handoff', {
        ...handoff,
        ...checkpoint,
        testEvidence: `${handoff.testEvidence}\nCoordinator: ${checkpoint.testEvidence}`,
        quota: this.host.quota.current(session.memberId),
        status: 'awaiting_ack',
        error: null,
        updatedAt: new Date().toISOString(),
      });
      this.host.store.updateSession(session.id, { status: 'handoff' });
      await this.host.aegis.recordHandoff(handoff);
      this.host.mesh.post({
        projectId: handoff.projectId,
        taskId: task.id,
        sessionId: session.id,
        authorId: session.memberId,
        kind: 'handoff',
        mentions: [handoff.toMemberId],
        content: `Handoff ready. ${handoff.summary}\nCheckpoint: ${handoff.commitSha || 'MESH read-only context'}\nTests: ${handoff.testEvidence}\nNext steps: ${handoff.nextSteps}\nUsage: ${JSON.stringify(handoff.quota?.windows || [])}\nRecipient must read and acknowledge before ownership transfers.`,
      });
      return handoff;
    } catch (error) {
      const handoff = this.host.store.get<Handoff>('handoff', id);
      const blocked = this.host.store.put('handoff', {
        ...handoff,
        status: 'blocked' as const,
        error: redact((error as Error).message),
        updatedAt: new Date().toISOString(),
      });
      this.host.mesh.ask(
        handoff.projectId,
        this.host.store.get<CodexSession>('session', handoff.fromSessionId).memberId,
        'Handoff needs recovery',
        blocked.error!,
      );
      return blocked;
    } finally {
      this.busy.delete(id);
    }
  }
  async accept(id: string): Promise<Handoff> {
    if (this.busy.has(id)) throw new DomainError('Handoff is busy.');
    this.busy.add(id);
    try {
      const handoff = this.host.store.get<Handoff>('handoff', id);
      if (handoff.status !== 'awaiting_ack')
        throw new DomainError('This handoff is not ready for acknowledgement.');
      assertGroupMember(this.host.store, handoff.projectId, handoff.toMemberId);
      await this.host.quota.refresh(handoff.toMemberId);
      this.host.quota.assertCanRun(handoff.toMemberId, handoff.projectId);
      await this.host.aegis.assertHandoff(handoff);
      await this.host.aegis.assertCanRun(
        handoff.projectId,
        this.host.store.get<Member>('member', handoff.toMemberId).runnerId || 'local',
      );
      return this.host.store.transaction(() => {
        const current = this.host.store.get<Handoff>('handoff', id);
        if (current.status !== 'awaiting_ack') throw new DomainError('Handoff already changed.');
        const source = this.host.store.get<CodexSession>('session', handoff.fromSessionId);
        this.fence(current);
        if (source.pid !== null || source.status !== 'handoff')
          throw new DomainError('Source session is not safely stopped.');
        const member = this.host.store.get<Member>('member', handoff.toMemberId);
        if (!member.account) throw new DomainError('The recipient account must be signed in.');
        if (
          this.host.store.leases().filter((lease) => lease.memberId === member.id).length >=
          (member.maxSessions || 2)
        )
          throw new DomainError('Recipient concurrency limit reached.');
        const task = this.host.store.get<Task>('task', handoff.taskId),
          lease = this.host.store.lease(task.id);
        const reservation = this.host.store
          .workflows()
          .find(
            (workflow: Workflow) =>
              !['completed', 'cancelled'].includes(workflow.status) &&
              workflow.memberIds.includes(member.id) &&
              workflow.id !== task.workflowId,
          );
        if (reservation) throw new DomainError('The recipient is reserved for another workflow.');
        if (!source.readOnly && (!lease || lease.orphaned || lease.memberId !== source.memberId))
          throw new DomainError('Source ownership changed. Recover before accepting.');
        const now = new Date().toISOString();
        const recipient = this.host.store.put('session', {
          id: randomUUID(),
          memberId: member.id,
          provider: member.provider || 'codex',
          projectId: source.projectId,
          taskId: task.id,
          title: source.title,
          status: 'paused',
          readOnly: source.readOnly,
          threadId: null,
          turnId: null,
          pid: null,
          error: null,
          createdAt: now,
          updatedAt: now,
        } satisfies CodexSession);
        if (lease)
          this.host.store.db
            .prepare(
              'UPDATE leases SET memberId=?,sessionId=?,token=?,heartbeat=? WHERE taskId=? AND token=? AND orphaned=0',
            )
            .run(member.id, recipient.id, randomUUID(), Date.now(), task.id, lease.token);
        this.host.store.updateTask(task.id, {
          assignedTo: member.id,
          sessionId: recipient.id,
          status: 'ready',
          threadId: null,
          turnId: null,
          error: null,
          description: `${task.description}\n\nHandoff context: ${handoff.summary}\nNext actions: ${handoff.nextSteps}\nPrior tests: ${handoff.testEvidence}\nPrior remote checkpoint: ${handoff.commitSha || 'read-only context'}`,
        });
        this.host.store.updateSession(source.id, { status: 'stopped' });
        this.host.store.put('sessionEvent', {
          id: randomUUID(),
          sessionId: recipient.id,
          kind: 'system',
          text: `Accepted handoff from ${source.id}. ${handoff.summary}\n${handoff.nextSteps}\nCheckpoint ${handoff.commitSha || 'MESH context'}`,
          createdAt: now,
        });
        const accepted = this.host.store.put('handoff', {
          ...handoff,
          toSessionId: recipient.id,
          status: 'accepted' as const,
          updatedAt: now,
        });
        this.host.mesh.post({
          projectId: handoff.projectId,
          taskId: task.id,
          sessionId: recipient.id,
          authorId: member.id,
          kind: 'progress',
          content: `Acknowledged handoff for ${task.title}. Ownership transferred; session is paused until resumed.`,
        });
        return accepted;
      });
    } finally {
      this.busy.delete(id);
    }
  }
  async automatic(sessionId: string) {
    const source = this.host.store.get<CodexSession>('session', sessionId);
    if (
      this.host.store
        .all<Handoff>('handoff')
        .some(
          (entry) =>
            entry.taskId === source.taskId && !['accepted', 'cancelled'].includes(entry.status),
        )
    )
      return;
    const member = groupMembers(this.host.store, source.projectId)
      .map((member) => ({ ...member, ...memberPresence(this.host, member) }))
      .sort(
        (a, b) =>
          Number(a.presence === 'busy') - Number(b.presence === 'busy') ||
          (a.activeSessions || 0) - (b.activeSessions || 0),
      )
      .find((candidate) => {
        if (isExternalMember(candidate)) return false;
        if (candidate.id === source.memberId || !candidate.account) return false;
        if (candidate.presence === 'offline') return false;
        try {
          this.host.quota.assertCanRun(candidate.id, source.projectId);
          return (
            this.host.store.leases().filter((lease) => lease.memberId === candidate.id).length <
            (candidate.maxSessions || 2)
          );
        } catch {
          return false;
        }
      });
    if (!member) {
      this.host.mesh.ask(
        source.projectId,
        source.memberId,
        'No account available for handoff',
        'Refresh another account or grant reserve usage to a specific account/project.',
      );
      return;
    }
    const task = this.host.store.get<Task>('task', source.taskId);
    const handoff = await this.create({
      sessionId,
      toMemberId: member.id,
      summary: `Quota checkpoint: ${task.title}. ${task.summary || 'See the persisted session events for the latest work.'}`,
      nextSteps: `Continue the assigned task and verify acceptance: ${task.acceptance}\n${task.description}`,
      testEvidence:
        'Review the saved session command events. No new model-generated tests were assumed to pass.',
    });
    // Stop at recipient ACK: the UI or recipient tool must explicitly accept.
    return handoff;
  }
  cancel(id: string) {
    if (this.busy.has(id))
      throw new DomainError('Wait for checkpointing to stop before cancelling.');
    const handoff = this.host.store.get<Handoff>('handoff', id);
    if (['accepted', 'cancelled'].includes(handoff.status))
      throw new DomainError('This handoff has ended.');
    const source = this.host.store.get<CodexSession>('session', handoff.fromSessionId);
    if (source.status === 'handoff') this.host.store.updateSession(source.id, { status: 'paused' });
    return this.host.store.put('handoff', {
      ...handoff,
      status: 'cancelled' as const,
      updatedAt: new Date().toISOString(),
    });
  }
}
