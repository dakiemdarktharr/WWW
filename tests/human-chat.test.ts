import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { postHumanChat } from '../server/human-chat.ts';
import { chatRecipients, reserveIntent } from '../server/chat-intent.ts';
import type { Member, Project, QuotaGrant, RoomMessage } from '../shared/types.ts';

test('Vietnamese and English allowance language binds remaining floor and duration; denials and quoted requests never grant', () => {
  for (const content of [
    '@Vega tôi cho phép tiếp tục',
    'Vega I allow you to work on it',
    'go ahead @Vega',
    'Vega làm tiếp',
  ])
    assert.deepEqual(reserveIntent(content, true), { floor: 20, minutes: 60 });
  assert.deepEqual(reserveIntent('I allow you to work until you reach 37% usage @Vega', true), {
    floor: 37,
    minutes: 60,
  });
  assert.deepEqual(
    reserveIntent('Tôi cho phép @Vega tiếp tục đến 25% còn lại trong 30 phút', true),
    { floor: 25, minutes: 30 },
  );
  for (const content of [
    'I do not allow Vega',
    'Vega don’t continue',
    'Continue after your quota resets @Vega',
    'Tôi chưa cho phép Vega',
    'If I allow Vega?',
    'Ví dụ tôi cho phép Vega',
    '> I allow Vega',
    '"I allow Vega"',
  ])
    assert.equal(reserveIntent(content, true), null, content);
  assert.equal(reserveIntent('I allow access to the repo @Vega', false), null);
  assert.ok(reserveIntent('I allow @Vega until 37% and 20%', true)?.error);
});

test('addresses include typed mentions and a directly addressed name, excluding quotes, code and partial names', () => {
  const members = [
    { id: 'a', name: 'Atlas' },
    { id: 'v', name: 'Vega' },
  ] as Member[];
  for (const text of ['@Vega work on it', 'work on it\n@Vega', 'vega work on it', 'tiếp tục, Vega'])
    assert.deepEqual(chatRecipients(text, members), ['v']);
  for (const text of [
    'Megavega work on it',
    '> @Vega work on it',
    '```@Vega```',
    'Compare the star Vega with the sun',
  ])
    assert.deepEqual(chatRecipients(text, members), []);
});

test('human allowance resumes the queued request, replaces older limits, deduplicates retry, and cannot unblock provider exhaustion', async (t) => {
  const store = new Store(':memory:');
  const host = new Workspace(store, process.cwd(), process.cwd());
  t.after(async () => {
    await host.close();
    store.close();
  });
  const atlas = host.autonomy.addAccount(),
    vega = host.autonomy.addAccount();
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Test',
    path: process.cwd(),
    goal: 'Fixtures only',
    createdAt: new Date().toISOString(),
    memberIds: [atlas.id, vega.id],
  } satisfies Project);
  for (const member of [atlas, vega])
    store.updateMember(member.id, { account: { type: 'chatgpt' }, status: 'ready' });
  host.quota.ingest(atlas.id, {
    rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300 } },
  });
  host.quota.ingest(vega.id, {
    rateLimits: { primary: { usedPercent: 61, windowDurationMins: 300 } },
  });
  const queued = host.mesh.post({
    projectId: project.id,
    authorId: null,
    kind: 'message',
    content: 'Review this repository',
  });
  await host.quota.enforce();
  const request = {
    projectId: project.id,
    content: '@Vega I allow you to continue until 37% usage',
    clientRequestId: randomUUID(),
  };
  const result = postHumanChat(host, request, []);
  assert.equal(result.requestStatus, 'done');
  assert.deepEqual(store.get<RoomMessage>('message', queued.id).mentions, [vega.id]);
  assert.equal(store.all<QuotaGrant>('quotaGrant')[0].floor, 37);
  assert.equal(postHumanChat(host, request, []).id, result.id);
  assert.equal(store.all('quotaGrant').length, 1);
  assert.doesNotThrow(() => host.quota.assertCanRun(vega.id, project.id));
  postHumanChat(
    host,
    { projectId: project.id, content: '@Vega I allow reserve usage until 38%' },
    [],
  );
  assert.equal(store.all<QuotaGrant>('quotaGrant').filter((grant) => !grant.revokedAt).length, 1);
  host.quota.ingest(vega.id, {
    rateLimits: { primary: { usedPercent: 62, windowDurationMins: 300 } },
  });
  assert.throws(() => host.quota.assertCanRun(vega.id, project.id), /38%/);
  postHumanChat(
    host,
    { projectId: project.id, content: '@Atlas I allow reserve usage until 0%' },
    [],
  );
  assert.throws(() => host.quota.assertCanRun(atlas.id, project.id));
});

test('ambiguous allowance asks in chat, agents cannot grant, and an outsider cannot receive a project allowance', async (t) => {
  const store = new Store(':memory:');
  const host = new Workspace(store, process.cwd(), process.cwd());
  t.after(async () => {
    await host.close();
    store.close();
  });
  const a = host.autonomy.addAccount(),
    b = host.autonomy.addAccount(),
    outsider = host.autonomy.addAccount();
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Test',
    path: process.cwd(),
    goal: 'Test',
    createdAt: new Date().toISOString(),
    memberIds: [a.id, b.id],
  } satisfies Project);
  postHumanChat(host, { projectId: project.id, content: 'I allow reserve usage' }, []);
  assert.equal(store.all('quotaGrant').length, 0);
  assert.ok(
    store.all<RoomMessage>('message').some((message) => /exactly one/.test(message.content)),
  );
  host.mesh.post({
    projectId: project.id,
    authorId: a.id,
    kind: 'message',
    content: '@Vega I allow reserve usage',
  });
  assert.equal(store.all('quotaGrant').length, 0);
  assert.throws(
    () =>
      host.quota.grant(outsider.id, {
        projectId: project.id,
        floor: 20,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    /teammate/,
  );
});
