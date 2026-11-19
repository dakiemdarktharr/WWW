import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  sharedTeammatesPerOwnerLimit,
  type GroupListing,
  type SharedGroup,
  type SharedMessage,
} from '../shared/collaboration.ts';
import { DomainError, type Store } from './store.ts';
import { type DesktopOwner, DesktopIdentity } from './desktop-auth.ts';
import { GroupSade, groupSadeCommands, projectKey } from './group-sade.ts';
import { effectiveTier } from './billing.ts';

const groupId = z.string().uuid();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z
    .object({ action: z.literal('create'), id: groupId, name: z.string().trim().min(1).max(100) })
    .strict(),
  z
    .object({ action: z.literal('read'), groupId, after: z.number().int().min(0).optional() })
    .strict(),
  z
    .object({ action: z.literal('invite'), groupId, account: z.string().trim().min(1).max(254) })
    .strict(),
  z.object({ action: z.enum(['accept', 'decline', 'leave']), groupId }).strict(),
  z.object({ action: z.literal('remove'), groupId, userId: z.string().min(1).max(128) }).strict(),
  z
    .object({ action: z.literal('seats'), groupId, userIds: z.array(z.string().min(1).max(128)) })
    .strict(),
  z
    .object({
      action: z.literal('teammates'),
      groupId,
      teammates: z
        .array(
          z
            .object({
              localId: groupId,
              name: z.string().trim().min(1).max(100),
              provider: z.enum(['codex', 'gemini', 'claude', 'antigravity']),
            })
            .strict(),
        )
        .max(sharedTeammatesPerOwnerLimit),
    })
    .strict(),
  z
    .object({
      action: z.literal('message'),
      groupId,
      id: groupId,
      content: z.string().trim().min(1).max(8000),
      sade: z.object({ projectKey }).strict().optional(),
    })
    .strict(),
  ...groupSadeCommands,
]);

export class SharedGroups {
  private sade: GroupSade;
  constructor(
    private store: Store,
    private findUser: (account: string) => DesktopOwner | null,
  ) {
    this.sade = new GroupSade(store);
    store.db.exec(
      "CREATE INDEX IF NOT EXISTS shared_message_group_sequence ON records(json_extract(data,'$.groupId'),json_extract(data,'$.sequence')) WHERE kind='sharedMessage'",
    );
  }
  execute(owner: DesktopOwner, raw: unknown, deviceId?: string): unknown {
    const input = command.parse(raw);
    return this.store.transaction(() => {
      const actor = { ownerId: owner.id, deviceId: deviceId || '' };
      if (input.action === 'sade-poll' || input.action === 'sade-finish') {
        if (!deviceId) throw new DomainError('Desktop authentication required.', 401);
        if (input.action === 'sade-poll') {
          const supplied = new Set(input.grants);
          const groupIds = new Set<string>();
          for (const grant of this.store.all<{
            id: string;
            ownerId: string;
            deviceId: string;
            groupId: string;
          }>('sharedSadeGrant'))
            if (supplied.has(grant.id) && grant.ownerId === owner.id && grant.deviceId === deviceId)
              groupIds.add(grant.groupId);
          // A locked seat applies to its own group, not to every grant in this desktop's poll.
          for (const groupId of groupIds) this.refreshGroupSeats(groupId);
        } else {
          const run = this.store
            .all<{ groupId: string; jobs: { id: string }[] }>('sharedSadeRun')
            .find((item) => item.jobs.some((job) => job.id === input.jobId));
          if (run) this.assertActiveSeat(owner.id, run.groupId);
        }
        return input.action === 'sade-poll'
          ? this.sade.poll(actor, input)
          : this.sade.finish(actor, input);
      }
      const all = this.store.all<SharedGroup>('sharedGroup');
      if (input.action === 'list') {
        const groups: SharedGroup[] = [];
        const invitations: { id: string; name: string }[] = [];
        const lockedGroups: { id: string; name: string }[] = [];
        for (const group of all) {
          if (this.reconcileSeats(group))
            this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
          const person = group.people.find((member) => member.id === owner.id);
          const isOwner = group.ownerId === owner.id;
          if (isOwner || (person?.state === 'active' && !person.quotaLocked)) {
            const row = this.store.db
              .prepare(
                "SELECT data FROM records WHERE kind='sharedMessage' AND json_extract(data,'$.groupId')=? ORDER BY json_extract(data,'$.sequence') DESC LIMIT 1",
              )
              .get(group.id);
            const latest = row ? (JSON.parse(String(row.data)) as SharedMessage) : undefined;
            groups.push({
              ...group,
              seatLimit: this.seatLimit(group.ownerId),
              lastMessageAt: latest?.createdAt,
              lastMessagePreview: latest?.content.slice(0, 180),
            });
          } else if (person?.quotaLocked) {
            // Only this metadata is exposed so a locked person can identify and leave the group.
            lockedGroups.push({ id: group.id, name: group.name });
          } else if (person?.state === 'invited') {
            invitations.push({ id: group.id, name: group.name });
          }
        }
        return {
          owner,
          groups: groups.sort(
            (a, b) =>
              Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt) -
              Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt),
          ),
          invitations,
          lockedGroups,
        } satisfies GroupListing;
      }
      if (input.action === 'create') {
        const existing = all.find((group) => group.id === input.id);
        if (existing) {
          if (existing.ownerId !== owner.id) throw new DomainError('Group unavailable.', 403);
          return existing;
        }
        if (all.filter((group) => group.ownerId === owner.id).length >= 50)
          throw new DomainError('Group limit reached.', 429);
        return this.store.put('sharedGroup', {
          id: input.id,
          name: input.name,
          ownerId: owner.id,
          people: [{ ...owner, state: 'active' as const }],
          teammates: [],
          createdAt: new Date().toISOString(),
        } satisfies SharedGroup);
      }
      const group = all.find((group) => group.id === input.groupId);
      const person = group?.people.find((person) => person.id === owner.id);
      if (input.action === 'sade-revoke' && (!group || person?.state !== 'active')) {
        if (!deviceId) throw new DomainError('Desktop authentication required.', 401);
        this.sade.revokeGrant(input.groupId, input.grantId, actor);
        return { revoked: true };
      }
      if (!group || !person) throw new DomainError('Group unavailable.', 403);
      const isOwner = group.ownerId === owner.id;
      if (this.reconcileSeats(group))
        this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
      if (input.action === 'accept') {
        if (person.quotaLocked)
          throw new DomainError(
            'Your group seat is locked. Ask the owner to assign an active seat.',
            403,
          );
        if (person.state !== 'invited') throw new DomainError('Invitation unavailable.', 409);
        person.state = 'active';
        person.name = owner.name;
        return this.saveGroup(group);
      }
      if (input.action === 'decline') {
        if (person.state !== 'invited') throw new DomainError('Invitation unavailable.', 409);
        group.people = group.people.filter((person) => person.id !== owner.id);
        this.saveGroup(group);
        return { declined: true };
      }
      if (input.action === 'leave' || input.action === 'remove') {
        const target = input.action === 'remove' ? input.userId : owner.id;
        if (target === group.ownerId)
          throw new DomainError('The group owner cannot leave the group.', 409);
        if (target !== owner.id && !isOwner)
          throw new DomainError('Only the group owner can remove accounts.', 403);
        this.sade.revokeOwnerGrants(group, target);
        group.people = group.people.filter((person) => person.id !== target);
        group.teammates = group.teammates.filter((member) => member.ownerId !== target);
        return this.saveGroup(group);
      }
      if (input.action === 'seats') {
        if (!isOwner) throw new DomainError('Only the group owner can choose active seats.', 403);
        if (new Set(input.userIds).size !== input.userIds.length)
          throw new DomainError('Choose each group member once.', 400);
        const selected = new Set(input.userIds);
        if (!selected.has(group.ownerId))
          throw new DomainError('The group owner must have an active seat.', 400);
        if (input.userIds.some((id) => !group.people.some((person) => person.id === id)))
          throw new DomainError('Choose only people already in this group.', 400);
        const limit = this.seatLimit(group.ownerId);
        if (limit !== null && selected.size > limit)
          throw new DomainError(`This plan supports up to ${limit} active group seats.`, 429);
        for (const member of group.people)
          member.quotaLocked = limit === null ? false : !selected.has(member.id);
        return this.saveGroup(group);
      }
      if (person.quotaLocked && input.action !== 'sade-revoke')
        throw new DomainError('Your group seat is locked. You may leave the group.', 403);
      if (person.state !== 'active')
        throw new DomainError('Accept the group invitation first.', 403);
      if (
        input.action === 'sade-grant' ||
        input.action === 'sade-revoke' ||
        input.action === 'sade-cancel' ||
        input.action === 'sade-answer' ||
        input.action === 'sade-update-task'
      ) {
        if (!deviceId) throw new DomainError('Desktop authentication required.', 401);
        const result = this.sade.groupCommand(group, actor, input);
        return person.quotaLocked ? { revoked: true } : result;
      }
      if (input.action === 'read') {
        // Query only this group's records; never return other groups' history.
        const rows = this.store.db
          .prepare(
            "SELECT data FROM records WHERE kind='sharedMessage' AND json_extract(data,'$.groupId')=? AND json_extract(data,'$.sequence')>? ORDER BY json_extract(data,'$.sequence') ASC LIMIT 101",
          )
          .all(group.id, input.after || 0);
        return {
          group: { ...group, seatLimit: this.seatLimit(group.ownerId) },
          messages: rows.slice(0, 100).map((row) => JSON.parse(String(row.data)) as SharedMessage),
          hasMore: rows.length > 100,
          sadeSharingId: true as const,
          ...this.sade.view(group, owner.id),
        };
      }
      if (input.action === 'invite') {
        if (!isOwner) throw new DomainError('Only the group owner can invite accounts.', 403);
        const target = this.findUser(input.account);
        if (!target) throw new DomainError('No Kivuno account matches that ID or email.', 404);
        if (group.people.some((person) => person.id === target.id))
          return { ...group, seatLimit: this.seatLimit(group.ownerId) };
        const limit = this.seatLimit(group.ownerId);
        const reserved = group.people.filter((person) => !person.quotaLocked).length;
        if (limit !== null && reserved >= limit)
          throw new DomainError(`This plan supports up to ${limit} active group seats.`, 429);
        group.people.push({ ...target, state: 'invited' });
      } else if (input.action === 'teammates') {
        const submitted = new Map(input.teammates.map((member) => [member.localId, member]));
        if (submitted.size !== input.teammates.length)
          throw new DomainError('Choose each teammate once.', 400);
        const previous = new Map(
          group.teammates
            .filter((member) => member.ownerId === owner.id)
            .map((member) => [member.localId, member]),
        );
        const withdrawn = new Set(
          [...previous.values()]
            .filter((member) => submitted.get(member.localId)?.provider !== member.provider)
            .map((member) => member.localId),
        );
        if (withdrawn.size) this.sade.revokeOwnerGrants(group, owner.id, withdrawn);
        group.teammates = [
          ...group.teammates.filter((member) => member.ownerId !== owner.id),
          ...input.teammates.map((member) => {
            const shared = previous.get(member.localId);
            return {
              ...member,
              ownerId: owner.id,
              sharingId: shared?.provider === member.provider ? shared.sharingId : randomUUID(),
            };
          }),
        ];
      } else if (input.action === 'message') {
        const existing = this.store.db
          .prepare("SELECT data FROM records WHERE kind='sharedMessage' AND id=?")
          .get(input.id);
        if (existing) {
          const message = JSON.parse(String(existing.data)) as SharedMessage;
          if (
            message.ownerId !== owner.id ||
            message.groupId !== group.id ||
            message.content !== input.content ||
            message.sade?.projectKey !== input.sade?.projectKey
          )
            throw new DomainError('Message ID already used.', 409);
          return message;
        }
        const count = Number(
          this.store.db
            .prepare(
              "SELECT COUNT(*) AS n FROM records WHERE kind='sharedMessage' AND json_extract(data,'$.groupId')=?",
            )
            .get(group.id)!.n,
        );
        if (count >= 10000)
          throw new DomainError('Group history limit reached. Create a new group.', 429);
        const message = this.store.put('sharedMessage', {
          id: input.id,
          groupId: group.id,
          ownerId: owner.id,
          author: owner.name,
          content: input.content,
          createdAt: new Date().toISOString(),
          sequence: count + 1,
          ...(input.sade ? { sade: input.sade } : {}),
        } satisfies SharedMessage);
        this.sade.start(group, message);
        return message;
      }
      return this.saveGroup(group);
    });
  }

  private seatLimit(ownerId: string): number | null {
    const tier = effectiveTier(this.store, ownerId);
    return tier === 'free' ? 3 : tier === 'plus' ? 10 : null;
  }

  /** Preserve people and history while locking everyone outside a downgraded seat set. */
  private reconcileSeats(group: SharedGroup): boolean {
    const previous = JSON.stringify(group.people);
    const limit = this.seatLimit(group.ownerId);
    const groupOwner = group.people.find((person) => person.id === group.ownerId);
    if (groupOwner) {
      groupOwner.state = 'active';
      groupOwner.quotaLocked = false;
    }
    if (limit === null) {
      for (const person of group.people) person.quotaLocked = false;
    } else if (group.people.filter((person) => !person.quotaLocked).length > limit) {
      for (const person of group.people) person.quotaLocked = person.id !== group.ownerId;
    }
    return previous !== JSON.stringify(group.people);
  }

  private refreshGroupSeats(groupId: string) {
    const group = this.store.lookup<SharedGroup>('sharedGroup', groupId);
    if (group && this.reconcileSeats(group))
      this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
    return group;
  }

  private assertActiveSeat(ownerId: string, groupId: string) {
    const group = this.refreshGroupSeats(groupId);
    const person = group?.people.find((item) => item.id === ownerId);
    if (!group || !person) throw new DomainError('Group unavailable.', 403);
    if (person.quotaLocked)
      throw new DomainError('Your group seat is locked. You may leave the group.', 403);
    if (person.state !== 'active') throw new DomainError('Accept the group invitation first.', 403);
  }

  private saveGroup(group: SharedGroup): SharedGroup {
    const saved = this.store.put('sharedGroup', {
      ...group,
      seatLimit: undefined,
      updatedAt: new Date().toISOString(),
    });
    return { ...saved, seatLimit: this.seatLimit(saved.ownerId) };
  }
}

export function registerCollaboration(
  app: FastifyInstance,
  store: Store,
  identity: DesktopIdentity,
  findUser: (account: string) => DesktopOwner | null,
) {
  const groups = new SharedGroups(store, findUser);
  const limits = new Map<string, { count: number; at: number }>();
  app.post('/api/desktop/groups', async (request) => {
    const { owner, deviceId } = identity.publicDevice(
      identity.authenticate(request.headers.authorization),
    );
    const now = Date.now();
    for (const [key, value] of limits) if (now - value.at > 60_000) limits.delete(key);
    const window = limits.get(owner.id) || { count: 0, at: now };
    if (++window.count > 180)
      throw new DomainError('Too many group requests. Retry in a minute.', 429);
    limits.set(owner.id, window);
    return groups.execute(owner, request.body, deviceId);
  });
}
