import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Mesh } from '../server/mesh.ts';
import { InboxDispatcher } from '../server/inbox.ts';
import type { CodexSession, Project, RoomMessage } from '../shared/types.ts';

function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Inbox',
    path: 'C:/controlled/fixture',
    goal: 'Test dispatch without model calls.',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const member = store.addMember({ name: 'Vega', role: 'researcher' });
  store.updateMember(member.id, {
    account: { type: 'chatgpt', planType: 'plus' },
    status: 'ready',
    maxSessions: 2,
  });
  store.put('project', { ...project, memberIds: [member.id] });
  const mesh = new Mesh({ store });
  const calls: any[] = [];
  let allowed = true,
    failStart = false,
    gate: Promise<void> | null = null;
  const host = {
    store,
    closing: false,
    mesh,
    async validateChatConfig(
      _memberId: string,
      _config: { model?: string; reasoningEffort?: string },
    ) {},
    quota: {
      async refresh() {
        if (gate) await gate;
      },
      assertCanRun() {
        if (!allowed) throw new Error('Quota unknown or reserve protected.');
      },
    },
    sessions: {
      async send(id: string, prompt: string) {
        calls.push({ sessionId: id, prompt });
        return store.updateSession(id, { status: 'running' });
      },
      async resume(id: string) {
        calls.push({ resumed: id });
        return store.updateSession(id, { status: 'running', pausedFor: undefined });
      },
      async create(options: any): Promise<CodexSession> {
        calls.push(options);
        if (failStart) throw new Error('Controlled startup failed.');
        const now = new Date().toISOString();
        return store.put('session', {
          id: randomUUID(),
          memberId: options.memberId,
          projectId: options.projectId,
          taskId: randomUUID(),
          title: options.title,
          readOnly: options.readOnly,
          status: 'idle',
          threadId: 'controlled',
          turnId: 'turn',
          pid: null,
          error: null,
          createdAt: now,
          updatedAt: now,
        } satisfies CodexSession);
      },
    },
  };
  const dispatcher = new InboxDispatcher(host);
  t.after(async () => {
    await dispatcher.close();
    store.close();
  });
  const human = (content = '!! Research this request.') =>
    mesh.post({ projectId: project.id, authorId: null, kind: 'message', content });
  return {
    store,
    project,
    member,
    mesh,
    host,
    dispatcher,
    calls,
    human,
    blockQuota: () => {
      allowed = false;
    },
    failStart: () => {
      failStart = true;
    },
    delay: (promise: Promise<void>) => {
      gate = promise;
    },
  };
}

test('a human chat prompt is claimed once before a read-only session starts', async (t) => {
  const f = fixture(t),
    message = f.human();
  const create = f.host.sessions.create.bind(f.host.sessions);
  f.host.sessions.create = async (options) => {
    const claimed = f.store.get<RoomMessage>('message', message.id);
    assert.equal(claimed.requestStatus, 'claimed');
    assert.equal(claimed.claimedBy, f.member.id);
    return create(options);
  };
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].readOnly, true);
  assert.match(f.calls[0].prompt, /Read current group context/);
  assert.equal(f.store.get<RoomMessage>('message', message.id).requestStatus, 'done');
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 1);
});

test('an addressed follow-up steers the one active conversation and a reply resumes that same conversation', async (t) => {
  const f = fixture(t);
  f.human();
  await f.dispatcher.dispatch(f.project.id);
  const session = f.store.sessions()[0];
  f.store.updateSession(session.id, { status: 'running' });
  f.human('@Vega focus on installer reliability');
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].sessionId, session.id);
  assert.equal(f.store.sessions().length, 1);
  f.store.updateSession(session.id, { status: 'idle' });
  const answer = f.mesh.post({
    projectId: f.project.id,
    authorId: f.member.id,
    sessionId: session.id,
    kind: 'message',
    content: 'Here is the review.',
  });
  f.mesh.post({
    projectId: f.project.id,
    authorId: null,
    replyTo: answer.id,
    kind: 'message',
    content: 'Explain the first finding',
  });
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.at(-1).sessionId, session.id);
  assert.equal(f.store.sessions().length, 1);
});

test('only quota-paused conversations recover automatically; manual pause stays paused', async (t) => {
  const f = fixture(t);
  f.human();
  await f.dispatcher.dispatch(f.project.id);
  const session = f.store.sessions()[0];
  f.store.updateSession(session.id, { status: 'paused', pausedFor: 'quota' });
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.at(-1).resumed, session.id);
  assert.equal(f.store.sessions()[0].status, 'running');
  f.store.updateSession(session.id, { status: 'paused', pausedFor: undefined });
  const count = f.calls.length;
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, count);
  assert.equal(f.store.sessions()[0].status, 'paused');
});

test('manual pause during quota refresh fences automatic recovery', async (t) => {
  const f = fixture(t);
  f.human();
  await f.dispatcher.dispatch(f.project.id);
  const session = f.store.sessions()[0];
  f.store.updateSession(session.id, { status: 'paused', pausedFor: 'quota' });
  let release!: () => void;
  f.delay(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const dispatch = f.dispatcher.dispatch(f.project.id);
  await Promise.resolve();
  f.store.updateSession(session.id, { status: 'paused', pausedFor: undefined });
  release();
  await dispatch;
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.sessions()[0].status, 'paused');
});

test('agent progress and system messages cannot create model-turn ping-pong', async (t) => {
  const f = fixture(t);
  f.mesh.post({
    projectId: f.project.id,
    authorId: f.member.id,
    kind: 'message',
    content: '!! This is still an agent message.',
  });
  f.mesh.post({
    projectId: f.project.id,
    authorId: null,
    kind: 'system',
    content: 'System notice.',
  });
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.all('meshDispatch').length, 0);
});

test('unknown or protected quota leaves human requests queued without claiming or model usage', async (t) => {
  const f = fixture(t),
    message = f.human();
  f.blockQuota();
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.get<RoomMessage>('message', message.id).requestStatus, 'open');
  assert.equal(f.store.all('meshDispatch').length, 0);
});

test('concurrent dispatch calls share one claim and bounded pass starts at most four requests', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 7; i++) f.human(`Request ${i}`);
  await Promise.all([
    f.dispatcher.dispatch(f.project.id),
    f.dispatcher.dispatch(f.project.id),
    f.dispatcher.dispatch(f.project.id),
  ]);
  assert.equal(f.calls.length, 4);
  assert.equal(
    f.store.all<any>('meshDispatch').filter((entry) => entry.status === 'done').length,
    4,
  );
  assert.equal(
    f.store.all<RoomMessage>('message').filter((message) => message.requestStatus === 'open')
      .length,
    3,
  );
});

test('a failed startup preserves the claim and raises one human question without automatic retries', async (t) => {
  const f = fixture(t),
    message = f.human();
  f.failStart();
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.store.get<RoomMessage>('message', message.id).requestStatus, 'claimed');
  assert.equal(f.store.get<any>('meshDispatch', message.id).status, 'blocked');
  assert.equal(f.store.all('humanRequest').length, 1);
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.all('humanRequest').length, 1);
});

test('shutdown during quota preflight cannot claim or start a new session', async (t) => {
  const f = fixture(t),
    message = f.human();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.delay(gate);
  const dispatch = f.dispatcher.dispatch(f.project.id);
  await Promise.resolve();
  f.host.closing = true;
  const closing = f.dispatcher.close();
  release();
  await dispatch;
  await closing;
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.get<RoomMessage>('message', message.id).requestStatus, 'open');
});

test('restart preserves an uncertain startup as blocked and never automatically retries its prompt', async (t) => {
  const f = fixture(t),
    message = f.human();
  f.mesh.claim(message.id, f.member.id);
  f.store.put('meshDispatch', {
    id: message.id,
    projectId: f.project.id,
    memberId: f.member.id,
    status: 'starting',
    createdAt: new Date().toISOString(),
  });
  const restarted = new InboxDispatcher(f.host);
  await restarted.dispatch(f.project.id);
  assert.equal(f.store.get<any>('meshDispatch', message.id).status, 'blocked');
  assert.equal(f.calls.length, 0);
  await restarted.close();
});

test('mixed-provider chat checks model and reasoning before claiming and skips external Claude', async (t) => {
  const f = fixture(t);
  const gemini = f.store.addMember({ name: 'Gemini', provider: 'gemini', role: 'researcher' });
  const claude = f.store.addMember({
    name: 'Claude',
    provider: 'claude',
    integration: 'external',
    role: 'engineer',
  });
  for (const member of [gemini, claude])
    f.store.updateMember(member.id, { account: { type: 'controlled' }, status: 'ready' });
  f.store.put('project', { ...f.project, memberIds: [f.member.id, gemini.id, claude.id] });
  const inspected: string[] = [];
  f.host.validateChatConfig = async (memberId, config) => {
    inspected.push(memberId);
    assert.equal(config.reasoningEffort, 'high');
    if (memberId === gemini.id) throw new Error('Gemini does not support reasoning controls');
  };
  const message = f.human();
  f.store.put('message', {
    ...message,
    mentions: [gemini.id, claude.id],
    effectiveConfig: { model: 'controlled-codex', reasoningEffort: 'high' },
  });
  await f.dispatcher.dispatch(f.project.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].memberId, f.member.id);
  assert.deepEqual(inspected, [gemini.id, f.member.id]);
  assert.equal(f.store.get<RoomMessage>('message', message.id).claimedBy, f.member.id);
});
