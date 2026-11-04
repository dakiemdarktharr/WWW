import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Mesh } from '../server/mesh.ts';
import { InboxDispatcher } from '../server/inbox.ts';
import { memberPresence, humanPresence } from '../server/groups.ts';
import type { CodexModel, CodexSession, Project } from '../shared/types.ts';

function fixture(t: TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const members = ['Atlas', 'Vega', 'Nova', 'Orion'].map((name) => {
    const member = store.addMember({ name, role: 'engineer' });
    return store.updateMember(member.id, {
      account: { type: 'chatgpt', planType: 'plus' },
      status: 'ready',
      maxSessions: 8,
      skills: ['writing'],
      plugins: ['docs'],
    });
  });
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Selected group',
    path: 'C:/fixture',
    goal: '',
    createdAt: new Date().toISOString(),
    memberIds: members.slice(0, 3).map((member) => member.id),
  } satisfies Project);
  const nodes = [{ id: 'other-machine', online: false, ready: false }];
  const host = {
    store,
    closing: false,
    runtime: { codexAvailable: true },
    runners: { list: () => nodes },
  };
  const mesh = new Mesh(host);
  const post = (content: string, authorId: string | null = null) =>
    mesh.post({ projectId: project.id, authorId, kind: 'message', content });
  const session = (memberId: string, status: CodexSession['status'] = 'running') =>
    store.put('session', {
      id: randomUUID(),
      memberId,
      projectId: project.id,
      taskId: randomUUID(),
      title: 'Controlled',
      status,
      readOnly: true,
      threadId: null,
      turnId: null,
      pid: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies CodexSession);
  return { store, members, project, nodes, host, mesh, post, session };
}

test('project roster is distinct from the global team and durable introductions are idempotent', (t) => {
  const f = fixture(t),
    [a, b, c, outside] = f.members;
  f.mesh.setMembers(f.project.id, [a.id, b.id, c.id]);
  assert.equal(f.store.members().length, 4);
  assert.equal(f.mesh.readRoom(f.project.id, a.id).members.length, 3);
  assert.equal(f.store.all('groupIntroduction').length, 3);
  const messages = f.store.all('message').length;
  f.mesh.ensureMember(f.project.id, a.id);
  f.mesh.setMembers(f.project.id, [a.id, b.id, c.id]);
  assert.equal(f.store.all('message').length, messages);
  assert.throws(() => f.mesh.readRoom(f.project.id, outside.id), /group first/);
  assert.throws(() => f.post('Hello', outside.id), /group first/);
  assert.throws(
    () =>
      f.mesh.post({
        projectId: f.project.id,
        authorId: a.id,
        kind: 'message',
        content: 'Secret task',
        mentions: [outside.id],
      }),
    /group first/,
  );
  const request = f.post('Please inspect');
  assert.throws(() => f.mesh.claim(request.id, outside.id), /group first/);
  f.mesh.setMembers(f.project.id, [a.id, c.id]);
  assert.throws(() => f.mesh.ensureMember(f.project.id, b.id), /group first/);
  assert.equal(f.store.all('meshCursor').length, 3, 'read cursors remain durable after removal');
});

test('legacy membership migrates from project cursors, without acquiring unrelated accounts', (t) => {
  const f = fixture(t);
  f.store.put('project', { ...f.project, memberIds: undefined });
  f.store.put('meshCursor', {
    id: `${f.project.id}:${f.members[1].id}`,
    projectId: f.project.id,
    memberId: f.members[1].id,
    readThrough: 9,
    acknowledgedThrough: 8,
    updatedAt: new Date().toISOString(),
  });
  new Mesh(f.host);
  assert.deepEqual(f.store.get<Project>('project', f.project.id).memberIds, [f.members[1].id]);
  assert.throws(() => f.mesh.ensureMember(f.project.id, f.members[0].id), /group first/);
});

test('presence follows runner liveness and busy means strictly more than four active sessions', (t) => {
  const f = fixture(t),
    [a, b] = f.members;
  for (let i = 0; i < 4; i++) f.session(a.id);
  assert.equal(memberPresence(f.host, a).presence, 'online');
  f.session(a.id);
  assert.deepEqual(memberPresence(f.host, a), { presence: 'busy', activeSessions: 5 });
  const remote = f.store.updateMember(b.id, { runnerId: f.nodes[0].id });
  assert.equal(memberPresence(f.host, remote).presence, 'offline');
  f.nodes[0].online = true;
  f.nodes[0].ready = true;
  assert.equal(memberPresence(f.host, remote).presence, 'online');
  f.host.closing = true;
  assert.equal(memberPresence(f.host, a).presence, 'offline');
});

test('offline and busy mentions route once to an online eligible peer, never outside the roster', (t) => {
  const f = fixture(t),
    [a, b, c] = f.members;
  f.store.updateMember(b.id, { runnerId: f.nodes[0].id });
  for (let i = 0; i < 5; i++) f.session(a.id);
  const message = f.post('@Vega @Atlas check this', c.id);
  const routed = f.store
    .all<any>('meshNotification')
    .filter((entry) => entry.messageId === message.id);
  assert.equal(routed.length, 1, 'two unavailable targets coalesce to one recipient');
  assert.equal(routed[0].memberId, a.id, 'all other eligible teammates are busy');
  f.nodes[0].online = true;
  f.nodes[0].ready = true;
  const next = f.post('@Atlas check this', c.id);
  const routedNext = f.store
    .all<any>('meshNotification')
    .find((entry) => entry.messageId === next.id);
  assert.equal(routedNext.memberId, b.id, 'busy is avoided when an online teammate is available');
  assert.equal(f.store.all('meshDispatch').length, 0, 'notifications do not spawn turns');
  f.store.updateMember(a.id, { status: 'offline' });
  f.nodes[0].online = false;
  const self = f.post('@Vega Please check this', c.id);
  assert.equal(
    f.store.all<any>('meshNotification').find((entry) => entry.messageId === self.id).memberId,
    c.id,
    'a sender receives its undeliverable mention when no other teammate is eligible',
  );
});

test('human heartbeat expires and feedback remains durable, author-scoped, and never grants approvals', (t) => {
  const f = fixture(t),
    [a, b] = f.members;
  f.mesh.heartbeat(f.project.id);
  assert.equal(humanPresence(f.store)[0].status, 'online');
  f.store.put('humanPresence', {
    id: f.project.id,
    lastSeen: new Date(Date.now() - 46_000).toISOString(),
  });
  assert.equal(humanPresence(f.store)[0].status, 'offline');
  const session = f.session(a.id, 'idle');
  const message = f.mesh.post({
    projectId: f.project.id,
    authorId: a.id,
    sessionId: session.id,
    kind: 'progress',
    content: 'Review ready',
  });
  const up = f.mesh.react(message.id, 'up');
  assert.equal(up.reactions?.[0].meaning, 'agree');
  assert.equal(up.requestStatus, undefined);
  assert.equal(f.mesh.signals(f.project.id, a.id, session.id).feedback.length, 1);
  assert.equal(f.mesh.signals(f.project.id, b.id).feedback.length, 0);
  assert.equal(f.mesh.signals(f.project.id, a.id, 'different-session').feedback.length, 0);
  assert.equal(f.store.all('approval').length, 0);
  new Mesh(f.host);
  const pending = f.mesh.signals(f.project.id, a.id, session.id);
  assert.equal(pending.feedback.length, 1);
  f.mesh.deliveredSignals(pending);
  assert.equal(f.mesh.signals(f.project.id, a.id, session.id).feedback.length, 0);
  f.mesh.react(message.id, 'up');
  assert.equal(f.mesh.signals(f.project.id, a.id, session.id).feedback[0].removed, true);
  f.mesh.react(message.id, 'heart');
  f.mesh.react(message.id, 'down');
  assert.deepEqual(
    f.store.get<any>('message', message.id).reactions.map((entry: any) => entry.meaning),
    ['understood', 'disagree'],
  );
});

test('slash commands validate real catalogs and persist configuration for future prompts', (t) => {
  const f = fixture(t);
  const catalog: CodexModel[] = [
    {
      id: 'catalog-id',
      model: 'supported-model',
      displayName: 'Supported',
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: '' },
        { reasoningEffort: 'high', description: '' },
      ],
    },
  ];
  const post = (content: string) =>
    f.mesh.post({ projectId: f.project.id, authorId: null, kind: 'message', content }, catalog);
  assert.throws(() => post('/model imaginary'), /available model/);
  assert.equal(post('/model supported-model').requestStatus, 'done');
  assert.equal(post('/reasoning high').requestStatus, 'done');
  assert.throws(() => post('/reasoning imaginary'), /supported/);
  assert.equal(post('/skills writing').requestStatus, 'done');
  assert.throws(() => post('/skills steal-credentials'), /not installed/);
  assert.throws(() => post('/not-installed Build it'), /Unknown command/);
  const goal = post('/goal Build a useful prototype');
  assert.equal(goal.requestStatus, 'open');
  assert.equal(f.store.get<Project>('project', f.project.id).goal, 'Build a useful prototype');
  assert.deepEqual(goal.effectiveConfig, {
    model: 'supported-model',
    reasoningEffort: 'high',
    skills: ['writing'],
  });
  assert.deepEqual(post('/writing Draft a pitch').effectiveConfig, goal.effectiveConfig);
  const agent = f.post('/model attacker-choice', f.members[0].id);
  assert.equal(agent.command, undefined);
  assert.equal(f.store.get<Project>('project', f.project.id).chatConfig?.model, 'supported-model');
});

test('prompt routing observes roster, live machine, skills and busy load, passing effective settings into the real session adapter', async (t) => {
  const f = fixture(t),
    [a, b, c] = f.members;
  f.store.updateMember(a.id, { runnerId: f.nodes[0].id });
  for (let i = 0; i < 5; i++) f.session(b.id);
  const calls: any[] = [];
  const dispatcher = new InboxDispatcher({
    ...f.host,
    mesh: f.mesh,
    quota: { refresh: async () => {}, assertCanRun: () => {} },
    sessions: {
      create: async (options) => {
        calls.push(options);
        return f.session(options.memberId, 'idle');
      },
    },
  });
  t.after(() => dispatcher.close());
  f.store.put('project', {
    ...f.project,
    chatConfig: { model: 'real-model', reasoningEffort: 'high', skills: ['writing'] },
  });
  const message = f.post('@Atlas @Vega Please inspect the brief');
  await Promise.all([dispatcher.dispatch(f.project.id), dispatcher.dispatch(f.project.id)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].memberId, c.id);
  assert.equal(calls[0].model, 'real-model');
  assert.equal(calls[0].reasoningEffort, 'high');
  assert.equal(calls[0].modelPolicy, 'manual');
  assert.deepEqual(calls[0].skills, ['writing']);
  assert.equal(f.store.get<any>('message', message.id).claimedBy, c.id);
});
