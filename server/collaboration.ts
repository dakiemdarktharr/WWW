import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { GroupListing, SharedGroup, SharedMessage } from '../shared/collaboration.ts';
import { DomainError, type Store } from './store.ts';
import { type DesktopOwner, DesktopIdentity } from './desktop-auth.ts';
import { GroupSade, groupSadeCommands, projectKey } from './group-sade.ts';

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
        .max(32),
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
        return input.action === 'sade-poll'
          ? this.sade.poll(actor, input)
          : this.sade.finish(actor, input);
      }
      const all = this.store.all<SharedGroup>('sharedGroup');
      if (input.action === 'list')
        return {
          owner,
          groups: all
            .filter((group) =>
              group.people.some((person) => person.id === owner.id && person.state === 'active'),
            )
            .map((group) => {
              const row = this.store.db
                .prepare(
                  "SELECT data FROM records WHERE kind='sharedMessage' AND json_extract(data,'$.groupId')=? ORDER BY json_extract(data,'$.sequence') DESC LIMIT 1",
                )
                .get(group.id);
              const latest = row ? (JSON.parse(String(row.data)) as SharedMessage) : undefined;
              return {
                ...group,
                lastMessageAt: latest?.createdAt,
                lastMessagePreview: latest?.content.slice(0, 180),
              };
            })
            .sort(
              (a, b) =>
                Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt) -
                Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt),
            ),
          invitations: all
            .filter((group) =>
              group.people.some((person) => person.id === owner.id && person.state === 'invited'),
            )
            .map(({ id, name }) => ({ id, name })),
        } satisfies GroupListing;
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
      if (!group || !person) throw new DomainError('Group unavailable.', 403);
      if (input.action === 'accept') {
        person.state = 'active';
        person.name = owner.name;
        return this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
      }
      if (input.action === 'decline') {
        if (person.state !== 'invited') throw new DomainError('Invitation unavailable.', 409);
        group.people = group.people.filter((person) => person.id !== owner.id);
        this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
        return { declined: true };
      }
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
        return this.sade.groupCommand(group, actor, input);
      }
      if (input.action === 'read') {
        // Query only this group's records; never return other groups' history.
        const messages = this.store.db
          .prepare(
            "SELECT data FROM records WHERE kind='sharedMessage' AND json_extract(data,'$.groupId')=? AND json_extract(data,'$.sequence')>? ORDER BY json_extract(data,'$.sequence') ASC LIMIT 100",
          )
          .all(group.id, input.after || 0)
          .map((row) => JSON.parse(String(row.data)) as SharedMessage);
        return {
          group,
          messages,
          hasMore: messages.length === 100,
          ...this.sade.view(group, owner.id),
        };
      }
      if (input.action === 'invite') {
        if (group.ownerId !== owner.id)
          throw new DomainError('Only the group owner can invite accounts.', 403);
        const target = this.findUser(input.account);
        if (!target) throw new DomainError('No Kivuno account matches that ID or email.', 404);
        if (group.people.some((person) => person.id === target.id)) return group;
        if (group.people.length >= 32) throw new DomainError('Group member limit reached.', 429);
        group.people.push({ ...target, state: 'invited' });
      } else if (input.action === 'teammates') {
        const localIds = new Set(input.teammates.map((member) => member.localId));
        if (localIds.size !== input.teammates.length)
          throw new DomainError('Choose each teammate once.', 400);
        group.teammates = [
          ...group.teammates.filter((member) => member.ownerId !== owner.id),
          ...input.teammates.map((member) => ({ ...member, ownerId: owner.id })),
        ];
      } else if (input.action === 'leave' || input.action === 'remove') {
        const target = input.action === 'remove' ? input.userId : owner.id;
        if (target === group.ownerId)
          throw new DomainError('The group owner cannot leave the group.', 409);
        if (target !== owner.id && group.ownerId !== owner.id)
          throw new DomainError('Only the group owner can remove accounts.', 403);
        group.people = group.people.filter((person) => person.id !== target);
        group.teammates = group.teammates.filter((member) => member.ownerId !== target);
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
      return this.store.put('sharedGroup', { ...group, updatedAt: new Date().toISOString() });
    });
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
