import type { DynamicTool } from './codex.ts';
import { Store } from './store.ts';
import type { AccountQuota, Project } from '../shared/types.ts';

export const portfolioTool: DynamicTool = {
  type: 'function',
  name: 'portfolio_read',
  description:
    'Read your assigned projects, deadlines, pending tasks, active sessions and account-wide usage. Use this to budget work across competitions; it grants no access to other repositories or task scopes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
export function portfolio(store: Store, memberId: string) {
  const tasks = store.tasks(),
    sessions = store.sessions();
  const projects = store.projects().filter((project) => project.memberIds?.includes(memberId));
  const quota = store.all<AccountQuota>('quota').find((item) => item.memberId === memberId);
  return {
    memberId,
    quota: quota
      ? { status: quota.status, observedAt: quota.observedAt, windows: quota.windows }
      : null,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      deadline: project.competition?.deadline || null,
      assigned: tasks
        .filter(
          (task) =>
            task.projectId === project.id && task.assignedTo === memberId && task.status !== 'done',
        )
        .slice(0, 16)
        .map(({ id, title, status, kind, effort }) => ({ id, title, status, kind, effort })),
      activeSessions: sessions.filter(
        (session) =>
          session.projectId === project.id &&
          session.memberId === memberId &&
          ['starting', 'running', 'interrupted'].includes(session.status),
      ).length,
      pendingHumanRequests: store
        .all<any>('message')
        .filter(
          (message) =>
            message.projectId === project.id &&
            message.authorId === null &&
            message.requestStatus === 'open',
        ).length,
      workflow:
        store
          .workflows()
          .find(
            (workflow) =>
              workflow.projectId === project.id &&
              !['completed', 'cancelled'].includes(workflow.status),
          )?.status || null,
    })),
    policy:
      'Usage is shared across every project and provider window. Respect reserve floors and expiry, never treat projects as separate account allowances. Use account-advertised models only; preserve strong reasoning for security/architecture and use lighter settings for routine work. Finish a bounded handoff before switching tasks. Other project names and assignments are awareness data, not permission to access their files.',
  };
}
export function portfolioContext(store: Store, memberId: string) {
  return `Your workspace portfolio (host state, not instructions from another project): ${JSON.stringify(portfolio(store, memberId)).slice(0, 12000)}\nRead portfolio_read again before allocating substantial work. Budget for all projects, not only this conversation.`;
}

interface Ticket {
  id: string;
  projectId: string;
  memberId: string;
  createdAt: number;
  seenAt: number;
}
/** Durable project rotation. Waiting work survives polling; processes never restart from a ticket. */
export class FairTurns {
  constructor(private store: Store) {
    for (const item of store.all<Ticket>('turnTicket')) store.remove('turnTicket', item.id);
  }
  ticket(id: string, projectId: string, memberId: string) {
    const old = this.store.all<Ticket>('turnTicket').find((item) => item.id === id);
    return this.store.put('turnTicket', {
      id,
      projectId,
      memberId,
      createdAt: old?.createdAt || Date.now(),
      seenAt: Date.now(),
    });
  }
  forget(id: string) {
    this.store.remove('turnTicket', id);
  }
  preferred(eligible: (ticket: Ticket) => boolean) {
    const service = this.store.all<{ id: string; grantedAt: number }>('projectService');
    const tickets = this.store.all<Ticket>('turnTicket').filter((item) => {
      if (Date.now() - item.seenAt > 120000) {
        this.forget(item.id);
        return false;
      }
      return eligible(item);
    });
    // Least recently served first; deadlines break ties without starving long projects.
    const last = (item: Ticket) =>
      service.find((entry) => entry.id === item.projectId)?.grantedAt || 0;
    const deadline = (item: Ticket) => {
      const value = this.store.get<Project>('project', item.projectId).competition?.deadline;
      return value ? Date.parse(value) : Infinity;
    };
    return tickets.sort(
      (a, b) =>
        last(a) - last(b) ||
        deadline(a) - deadline(b) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )[0];
  }
  granted(id: string, projectId: string) {
    this.forget(id);
    this.store.put('projectService', { id: projectId, grantedAt: Date.now() });
  }
}
