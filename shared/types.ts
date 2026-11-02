export type Role = 'engineer' | 'researcher' | 'designer' | 'reviewer';
export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'done' | 'blocked';
export type TaskKind = 'code' | 'research' | 'design' | 'review';
export interface Member {
  id: string;
  name: string;
  role: Role;
  color: string;
  status: 'offline' | 'connecting' | 'ready' | 'working' | 'error';
  account: { email?: string; planType?: string; type?: string } | null;
  skills: string[];
  plugins: string[];
  capabilitiesError?: string;
  rateLimits: unknown;
  error?: string | null;
  createdAt: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  goal: string;
  createdAt: string;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  assignedTo: string | null;
  dependsOn: string[];
  scope: string[];
  acceptance: string;
  branch: string | null;
  worktree: string | null;
  baseCommit: string | null;
  threadId: string | null;
  turnId: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RoomMessage {
  id: string;
  projectId: string;
  taskId: string | null;
  authorId: string | null;
  kind: 'message' | 'progress' | 'handoff' | 'blocker' | 'system';
  content: string;
  createdAt: string;
}
export interface Approval {
  id: string;
  memberId: string;
  taskId: string;
  method: string;
  description: string;
  details: unknown;
  createdAt: string;
}
export interface Activity {
  id: string;
  projectId: string | null;
  taskId: string | null;
  memberId: string | null;
  type: string;
  text: string;
  createdAt: string;
}
export interface WorkspaceState {
  projects: Project[];
  members: Member[];
  tasks: Task[];
  messages: RoomMessage[];
  approvals: Approval[];
  activity: Activity[];
  runtime: {
    codexAvailable: boolean;
    codexVersion: string;
    version: string;
    platform: string;
    dataDir: string;
    recoveryRequired: boolean;
  };
}
export interface LoginResult {
  type: string;
  loginId?: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
}
export interface TaskDiff {
  diff: string;
  files: string[];
  stat: string;
  truncated: boolean;
}
