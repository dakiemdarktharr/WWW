import type { ProviderId } from './types';

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
  | { action: 'message'; groupId: string; id: string; content: string };
