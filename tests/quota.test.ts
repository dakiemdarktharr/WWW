import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AccountQuota,
  CodexSession,
  HumanRequest,
  Project,
  QuotaGrant,
} from '../shared/types.ts';
import type { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { normalizeQuota, QuotaManager } from '../server/quota.ts';

const usage = (usedPercent: number, ordinaryUsageAllowed: boolean | null = true) => ({
  ordinaryUsageAllowed,
  rateLimits: {
    limitId: 'codex',
    limitName: 'Codex',
    primary: { usedPercent, windowDurationMins: 300, resetsAt: 2_000_000_000 },
  },
});

test('a queued human prompt raises one usage decision even before any runtime can start', async (t) => {
  const f = await fixture(t);
  for (const member of f.members) f.quota.ingest(member.id, usage(60));
  f.store.message({
    projectId: f.project.id,
    taskId: null,
    authorId: null,
    kind: 'message',
    content: 'Please help with this project.',
    requestStatus: 'open',
    claimedBy: null,
  });
  await f.quota.enforce();
  await f.quota.enforce();
  assert.equal(f.store.sessions().length, 0);
  const questions = f.store.all<HumanRequest>('humanRequest');
  assert.equal(questions.length, 1);
  assert.equal(questions[0].kind, 'quota');
  assert.equal(questions[0].projectId, f.project.id);
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-quota-test-'));
  const store = new Store(path.join(root, 'state.sqlite'));
  const project = store.put('project', {
    id: 'project-one',
    name: 'One',
    path: root,
    goal: '',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const other = store.put('project', { ...project, id: 'project-two', name: 'Two' });
  const members = ['Atlas', 'Vega'].map((name) => {
    const member = store.addMember({ name, role: 'engineer' });
    return store.updateMember(member.id, {
      status: 'ready',
      account: { type: 'chatgpt', planType: 'plus' },
    });
  });
  let response: unknown = usage(10),
    failure: Error | null = null,
    calls = 0;
  let gate: Promise<void> | null = null;
  const client = {
    start: async () => {},
    request: async () => {
      calls++;
      if (gate) await gate;
      if (failure) throw failure;
      return response;
    },
  } as unknown as CodexClient;
  const interrupted: string[] = [],
    automatic: string[] = [];
  const host = {
    store,
    closing: false,
    client: async () => client,
    log: () => {},
    sessions: {
      interrupt: async (id: string) => {
        interrupted.push(id);
        return store.updateSession(id, { status: 'paused', pid: null });
      },
    },
    handoffs: {
      automatic: async (id: string) => {
        automatic.push(id);
      },
    },
  };
  const quota = new QuotaManager(host);
  t.after(async () => {
    await quota.close();
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-quota-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  return {
    store,
    quota,
    project,
    other,
    members,
    interrupted,
    automatic,
    host,
    get calls() {
      return calls;
    },
    response(value: unknown) {
      response = value;
    },
    fail(error: Error | null) {
      failure = error;
    },
    gate(value: Promise<void> | null) {
      gate = value;
    },
    session(id: string, memberId = members[0].id, projectId = project.id, readOnly = false) {
      return store.put('session', {
        id,
        memberId,
        projectId,
        taskId: `task-${id}`,
        title: id,
        status: 'running',
        readOnly,
        threadId: `thread-${id}`,
        turnId: `turn-${id}`,
        pid: 10,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies CodexSession);
    },
  };
}

test('connector-only Claude does not raise or retain a runtime quota decision', async (t) => {
  const f = await fixture(t);
  for (const member of f.members)
    f.store.updateMember(member.id, {
      provider: 'claude',
      integration: 'external',
      account: { type: 'external', planType: 'unknown' },
    });
  f.store.message({
    projectId: f.project.id,
    taskId: null,
    authorId: null,
    kind: 'message',
    content: 'Read the shared project',
    requestStatus: 'open',
    claimedBy: null,
  });
  await f.quota.enforce();
  assert.equal(f.store.all<HumanRequest>('humanRequest').length, 0);
  f.store.put('humanRequest', {
    id: 'legacy-connector-quota',
    projectId: f.project.id,
    kind: 'quota',
    title: 'Team usage needs your decision',
    content: 'Atlas: unknown; usage unknown',
    status: 'open',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  } satisfies HumanRequest);
  await f.quota.enforce();
  assert.equal(
    f.store.get<HumanRequest>('humanRequest', 'legacy-connector-quota').status,
    'resolved',
  );
  assert.equal(f.interrupted.length, 0);
});

test('mixed roster quota decision includes only managed accounts and clears after recovery', async (t) => {
  const f = await fixture(t);
  f.store.updateMember(f.members[0].id, { provider: 'claude', integration: 'external' });
  f.quota.ingest(f.members[1].id, usage(60));
  f.store.message({
    projectId: f.project.id,
    taskId: null,
    authorId: null,
    kind: 'message',
    content: 'Help',
    requestStatus: 'open',
    claimedBy: null,
  });
  await f.quota.enforce();
  const request = f.store.all<HumanRequest>('humanRequest')[0];
  assert.ok(request);
  assert.match(request.content, /Vega/);
  assert.doesNotMatch(request.content, /Atlas/);
  f.quota.ingest(f.members[1].id, usage(10));
  await f.quota.enforce();
  assert.equal(f.store.get<HumanRequest>('humanRequest', request.id).status, 'resolved');
});

test('quota normalization preserves every provider bucket and applies the most restrictive window', () => {
  const quota = normalizeQuota('account', {
    ordinaryUsageAllowed: true,
    rateLimitsByLimitId: {
      codex: {
        limitName: 'Codex',
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000_000_000 },
        secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 2_000_100_000 },
      },
      review: { primary: { usedPercent: 5, windowDurationMins: null, resetsAt: null } },
    },
  });
  assert.equal(quota.windows.length, 3);
  assert.deepEqual(
    quota.windows.map((window) => window.remainingPercent),
    [75, 40, 95],
  );
  assert.equal(quota.status, 'reserve');
  assert.equal(quota.windows[1].windowMinutes, 10080);
  assert.equal(quota.windows[2].resetsAt, null);
  assert.equal(normalizeQuota('account', usage(50)).status, 'reserve');
  assert.equal(normalizeQuota('account', usage(49)).status, 'available');
});

test('unknown and malformed provider payloads never fabricate remaining usage', () => {
  assert.equal(normalizeQuota('account', null).status, 'unknown');
  const quota = normalizeQuota('account', {
    rateLimits: { primary: { usedPercent: Number.NaN }, secondary: { usedPercent: 101 } },
  });
  assert.equal(quota.status, 'unknown');
  assert.deepEqual(quota.windows, []);
  assert.equal(
    normalizeQuota('account', { ...usage(0), ordinaryUsageAllowed: false }).status,
    'blocked',
  );
  assert.equal(
    normalizeQuota('account', {
      rateLimits: { spendControlReached: true, primary: { usedPercent: 0 } },
    }).status,
    'blocked',
  );
});

test('sparse quota events merge windows and honor a top-level provider block', async (t) => {
  const f = await fixture(t),
    id = f.members[0].id;
  f.quota.ingest(id, {
    ...usage(10),
    rateLimits: {
      ...usage(10).rateLimits,
      secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 2_000_100_000 },
    },
  });
  f.quota.ingest(id, { primary: { usedPercent: 30 } }, true);
  assert.equal(f.quota.current(id).windows.length, 2);
  assert.equal(f.quota.current(id).windows[0].remainingPercent, 70);
  f.quota.ingest(id, { ordinaryUsageAllowed: false }, true);
  assert.equal(f.quota.current(id).status, 'blocked');
  assert.throws(() => f.quota.assertCanRun(id, f.project.id));
});

test('a provider false remains blocked through nullable reads until explicit recovery is reported', async (t) => {
  const f = await fixture(t),
    id = f.members[0].id;
  f.quota.ingest(id, usage(0, false));
  f.quota.ingest(id, usage(0, null));
  assert.equal(f.quota.current(id).ordinaryUsageAllowed, false);
  assert.equal(f.quota.current(id).status, 'blocked');
  assert.throws(() => f.quota.assertCanRun(id, f.project.id));
  f.quota.ingest(id, usage(0, true));
  assert.equal(f.quota.assertCanRun(id, f.project.id).status, 'available');
});

test('stale snapshots and invalid observation dates cannot authorize a new session', async (t) => {
  const f = await fixture(t),
    id = f.members[0].id;
  const fresh = f.quota.ingest(id, usage(5));
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  f.store.put('quota', { ...fresh, observedAt: old });
  const source = f.store.get<{ id: string; raw: unknown; observedAt: string }>('quotaSource', id);
  f.store.put('quotaSource', { ...source, observedAt: old });
  assert.equal(f.quota.current(id).status, 'stale');
  f.quota.ingest(id, { primary: { usedPercent: 6 } }, true);
  assert.equal(f.quota.current(id).status, 'stale');
  assert.throws(() => f.quota.assertCanRun(id, f.project.id), /stale/);
  f.store.put('quota', { ...fresh, observedAt: 'not-a-date' });
  assert.throws(() => f.quota.assertCanRun(id, f.project.id));
});

test('reserve grants bind account, project, floor and expiry without overriding provider hard blocks', async (t) => {
  const f = await fixture(t),
    id = f.members[0].id;
  f.quota.ingest(id, usage(60));
  assert.throws(() => f.quota.assertCanRun(id, f.project.id), /reserve/);
  const grant = f.quota.grant(id, {
    projectId: f.project.id,
    floor: 30,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(f.quota.assertCanRun(id, f.project.id).status, 'reserve');
  assert.throws(() => f.quota.assertCanRun(id, f.other.id), /reserve/);
  assert.throws(() => f.quota.assertCanRun(f.members[1].id, f.project.id), /Refresh account/);
  f.quota.ingest(id, usage(70));
  assert.throws(() => f.quota.assertCanRun(id, f.project.id), /30%/);
  f.quota.ingest(id, usage(60));
  f.store.put('quotaGrant', { ...grant, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.throws(() => f.quota.assertCanRun(id, f.project.id), /50%/);
  const second = f.quota.grant(id, {
    projectId: f.project.id,
    floor: 0,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  f.quota.ingest(id, usage(1, false));
  assert.throws(() => f.quota.assertCanRun(id, f.project.id));
  f.quota.ingest(id, usage(60, true));
  f.quota.revoke(second.id);
  assert.throws(() => f.quota.assertCanRun(id, f.project.id), /reserve/);
  for (const floor of [-1, 50, 100])
    assert.throws(() =>
      f.quota.grant(id, {
        projectId: f.project.id,
        floor,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
});

test('account-wide enforcement pauses every session across projects and creates one actionable project request', async (t) => {
  const f = await fixture(t),
    [a, b] = f.members;
  f.session('one', a.id);
  f.session('two', a.id, f.other.id);
  f.session('three', b.id, f.project.id, true);
  f.quota.ingest(a.id, usage(55));
  f.quota.ingest(b.id, usage(70));
  await f.quota.enforce();
  assert.deepEqual(new Set(f.interrupted), new Set(['one', 'two', 'three']));
  assert.deepEqual(new Set(f.automatic), new Set(['one', 'two', 'three']));
  assert.ok(f.store.sessions().every((session) => session.status === 'paused'));
  const requests = f.store.all<HumanRequest>('humanRequest');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.kind === 'quota' && request.status === 'open'));
  assert.match(requests[0].content, /45% remaining/);
  assert.match(requests[0].content, /reset/);
  await f.quota.enforce();
  assert.equal(f.store.all('humanRequest').length, 2);
  assert.equal(f.interrupted.length, 3);
});

test('concurrent refreshes use one provider read and failures preserve an honest unknown state', async (t) => {
  const f = await fixture(t),
    id = f.members[0].id;
  let release!: () => void;
  f.gate(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const first = f.quota.refresh(id),
    second = f.quota.refresh(id);
  release();
  await Promise.all([first, second]);
  assert.equal(f.calls, 1);
  assert.equal(f.quota.current(id).status, 'available');
  f.gate(null);
  f.fail(new Error('Usage read failed: Bearer sensitive-token'));
  await f.quota.refresh(id);
  assert.equal(f.quota.current(id).status, 'unknown');
  assert.doesNotMatch(f.quota.current(id).error!, /sensitive-token/);
  assert.throws(() => f.quota.assertCanRun(id, f.project.id));
});
