import type { WorkspaceState } from './types';
import type { SharedGroup } from './collaboration';

export interface ChatListItem {
  id: string;
  kind: 'project' | 'shared';
  name: string;
  at: number;
  active: boolean;
  preview: string;
}
const time = (value?: string) => {
  const result = Date.parse(value || '');
  return Number.isFinite(result) ? result : 0;
};
export function chatList(state: WorkspaceState, groups: SharedGroup[] = []): ChatListItem[] {
  const projects: ChatListItem[] = state.projects.map((project) => {
    const messages = state.messages
      .filter((message) => message.projectId === project.id)
      .sort(
        (a, b) => time(b.createdAt) - time(a.createdAt) || (b.sequence || 0) - (a.sequence || 0),
      );
    const updates = [
      ...messages.map((message) => time(message.createdAt)),
      ...state.sessions
        .filter((session) => session.projectId === project.id)
        .map((session) => time(session.updatedAt)),
      ...state.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => time(task.updatedAt)),
      ...state.workflows
        .filter((workflow) => workflow.projectId === project.id)
        .map((workflow) => time(workflow.updatedAt)),
      ...(state.competitionResearch || [])
        .filter((item) => item.projectId === project.id)
        .map((item) => time((item as { updatedAt?: string }).updatedAt)),
    ];
    return {
      id: project.id,
      kind: 'project',
      name: project.name,
      at: Math.max(time(project.createdAt), ...updates),
      active: updates.some((value) => value > 0),
      preview: messages[0]?.content.slice(0, 180) || '',
    };
  });
  return [
    ...projects,
    ...groups.map((group): ChatListItem => ({
      id: group.id,
      kind: 'shared',
      name: group.name,
      at: Math.max(time(group.createdAt), time(group.updatedAt), time(group.lastMessageAt)),
      active: !!(group.lastMessageAt || group.updatedAt),
      preview: group.lastMessagePreview || '',
    })),
  ].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.at - a.at ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
