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
  const mesh = new Mesh({ store });
  const calls: any[] = [];
  let allowed = true,
    failStart = false,
    gate: Promise<void> | null = null;
  const host = {
    store,
    closing: false,
    mesh,
    quota: {
      async refresh() {
        if (gate) await gate;
      },
      assertCanRun() {
        if (!allowed) throw new Error('Quota unknown or reserve protected.');
      },
    },
    sessions: {
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
