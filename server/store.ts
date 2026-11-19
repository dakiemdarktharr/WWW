import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  Activity,
  Member,
  Project,
  RoomMessage,
  Task,
  Workflow,
  CodexSession,
} from '../shared/types.ts';
import { normalizeScope, scopesOverlap } from './security.ts';

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export interface Lease {
  taskId: string;
  memberId: string;
  projectId: string;
  token: string;
  scopes: string[];
  heartbeat: number;
  orphaned: number;
  sessionId?: string;
}
export class Store extends EventEmitter {
  db: DatabaseSync;
  private transactionDepth = 0;
  private savepoint = 0;
  constructor(filename: string) {
    super();
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS leases (taskId TEXT PRIMARY KEY, memberId TEXT UNIQUE NOT NULL, projectId TEXT NOT NULL, token TEXT NOT NULL, scopes TEXT NOT NULL, heartbeat INTEGER NOT NULL, orphaned INTEGER NOT NULL DEFAULT 0);`);
    const columns = this.db.prepare('PRAGMA table_info(leases)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'sessionId'))
      this.transaction(() => {
        this.db.exec(`ALTER TABLE leases RENAME TO leases_v1;
        CREATE TABLE leases (taskId TEXT PRIMARY KEY, memberId TEXT NOT NULL, sessionId TEXT UNIQUE NOT NULL, projectId TEXT NOT NULL, token TEXT NOT NULL, scopes TEXT NOT NULL, heartbeat INTEGER NOT NULL, orphaned INTEGER NOT NULL DEFAULT 0);
        INSERT INTO leases(taskId,memberId,sessionId,projectId,token,scopes,heartbeat,orphaned) SELECT taskId,memberId,memberId,projectId,token,scopes,heartbeat,orphaned FROM leases_v1;
        DROP TABLE leases_v1;`);
      });
    let sequence = 0;
    for (const message of this.all<RoomMessage>('message')) {
      sequence = Math.max(sequence + 1, message.sequence || 0);
      if (!message.sequence) this.put('message', { ...message, sequence });
    }
    for (const member of this.members())
      if (!member.provider) this.put('member', { ...member, provider: 'codex' });
    for (const session of this.sessions())
      if (!session.provider)
        this.put('session', {
          ...session,
          provider: this.get<Member>('member', session.memberId).provider || 'codex',
        });
  }
  all<T>(kind: string): T[] {
    return (
      this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind) as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  recent<T>(kind: string, limit: number): T[] {
    return (
      this.db
        .prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?')
        .all(kind, Math.max(1, Math.min(1000, limit))) as { data: string }[]
    )
      .reverse()
      .map((row) => JSON.parse(row.data));
  }
  lookup<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  get<T>(kind: string, id: string): T {
    const value = this.lookup<T>(kind, id);
    if (value === undefined) throw new DomainError(`${kind} not found.`, 404);
    return value;
  }
  put<T extends { id: string }>(kind: string, data: T): T {
    this.db
      .prepare(
        'INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, data.id, JSON.stringify(data));
    this.emit('change');
    return data;
  }
  remove(kind: string, id: string) {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
    this.emit('change');
  }
  transaction<T>(fn: () => T): T {
    const nested = this.transactionDepth > 0;
    const point = `relay_${++this.savepoint}`;
    this.db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const value = fn();
      this.db.exec(nested ? `RELEASE SAVEPOINT ${point}` : 'COMMIT');
      return value;
    } catch (error) {
      this.db.exec(
        nested ? `ROLLBACK TO SAVEPOINT ${point}; RELEASE SAVEPOINT ${point}` : 'ROLLBACK',
      );
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  members() {
    return this.all<Member>('member').filter((member) => !member.removedAt);
  }
  tasks() {
    return this.all<Task>('task');
  }
  projects() {
    return this.all<Project>('project');
  }
  sessions() {
    return this.all<CodexSession>('session');
  }
  updateSession(id: string, patch: Partial<CodexSession>) {
    return this.put('session', {
      ...this.get<CodexSession>('session', id),
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    });
  }
  workflows() {
    return this.all<Workflow>('workflow');
  }
  updateWorkflow(id: string, patch: Partial<Workflow>): Workflow {
    return this.put('workflow', {
      ...this.get<Workflow>('workflow', id),
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    });
  }
  leases(): Lease[] {
    return (
      this.db.prepare('SELECT * FROM leases').all() as unknown as (Omit<Lease, 'scopes'> & {
        scopes: string;
      })[]
    ).map((l) => ({ ...l, scopes: JSON.parse(l.scopes) }));
  }
  lease(taskId: string) {
    return this.leases().find((l) => l.taskId === taskId);
  }
  addMember(input: {
    name: string;
    role: Member['role'];
    color?: string;
    provider?: Member['provider'];
    integration?: Member['integration'];
  }): Member {
    if (this.members().length >= 16)
      throw new DomainError('This room supports up to 16 local profiles.');
    return this.put('member', {
      id: randomUUID(),
      provider: input.provider || 'codex',
      integration: input.integration || 'native',
      name: input.name,
      role: input.role,
      color: input.color || ['#b8f682', '#a8bbff', '#e9a8ee', '#f6c47e'][this.members().length % 4],
      status: 'offline',
      account: null,
      skills: [],
      plugins: [],
      rateLimits: null,
      createdAt: new Date().toISOString(),
    } satisfies Member);
  }
  updateMember(id: string, patch: Partial<Member>): Member {
    return this.put('member', { ...this.get<Member>('member', id), ...patch, id });
  }
  updateTask(id: string, patch: Partial<Task>): Task {
    return this.put('task', {
      ...this.get<Task>('task', id),
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    });
  }
  addTask(
    input: Pick<
      Task,
      | 'projectId'
      | 'title'
      | 'description'
      | 'kind'
      | 'priority'
      | 'scope'
      | 'dependsOn'
      | 'acceptance'
    > & {
      assignedTo?: string | null;
      status?: 'ready' | 'backlog';
    } & Partial<
        Pick<Task, 'workflowId' | 'phase' | 'parentTaskId' | 'stage' | 'effort' | 'planKey'>
      >,
  ): Task {
    this.get<Project>('project', input.projectId);
    if (
      input.workflowId &&
      this.get<Workflow>('workflow', input.workflowId).projectId !== input.projectId
    )
      throw new DomainError('The workflow belongs to another project.');
    if (input.assignedTo) {
      this.get<Member>('member', input.assignedTo);
      const project = this.get<Project>('project', input.projectId);
      if (project.memberIds && !project.memberIds.includes(input.assignedTo))
        throw new DomainError('Add this teammate to the project group first.', 403);
    }
    const normalized = input.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (
      this.tasks().some(
        (t) =>
          t.projectId === input.projectId &&
          t.status !== 'done' &&
          (!t.workflowId || this.get<Workflow>('workflow', t.workflowId).status !== 'cancelled') &&
          t.title.toLowerCase().replace(/\s+/g, ' ').trim() === normalized,
      )
    )
      throw new DomainError(
        'An unfinished task with this title already exists. Add detail or use the existing task.',
      );
    for (const id of input.dependsOn)
      if (this.get<Task>('task', id).projectId !== input.projectId)
        throw new DomainError('Dependencies must belong to this project.');
    const now = new Date().toISOString();
    return this.put('task', {
      ...input,
      id: randomUUID(),
      scope:
        input.workflowId && (input.phase === 'proposal' || input.phase === 'plan')
          ? []
          : input.scope.length
            ? input.scope.map(normalizeScope)
            : ['.'],
      assignedTo: input.assignedTo || null,
      status: input.status || 'ready',
      branch: null,
      worktree: null,
      baseCommit: null,
      threadId: null,
      turnId: null,
      summary: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Task);
  }
  validateDependencies(taskId: string, deps: string[]) {
    const task = this.get<Task>('task', taskId);
    const visit = (id: string, seen: Set<string>) => {
      if (id === taskId) throw new DomainError('Dependencies cannot form a cycle.');
      if (seen.has(id)) return;
      seen.add(id);
      const dep = this.get<Task>('task', id);
      if (dep.projectId !== task.projectId)
        throw new DomainError('Dependency belongs to a different project.');
      dep.dependsOn.forEach((x) => visit(x, seen));
    };
    deps.forEach((id) => visit(id, new Set()));
  }
  claim(taskId: string, memberId: string, sessionId?: string): { task: Task; lease: Lease } {
    return this.transaction(() => {
      const task = this.get<Task>('task', taskId),
        member = this.get<Member>('member', memberId);
      if (member.removedAt) throw new DomainError('This teammate was removed.', 410);
      const session = sessionId ? this.get<CodexSession>('session', sessionId) : null;
      const project = this.get<Project>('project', task.projectId);
      if (task.reviewOfTaskId) {
        const source = this.get<Task>('task', task.reviewOfTaskId);
        if (
          source.status !== 'review' ||
          !source.workflowId ||
          !['running', 'review'].includes(this.get<Workflow>('workflow', source.workflowId).status)
        )
          throw new DomainError(
            'Resume the source workflow before starting its independent review.',
          );
      }
      if (project.memberIds && !project.memberIds.includes(memberId))
        throw new DomainError('Add this teammate to the project group first.', 403);
      const scopes = session?.readOnly ? [] : task.scope;
      if (task.status !== 'ready') throw new DomainError('Only a ready task can be claimed.');
      if (
        this.all<{ taskId: string; status: string }>('handoff').some(
          (handoff) =>
            handoff.taskId === taskId && !['accepted', 'cancelled'].includes(handoff.status),
        )
      )
        throw new DomainError('This task is reserved by a pending handoff.');
      if (task.workflowId) {
        const workflow = this.get<Workflow>('workflow', task.workflowId);
        if (!['planning', 'running', 'review'].includes(workflow.status))
          throw new DomainError('Resume this workflow before starting a task.');
      }
      if (
        !member.account ||
        (member.status !== 'ready' && !(sessionId && member.status === 'working'))
      )
        throw new DomainError('This Codex profile must be signed in and ready.');
      if (task.assignedTo && task.assignedTo !== memberId)
        throw new DomainError('This task is assigned to another teammate.');
      if (task.dependsOn.some((id) => this.get<Task>('task', id).status !== 'done'))
        throw new DomainError('Dependencies must be integrated before this task can start.');
      for (const lease of this.leases()) {
        if (lease.memberId === memberId && (!sessionId || lease.sessionId === sessionId))
          throw new DomainError('This teammate already owns another task.');
        if (lease.projectId === task.projectId && scopesOverlap(scopes, lease.scopes))
          throw new DomainError(
            'Scope overlaps another claimed task. Wait for its handoff or narrow the scope.',
          );
      }
      if (sessionId) {
        if (
          session!.memberId !== memberId ||
          session!.projectId !== task.projectId ||
          session!.taskId !== taskId
        )
          throw new DomainError('Session does not own this task or account.');
        if (
          this.leases().filter((lease) => lease.memberId === memberId).length >=
          (member.maxSessions || 2)
        )
          throw new DomainError('This account has reached its session concurrency limit.');
      }
      const lease: Lease = {
        taskId,
        memberId,
        projectId: task.projectId,
        token: randomUUID(),
        scopes,
        heartbeat: Date.now(),
        orphaned: 0,
        sessionId: sessionId || memberId,
      };
      this.db
        .prepare(
          'INSERT INTO leases(taskId,memberId,sessionId,projectId,token,scopes,heartbeat,orphaned) VALUES(?,?,?,?,?,?,?,0)',
        )
        .run(
          taskId,
          memberId,
          lease.sessionId!,
          task.projectId,
          lease.token,
          JSON.stringify(lease.scopes),
          lease.heartbeat,
        );
      this.updateMember(memberId, { status: 'working', error: null });
      return {
        task: this.updateTask(taskId, {
          status: 'running',
          assignedTo: memberId,
          error: null,
          ...(sessionId ? { sessionId } : {}),
        }),
        lease,
      };
    });
  }
  heartbeat(taskId: string, token: string) {
    this.db
      .prepare('UPDATE leases SET heartbeat=? WHERE taskId=? AND token=? AND orphaned=0')
      .run(Date.now(), taskId, token);
  }
  owns(taskId: string, token: string) {
    return this.lease(taskId)?.token === token && this.lease(taskId)?.orphaned === 0;
  }
  release(taskId: string, token: string) {
    this.db.prepare('DELETE FROM leases WHERE taskId=? AND token=?').run(taskId, token);
    this.emit('change');
  }
  orphanAll() {
    const leases = this.leases().filter(
      (l) => this.get<Task>('task', l.taskId).status !== 'review',
    );
    for (const l of leases)
      this.db.prepare('UPDATE leases SET orphaned=1 WHERE taskId=?').run(l.taskId);
    for (const l of leases) {
      this.updateTask(l.taskId, {
        status: 'blocked',
        error:
          'The coordinator stopped during this run. Confirm its old Codex processes have stopped before recovering.',
      });
      this.updateMember(l.memberId, { status: 'offline' });
    }
    for (const m of this.members())
      this.updateMember(m.id, { status: 'offline', account: null, rateLimits: null });
    for (const session of this.sessions())
      if (['running', 'starting', 'idle'].includes(session.status))
        this.updateSession(session.id, {
          status: 'interrupted',
          error:
            'Coordinator restarted. Confirm the last observed session PID stopped before recovery.',
        });
    return leases.length;
  }
  recoverOrphans() {
    for (const l of this.leases().filter((x) => x.orphaned)) {
      this.release(l.taskId, l.token);
      this.updateTask(l.taskId, { status: 'ready', error: null, threadId: null, turnId: null });
    }
  }
  message(input: Omit<RoomMessage, 'id' | 'createdAt'>) {
    const message = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    const row = this.db
      .prepare(
        "INSERT INTO records(kind,id,data) SELECT 'message',?,json_set(?,'$.sequence',(SELECT COALESCE(MAX(json_extract(data,'$.sequence')),0)+1 FROM records WHERE kind='message')) RETURNING data",
      )
      .get(message.id, JSON.stringify(message)) as { data: string };
    this.emit('change');
    return JSON.parse(row.data) as RoomMessage;
  }
  activity(input: Omit<Activity, 'id' | 'createdAt'>) {
    const result = this.put('activity', {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    this.db
      .prepare(
        "DELETE FROM records WHERE kind='activity' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='activity' ORDER BY rowid DESC LIMIT 5000)",
      )
      .run();
    return result;
  }
  close() {
    this.db.close();
  }
}
