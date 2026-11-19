import type { PlanTask, ProviderId, Role } from './types';

export const sharedGroupMemberLimit = 32;
export const sharedTeammatesPerOwnerLimit = 32;
export const sharedSadePollGrantLimit = 32;

export interface GroupPerson {
  id: string;
  name: string;
  state: 'invited' | 'active';
}
export interface SharedTeammate {
  localId: string;
  name: string;
  provider: ProviderId;
  ownerId: string;
}
export interface SharedGroup {
  updatedAt?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  id: string;
  name: string;
  ownerId: string;
  people: GroupPerson[];
  teammates: SharedTeammate[];
  createdAt: string;
}
export interface SharedMessage {
  id: string;
  groupId: string;
  ownerId: string;
  author: string;
  content: string;
  createdAt: string;
  sequence: number;
  sade?: { projectKey: string };
}
export type SharedPlatform = 'win32' | 'darwin' | 'linux';
export interface SharedHarnessGrant {
  id: string;
  groupId: string;
  ownerId: string;
  teammateId: string;
  label: string;
  projectKey: string;
  projectName: string;
  role: Role;
  platform: SharedPlatform;
  pairedPlatform?: SharedPlatform;
  patchHandoff?: true;
  allowWrites: boolean;
  expiresAt: number;
  turns: number;
  used: number;
}

export interface SharedSadeJob {
  id: string;
  runId: string;
  grantId: string;
  phase: 'plan' | 'task' | 'review';
  task?: PlanTask;
  state: 'queued' | 'running' | 'waiting' | 'reviewing' | 'done' | 'blocked' | 'cancelled';
  summary?: string;
  canUpdate?: boolean;
  updateCount?: number;
  updatesRead?: number;
}

export interface SharedSadeRun {
  id: string;
  groupId: string;
  projectKey: string;
  state: 'planning' | 'running' | 'done' | 'blocked' | 'cancelled';
  jobs: SharedSadeJob[];
  error?: string;
  canAnswer?: boolean;
}
export interface GroupListing {
  groups: SharedGroup[];
  invitations: { id: string; name: string }[];
  owner: { id: string; name: string };
}
export type GroupCommand =
  | { action: 'list' }
  | { action: 'create'; id: string; name: string }
  | { action: 'read'; groupId: string; after?: number }
  | { action: 'invite'; groupId: string; account: string }
  | { action: 'accept' | 'decline' | 'leave'; groupId: string }
  | { action: 'remove'; groupId: string; userId: string }
  | { action: 'teammates'; groupId: string; teammates: Omit<SharedTeammate, 'ownerId'>[] }
  | {
      action: 'message';
      groupId: string;
      id: string;
      content: string;
      sade?: { projectKey: string };
    }
  | {
      action: 'sade-connect';
      groupId: string;
      projectId: string;
      teammateId: string;
      allowWrites: boolean;
      machineId?: string;
      turns: number;
    }
  | { action: 'sade-revoke'; groupId: string; grantId: string }
  | { action: 'sade-cancel'; groupId: string; runId: string }
  | { action: 'sade-answer'; groupId: string; runId: string; jobId: string; answer: string }
  | {
      action: 'sade-update-task';
      groupId: string;
      runId: string;
      jobId: string;
      id: string;
      text: string;
    };
