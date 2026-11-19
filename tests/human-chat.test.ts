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
    'ĐỪNG cho phép Vega tiếp tục',
    'I refuse to allow usage, stop @Vega',
    "'I allow reserve usage @Vega'",
    '/goal I allow reserve usage @Vega',
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
  assert.ok(reserveIntent('I allow @Vega until -1%', true)?.error);
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

test('a redacted chat retry reuses its original message and rejects changed routing', async (t) => {
  const store = new Store(':memory:');
  const host = new Workspace(store, process.cwd(), process.cwd());
  t.after(async () => {
    await host.close();
    store.close();
  });
  const a = host.autonomy.addAccount(),
    b = host.autonomy.addAccount();
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Inbox',
    path: process.cwd(),
    goal: '',
    memberIds: [a.id, b.id],
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const other = store.put('project', { ...project, id: randomUUID() });
  const request = {
    projectId: project.id,
    clientRequestId: randomUUID(),
    content: 'Look at password=fixture-only',
    mentions: [b.id, a.id],
  };
  const original = postHumanChat(host, request, []);
  assert.doesNotMatch(original.content, /fixture-only/);
  assert.equal(postHumanChat(host, { ...request, mentions: [a.id, b.id] }, []).id, original.id);
  assert.throws(() => postHumanChat(host, { ...request, mentions: [b.id] }, []), /target changed/);
  assert.throws(
    () => postHumanChat(host, { ...request, replyTo: original.id }, []),
    /target changed/,
  );
  assert.throws(
    () => postHumanChat(host, { ...request, taskId: randomUUID() }, []),
    /target changed/,
  );
  assert.throws(
    () => postHumanChat(host, { ...request, content: 'Different request' }, []),
    /content changed/,
  );
  assert.notEqual(postHumanChat(host, { ...request, projectId: other.id }, []).id, original.id);
  // Older messages stored the inferred recipients without the original explicit mention set.
  store.put('message', { ...original, requestedMentions: undefined });
  assert.equal(postHumanChat(host, request, []).id, original.id);
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

test('9% remaining with a 20% floor stays paused without repeatedly resolving and reopening the quota decision', async (t) => {
  const store = new Store(':memory:'),
    host = new Workspace(store, process.cwd(), process.cwd());
  t.after(async () => {
    await host.close();
    store.close();
  });
  const member = host.autonomy.addAccount();
  store.updateMember(member.id, { name: 'Vega', account: { type: 'chatgpt' }, status: 'ready' });
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Screenshot regression',
    path: process.cwd(),
    goal: 'Controlled test',
    createdAt: new Date().toISOString(),
    memberIds: [member.id],
  } satisfies Project);
  host.quota.ingest(member.id, {
    rateLimits: { primary: { usedPercent: 91, windowDurationMins: 10080 } },
  });
  const queued = host.mesh.post({
    projectId: project.id,
    authorId: null,
    kind: 'message',
    content: 'Review this project',
  });
  await host.quota.enforce();
  const decision = store.all<any>('humanRequest')[0];
  for (const content of ['vega work on it', 'i allow you to work on this vega']) {
    postHumanChat(host, { projectId: project.id, content }, []);
    await host.quota.enforce();
    assert.equal(store.get<any>('humanRequest', decision.id).status, 'open');
    assert.equal(store.all('humanRequest').length, 1);
    const reply = store.all<RoomMessage>('message').at(-1)!;
    assert.match(reply.content, /9% remaining.*20% stop limit/);
    assert.doesNotMatch(reply.content, /Continuing eligible|can now be dispatched/);
    assert.equal(store.get<RoomMessage>('message', queued.id).requestStatus, 'open');
    assert.throws(() => host.quota.assertCanRun(member.id, project.id));
  }
  postHumanChat(
    host,
    { projectId: project.id, content: '@Vega I allow you to continue until 5% remaining' },
    [],
  );
  assert.doesNotThrow(() => host.quota.assertCanRun(member.id, project.id));
  assert.equal(store.get<any>('humanRequest', decision.id).status, 'resolved');
  // A newer, stricter permission must stop work; it cannot leave the old 5% grant effective.
  postHumanChat(
    host,
    { projectId: project.id, content: '@Vega I allow reserve usage until 20%' },
    [],
  );
  assert.equal(store.all<QuotaGrant>('quotaGrant').filter((item) => !item.revokedAt).length, 1);
  assert.throws(() => host.quota.assertCanRun(member.id, project.id));
});
