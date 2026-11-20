import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { CodexSession, Project, ProviderId, PlanTask, Task } from '../shared/types.ts';
import type { SharedMessage, SharedSadeRun, SharedTeammate } from '../shared/collaboration.ts';
import { SharedGroups } from '../server/collaboration.ts';
import { DesktopIdentity, type DesktopDevice } from '../server/desktop-auth.ts';
import {
  parseSharedGroupPlan,
  sharedPlanMemberRef,
  sharedSadeUpdates,
  type SharedDelivery,
  type SharedFinish,
} from '../server/group-sade.ts';
import { reviewDigest } from '../server/sade.ts';
import { Store } from '../server/store.ts';
import { sharedSadeCorpus } from './fixtures/shared-sade-corpus.ts';
import { mkdir, mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexClient } from '../server/codex.ts';
import { Workspace } from '../server/service.ts';
import { git } from '../server/git.ts';
import {
  canonicalSharedRepository,
  sharedGroupPlanningPrompt,
  sharedWorkerCommand,
} from '../server/shared-sade-worker.ts';
import { generateKeyPairSync } from 'node:crypto';
import { signMachineResult } from '../server/machine-signature.ts';
import { MachineExecutor } from '../server/machine-execution.ts';
import { startCrossHostBridge } from './fixtures/shared-sade-cross-host.ts';
import {
  pathProgram,
  portablePathProgram,
  smokeProgram,
} from './fixtures/shared-sade-path-check.ts';

const key = 'a'.repeat(64);
const sha = 'b'.repeat(40);
const fixtureGrantId = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const patch = {
  files: ['src/example.ts'],
  diff: '+export const value = 1;\n',
  stat: 'one file',
  truncated: false,
};
function fixture(
  providers: readonly [ProviderId, ProviderId] = ['gemini', 'codex'],
  options: {
    grantB?: boolean;
    turnsA?: number;
    turnsB?: number;
    mac?: boolean;
    key?: string;
    members?: string[];
    names?: [string, string];
    patchHandoff?: boolean;
    reviewRevision?: boolean;
    taskUpdates?: boolean;
    roleA?: 'researcher';
    allowWritesB?: boolean;
    roleB?: 'reviewer' | 'researcher';
  } = {},
) {
  const store = new Store(':memory:');
  const people = [
    { id: 'owner-A', name: 'An' },
    { id: 'owner-B', name: 'Bình' },
  ];
  const devices = [randomUUID(), randomUUID()];
  const members = options.members || [randomUUID(), randomUUID()];
  const grants = [randomUUID(), randomUUID()];
  const groupId = randomUUID();
  for (const [index, device] of devices.entries())
    store.put('desktopDevice', {
      id: device,
      owner: people[index],
      revoked: false,
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
      tokenHash: `private-token-hash-${index}`,
    });
  const groups = new SharedGroups(
    store,
    (value) => people.find((person) => person.id === value) || null,
  );
  const call = (index: number, action: object, deviceId = devices[index]) =>
    groups.execute(people[index], action, deviceId) as any;
  call(0, { action: 'create', id: groupId, name: 'Shared Sade fixture' });
  call(0, { action: 'invite', groupId, account: people[1].id });
  call(1, { action: 'accept', groupId });
  for (const [index, member] of members.entries()) {
    call(index, {
      action: 'teammates',
      groupId,
      teammates: [
        {
          localId: member,
          provider: providers[index],
          name: options.names?.[index] || (index ? 'Mây' : 'Bếp'),
        },
      ],
    });
    if (!index || options.grantB !== false)
      call(index, {
        action: 'sade-grant',
        groupId,
        id: grants[index],
        teammateId: member,
        projectKey: options.key || key,
        projectName: 'Fixture project',
        role: index ? options.roleB || 'reviewer' : options.roleA || 'engineer',
        platform: index && options.mac ? 'darwin' : 'win32',
        allowWrites: !index || options.allowWritesB !== false,
        ...(options.patchHandoff ? { patchHandoff: true } : {}),
        turns: (index ? options.turnsB : options.turnsA) ?? 8,
      });
  }
  const poll = (
    index: number,
    active: string[] = [],
    grantIds = [grants[index]],
    deviceId = devices[index],
    readUpdates: { jobId: string; through: number }[] = [],
    waitingForRevisions?: string[],
    rosterLookup?: true,
    waitingForMachineChecks?: string[],
  ) =>
    call(
      index,
      {
        action: 'sade-poll',
        grants: grantIds,
        active,
        unchangedRevisionScopes: true,
        referencedMessage: true,
        ...(options.patchHandoff ? { patchHandoff: true } : {}),
        ...(options.reviewRevision ? { reviewRevision: true } : {}),
        ...(rosterLookup ? { rosterLookup } : {}),
        ...(options.taskUpdates ? { taskUpdates: true, readUpdates } : {}),
        waitingForRevisions,
        waitingForMachineChecks,
      },
      deviceId,
    ) as {
      supportsReviewRevision?: true;
      supportsRosterLookup?: true;
      supportsReviewedRevisionFiles?: true;
      supportsUnchangedRevisionScopes?: true;
      supportsCapacityWait?: true;
      supportsMachineCheckWait?: true;
      delivery?: SharedDelivery;
      active: string[];
      revisionHandoff?: true;
      quotaFailover?: true;
      planQuotaFailover?: true;
      reviews: { jobId: string; digest: string }[];
      updates?: { jobId: string; notes: { sequence: number; text: string }[] }[];
    };
  const finish = (index: number, jobId: string, result: SharedFinish, updatesRead?: number) =>
    call(index, { action: 'sade-finish', jobId, result, updatesRead });
  const view = () =>
    call(0, { action: 'read', groupId }) as {
      sadeRuns: SharedSadeRun[];
      messages: { id: string }[];
    };
  return { store, call, poll, finish, view, groupId, grants, members, devices };
}

function work(key: string, patch: Partial<PlanTask> = {}): PlanTask {
  return {
    key,
    title: `Verify ${key} project output`,
    description: 'Carry out the scoped task and report a checkable result.',
    kind: 'research',
    effort: 1,
    scope: [`src/${key}.ts`],
    acceptance: 'Provide a concise result grounded in the shared project.',
    dependsOn: [],
    stage: 'Verify',
    ...patch,
  };
}

test('a lost poll response can retry the original delivery without spending another turn', (t) => {
  const f = fixture(undefined, { turnsA: 1 });
  t.after(() => f.store.close());
  const id = randomUUID();
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id,
    content: 'Nhờ Bếp lên kế hoạch kiểm tra trước khi giao việc.',
    sade: { projectKey: key },
  });
  const offer = f.poll(0).delivery;
  assert.ok(offer);
  const tracked = () =>
    f.store.get<{ id: string; jobs: { id: string; deadline: number }[] }>('sharedSadeRun', id);
  const originalDeadline = tracked().jobs[0].deadline;
  assert.equal(f.poll(0, [], f.grants, randomUUID()).delivery, undefined);
  assert.equal(f.poll(1, [], f.grants).delivery, undefined);
  assert.deepEqual(f.poll(0).delivery, offer);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
  assert.equal(tracked().jobs[0].deadline, originalDeadline);
  assert.ok(tracked().jobs[0].deadline > Date.now() + 30_000);
  assert.doesNotMatch(JSON.stringify(f.view()), /awaitingReceipt|deadline/);
  const admitted = f.poll(0, [offer.id]);
  assert.deepEqual(admitted.active, [offer.id]);
  assert.equal(admitted.delivery, undefined);
  assert.ok(tracked().jobs[0].deadline <= Date.now() + 30_000);
  assert.equal(f.poll(0).delivery, undefined);
  const expired = tracked();
  expired.jobs[0].deadline = 0;
  f.store.put('sharedSadeRun', expired);
  assert.equal(f.poll(0).delivery, undefined);
  assert.equal(f.view().sadeRuns[0].state, 'blocked');
});

test('one Shared Sade message can refer to one earlier message and hand off a read-only task', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const id = randomUUID();
  const replyTo = randomUUID();
  const reference = `Mây đã commit ${sha} cho docs/contract.md. Chỉ kiểm bản hiện có.`;
  const message = {
    action: 'message',
    groupId: f.groupId,
    id: replyTo,
    content: `${reference} sk-fakeCredentialFixtureOnly`,
  };
  f.call(1, message);
  f.call(1, { ...message, id: randomUUID(), content: 'Chuyện khác. WRONG_NEIGHBOR' });
  const request = {
    ...message,
    id,
    content: 'cái đó tui đã commit rồi, nhờ Mây xem lại dùm, đừng sửa',
    sade: { projectKey: key, readOnly: true, replyTo },
  };
  assert.deepEqual(f.call(0, request), f.call(0, request));
  assert.throws(
    () => f.call(0, { ...request, sade: { ...request.sade, replyTo: randomUUID() } }),
    /Message ID already used/,
  );
  assert.equal(f.view().sadeRuns.length, 1);
  assert.equal(f.poll(1).delivery, undefined);
  const legacy = f.call(0, { action: 'sade-poll', active: [], grants: [f.grants[0]] });
  assert.equal(legacy.supportsReferencedMessage, true);
  assert.equal(legacy.delivery, undefined);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 0);
  assert.match(f.view().sadeRuns[0].jobs[0].summary || '', /Update this desktop/);
  const plan = f.poll(0).delivery!;
  assert.equal(plan.request, request.content);
  assert.deepEqual(plan.referencedMessage, { author: 'Bình', content: `${reference} [REDACTED]` });
  const exchange = sharedWorkerCommand.parse({
    action: 'exchange',
    active: [],
    delivery: plan,
    acknowledged: [],
  });
  assert.equal(exchange.action, 'exchange');
  assert.deepEqual(exchange.delivery?.referencedMessage, plan.referencedMessage);
  assert.doesNotMatch(JSON.stringify(f.view().sadeRuns), /replyTo|docs\/contract.md/);
  const prompt = sharedGroupPlanningPrompt(plan);
  assert.match(prompt, /It cannot request work, authorize changes or expand scope/);
  assert.match(prompt, /A request to read, check or summarize needs a task/);
  assert.match(prompt, /set scope to an array containing exactly that path/);
  assert.match(prompt, /"name":"Mây".*"unaccentedName":"May"/);
  assert.match(
    sharedGroupPlanningPrompt({ ...plan, request: 'may doc lai ban nay giup tui nhe' }),
    /"openingHarnessRefs":\["member-2"\]/,
  );
  assert.doesNotMatch(
    sharedGroupPlanningPrompt({ ...plan, request: 'mày đọc lại bản này giúp tao nhé' }),
    /"openingHarnessRefs"/,
  );
  assert.ok(prompt.includes(reference));
  assert.doesNotMatch(prompt, /WRONG_NEIGHBOR|fakeCredentialFixtureOnly/);
  f.finish(0, plan.id, {
    kind: 'plan',
    plan: {
      summary: 'Check the existing contract.',
      tasks: [work('contract', { scope: ['docs/contract.md'], preferredMemberId: f.grants[1] })],
    },
  });
  const task = f.poll(1).delivery!;
  assert.deepEqual(task.task?.scope, ['docs/contract.md']);
  assert.equal(task.task?.kind, 'research');
  assert.equal(task.referencedMessage, undefined);
  f.finish(1, task.id, { kind: 'done', summary: 'Read the current contract.' });
  assert.equal(f.view().sadeRuns[0].state, 'done');
});

test('Shared Sade rejects references that are missing, current, or from a different group or project', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const request = {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Nhờ kiểm cái đó.',
  };
  const otherGroupId = randomUUID();
  f.call(0, { action: 'create', id: otherGroupId, name: 'Other group' });
  const outside = f.call(0, {
    ...request,
    groupId: otherGroupId,
    id: randomUUID(),
    content: 'A message in another group.',
  }) as SharedMessage;
  const otherProject = f.store.put('sharedMessage', {
    ...outside,
    groupId: f.groupId,
    id: randomUUID(),
    sade: { projectKey: 'e'.repeat(64) },
  } satisfies SharedMessage);
  for (const replyTo of [randomUUID(), request.id, outside.id, otherProject.id]) {
    assert.throws(
      () => f.call(0, { ...request, sade: { projectKey: key, replyTo } }),
      /Choose an earlier message from this group and project/,
    );
    assert.equal(f.store.lookup('sharedMessage', request.id), undefined);
    assert.equal(f.store.lookup('sharedSadeRun', request.id), undefined);
  }
});

for (const kind of ['research', 'code'] as const) {
  test(`Shared Sade enforces a request's read-only setting for a ${kind} plan`, (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Đọc và tóm tắt src/check.ts, chỉ xem thôi.',
      sade: { projectKey: key, readOnly: true },
    };
    f.call(0, request);
    f.call(0, request);
    assert.throws(() => f.call(0, { ...request, sade: { projectKey: key } }), /ID already used/);
    const planner = f.poll(0).delivery!;
    assert.ok(planner.team.length > 0);
    assert.ok(planner.team.every((member) => !member.allowWrites && !member.pairedPlatform));
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Inspect the requested file.',
        tasks: [work('check', { kind, preferredMemberId: f.grants[1] })],
      },
    });
    assert.equal(f.view().messages.length, 1);
    if (kind === 'code') {
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
      assert.match(f.view().sadeRuns[0].error || '', /read.only/i);
      assert.equal(f.poll(1).delivery, undefined);
    } else {
      const task = f.poll(1).delivery!;
      assert.equal(task.task?.kind, 'research');
      assert.deepEqual(task.task?.scope, ['src/check.ts']);
      f.finish(1, task.id, { kind: 'done', summary: 'Read and summarized the original file.' });
      assert.equal(f.view().sadeRuns[0].state, 'done');
    }
  });
}

test('a group read reports a lost desktop while the remaining lease still fences new work', (t) => {
  const f = fixture(undefined, { turnsB: 1 });
  t.after(() => f.store.close());
  const message = {
    action: 'message',
    groupId: f.groupId,
    content: 'Mỗi người xem một file trong project giúp mình.',
    sade: { projectKey: key },
  };
  const original = randomUUID();
  f.call(0, { ...message, id: original });
  const plan = f.poll(0).delivery!;
  f.finish(0, plan.id, {
    kind: 'plan',
    plan: {
      summary: 'Two authorized teammates inspect separate files.',
      tasks: [
        work('first', { preferredMemberId: f.grants[0] }),
        work('second', { preferredMemberId: f.grants[1] }),
      ],
    },
  });
  const tasks = [f.poll(0).delivery!, f.poll(1).delivery!];
  assert.equal(f.view().sadeRuns[0].state, 'running');
  const expire = (jobId: string) => {
    const record = f.store.get<{ id: string; jobs: { id: string; deadline?: number }[] }>(
      'sharedSadeRun',
      original,
    );
    record.jobs.find((job) => job.id === jobId)!.deadline = Date.now() - 1;
    f.store.put('sharedSadeRun', record);
  };
  const retry = { ...message, id: randomUUID(), content: 'Thử xem lại hai file giúp mình.' };
  expire(tasks[0].id);
  assert.throws(() => f.call(0, retry), /active Sade request/);
  const peer = f.call(1, { action: 'read', groupId: f.groupId });
  assert.equal(peer.messages.length, 1);
  assert.equal(peer.sadeRuns[0].state, 'blocked');
  assert.match(peer.sadeRuns[0].error, /lost contact/);
  assert.equal(
    peer.sadeRuns[0].jobs.find(({ id }: { id: string }) => id === tasks[0].id)?.state,
    'blocked',
  );
  assert.throws(() => f.call(0, retry), /previous Sade request is stopping/);
  assert.throws(
    () =>
      f.finish(0, tasks[0].id, { kind: 'done', summary: 'Late result from the offline desktop.' }),
    /no longer running/,
  );

  expire(tasks[1].id);
  f.call(0, retry);
  f.call(0, retry);
  assert.equal(f.view().messages.length, 2);
  assert.deepEqual(
    f.view().sadeRuns.map(({ state }) => state),
    ['blocked', 'planning'],
  );
  assert.throws(
    () => f.finish(1, tasks[1].id, { kind: 'done', summary: 'Late result from the old run.' }),
    /no longer running/,
  );
  const next = f.poll(0).delivery!;
  assert.equal(next.phase, 'plan');
  assert.equal(next.request, retry.content);
  assert.notEqual(next.id, plan.id);
});

test('a group read reports that a queued harness grant expired before it could start', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const id = randomUUID();
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id,
    content: 'Nhờ Bếp kiểm tra hợp đồng trước nha.',
    sade: { projectKey: key },
  });
  const grant = f.store.get<{ id: string; used: number; expiresAt: number }>(
    'sharedSadeGrant',
    f.grants[0],
  );
  assert.equal(grant.used, 0);
  f.store.put('sharedSadeGrant', { ...grant, expiresAt: Date.now() - 1 });
  const view = f.view();
  assert.equal(view.sadeRuns[0].state, 'blocked');
  assert.match(view.sadeRuns[0].error || '', /grant ended/);
  assert.equal(f.poll(0).delivery, undefined);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', grant.id).used, 0);
});

test('1,000 distinct Shared Groups messages pass the admission and routing contract with controlled planner outputs', () => {
  const cases = sharedSadeCorpus();
  assert.equal(new Set(cases.map((item) => item.message)).size, 1000);
  const passed: typeof cases = [];
  for (const item of cases) {
    const f = fixture(item.providers, {
      grantB: item.scenario !== 'no-access',
      turnsA: item.grantedTurns[0],
      turnsB: item.grantedTurns[1],
      mac: item.scenario === 'platform',
    });
    try {
      const msgId = randomUUID();
      const message = {
        action: 'message',
        groupId: f.groupId,
        id: msgId,
        content: item.message,
        ...(item.scenario === 'chat' ? {} : { sade: { projectKey: key } }),
      };
      f.call(0, message);
      f.call(0, message);
      assert.equal(f.view().messages.length, 1);
      if (item.scenario === 'chat') {
        assert.equal(f.view().sadeRuns.length, 0);
        assert.equal(f.poll(0).delivery, undefined);
      } else {
        assert.equal(f.view().sadeRuns.length, 1);
        const plan = f.poll(0).delivery!;
        assert.equal(plan.phase, 'plan');
        assert.equal(plan.request, item.message.trim());
        if (item.scenario === 'lost') assert.deepEqual(f.poll(0).delivery, plan);
        assert.deepEqual(f.poll(0, [plan.id]).active, [plan.id]);
        assert.equal(f.poll(0).delivery, undefined, 'Do not redeliver an acknowledged turn');
        const [a, b] = f.grants;
        if (item.scenario === 'lost') {
          // Simulate a persisted lease deadline after desktop loss. Never start it twice.
          const current = f.store.get<any>('sharedSadeRun', msgId);
          current.jobs[0].deadline = 0;
          f.store.put('sharedSadeRun', current);
          assert.equal(f.poll(0).delivery, undefined);
          assert.equal(f.view().sadeRuns[0].state, 'blocked');
          passed.push(item);
          continue;
        }
        const tasks =
          item.scenario === 'budget'
            ? [work('one', { preferredMemberId: b }), work('two', { preferredMemberId: b })]
            : item.scenario === 'platform' || item.scenario === 'no-platform'
              ? [work('mac', { requiredPlatform: 'darwin' })]
              : item.scenario === 'handoff'
                ? [
                    work('arch', { preferredMemberId: a }),
                    work('ui', { preferredMemberId: b, dependsOn: ['arch'] }),
                  ]
                : item.scenario === 'review'
                  ? [work('implementation', { kind: 'code', preferredMemberId: a, scope: ['src'] })]
                  : item.scenario === 'scope'
                    ? [
                        work('one', { kind: 'code', preferredMemberId: a, scope: ['src'] }),
                        work('two', {
                          kind: 'code',
                          preferredMemberId: b,
                          scope: ['src/example.ts'],
                        }),
                      ]
                    : [work('verify', { preferredMemberId: b })];
        const plannedReview =
          item.scenario === 'review' &&
          ['informal-no-accents', 'expert-bilingual'].includes(item.style);
        if (plannedReview)
          tasks.push(
            work('peer-review', {
              kind: 'review',
              scope: ['src'],
              preferredMemberId: b,
              dependsOn: ['implementation'],
            }),
          );
        const summary = 'Controlled structured fixture authored independently of the allocator.';
        const roster = plan.team.map((member) => member.id);
        const actions = {
          code: 'edit-files',
          design: 'edit-design',
          research: 'research-read-only',
          review: 'review-read-only',
        };
        const proposed = {
          summary,
          tasks: tasks.map((task) => {
            const index = roster.indexOf(task.preferredMemberId || '');
            return {
              ...task,
              kind: actions[task.kind],
              preferredMemberId:
                index >= 0 ? sharedPlanMemberRef(index) : task.preferredMemberId || 'auto',
              requiredPlatform: task.requiredPlatform || 'any',
            };
          }),
        };
        if (item.scenario === 'no-access')
          assert.throws(() => parseSharedGroupPlan(proposed, roster), /teammate reference/);
        f.finish(0, plan.id, {
          kind: 'plan',
          plan:
            item.scenario === 'no-access'
              ? { summary, tasks }
              : parseSharedGroupPlan(proposed, roster),
        });
        if (['no-platform', 'no-access', 'budget'].includes(item.scenario)) {
          assert.equal(f.view().sadeRuns[0].state, 'blocked');
          assert.equal(f.poll(1).delivery, undefined);
        } else if (item.scenario === 'handoff') {
          assert.equal(f.poll(1).delivery, undefined);
          const arch = f.poll(0).delivery!;
          assert.equal(arch.task?.key, 'arch');
          f.finish(0, arch.id, { kind: 'done', summary: 'Data contract verified by Bếp.' });
          const frontend = f.poll(1).delivery!;
          assert.equal(frontend.task?.key, 'ui');
          assert.match(frontend.prerequisites[0].summary!, /Data contract/);
          f.finish(1, frontend.id, {
            kind: 'done',
            summary: 'Mây used the contract to verify the interface.',
          });
          assert.equal(f.view().sadeRuns[0].state, 'done');
        } else if (item.scenario === 'scope' || item.scenario === 'review') {
          const writer = f.poll(0).delivery!;
          assert.equal(
            f.poll(1).delivery,
            undefined,
            'No overlapping writer and no self-selected reviewer',
          );
          assert.throws(
            () =>
              f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Unreviewed claim' }),
            /independent review/,
          );
          f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'Validated change' });
          const reviewer = f.poll(1).delivery!;
          assert.equal(reviewer.phase, 'review');
          if (plannedReview) assert.equal(reviewer.task?.key, 'peer-review');
          assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', b).used, 1);
          assert.equal(f.view().sadeRuns[0].jobs.filter((job) => job.phase === 'review').length, 1);
          assert.equal(reviewer.review?.diff, patch.diff);
          assert.throws(
            () =>
              f.finish(0, reviewer.id, {
                kind: 'review',
                verdict: 'approved',
                summary: 'Wrong owner',
              }),
            /grant/,
          );
          f.finish(1, reviewer.id, {
            kind: 'review',
            verdict: 'approved',
            summary: 'Checked the bounded patch.',
          });
          assert.equal(f.poll(0, [writer.id]).reviews[0].digest, reviewDigest(patch));
          f.finish(0, writer.id, {
            kind: 'done',
            revision: sha,
            summary: 'Integrated reviewed revision',
          });
          if (item.scenario === 'scope') assert.equal(f.poll(1).delivery?.task?.key, 'two');
          else {
            assert.equal(f.view().sadeRuns[0].state, 'done');
            assert.equal(f.poll(1).delivery, undefined);
          }
        } else {
          const assigned = f.poll(1).delivery!;
          assert.equal(assigned.grantId, b);
          if (item.scenario === 'revoked') {
            f.call(1, { action: 'sade-revoke', groupId: f.groupId, grantId: b });
            assert.deepEqual(f.poll(1, [assigned.id]).active, []);
            assert.throws(
              () => f.finish(1, assigned.id, { kind: 'done', summary: 'Late result' }),
              /grant/,
            );
            assert.equal(f.view().sadeRuns[0].state, 'blocked');
          } else {
            assert.equal(assigned.task?.requiredPlatform, 'darwin');
            f.finish(1, assigned.id, {
              kind: 'done',
              summary: 'Controlled macOS grant fixture, not macOS execution.',
            });
            assert.equal(f.view().sadeRuns[0].state, 'done');
          }
        }
      }
      assert.doesNotMatch(JSON.stringify(f.view()), /private-token-hash|"deviceId"/);
      passed.push(item);
    } catch (error) {
      throw new Error(`${item.id}: ${item.message}`, { cause: error });
    } finally {
      f.store.close();
    }
  }
  assert.equal(passed.length, 1000);
  const countBy = (labelFor: (item: (typeof cases)[number]) => string) => {
    const counts: Record<string, number> = {};
    for (const item of passed) {
      const label = labelFor(item);
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return counts;
  };
  console.log(
    'Shared Sade corpus (fixture, not live model semantics):',
    JSON.stringify({
      passed: passed.length,
      byScenario: countBy((item) => item.scenario),
      byStyle: countBy((item) => item.style),
      byProviderPlanPair: countBy((item) =>
        item.providers
          .map((provider, index) => `${provider} ${item.subscriptions[index]}`)
          .join(' / '),
      ),
    }),
  );
});

const crossHostOrigin = process.env.KIVUNO_CROSS_HOST_ORIGIN;

class DesktopPeer extends CodexClient {
  quotaUsedPercent = 10;
  override readonly provider;
  calls: { method: string; params: any }[] = [];
  responded?: { success: boolean; contentItems?: { text: string }[] };
  constructor(cwd: string, provider: ProviderId) {
    super({ home: cwd, cwd });
    this.provider = provider;
  }
  override async start() {}
  override async stop() {}
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.calls.push({ method, params });
    let value: unknown = {};
    if (method === 'account/read')
      value = {
        account: {
          type: this.provider === 'gemini' ? 'gemini-google' : 'chatgpt',
          email: 'provider-private@example.test',
        },
      };
    else if (method === 'account/rateLimits/read')
      value =
        this.provider === 'gemini' && this.quotaUsedPercent < 100
          ? { rateLimits: null }
          : {
              ordinaryUsageAllowed: true,
              rateLimits: {
                primary: {
                  usedPercent: this.quotaUsedPercent,
                  windowDurationMins: 300,
                  resetsAt: Math.floor(Date.now() / 1000) + 3600,
                },
              },
            };
    else if (method === 'model/list')
      value = {
        data: ['fixture', 'fixture-mini'].map((model, index) => ({
          id: model,
          model,
          displayName: model,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({
            reasoningEffort,
            description: reasoningEffort,
          })),
          isDefault: index === 0,
        })),
      };
    else if (method === 'thread/start' || method === 'thread/resume')
      value = {
        thread: { id: params.threadId || randomUUID() },
        model: params.model,
        reasoningEffort: params.config?.model_reasoning_effort,
        approvalsReviewer: 'user',
        approvalPolicy: 'on-request',
        sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' },
        ...(params.kivunoSharedGroup ? { kivunoSharedGroupToolsScoped: true } : {}),
        toolPolicy: { kind: 'scoped-mcp', readOnly: params.sandbox === 'read-only' },
      };
    else if (method === 'turn/start') value = { turn: { id: randomUUID() } };
    return value as T;
  }
  override respond(_id: string | number, value: any) {
    this.responded = value;
  }
}

test(
  'two desktop workspaces hand off reviewed code without a Git push and verify a consented paired runner',
  { timeout: crossHostOrigin ? 660000 : 60000 },
  async (t) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'shared-sade-e2e-')));
    const remote = path.join(root, 'bare');
    await mkdir(remote);
    await git(remote, ['init', '--bare', '-b', 'main']);
    const origin = 'https://example.test/shared/fixture.git';
    const fixtureIdentity = [
      '-c',
      'user.name=Shared fixture',
      '-c',
      'user.email=fixture@example.test',
    ];
    const setups: {
      workspace: Workspace;
      store: Store;
      repo: string;
      projectId: string;
      memberId: string;
      peers: Map<string, DesktopPeer>;
    }[] = [];
    let closeBridge: (() => Promise<void>) | undefined;
    t.after(async () => {
      await closeBridge?.();
      for (const entry of setups) {
        await entry.workspace.close();
        entry.store.close();
      }
      assert.equal(path.dirname(root), await realpath(os.tmpdir()));
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    });
    for (const [index, provider] of (['gemini', 'codex'] as const).entries()) {
      const repo = path.join(root, `project ${index}`);
      if (!index) {
        await mkdir(repo);
        await git(repo, ['init', '-b', 'main']);
        await writeFile(path.join(repo, 'README.md'), 'Shared project\n');
        if (crossHostOrigin) {
          await writeFile(path.join(repo, 'path-label.cjs'), pathProgram);
          await writeFile(path.join(repo, 'platform-smoke.cjs'), smokeProgram);
        }
        await git(repo, ['add', '.']);
        await git(repo, [...fixtureIdentity, 'commit', '-m', 'Initial']);
        await git(repo, ['remote', 'add', 'origin', remote]);
        await git(repo, ['push', '-u', 'origin', 'main']);
      } else await git(root, ['clone', '--', remote, repo]);
      await git(repo, ['remote', 'set-url', 'origin', origin]);
      await git(repo, ['config', `url.${remote}.insteadOf`, origin]);
      await writeFile(path.join(repo, '.env.local'), 'PRIVATE_TEST=local-only');
      await git(repo, ['config', 'core.excludesFile', path.join(root, 'ignore')]);
      await writeFile(path.join(root, 'ignore'), '.env.local\n');
      const data = path.join(root, `desktop-${index}`);
      await mkdir(data);
      const store = new Store(path.join(data, 'db.sqlite'));
      const workspace = new Workspace(store, data, repo);
      const member = store.addMember({
        name: index ? 'Mây' : 'Bếp',
        role: index ? 'reviewer' : 'engineer',
        provider,
      });
      const account = {
        type: provider === 'gemini' ? ('gemini-google' as const) : ('chatgpt' as const),
        email: 'provider-private@example.test',
      };
      store.updateMember(member.id, { status: 'ready', account });
      const projectId = randomUUID();
      store.put('project', {
        id: projectId,
        path: repo,
        name: 'Project fixture',
        goal: 'Shared project',
        memberIds: [member.id],
        createdAt: new Date().toISOString(),
      });
      const control = new DesktopPeer(repo, provider);
      workspace.client = async () => control;
      workspace.refresh = async () => store.get('member', member.id);
      const peers = new Map<string, DesktopPeer>();
      workspace.sessions.createClient = (session) => {
        const peer = new DesktopPeer(repo, provider);
        peers.set(session.id, peer);
        return peer;
      };
      setups.push({ workspace, store, repo, projectId, memberId: member.id, peers });
    }
    const fingerprint = canonicalSharedRepository(origin, 'main');
    assert.equal(
      fingerprint,
      canonicalSharedRepository('git@example.test:shared/fixture.git', 'main'),
    );
    const cloud = fixture(['gemini', 'codex'], {
      key: fingerprint,
      members: setups.map((entry) => entry.memberId),
      patchHandoff: true,
      reviewRevision: true,
      taskUpdates: true,
    });
    const remoteHead = () => git(root, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']);
    const startingRevision = await remoteHead();
    t.after(() => cloud.store.close());
    for (const [index, entry] of setups.entries()) {
      const grant = await entry.workspace.sharedSade.execute({
        action: 'grant',
        groupId: cloud.groupId,
        id: cloud.grants[index],
        projectId: entry.projectId,
        teammateId: entry.memberId,
        turns: 8,
        allowWrites: true,
      });
      assert.equal((grant as any).projectKey, fingerprint);
    }
    const grantCursors: (string | undefined)[] = [];
    const pump = async (index: number, response: 'deliver' | 'drop' | 'repeat' = 'deliver') => {
      const worker = setups[index].workspace.sharedSade;
      const hello = (await worker.execute({
        action: 'snapshot',
        grantCursor: grantCursors[index],
      })) as any;
      for (const result of hello.results)
        cloud.finish(index, result.jobId, result.result, result.updatesRead);
      const packet = cloud.poll(
        index,
        hello.active,
        hello.grants,
        cloud.devices[index],
        hello.readUpdates,
        hello.waitingForRevisions,
        true,
        hello.waitingForMachineChecks,
      );
      assert.equal(packet.supportsReviewRevision, true);
      assert.equal(packet.supportsRosterLookup, true);
      assert.equal(packet.supportsCapacityWait, true);
      assert.equal(packet.supportsMachineCheckWait, true);
      assert.doesNotMatch(
        JSON.stringify(packet),
        /provider-private|accessToken|tokenHash|projectId/,
      );
      if (response === 'drop') return packet.delivery;
      const exchange = {
        action: 'exchange',
        active: packet.active,
        delivery: packet.delivery,
        reviews: packet.reviews,
        updates: packet.updates,
        revisionHandoff: packet.revisionHandoff,
        unchangedRevisionScopes: packet.supportsUnchangedRevisionScopes,
        quotaFailover: packet.quotaFailover,
        planQuotaFailover: packet.planQuotaFailover,
        acknowledged: hello.results.map(
          ({ jobId, version }: { jobId: string; version: number }) => ({ jobId, version }),
        ),
      };
      await worker.execute(exchange);
      if (response === 'repeat') await worker.execute(exchange);
      grantCursors[index] = hello.nextGrantCursor;
      return packet.delivery;
    };
    async function sessionFor(index: number, job: SharedDelivery) {
      const entry = setups[index];
      const deadline = Date.now() + 25000;
      let nextHeartbeat = Date.now() + 2500;
      while (Date.now() < deadline) {
        const task = entry.store.tasks().find((item) => item.sharedSadeJobId === job.id);
        if (task?.turnId)
          return {
            task,
            session: entry.store.get<CodexSession>('session', task.sessionId!),
            peer: entry.peers.get(task.sessionId!)!,
          };
        if (Date.now() >= nextHeartbeat) {
          await pump(index);
          const blocked = cloud
            .view()
            .sadeRuns.find(
              (run) => run.state === 'blocked' && run.jobs.some(({ id }) => id === job.id),
            );
          if (blocked) throw new Error(`Harness could not start: ${blocked.error}`);
          nextHeartbeat = Date.now() + 2500;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(
        `Harness never started for ${job.phase}: ${JSON.stringify(await entry.workspace.sharedSade.execute({ action: 'snapshot' }))}`,
      );
    }
    const callTool = async (
      index: number,
      session: CodexSession,
      peer: DesktopPeer,
      tool: string,
      args: unknown,
    ) => {
      await setups[index].workspace.sessions.request(session.id, peer, {
        id: randomUUID(),
        method: 'item/tool/call',
        params: { threadId: session.threadId, turnId: session.turnId, tool, arguments: args },
      });
      return peer.responded;
    };
    const submit = async (...args: Parameters<typeof callTool>) => {
      const result = await callTool(...args);
      assert.equal(result?.success, true, JSON.stringify(result));
      return result;
    };
    const complete = async (
      index: number,
      session: CodexSession,
      peer: DesktopPeer,
      summary: string,
    ) => {
      const manager = setups[index].workspace.sessions;
      await manager.notification(session.id, peer, 'item/completed', {
        threadId: session.threadId,
        turnId: session.turnId,
        item: { type: 'agentMessage', text: summary },
      });
      await manager.notification(session.id, peer, 'turn/completed', {
        threadId: session.threadId,
        turn: { id: session.turnId, status: 'completed' },
      });
    };
    const extraGrants: string[] = [];
    const observerName = 'Trợ lý đối chiếu cuối danh sách';
    const receivingDesktop = setups[1];
    const observer = receivingDesktop.store.addMember({
      name: observerName,
      provider: 'codex',
      role: 'researcher',
    });
    receivingDesktop.store.updateMember(observer.id, {
      status: 'ready',
      account: { type: 'chatgpt', email: 'provider-private@example.test' },
    });
    const receivingProject = receivingDesktop.store.get<Project>(
      'project',
      receivingDesktop.projectId,
    );
    assert.ok(receivingProject.memberIds);
    receivingDesktop.store.put('project', {
      ...receivingProject,
      memberIds: [...receivingProject.memberIds, observer.id],
    });
    for (const [index, provider] of (['gemini', 'codex'] as const).entries()) {
      const teammates = Array.from({ length: 15 }, (_, slot) => ({
        localId: randomUUID(),
        provider,
        name:
          !index && slot === 14
            ? observerName
            : `Trợ lý đối chiếu tài liệu triển khai và giao diện số ${slot + 1}`,
      }));
      cloud.call(index, {
        action: 'teammates',
        groupId: cloud.groupId,
        teammates: [
          { localId: cloud.members[index], provider, name: index ? 'Mây' : 'Bếp' },
          ...teammates,
          ...(index ? [{ localId: observer.id, provider, name: observerName }] : []),
        ],
      });
      for (const { localId } of teammates) {
        const grantId = randomUUID();
        cloud.call(index, {
          action: 'sade-grant',
          groupId: cloud.groupId,
          id: grantId,
          teammateId: localId,
          projectKey: fingerprint,
          projectName: 'Fixture project',
          role: 'researcher',
          platform: process.platform,
          allowWrites: false,
          turns: 1,
        });
        extraGrants.push(grantId);
      }
    }
    const observerGrantId = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const observerConsent = {
      action: 'grant',
      groupId: cloud.groupId,
      id: observerGrantId,
      projectId: receivingDesktop.projectId,
      teammateId: observer.id,
      allowWrites: false,
      turns: 1,
    };
    receivingDesktop.store.updateMember(observer.id, { entitlementLocked: true });
    await assert.rejects(
      receivingDesktop.workspace.sharedSade.execute(observerConsent),
      /profile is locked/,
    );
    assert.equal(receivingDesktop.store.lookup('sharedSadeLocalGrant', observerGrantId), undefined);
    receivingDesktop.store.updateMember(observer.id, { entitlementLocked: false });
    const observerGrant = (await receivingDesktop.workspace.sharedSade.execute(
      observerConsent,
    )) as {
      projectKey: string;
      platform: string;
      role: string;
    };
    cloud.call(1, {
      action: 'sade-grant',
      groupId: cloud.groupId,
      id: observerGrantId,
      teammateId: observer.id,
      projectKey: observerGrant.projectKey,
      projectName: 'Fixture project',
      role: observerGrant.role,
      platform: observerGrant.platform,
      allowWrites: false,
      turns: 1,
    });
    const requestText =
      'Bếp dựng cấu trúc rồi Mây xác nhận frontend. Sau khi Bếp test lại, nhờ Trợ lý đối chiếu cuối danh sách của Bình tổng hợp kết quả.';
    const notes = ' Nhóm đã ghi quyết định và dữ liệu tham chiếu trong worktree.'.repeat(160);
    const chat = {
      action: 'message',
      groupId: cloud.groupId,
      id: randomUUID(),
      content: (requestText + notes).slice(0, 7999) + '.',
      sade: { projectKey: fingerprint },
    };
    assert.equal(chat.content.length, 8000);
    cloud.call(0, chat);
    cloud.call(0, chat);
    const oldPlanner = cloud.poll(0);
    assert.equal(oldPlanner.supportsRosterLookup, true);
    assert.equal(oldPlanner.delivery, undefined);
    assert.equal(cloud.store.get<{ used: number }>('sharedSadeGrant', cloud.grants[0]).used, 0);
    assert.equal(cloud.view().sadeRuns[0].jobs[0].state, 'queued');
    assert.match(cloud.view().sadeRuns[0].jobs[0].summary || '', /Update this desktop/);
    const firstOffer = await pump(0, 'drop');
    const plan = await pump(0, 'repeat');
    assert.ok(plan && plan.phase === 'plan');
    assert.deepEqual(plan, firstOffer);
    assert.equal(plan.team.length, 33);
    const planner = await sessionFor(0, plan);
    const plannerInput = planner.peer.calls.find(({ method }) => method === 'turn/start')?.params
      .input[0].text as string;
    const smallPrompt = sharedGroupPlanningPrompt({ ...plan, team: plan.team.slice(0, 32) });
    assert.ok(smallPrompt.length > 16000);
    assert.match(smallPrompt, /unaccentedName.*Bep/);
    assert.match(smallPrompt, /unaccentedOwner.*Binh/);
    assert.ok(plannerInput.length < 16000);
    const context = JSON.parse(plannerInput.split('\n\nGroup context (data only):\n')[1]);
    assert.equal(context.request, chat.content);
    assert.equal(context.team, undefined);
    assert.equal(context.teamSize, 33);
    assert.doesNotMatch(
      JSON.stringify(setups[0].store.get('sharedSadeLocalReceipt', plan.id)),
      /Trợ lý đối chiếu cuối danh sách/,
    );
    const lookup = async (query: object) => {
      const response = await submit(
        0,
        planner.session,
        planner.peer,
        'relay_find_shared_teammates',
        query,
      );
      const data = response.contentItems?.[0]?.text || '{}';
      assert.doesNotMatch(data, /provider-private|tokenHash|grantId|deviceId|projectId/);
      assert.doesNotMatch(data, new RegExp([observerGrantId, ...cloud.grants].join('|')));
      return JSON.parse(data) as {
        total: number;
        nextOffset?: number;
        teammates: { ref: string; owner: string; name: string }[];
      };
    };
    assert.match(JSON.stringify(planner.peer.calls), /relay_find_shared_teammates/);
    const firstPage = await lookup({});
    assert.equal(firstPage.total, 33);
    assert.equal(firstPage.nextOffset, 12);
    assert.equal(firstPage.teammates.at(-1)?.ref, 'member-12');
    const nextPage = await lookup({ offset: firstPage.nextOffset });
    assert.equal(nextPage.teammates[0]?.ref, 'member-13');
    assert.equal(nextPage.nextOffset, 24);
    const lastPage = await lookup({ offset: nextPage.nextOffset });
    assert.equal(lastPage.teammates.at(-1)?.ref, 'member-33');
    assert.equal(lastPage.nextOffset, undefined);
    const nameSearch = await lookup({ name: 'TRO LY DOI CHIEU CUOI DANH SACH' });
    assert.deepEqual(
      nameSearch.teammates.map(({ owner }) => owner),
      ['An', 'Bình'],
    );
    const ownedObserver = await lookup({
      name: observerName,
      owner: 'binh',
      ownedByRequester: false,
      provider: 'codex',
      platform: process.platform,
    });
    assert.equal(ownedObserver.total, 1);
    const observerRef = ownedObserver.teammates[0].ref;
    assert.equal(observerRef, 'member-33');
    await assert.rejects(
      setups[0].workspace.sessions.send(planner.session.id, 'a'.repeat(16_001)),
      /16,000/,
    );
    for (const [index, grantId] of extraGrants.entries())
      cloud.call(index < 15 ? 0 : 1, {
        action: 'sade-revoke',
        groupId: cloud.groupId,
        grantId,
      });
    assert.equal(planner.session.model, 'fixture');
    assert.equal(planner.session.reasoningEffort, 'high');
    assert.throws(
      () => setups[0].workspace.quota.assertCanRun(setups[0].memberId, setups[0].projectId),
      /bounded number/,
    );
    assert.throws(
      () => setups[0].workspace.sharedSade.consumeProviderTurn(plan.id),
      /already used/,
    );
    await assert.rejects(readFile(path.join(planner.task.worktree!, '.env.local')), {
      code: 'ENOENT',
    });
    const plannerCalls = JSON.stringify(planner.peer.calls);
    assert.doesNotMatch(plannerCalls, new RegExp(cloud.grants.join('|')));
    const validPlan = {
      summary: 'Build architecture then inspect the result in another harness.',
      tasks: [
        {
          ...work('architecture', {
            scope: ['architecture.txt'],
            preferredMemberId: 'member-1',
            acceptance: 'Keep credential fields out of the shared registration contract.',
          }),
          kind: 'edit-files',
        },
        {
          ...work('frontend', {
            scope: ['frontend.txt'],
            preferredMemberId: 'member-2',
            dependsOn: ['review-contract'],
            acceptance: 'The form preserves the agreed registration field names.',
          }),
          kind: 'edit-design',
        },
        {
          ...work('review-contract', {
            scope: ['architecture.txt'],
            preferredMemberId: 'member-2',
            dependsOn: ['architecture'],
            acceptance: 'Verify the registration field names match the agreed contract.',
          }),
          kind: 'review-read-only',
        },
        {
          ...work('verify-ui', {
            preferredMemberId: 'member-1',
            dependsOn: ['frontend'],
            effort: 4,
          }),
          kind: 'research-read-only',
        },
        {
          ...work('report-ui', {
            preferredMemberId: observerRef,
            dependsOn: ['verify-ui'],
          }),
          kind: 'research-read-only',
        },
      ].map((task) => ({ ...task, requiredPlatform: task.requiredPlatform || 'any' })),
    };
    const invalid = await callTool(0, planner.session, planner.peer, 'relay_submit_plan', {
      ...validPlan,
      tasks: validPlan.tasks.map((task) =>
        task.key === 'frontend' ? { ...task, dependsOn: ['member-1'] } : task,
      ),
    });
    assert.equal(invalid?.success, false);
    assert.match(invalid?.contentItems?.[0]?.text || '', /Unknown dependency/);
    assert.match(invalid?.contentItems?.[0]?.text || '', /Declared task keys: architecture/);
    assert.equal(cloud.view().sadeRuns[0].jobs.length, 1);
    await submit(0, planner.session, planner.peer, 'relay_submit_plan', validPlan);
    const lateQuestion = await callTool(
      0,
      planner.session,
      planner.peer,
      'relay_ask_shared_requester',
      {
        summary: 'Should the group change the architecture?',
      },
    );
    assert.equal(lateQuestion?.success, false);
    assert.match(lateQuestion?.contentItems?.[0]?.text || '', /already recorded/);
    assert.equal(planner.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    await complete(0, planner.session, planner.peer, 'Plan submitted.');
    const lostWriter = await pump(0, 'drop');
    const writer = (await pump(0, 'repeat'))!;
    assert.deepEqual(writer, lostWriter);
    const plannedReviewId = cloud
      .view()
      .sadeRuns[0].jobs.find((job) => job.task?.key === 'review-contract')?.id;
    assert.ok(plannedReviewId);
    assert.equal(await pump(1), undefined, 'Review waits for the author’s actual patch');
    assert.equal(writer.task?.key, 'architecture');
    assert.equal(writer.task?.kind, 'code');
    const author = await sessionFor(0, writer);
    const sendUpdate = (jobId: string, text: string) => ({
      action: 'sade-update-task',
      groupId: cloud.groupId,
      runId: chat.id,
      jobId,
      text,
      id: randomUUID(),
    });
    const architectureUpdate = sendUpdate(writer.id, 'Giữ đúng tên trường đăng ký trong contract.');
    assert.throws(() => cloud.call(1, architectureUpdate), /assigned harness owner/);
    cloud.call(0, architectureUpdate);
    cloud.call(0, architectureUpdate);
    assert.equal(cloud.view().sadeRuns[0].jobs.find((job) => job.id === writer.id)?.updateCount, 1);
    assert.equal(await pump(0), undefined);
    assert.equal(author.peer.calls.filter((call) => call.method === 'turn/steer').length, 0);
    const inboxHint = await submit(0, author.session, author.peer, 'workspace_read_file', {
      path: 'README.md',
    });
    assert.match(
      JSON.parse(inboxHint.contentItems?.[0]?.text || '{}').taskUpdate,
      /relay_read_shared_updates/,
    );
    const denied = await callTool(0, author.session, author.peer, 'workspace_write_file', {
      path: 'architecture.txt',
      content: 'stale',
    });
    assert.equal(denied?.success, false);
    assert.match(denied?.contentItems?.[0]?.text || '', /Read the latest task update/);
    const authorRead = await submit(
      0,
      author.session,
      author.peer,
      'relay_read_shared_updates',
      {},
    );
    assert.match(authorRead.contentItems?.[0]?.text || '', /Giữ đúng tên trường/);
    assert.equal(author.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    assert.equal(await pump(0), undefined);
    assert.equal(cloud.view().sadeRuns[0].jobs.find((job) => job.id === writer.id)?.updatesRead, 1);
    await writeFile(
      path.join(author.task.worktree!, 'architecture.txt'),
      'Draft contract needs correction\n',
    );
    await complete(0, author.session, author.peer, 'Architecture contract prepared.');
    const architectureRepo = setups[0].repo;
    const authorWorktree = author.task.worktree!;
    const authorHead = await git(authorWorktree, ['rev-parse', 'HEAD']);
    assert.equal(await pump(1), undefined);
    await assert.rejects(setups[0].workspace.accept(author.task.id), /Wait for independent/);
    await pump(0);
    let reviewer: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !reviewer; attempt++) {
      await pump(0);
      reviewer = await pump(1);
      if (!reviewer) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(reviewer && reviewer.phase === 'review');
    assert.equal(reviewer.id, plannedReviewId);
    const check = await sessionFor(1, reviewer);
    assert.equal(check.session.model, 'fixture');
    assert.equal(check.session.reasoningEffort, 'high');
    assert.match(JSON.stringify(check.peer.calls), /Draft contract needs correction/);
    assert.match(JSON.stringify(check.peer.calls), /Verify the registration field names/);
    await submit(1, check.session, check.peer, 'relay_submit_shared_review', {
      verdict: 'changes',
      summary: 'Use the approved registration fields in the contract.',
    });
    await complete(1, check.session, check.peer, 'Requested a scoped correction.');
    assert.equal(await pump(1), undefined);
    assert.throws(
      () =>
        cloud.finish(0, writer.id, {
          kind: 'done',
          revision: sha,
          summary: 'Stale attempt.',
        }),
      /unavailable/,
    );
    const lostRevision = await pump(0, 'drop');
    const revision = (await pump(0, 'repeat'))!;
    assert.deepEqual(revision, lostRevision);
    assert.equal(revision.reviewRevision?.previousJobId, writer.id);
    const revised = await sessionFor(0, revision);
    assert.equal(revised.task.id, author.task.id);
    assert.equal(revised.task.worktree, authorWorktree);
    assert.equal(revised.session.id, author.session.id);
    assert.notEqual(revised.session.turnId, author.session.turnId);
    assert.equal(revised.peer.calls.filter((call) => call.method === 'turn/start').length, 2);
    assert.match(JSON.stringify(revised.peer.calls), /Use the approved registration fields/);
    assert.equal(
      await readFile(path.join(authorWorktree, 'architecture.txt'), 'utf8'),
      'Draft contract needs correction\n',
    );
    cloud.call(0, sendUpdate(revision.id, 'Giữ tên trường đã duyệt trong bản sửa.'));
    await pump(0);
    const pending = await callTool(0, revised.session, revised.peer, 'workspace_write_file', {
      path: 'architecture.txt',
      content: 'This change missed the update.',
    });
    assert.equal(pending?.success, false);
    assert.match(pending?.contentItems?.[0]?.text || '', /Read the latest task update/);
    const revisionUpdate = await submit(
      0,
      revised.session,
      revised.peer,
      'relay_read_shared_updates',
      {},
    );
    assert.match(revisionUpdate.contentItems?.[0]?.text || '', /Giữ tên trường đã duyệt/);
    await writeFile(path.join(authorWorktree, 'architecture.txt'), 'Shared verified contract\n');
    await complete(0, revised.session, revised.peer, 'Revised the registration contract.');
    let repeatedReview: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !repeatedReview; attempt++) {
      await pump(0);
      repeatedReview = await pump(1);
      if (!repeatedReview) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(repeatedReview && repeatedReview.phase === 'review');
    assert.notEqual(repeatedReview.id, reviewer.id);
    assert.match(repeatedReview.review?.diff || '', /Shared verified contract/);
    await assert.rejects(setups[0].workspace.accept(author.task.id), /Wait for independent/);
    const finalReview = await sessionFor(1, repeatedReview);
    assert.equal(finalReview.session.model, 'fixture');
    assert.equal(finalReview.session.reasoningEffort, 'high');
    await submit(1, finalReview.session, finalReview.peer, 'relay_submit_shared_review', {
      verdict: 'approved',
      summary: 'The revised contract contains the approved fields.',
    });
    await complete(1, finalReview.session, finalReview.peer, 'Reviewed the revised patch.');
    await writeFile(path.join(architectureRepo, 'architecture.txt'), 'Shared verified contract\n');
    await git(architectureRepo, ['add', 'architecture.txt']);
    await git(architectureRepo, [...fixtureIdentity, 'commit', '-m', 'Existing architecture work']);
    const existingArchitecture = await git(architectureRepo, ['rev-parse', 'HEAD']);
    assert.equal(await pump(1), undefined, 'Dependency still needs local human integration');
    await pump(0);
    const authorContract = path.join(authorWorktree, 'architecture.txt');
    const reviewedContract = await readFile(authorContract);
    await writeFile(authorContract, 'Contract changed after independent review\n');
    await assert.rejects(
      setups[0].workspace.accept(author.task.id),
      /independent Shared Sade review of the current change/,
    );
    assert.equal(await git(architectureRepo, ['rev-parse', 'HEAD']), existingArchitecture);
    assert.equal(await git(authorWorktree, ['rev-parse', 'HEAD']), authorHead);
    assert.equal(await pump(1), undefined, 'The changed contract cannot reach dependent work');
    await writeFile(authorContract, reviewedContract);
    const accepted = await setups[0].workspace.accept(author.task.id);
    assert.match(accepted.summary || '', /already on the project branch/);
    assert.equal(await git(architectureRepo, ['rev-parse', 'HEAD']), existingArchitecture);
    assert.equal(await git(authorWorktree, ['rev-parse', 'HEAD']), authorHead);
    assert.equal(await remoteHead(), startingRevision);
    await assert.rejects(readFile(path.join(setups[1].repo, 'architecture.txt')), {
      code: 'ENOENT',
    });
    await pump(0);
    assert.match(
      cloud.view().sadeRuns[0].jobs.find((job) => job.id === revision.id)?.summary || '',
      /already on the project branch/,
    );
    assert.doesNotMatch(JSON.stringify(cloud.view()), /Shared verified contract/);
    const olderReceiver = cloud.call(1, {
      action: 'sade-poll',
      grants: [cloud.grants[1]],
      active: [],
    });
    assert.equal(olderReceiver.delivery, undefined);
    assert.match(
      cloud.view().sadeRuns[0].jobs.find((job) => job.task?.key === 'frontend')?.summary || '',
      /Update this desktop/,
    );
    const frontend = (await pump(1))!;
    assert.equal(frontend.task?.key, 'frontend');
    assert.equal(frontend.task?.kind, 'design');
    const contractPatch = frontend.prerequisites[0]?.patch;
    assert.ok(contractPatch);
    const reader = await sessionFor(1, frontend);
    assert.equal(reader.session.model, 'fixture');
    assert.deepEqual(
      receivingDesktop.store.get<{ importedPatchDigests?: string[] }>(
        'sharedSadeLocalReceipt',
        frontend.id,
      ).importedPatchDigests,
      [contractPatch.digest],
    );
    assert.equal(reader.session.reasoningEffort, 'medium');
    assert.match(
      await readFile(path.join(reader.task.worktree!, 'architecture.txt'), 'utf8'),
      /Shared verified contract/,
    );
    const frontendUpdate = sendUpdate(
      frontend.id,
      'Giữ contract đã duyệt và dùng nhãn form tiếng Việt.',
    );
    cloud.call(1, frontendUpdate);
    assert.equal(await pump(1), undefined);
    assert.equal(await pump(1), undefined);
    assert.equal(reader.peer.calls.filter((call) => call.method === 'turn/steer').length, 1);
    assert.equal(reader.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    const frontendRead = await submit(
      1,
      reader.session,
      reader.peer,
      'relay_read_shared_updates',
      {},
    );
    assert.match(frontendRead.contentItems?.[0]?.text || '', /nhãn form tiếng Việt/);
    await submit(1, reader.session, reader.peer, 'relay_ask_shared_requester', {
      summary: 'Bạn muốn chọn phong cách giao diện hay để Mây tự chọn?',
    });
    await complete(1, reader.session, reader.peer, 'Waiting for style preference.');
    for (
      let attempt = 0;
      attempt < 100 && !cloud.view().sadeRuns[0].jobs.some((job) => job.state === 'waiting');
      attempt++
    ) {
      assert.equal(await pump(1), undefined);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      cloud.view().sadeRuns[0].jobs.find((job) => job.id === frontend.id)?.state,
      'waiting',
    );
    const reply = {
      action: 'sade-answer',
      groupId: cloud.groupId,
      runId: chat.id,
      jobId: frontend.id,
      answer: 'Mây tự chọn phong cách nhé.',
    };
    assert.throws(() => cloud.call(1, reply), /request author/);
    cloud.call(0, reply);
    assert.throws(() => cloud.call(0, reply), /no longer waiting/);
    const continued = (await pump(1))!;
    assert.notEqual(continued.id, frontend.id);
    assert.equal(continued.task?.key, 'frontend');
    const resumed = await sessionFor(1, continued);
    assert.match(JSON.stringify(resumed.peer.calls), /tự chọn phong cách nhé/);
    const resumedRead = await submit(
      1,
      resumed.session,
      resumed.peer,
      'relay_read_shared_updates',
      {},
    );
    assert.match(resumedRead.contentItems?.[0]?.text || '', /nhãn form tiếng Việt/);
    await writeFile(
      path.join(resumed.task.worktree!, 'frontend.txt'),
      'Frontend uses the contract\n',
    );
    await complete(
      1,
      resumed.session,
      resumed.peer,
      'Frontend implemented using the correct contract.',
    );
    let frontendReviewer: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !frontendReviewer; attempt++) {
      await pump(1);
      frontendReviewer = await pump(0);
      if (!frontendReviewer) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(frontendReviewer?.phase === 'review');
    assert.deepEqual(frontendReviewer.review?.files, ['frontend.txt']);
    assert.ok(frontendReviewer.prerequisites[0]?.patch);
    const frontendCheck = await sessionFor(0, frontendReviewer);
    assert.deepEqual(frontendCheck.task.scope, ['frontend.txt']);
    assert.equal(frontendCheck.session.model, 'fixture-mini');
    assert.equal(frontendCheck.session.reasoningEffort, 'high');
    assert.match(
      JSON.stringify(frontendCheck.peer.calls),
      /The form preserves the agreed registration field names/,
    );
    assert.match(JSON.stringify(frontendCheck.peer.calls), /tự chọn phong cách nhé/);
    await submit(0, frontendCheck.session, frontendCheck.peer, 'relay_submit_shared_review', {
      verdict: 'approved',
      summary: 'Frontend changes stay within their assigned file.',
    });
    const lateVerdict = await callTool(
      0,
      frontendCheck.session,
      frontendCheck.peer,
      'relay_submit_shared_review',
      {
        verdict: 'changes',
        summary: 'This contradicts the accepted verdict.',
      },
    );
    assert.equal(lateVerdict?.success, false);
    assert.match(lateVerdict?.contentItems?.[0]?.text || '', /already recorded/);
    await complete(0, frontendCheck.session, frontendCheck.peer, 'Frontend reviewed.');
    await pump(0);
    await pump(1);
    const frontendRepo = setups[1].repo;
    await writeFile(path.join(frontendRepo, 'frontend.txt'), 'Frontend uses the contract\n');
    await git(frontendRepo, ['add', 'frontend.txt']);
    await git(frontendRepo, [...fixtureIdentity, 'commit', '-m', 'Existing frontend work']);
    await setups[1].workspace.accept(resumed.task.id);
    assert.equal(
      await git(frontendRepo, ['diff', '--name-only', 'HEAD^', 'HEAD']),
      'architecture.txt',
      'Integration still brings in the missing prerequisite',
    );
    await pump(1);
    const verification = (await pump(0))!;
    assert.equal(verification.task?.key, 'verify-ui');
    assert.equal(verification.task?.kind, 'research');
    assert.deepEqual(
      verification.prerequisites.flatMap((entry) =>
        entry.patch ? [entry.patch.change.files] : [],
      ),
      [['architecture.txt'], ['frontend.txt']],
    );
    const verifier = await sessionFor(0, verification);
    assert.equal(verifier.session.model, 'fixture');
    assert.equal(verifier.session.reasoningEffort, 'high');
    assert.match(
      await readFile(path.join(verifier.task.worktree!, 'frontend.txt'), 'utf8'),
      /Frontend uses the contract/,
    );
    await complete(0, verifier.session, verifier.peer, 'Verified the assembled worktree.');
    await pump(0);
    assert.equal(cloud.poll(0, [], [observerGrantId]).delivery, undefined);
    assert.equal(cloud.poll(1, [], [observerGrantId], randomUUID()).delivery, undefined);
    const otherProjectGrants = Array.from({ length: 35 }, (_, index) => fixtureGrantId(index));
    for (const id of otherProjectGrants)
      receivingDesktop.store.put('sharedSadeLocalGrant', {
        id,
        projectId: randomUUID(),
        expiresAt: Date.now() + 60_000,
      });
    assert.equal(await pump(1), undefined, 'The first poll only contains earlier grant IDs');
    const observation = (await pump(1))!;
    assert.equal(observation.grantId, observerGrantId);
    assert.equal(observation.task?.key, 'report-ui');
    assert.deepEqual(observation.team, []);
    const observerSession = await sessionFor(1, observation);
    assert.equal(observerSession.session.memberId, observer.id);
    assert.doesNotMatch(JSON.stringify(observerSession.peer.calls), /relay_find_shared_teammates/);
    assert.equal(await pump(1), undefined);
    receivingDesktop.workspace.sharedSade.assertCurrent(observation.id);
    assert.equal(await pump(1), undefined);
    receivingDesktop.workspace.sharedSade.assertCurrent(observation.id);
    await complete(
      1,
      observerSession.session,
      observerSession.peer,
      'Summarized the verified handoff.',
    );
    await pump(1);
    for (const id of otherProjectGrants) receivingDesktop.store.remove('sharedSadeLocalGrant', id);
    assert.equal(cloud.view().sadeRuns[0].state, 'done');
    assert.doesNotMatch(
      JSON.stringify(cloud.store.get('sharedSadeRun', chat.id)),
      /Shared verified contract|Frontend uses the contract/,
    );
    assert.equal(setups[0].store.get<Task>('task', author.task.id).status, 'done');
    assert.equal(await remoteHead(), startingRevision);
    assert.match(
      await readFile(path.join(setups[1].repo, 'architecture.txt'), 'utf8'),
      /Shared verified contract/,
    );
    assert.match(
      await readFile(path.join(setups[1].repo, 'frontend.txt'), 'utf8'),
      /Frontend uses the contract/,
    );

    const { workspace, projectId, memberId } = setups[0];
    const pairedPlatform = process.platform === 'darwin' ? 'win32' : 'darwin';
    const node = workspace.runners.add('Paired verification fixture', 'computer', projectId);
    const live = crossHostOrigin
      ? await startCrossHostBridge(workspace, projectId, node, {
          origin: crossHostOrigin,
          port: Number(process.env.KIVUNO_CROSS_HOST_PORT),
          workflowRef: process.env.KIVUNO_CROSS_HOST_WORKFLOW!,
          sha: process.env.KIVUNO_CROSS_HOST_SHA!,
          runId: process.env.KIVUNO_MAC_RUN_ID,
        })
      : undefined;
    if (live) assert.equal(process.platform, 'win32');
    closeBridge = live?.close;
    const remotePermission = await live?.ready();
    if (remotePermission) {
      assert.equal(remotePermission.platform, 'darwin');
      console.log(
        `Tool-only paired runner ready on ${remotePermission.platform} ${remotePermission.arch}`,
      );
    }
    const permission = remotePermission || {
      id: randomUUID(),
      projectId,
      fullAccess: true,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const remoteWorker = live
      ? undefined
      : new MachineExecutor(path.join(root, 'paired-machine'), permission);
    t.after(() => remoteWorker?.stop());
    const advertise = async (access = permission) =>
      workspace.runners.exchange(node.id, {
        epoch: workspace.runners.epoch,
        version: 'controlled',
        ready: true,
        busy: false,
        events: [],
        execution: { ...access, platform: pairedPlatform, arch: process.arch },
      });
    if (!live) await advertise();
    const fixtureSigner = remoteWorker ? generateKeyPairSync('ed25519').privateKey : undefined;
    let simulateRequestedOS = false;
    const machineCall = remoteWorker
      ? t.mock.method(
          workspace.runners,
          'call',
          async (...[peer, command]: Parameters<typeof workspace.runners.call>) => {
            assert.equal(peer.nodeId, node.id);
            assert.doesNotMatch(
              JSON.stringify(command),
              /provider-private|accessToken|tokenHash|\.env\.local/,
            );
            const result = await remoteWorker.perform(randomUUID(), command.params);
            if (simulateRequestedOS && 'evidence' in result && result.evidence) {
              // The single-host fixture impersonates the remote OS; only the cross-host run uses a real Mac signer.
              const evidence = { ...result.evidence, platform: pairedPlatform };
              return {
                ...result,
                platform: pairedPlatform,
                evidence,
                proof: signMachineResult(fixtureSigner!, evidence),
              };
            }
            return simulateRequestedOS && 'platform' in result
              ? { ...result, platform: pairedPlatform }
              : result;
          },
        )
      : undefined;
    const nextGrant = {
      id: randomUUID(),
      groupId: cloud.groupId,
      projectId,
      teammateId: memberId,
      turns: 4,
      allowWrites: true,
      machineId: node.id,
    };
    await assert.rejects(
      workspace.sharedSade.execute({ action: 'preview', ...nextGrant, allowWrites: false }),
      /worktree/,
    );
    const { teammateName, pairedMachine, ...publicGrant } = (await workspace.sharedSade.execute({
      action: 'grant',
      ...nextGrant,
    })) as any;
    assert.equal(pairedMachine.grantId, permission.id);
    assert.equal(publicGrant.pairedPlatform, pairedPlatform);
    cloud.call(0, { action: 'sade-grant', ...publicGrant });
    cloud.grants[0] = nextGrant.id;
    const debug = {
      ...chat,
      id: randomUUID(),
      content:
        pairedPlatform === 'darwin'
          ? 'Windows chạy bình thường, trên macOS bị lỗi. Dùng Mac của tôi thử đi, nhưng tôi không có tài khoản ChatGPT.'
          : 'Dùng AI của mình để kiểm thử project trên máy Windows ghép cặp của bạn.',
    };
    cloud.call(0, debug);
    const debugPlan = (await pump(0))!;
    assert.match(JSON.stringify(debugPlan.team), /pairedPlatform/);
    assert.doesNotMatch(JSON.stringify(debugPlan), new RegExp(node.id + '|' + permission.id));
    const debugPlanner = await sessionFor(0, debugPlan);
    const platformPlan = {
      summary: 'Verify the app with the requester’s harness and the paired machine.',
      tasks: [
        work('platform-smoke', {
          kind: 'code',
          ...(live ? { scope: ['path-label.cjs'] } : {}),
          preferredMemberId: nextGrant.id,
          requiredPlatform: pairedPlatform,
        }),
      ],
    };
    const splitPlan = await callTool(
      0,
      debugPlanner.session,
      debugPlanner.peer,
      'relay_submit_plan',
      {
        ...platformPlan,
        tasks: [
          ...platformPlan.tasks,
          work('test-on-pair', {
            kind: 'research',
            scope: platformPlan.tasks[0].scope,
            preferredMemberId: nextGrant.id,
            requiredPlatform: pairedPlatform,
            dependsOn: ['platform-smoke'],
          }),
        ],
      },
    );
    assert.equal(splitPlan?.success, false);
    assert.match(splitPlan?.contentItems?.[0].text || '', /same paired machine task/i);
    await submit(0, debugPlanner.session, debugPlanner.peer, 'relay_submit_plan', platformPlan);
    await complete(0, debugPlanner.session, debugPlanner.peer, 'Paired check planned.');
    const debugJob = (await pump(0))!;
    assert.equal(debugJob.task?.requiredPlatform, pairedPlatform);
    const debuggerSession = await sessionFor(0, debugJob);
    const use = (operation: string, args = {}, runnerId = node.id) =>
      workspace.sharedSade.usePairedMachine(
        debugJob.id,
        debuggerSession.session,
        'machine_use',
        { runnerId, operation, args },
        () => {},
      );
    await assert.rejects(use('sync'), /Verify/);
    await assert.rejects(
      workspace.sharedSade.usePairedMachine(
        debugJob.id,
        debuggerSession.session,
        'machine_run',
        { runnerId: node.id, executable: 'node', argv: ['--version'] },
        () => {},
      ),
      /Verify/,
    );
    await assert.rejects(use('info', {}, randomUUID()), /Only the approved/);
    if (machineCall) {
      assert.equal(machineCall.mock.callCount(), 0);
      await assert.rejects(use('info'), /requested operating system/);
      simulateRequestedOS = true;
    }
    const machine = async (operation: string, args: Record<string, unknown> = {}) => {
      const machineRun = operation === 'run';
      const result = await submit(
        0,
        debuggerSession.session,
        debuggerSession.peer,
        machineRun ? 'machine_run' : 'machine_use',
        machineRun
          ? {
              runnerId: node.id,
              executable: args.command,
              argv: args.args,
              ...(args.purpose ? { purpose: args.purpose } : {}),
            }
          : { runnerId: node.id, operation, args },
      );
      return JSON.parse(result.contentItems?.[0]?.text || '{}');
    };
    if (live) {
      const root = debuggerSession.task.worktree!;
      await writeFile(path.join(root, '.env.local'), 'OPENAI_API_KEY=example-value');
      const { execFileSync } = await import('node:child_process');
      assert.equal(
        execFileSync(process.execPath, ['platform-smoke.cjs'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        'win32',
      );
      let heartbeat: Promise<unknown> = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = heartbeat.then(() => pump(0));
        void heartbeat.catch(() => {});
      }, 2500);
      try {
        assert.equal((await machine('info')).platform, 'darwin');
        const synced = await machine('sync');
        assert.ok(synced.files.includes('platform-smoke.cjs'));
        assert.ok(!synced.files.includes('.env.local'));
        const args = { command: 'node', args: ['platform-smoke.cjs'] };
        const failed = await machine('run', { ...args, purpose: 'diagnostic' });
        assert.equal(failed.platform, 'darwin');
        assert.equal(failed.code, 1);
        assert.match(failed.stderr, /registration/);
        await machine('write', { path: 'path-label.cjs', content: portablePathProgram });
        const fixed = await machine('run', args);
        assert.equal(fixed.code, 0, fixed.stderr);
        assert.equal(fixed.stdout.trim(), 'darwin');
        const beforePull = (await workspace.reviewDiff(debuggerSession.task.id)).machineChecks;
        assert.equal(beforePull?.passed, false);
        assert.equal(beforePull?.attempts.at(-1)?.status, 'stale');
        await machine('pull');
        const afterPull = (await workspace.reviewDiff(debuggerSession.task.id)).machineChecks;
        assert.equal(afterPull?.passed, true);
        assert.equal(afterPull?.attempts.at(-1)?.status, 'passed');
        assert.ok(afterPull?.attempts.at(-1)?.signer);
        assert.equal(afterPull.attempts[0].signer, afterPull.attempts.at(-1)?.signer);
        assert.equal(
          await readFile(path.join(root, 'path-label.cjs'), 'utf8'),
          portablePathProgram,
        );
        assert.equal(
          await readFile(path.join(setups[0].repo, 'path-label.cjs'), 'utf8'),
          pathProgram,
        );
        assert.equal(
          execFileSync(process.execPath, ['platform-smoke.cjs'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
          'win32',
        );
        console.log(
          'Windows passed; macOS diagnostic exit 1 and signed verification exit 0. Verification was stale before pulling only path-label.cjs and passed after pull.',
        );
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
    } else {
      await machine('info');
      const file = path.join(debuggerSession.task.worktree!, 'src/platform-smoke.ts');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'export const passed = 1;\n');
      await machine('sync');
      const diagnostic = await machine('run', {
        command: 'node',
        args: ['-e', 'process.exit(1)'],
        purpose: 'diagnostic',
      });
      assert.equal(diagnostic.code, 1);
      const diagnosed = (await workspace.reviewDiff(debuggerSession.task.id)).machineChecks!;
      assert.equal(diagnosed.passed, false, 'a diagnostic alone cannot open paired review');
      assert.equal(diagnosed.attempts[0]?.purpose, 'diagnostic');
      const prior = await machine('run', {
        command: 'node',
        args: [
          '-e',
          "process.exit(require('node:fs').readFileSync('src/platform-smoke.ts','utf8').includes('passed = 1') ? 0 : 1)",
        ],
      });
      assert.equal(prior.code, 0);
      await advertise({ ...permission, id: randomUUID() });
      await assert.rejects(use('info'), /authorization changed/);
      await advertise();
      await writeFile(file, 'export const passed = 0;\n');
    }
    await complete(
      0,
      debuggerSession.session,
      debuggerSession.peer,
      'Paired OS fixture finished the smoke check.',
    );
    if (!live) {
      const taskId = debuggerSession.task.id;
      const reviewerTurns = () =>
        cloud.store.get<{ used: number }>('sharedSadeGrant', cloud.grants[1]).used;
      const turnsBefore = reviewerTurns();
      const waitForVerification = async () => {
        for (let attempt = 0; attempt < 60; attempt++) {
          await pump(0);
          const progress = cloud.view().sadeRuns.at(-1)!;
          assert.equal(
            progress.jobs.some((job) => job.phase === 'review'),
            false,
          );
          assert.equal(reviewerTurns(), turnsBefore);
          if (
            progress.jobs.find((job) => job.id === debugJob.id)?.summary?.includes('passing check')
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.fail('the group should show the pending paired check before dispatching review');
      };
      await waitForVerification();
      const stale = (await workspace.reviewDiff(taskId)).machineChecks!;
      assert.equal(stale.attempts.at(-1)?.status, 'stale');
      const verificationId = stale.attempts.at(-1)!.id;
      const failed = await workspace.repeatMachineCheck(taskId, verificationId);
      assert.equal(failed.machineChecks?.attempts.at(-1)?.status, 'failed');
      await waitForVerification();
      await writeFile(
        path.join(debuggerSession.task.worktree!, 'src/platform-smoke.ts'),
        'export const passed = 1; // verified update\n',
      );
      const passed = await workspace.repeatMachineCheck(taskId, verificationId);
      assert.ok(passed.machineChecks?.passed);
      assert.equal(passed.machineChecks.attempts[0].status, 'failed');
      assert.equal(passed.machineChecks.attempts[0].purpose, 'diagnostic');
    }
    {
      let review: SharedDelivery | undefined;
      for (let attempt = 0; attempt < 100 && !review; attempt++) {
        await pump(0);
        review = await pump(1);
        if (!review) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.deepEqual(review?.review?.files, [live ? 'path-label.cjs' : 'src/platform-smoke.ts']);
      if (!live) assert.match(review?.review?.diff || '', /verified update/);
      const check = await sessionFor(1, review!);
      await submit(1, check.session, check.peer, 'relay_submit_shared_review', {
        verdict: 'approved',
        summary: 'Portable path handling uses both separator forms.',
      });
      await complete(1, check.session, check.peer, 'Reviewed the pulled fix.');
      await pump(1);
      await pump(0);
      await workspace.accept(debuggerSession.task.id);
    }
    const deadline = Date.now() + 7000;
    while (cloud.view().sadeRuns.at(-1)?.state !== 'done' && Date.now() < deadline) {
      await pump(0);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const final = cloud.view().sadeRuns.at(-1);
    assert.equal(final?.state, 'done');
    assert.match(
      final?.jobs[1].summary ?? '',
      new RegExp(`Paired ${pairedPlatform} command exit status 0`),
    );
    if (live) {
      assert.equal(await remoteHead(), startingRevision);
      await live.finish();
    }
    const update = {
      ...chat,
      id: randomUUID(),
      content: 'Tui báo tình hình thôi, khoan giao việc nha.',
      sade: { ...chat.sade, readOnly: true },
    };
    cloud.call(0, update);
    const noWorkJob = (await pump(0))!;
    assert.equal(noWorkJob.phase, 'plan');
    const noWork = await sessionFor(0, noWorkJob);
    const writeDraft = await callTool(0, noWork.session, noWork.peer, 'relay_submit_plan', {
      summary: 'Attempting an edit in a read-only request.',
      tasks: [work('blocked-edit', { kind: 'code', preferredMemberId: 'auto' })].map((task) => ({
        ...task,
        requiredPlatform: 'any',
      })),
    });
    assert.equal(writeDraft?.success, false);
    assert.match(writeDraft?.contentItems?.[0].text || '', /no authorized writes/i);
    const empty = await callTool(0, noWork.session, noWork.peer, 'relay_submit_plan', {
      summary: 'A status update for the team.',
      tasks: [],
    });
    assert.equal(empty?.success, false);
    const noWorkDecision = {
      summary: 'A status update for the team.',
    };
    await submit(
      0,
      noWork.session,
      noWork.peer,
      'relay_finish_shared_without_work',
      noWorkDecision,
    );
    const latePlan = await callTool(0, noWork.session, noWork.peer, 'relay_submit_plan', {
      summary: 'An unexpected request to edit a file.',
      tasks: [
        {
          ...work('late-edit', { scope: ['src/menu.ts'] }),
          kind: 'edit-files',
          preferredMemberId: 'auto',
          requiredPlatform: 'any',
        },
      ],
    });
    assert.equal(latePlan?.success, false);
    assert.match(latePlan?.contentItems?.[0]?.text || '', /already recorded/);
    await submit(
      0,
      noWork.session,
      noWork.peer,
      'relay_finish_shared_without_work',
      noWorkDecision,
    );
    await complete(0, noWork.session, noWork.peer, 'A status update for the team.');
    assert.equal(await pump(0), undefined);
    const closed = cloud.view().sadeRuns.at(-1);
    assert.equal(closed?.state, 'done');
    assert.deepEqual(
      closed?.jobs.map((job) => job.phase),
      ['plan'],
    );

    const nextAuthorGrant = {
      id: randomUUID(),
      groupId: cloud.groupId,
      projectId,
      teammateId: memberId,
      turns: 4,
      allowWrites: true,
    };
    const {
      teammateName: _name,
      pairedMachine: _machine,
      ...newGrant
    } = (await workspace.sharedSade.execute({
      action: 'grant',
      ...nextAuthorGrant,
    })) as any;
    cloud.call(0, { action: 'sade-grant', ...newGrant });
    cloud.grants[0] = newGrant.id;

    const sharedFile = 'existing-only.txt';
    await writeFile(path.join(architectureRepo, sharedFile), 'Already committed contract\n');
    await git(architectureRepo, ['add', sharedFile]);
    await git(architectureRepo, [...fixtureIdentity, 'commit', '-m', 'Existing contract update']);
    const required = await git(architectureRepo, ['rev-parse', 'HEAD']);
    const receiverHead = await git(frontendRepo, ['rev-parse', 'HEAD']);
    const request = {
      ...chat,
      id: randomUUID(),
      content: 'Nếu phần đã commit rồi thì giữ nguyên, nhờ Mây kiểm tài liệu đó giúp.',
    };
    cloud.call(0, request);
    const checkPlan = await sessionFor(0, (await pump(0))!);
    await submit(0, checkPlan.session, checkPlan.peer, 'relay_submit_plan', {
      summary: 'Verify an existing contract on both owners’ desktops.',
      tasks: [
        work('check-existing', {
          kind: 'code',
          scope: [sharedFile],
          preferredMemberId: newGrant.id,
        }),
        work('review-existing', {
          kind: 'review',
          scope: [sharedFile],
          preferredMemberId: cloud.grants[1],
          dependsOn: ['check-existing'],
        }),
      ].map((task) => ({ ...task, requiredPlatform: 'any' })),
    });
    await complete(0, checkPlan.session, checkPlan.peer, 'Existing contract check planned.');
    const unchanged = await sessionFor(0, (await pump(0))!);
    assert.match(
      await readFile(path.join(unchanged.task.worktree!, sharedFile), 'utf8'),
      /Already committed contract/,
    );
    await complete(0, unchanged.session, unchanged.peer, 'Existing contract needs no edits.');

    const recipientTurns = () =>
      cloud.store.get<{ used: number }>('sharedSadeGrant', cloud.grants[1]).used;
    const reservedBefore = recipientTurns();
    let checkDelivery: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !checkDelivery; attempt++) {
      await pump(0);
      checkDelivery = await pump(1);
      if (!checkDelivery) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(checkDelivery);
    assert.equal(checkDelivery.phase, 'task');
    assert.equal(checkDelivery.prerequisites[0]?.revision, required);
    assert.deepEqual(checkDelivery.prerequisites[0]?.unchangedCheckout, {
      scopes: [sharedFile],
      importedPatchDigests: [],
    });
    assert.equal(checkDelivery.prerequisites[0]?.patch, undefined);
    assert.equal(recipientTurns(), reservedBefore + 1);
    assert.doesNotMatch(JSON.stringify(cloud.view()), new RegExp(required));
    const peersBeforeSync = setups[1].peers.size;
    const waitingTask = () =>
      cloud
        .view()
        .sadeRuns.at(-1)
        ?.jobs.find((job) => job.id === checkDelivery.id);
    for (let attempt = 0; attempt < 100 && !waitingTask()?.summary; attempt++) {
      await pump(1);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(waitingTask()?.summary || '', /Sync the prerequisite Git revision/);
    assert.equal(setups[1].peers.size, peersBeforeSync);
    assert.equal(await git(frontendRepo, ['rev-parse', 'HEAD']), receiverHead);

    await git(frontendRepo, ['fetch', '--no-tags', architectureRepo, 'main']);
    await pump(1);
    assert.match(waitingTask()?.summary || '', /Sync the prerequisite Git revision/);
    assert.equal(setups[1].peers.size, peersBeforeSync, 'Fetching does not update the checkout');
    await git(frontendRepo, [...fixtureIdentity, 'merge', '--no-edit', 'FETCH_HEAD']);
    const syncedHead = await git(frontendRepo, ['rev-parse', 'HEAD']);
    await pump(1);
    const syncedReview = await sessionFor(1, checkDelivery);
    assert.equal(syncedReview.task.baseCommit, syncedHead);
    assert.match(
      await readFile(path.join(syncedReview.task.worktree!, sharedFile), 'utf8'),
      /Already committed contract/,
    );
    assert.equal(setups[1].peers.size, peersBeforeSync + 1);
    assert.equal(recipientTurns(), reservedBefore + 1);
    assert.equal(syncedReview.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    await complete(1, syncedReview.session, syncedReview.peer, 'Verified the synced contract.');
    await pump(1);
    assert.equal(cloud.view().sadeRuns.at(-1)?.state, 'done');
    assert.equal(await remoteHead(), startingRevision);

    const quotaRequest = {
      ...chat,
      id: randomUUID(),
      content: 'Nhờ Sade chọn một người đọc hợp đồng và kiểm tra phần mô tả.',
    };
    cloud.call(0, quotaRequest);
    const quotaPlanner = await sessionFor(0, (await pump(0))!);
    await submit(0, quotaPlanner.session, quotaPlanner.peer, 'relay_submit_plan', {
      summary: 'Inspect the existing contract on an available authorized teammate.',
      tasks: [
        work('inspect', { kind: 'review', scope: [sharedFile], preferredMemberId: 'auto' }),
      ].map((task) => ({ ...task, requiredPlatform: 'any' })),
    });
    await complete(
      0,
      quotaPlanner.session,
      quotaPlanner.peer,
      'Inspecting the contract is planned.',
    );
    await pump(0);
    const reviewerControl = (await setups[1].workspace.client(setups[1].memberId)) as DesktopPeer;
    reviewerControl.quotaUsedPercent = 100;
    const previousTurns = recipientTurns();
    const previousPeers = setups[1].peers.size;
    const rejected = (await pump(1))!;
    assert.equal(rejected.task?.key, 'inspect');
    cloud.call(0, {
      action: 'sade-update-task',
      groupId: cloud.groupId,
      runId: quotaRequest.id,
      jobId: rejected.id,
      id: randomUUID(),
      text: 'Chỉ đọc file hợp đồng, gửi lại số mục chưa rõ.',
    });
    let replacement: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !replacement; attempt++) {
      await pump(1);
      replacement = await pump(0);
      if (!replacement) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(replacement);
    assert.notEqual(replacement.id, rejected.id);
    assert.equal(replacement.grantId, newGrant.id);
    assert.deepEqual(replacement.task, rejected.task);
    assert.equal(recipientTurns(), previousTurns);
    assert.equal(setups[1].peers.size, previousPeers);
    assert.throws(
      () => cloud.finish(1, rejected.id, { kind: 'done', summary: 'Late result.' }),
      /unavailable/,
    );
    const reassigned = await sessionFor(0, replacement);
    assert.deepEqual(reassigned.task.scope, [sharedFile]);
    const carriedUpdate = await submit(
      0,
      reassigned.session,
      reassigned.peer,
      'relay_read_shared_updates',
      {},
    );
    assert.match(carriedUpdate.contentItems?.[0]?.text || '', /số mục chưa rõ/);
    assert.equal(reassigned.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    await complete(0, reassigned.session, reassigned.peer, 'The contract was inspected.');
    await pump(0);
    assert.equal(cloud.view().sadeRuns.at(-1)?.state, 'done');
    assert.equal(await remoteHead(), startingRevision);

    const authorStore = setups[0].store;
    const backup = authorStore.addMember({ name: 'Sổ tay', role: 'researcher', provider: 'codex' });
    authorStore.updateMember(backup.id, { status: 'ready', account: { type: 'chatgpt' } });
    const project = authorStore.get<Project>('project', setups[0].projectId);
    assert.ok(project.memberIds);
    authorStore.put('project', { ...project, memberIds: [...project.memberIds, backup.id] });
    const primaryControl = (await workspace.client(setups[0].memberId)) as DesktopPeer;
    primaryControl.quotaUsedPercent = 100;
    const backupControl = new DesktopPeer(project.path, 'codex');
    workspace.client = async (memberId) =>
      memberId === backup.id ? backupControl : primaryControl;
    workspace.refresh = async (memberId) => authorStore.get('member', memberId);
    cloud.call(0, {
      action: 'teammates',
      groupId: cloud.groupId,
      teammates: [
        { localId: setups[0].memberId, provider: 'gemini', name: 'Bếp' },
        { localId: backup.id, provider: 'codex', name: 'Sổ tay' },
      ],
    });
    const primaryGrantId = randomUUID();
    const backupGrantId = randomUUID();
    for (const [id, teammateId] of [
      [primaryGrantId, setups[0].memberId],
      [backupGrantId, backup.id],
    ]) {
      const { teammateName, pairedMachine, ...grant } = (await workspace.sharedSade.execute({
        action: 'grant',
        groupId: cloud.groupId,
        id,
        projectId: project.id,
        teammateId,
        turns: 1,
        allowWrites: false,
      })) as { teammateName: string; pairedMachine?: unknown };
      cloud.call(0, { action: 'sade-grant', ...grant });
    }
    const backupRequest = {
      ...chat,
      id: randomUUID(),
      content: 'Team ơi, em báo đã đọc kỹ hợp đồng thôi, hôm nay chưa giao ai làm thêm nhé.',
    };
    cloud.call(0, backupRequest);
    const usedBefore = authorStore.sessions().length;
    const plannerPeersBefore = setups[0].peers.size;
    const initialPlan = await pump(0);
    assert.equal(initialPlan?.grantId, primaryGrantId);
    let backupPlan: SharedDelivery | undefined;
    for (let attempt = 0; attempt < 100 && !backupPlan; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      backupPlan = await pump(0);
    }
    assert.ok(backupPlan);
    assert.equal(backupPlan.phase, 'plan');
    assert.equal(backupPlan.grantId, backupGrantId);
    assert.equal(backupPlan.request, backupRequest.content);
    const backupSession = await sessionFor(0, backupPlan);
    assert.equal(backupSession.session.memberId, backup.id);
    assert.equal(backupSession.session.readOnly, true);
    assert.equal(authorStore.sessions().length, usedBefore + 2);
    assert.equal(setups[0].peers.size, plannerPeersBefore + 1);
    await submit(0, backupSession.session, backupSession.peer, 'relay_finish_shared_without_work', {
      summary: 'This is a status update only.',
    });
    await complete(0, backupSession.session, backupSession.peer, 'No work requested.');
    await pump(0);
    const backupRun = cloud.view().sadeRuns.at(-1);
    assert.equal(backupRun?.id, backupRequest.id);
    assert.equal(backupRun?.state, 'done');
    assert.equal(backupRun?.jobs.length, 1);
    assert.equal(await remoteHead(), startingRevision);
  },
);

for (const backupProject of [key, 'c'.repeat(64)]) {
  const sameProject = backupProject === key;
  test(`planning quota failover ${sameProject ? 'uses an authorized harness of the requester' : 'keeps the request on the granted project'}`, (t) => {
    const f = fixture(['gemini', 'claude']);
    t.after(() => f.store.close());
    const profile = randomUUID();
    const backup = randomUUID();
    f.call(0, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [
        { localId: f.members[0], provider: 'gemini', name: 'Bếp' },
        { localId: profile, provider: 'codex', name: 'Sổ tay' },
      ],
    });
    f.call(0, {
      action: 'sade-grant',
      id: backup,
      groupId: f.groupId,
      teammateId: profile,
      projectKey: backupProject,
      projectName: 'Fixture project',
      role: 'researcher',
      platform: 'win32',
      allowWrites: false,
      turns: 1,
    });
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Gemini bên tui gói free hay hết lượt. Nhờ Claude của Bình đọc src/check.ts giùm.',
      sade: { projectKey: key },
    };
    f.call(0, request);
    const original = f.poll(0).delivery!;
    assert.equal(original.phase, 'plan');
    assert.equal(original.grantId, f.grants[0]);
    assert.throws(() => f.finish(1, original.id, { kind: 'provider-unavailable' }), /grant/);
    f.finish(0, original.id, { kind: 'provider-unavailable' });
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 0);
    assert.equal(f.poll(1).delivery, undefined);
    const replacement = f.poll(0, [], [backup]).delivery;
    if (!sameProject) {
      assert.equal(replacement, undefined);
      assert.match(f.view().sadeRuns[0].error || '', /quota/);
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
      return;
    }
    assert.ok(replacement);
    assert.equal(replacement.grantId, backup);
    assert.notEqual(replacement.id, original.id);
    assert.equal(replacement.phase, 'plan');
    assert.equal(replacement.request, request.content);
    assert.equal(
      replacement.team.some(({ id }) => id === original.grantId),
      false,
    );
    assert.throws(() => f.finish(0, original.id, { kind: 'provider-unavailable' }), /unavailable/);
    f.call(0, request);
    assert.deepEqual(f.poll(0, [], [backup]).delivery, replacement);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', backup).used, 1);
    f.finish(0, replacement.id, {
      kind: 'plan',
      plan: { summary: 'Inspect the assigned file once.', tasks: [work('check')] },
    });
    const task = f.poll(1).delivery;
    assert.equal(task?.phase, 'task');
    assert.equal(task.grantId, f.grants[1]);
    assert.equal(f.view().messages.filter(({ id }) => id === request.id).length, 1);
    assert.equal(f.view().sadeRuns.length, 1);
  });
}

for (const unavailable of ['before allocation', 'before starting', 'both exhausted'] as const) {
  test(`Shared Sade honors the named backup when quota is unavailable ${unavailable}`, (t) => {
    const f = fixture(['gemini', 'claude'], {
      turnsA: unavailable === 'before allocation' ? 1 : 3,
    });
    t.after(() => f.store.close());
    const observer = randomUUID();
    const observerGrant = randomUUID();
    f.call(0, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [
        { localId: f.members[0], provider: 'gemini', name: 'Bếp' },
        { localId: observer, provider: 'codex', name: 'Sổ tay' },
      ],
    });
    f.call(0, {
      action: 'sade-grant',
      id: observerGrant,
      groupId: f.groupId,
      teammateId: observer,
      projectKey: key,
      projectName: 'Fixture project',
      role: 'researcher',
      platform: 'win32',
      turns: 3,
      allowWrites: false,
    });
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nhờ Gemini bên tui coi src/check.ts nha. Hết lượt thì để Claude của Bình coi giùm.',
      sade: { projectKey: key },
    };
    f.call(0, request);
    const planner = f.poll(0).delivery!;
    const roster = planner.team.map(({ id }) => id);
    const plan = parseSharedGroupPlan(
      {
        summary: 'Read src/check.ts and send a short explanation.',
        tasks: [
          {
            ...work('check'),
            preferredMemberId: sharedPlanMemberRef(roster.indexOf(f.grants[0])),
            fallbackMemberId: sharedPlanMemberRef(roster.indexOf(f.grants[1])),
            requiredPlatform: 'any',
          },
        ],
      },
      roster,
    );
    f.finish(0, planner.id, { kind: 'plan', plan });
    if (unavailable !== 'before allocation') {
      const first = f.poll(0).delivery;
      assert.equal(first?.grantId, f.grants[0]);
      assert.equal(f.poll(1).delivery, undefined);
      f.finish(0, first.id, { kind: 'provider-unavailable' });
      assert.throws(() => f.finish(0, first.id, { kind: 'provider-unavailable' }), /unavailable/);
    }
    assert.equal(f.poll(0, [], [observerGrant]).delivery, undefined);
    const retry = f.poll(1).delivery;
    assert.equal(retry?.grantId, f.grants[1]);
    assert.deepEqual(retry.task?.scope, ['src/check.ts']);
    assert.doesNotMatch(JSON.stringify(retry.task), /fallbackMemberId/);
    if (unavailable === 'both exhausted') {
      f.finish(1, retry.id, { kind: 'provider-unavailable' });
      assert.equal(f.poll(0, [], [observerGrant]).delivery, undefined);
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
    } else {
      f.finish(1, retry.id, { kind: 'done', summary: 'Reported the file contents once.' });
      assert.equal(f.view().sadeRuns[0].state, 'done');
    }
    f.call(0, request);
    assert.equal(f.view().messages.length, 1);
    assert.equal(f.view().sadeRuns.length, 1);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', observerGrant).used, 0);
  });
}

test('a known provider limit moves later work to its own named backup without polling the primary', (t) => {
  const f = fixture(['gemini', 'claude'], { turnsA: 3, turnsB: 1 });
  t.after(() => f.store.close());
  const profile = randomUUID();
  const backup = randomUUID();
  f.call(1, {
    action: 'teammates',
    groupId: f.groupId,
    teammates: [
      { localId: f.members[1], provider: 'claude', name: 'Mây' },
      { localId: profile, provider: 'antigravity', name: 'Sổ tay' },
    ],
  });
  f.call(1, {
    action: 'sade-grant',
    groupId: f.groupId,
    id: backup,
    teammateId: profile,
    projectKey: key,
    projectName: 'Fixture project',
    role: 'researcher',
    platform: 'win32',
    allowWrites: false,
    turns: 1,
  });
  const request = {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content:
      'Nhờ Bếp đọc src/source.ts rồi src/target.ts. Nếu Gemini hết lượt, nhờ Mây đọc file đầu và Sổ tay đọc file sau, giữ đúng thứ tự.',
    sade: { projectKey: key, readOnly: true },
  };
  f.call(0, request);
  const planner = f.poll(0).delivery!;
  f.finish(0, planner.id, {
    kind: 'plan',
    plan: {
      summary: 'Read the source before inspecting the target.',
      tasks: [
        work('source', { preferredMemberId: f.grants[0], fallbackMemberId: f.grants[1] }),
        work('target', {
          preferredMemberId: f.grants[0],
          fallbackMemberId: backup,
          dependsOn: ['source'],
        }),
      ],
    },
  });
  const initial = f.poll(0).delivery!;
  assert.deepEqual(initial.task?.scope, ['src/source.ts']);
  const primaryOnly = f.poll(0, [initial.id]);
  assert.deepEqual(primaryOnly.active, [initial.id]);
  f.finish(0, initial.id, { kind: 'provider-unavailable' });
  assert.equal(f.poll(1, [], [backup]).delivery, undefined);
  const first = f.poll(1).delivery!;
  assert.deepEqual(first.task?.scope, ['src/source.ts']);
  f.finish(1, first.id, { kind: 'done', summary: 'The source check completed.' });
  assert.equal(f.poll(1, [], [backup], randomUUID()).delivery, undefined);
  const second = f.poll(1, [], [backup]).delivery;
  assert.ok(second, 'the second authorized backup can receive work with the primary offline');
  assert.equal(second.grantId, backup);
  assert.deepEqual(second.task?.scope, ['src/target.ts']);
  assert.match(second.prerequisites[0]?.summary || '', /source check completed/);
  f.finish(1, second.id, { kind: 'done', summary: 'The target check completed.' });
  f.call(0, request);
  assert.equal(f.view().sadeRuns[0].state, 'done');
  assert.equal(f.view().messages.length, 1);
  for (const id of [...f.grants, backup])
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', id).used, 1);
});

test('a known provider limit cannot reuse another task’s fallback for a pinned task', (t) => {
  const f = fixture(['gemini', 'claude'], { turnsA: 3, turnsB: 2 });
  t.after(() => f.store.close());
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Bếp xem file đầu rồi file sau. Mây chỉ được thay Bếp ở file đầu nếu hết lượt.',
    sade: { projectKey: key, readOnly: true },
  });
  const planner = f.poll(0).delivery!;
  f.finish(0, planner.id, {
    kind: 'plan',
    plan: {
      summary: 'Allow the backup for the first check only.',
      tasks: [
        work('first', { preferredMemberId: f.grants[0], fallbackMemberId: f.grants[1] }),
        work('second', { preferredMemberId: f.grants[0], dependsOn: ['first'] }),
      ],
    },
  });
  const primary = f.poll(0).delivery!;
  f.finish(0, primary.id, { kind: 'provider-unavailable' });
  const first = f.poll(1).delivery!;
  assert.equal(first.task?.key, 'first');
  f.finish(1, first.id, { kind: 'done', summary: 'The authorized check completed.' });
  assert.equal(f.poll(1).delivery, undefined);
  const run = f.view().sadeRuns[0];
  assert.equal(run.state, 'blocked');
  assert.match(run.error || '', /requested harness.*provider quota/);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 1);
});

for (const pinned of ['named harness', 'required OS'] as const) {
  test(`quota failover preserves the ${pinned}`, () => {
    const f = fixture(['gemini', 'codex'], { mac: pinned === 'required OS' });
    try {
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content: 'Kiểm tra file trong phạm vi đã chọn.',
        sade: { projectKey: key },
      });
      const planner = f.poll(0).delivery!;
      f.finish(0, planner.id, {
        kind: 'plan',
        plan: {
          summary: 'Perform a read-only check with the required condition.',
          tasks: [
            work(
              'check',
              pinned === 'named harness'
                ? { preferredMemberId: f.grants[1] }
                : { requiredPlatform: 'darwin' },
            ),
          ],
        },
      });
      const running = f.poll(1).delivery!;
      assert.ok(running);
      assert.throws(() => f.finish(0, running.id, { kind: 'provider-unavailable' }), /grant/);
      f.finish(1, running.id, { kind: 'provider-unavailable' });
      assert.equal(f.poll(0).delivery, undefined);
      const final = f.view().sadeRuns[0];
      assert.equal(final.state, 'blocked');
      assert.match(
        final.error || '',
        pinned === 'named harness' ? /requested harness/ : /No eligible granted teammate/,
      );
      assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
    } finally {
      f.store.close();
    }
  });
}

test('an independent patch review can change providers before its first turn', () => {
  const f = fixture();
  try {
    const profile = randomUUID();
    const backup = randomUUID();
    f.call(1, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [
        { localId: f.members[1], provider: 'codex', name: 'Mây' },
        { localId: profile, provider: 'claude', name: 'Backup reader' },
      ],
    });
    f.call(1, {
      action: 'sade-grant',
      id: backup,
      groupId: f.groupId,
      teammateId: profile,
      projectKey: key,
      projectName: 'Fixture project',
      role: 'researcher',
      platform: 'win32',
      allowWrites: false,
      turns: 1,
    });
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Sửa file rồi review độc lập trước lúc tích hợp.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Edit the scoped file and use the automatic patch review.',
        tasks: [
          work('write', { kind: 'code', scope: patch.files, preferredMemberId: f.grants[0] }),
        ],
      },
    });
    const writer = f.poll(0).delivery!;
    f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'A bounded change.' });
    const original = f.poll(1, [], [f.grants[1], backup]).delivery!;
    assert.equal(original.grantId, f.grants[1]);
    f.finish(1, original.id, { kind: 'provider-unavailable' });
    assert.equal(f.poll(0, [writer.id]).reviews.length, 0);
    const reassigned = f.poll(1, [], [f.grants[1], backup]).delivery!;
    assert.equal(reassigned.phase, 'review');
    assert.equal(reassigned.grantId, backup);
    assert.notEqual(reassigned.id, original.id);
    assert.deepEqual(reassigned.review, original.review);
    assert.throws(() => f.finish(1, original.id, { kind: 'provider-unavailable' }), /unavailable/);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
    f.finish(1, reassigned.id, {
      kind: 'review',
      verdict: 'approved',
      summary: 'The backup reviewer checked the scoped diff.',
    });
    assert.deepEqual(f.poll(0, [writer.id]).reviews, [
      { jobId: writer.id, digest: reviewDigest(patch) },
    ]);
    f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
  } finally {
    f.store.close();
  }
});

test('a quota fallback can write the same scope using another write grant and independent review', () => {
  for (const allowWrites of [true, false]) {
    const f = fixture();
    try {
      const profile = randomUUID();
      const backup = randomUUID();
      f.call(0, {
        action: 'teammates',
        groupId: f.groupId,
        teammates: [
          { localId: f.members[0], provider: 'gemini', name: 'Bếp' },
          { localId: profile, provider: 'claude', name: 'Backup writer' },
        ],
      });
      f.call(0, {
        action: 'sade-grant',
        id: backup,
        groupId: f.groupId,
        teammateId: profile,
        projectKey: key,
        projectName: 'Fixture project',
        role: 'designer',
        platform: 'win32',
        allowWrites,
        turns: 1,
      });
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content: 'Sửa file rồi nhờ một người khác kiểm lại.',
        sade: { projectKey: key },
      });
      const planner = f.poll(0).delivery!;
      f.finish(0, planner.id, {
        kind: 'plan',
        plan: {
          summary: 'Edit one file with an independent reviewer.',
          tasks: [
            work('write', { kind: 'code', scope: patch.files }),
            work('review', {
              kind: 'review',
              scope: patch.files,
              dependsOn: ['write'],
              preferredMemberId: f.grants[1],
            }),
          ],
        },
      });
      const original = f.poll(0).delivery!;
      assert.equal(original.grantId, f.grants[0]);
      f.finish(0, original.id, { kind: 'provider-unavailable' });
      const writer = f.poll(0, [], [f.grants[0], backup]).delivery;
      if (!allowWrites) {
        assert.equal(writer, undefined);
        assert.equal(f.poll(1).delivery, undefined, 'the only independent reviewer cannot write');
        assert.equal(f.view().sadeRuns[0].state, 'blocked');
        continue;
      }
      assert.equal(writer?.grantId, backup);
      assert.deepEqual(writer?.task, original.task);
      f.finish(0, writer!.id, { kind: 'change', diff: patch, summary: 'Scoped edit.' });
      const review = f.poll(1).delivery!;
      assert.equal(review.phase, 'review');
      assert.equal(review.grantId, f.grants[1]);
      assert.deepEqual(review.review, patch);
      f.finish(1, review.id, { kind: 'review', verdict: 'approved', summary: 'Scope verified.' });
      f.finish(0, writer!.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
      assert.equal(f.view().sadeRuns[0].state, 'done');
    } finally {
      f.store.close();
    }
  }
});

test('a queued review on a quota-limited harness moves to its named backup only after a patch exists', (t) => {
  const f = fixture(['gemini', 'claude'], { turnsA: 3, turnsB: 2 });
  t.after(() => f.store.close());
  const teammateId = randomUUID();
  const backup = randomUUID();
  f.call(1, {
    action: 'teammates',
    groupId: f.groupId,
    teammates: [
      { localId: f.members[1], provider: 'claude', name: 'Mây' },
      { localId: teammateId, provider: 'antigravity', name: 'Sổ tay' },
    ],
  });
  f.call(1, {
    action: 'sade-grant',
    groupId: f.groupId,
    id: backup,
    teammateId,
    projectKey: key,
    projectName: 'Fixture project',
    role: 'reviewer',
    platform: 'win32',
    allowWrites: false,
    turns: 1,
  });
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content:
      'Mây đọc tiêu chí, Bếp sửa theo kết quả, Mây review diff. Nếu Mây hết lượt, Bếp đọc tiêu chí và Sổ tay review diff.',
    sade: { projectKey: key },
  });
  const planner = f.poll(0).delivery!;
  f.finish(0, planner.id, {
    kind: 'plan',
    plan: {
      summary: 'Read requirements, edit the file and run an independent review.',
      tasks: [
        work('requirements', { preferredMemberId: f.grants[1], fallbackMemberId: f.grants[0] }),
        work('write', {
          kind: 'code',
          scope: patch.files,
          dependsOn: ['requirements'],
          preferredMemberId: f.grants[0],
        }),
        work('review', {
          kind: 'review',
          scope: patch.files,
          dependsOn: ['write'],
          preferredMemberId: f.grants[1],
          fallbackMemberId: backup,
        }),
      ],
    },
  });
  const primary = f.poll(1).delivery!;
  assert.equal(primary.task?.key, 'requirements');
  f.finish(1, primary.id, { kind: 'provider-unavailable' });
  const requirements = f.poll(0).delivery!;
  assert.equal(requirements.task?.key, 'requirements');
  f.finish(0, requirements.id, { kind: 'done', summary: 'The requirements were read.' });
  const writer = f.poll(0).delivery!;
  assert.equal(writer.task?.key, 'write');
  assert.equal(f.poll(1, [], [backup]).delivery, undefined);
  f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'The scoped change is ready.' });
  assert.equal(f.poll(0, [writer.id]).reviews.length, 0);
  const reviewer = f.poll(1, [], [backup]).delivery!;
  assert.equal(reviewer.phase, 'review');
  assert.deepEqual(reviewer.review, patch);
  assert.equal(reviewer.grantId, backup);
  f.finish(1, reviewer.id, {
    kind: 'review',
    verdict: 'approved',
    summary: 'The scope was verified.',
  });
  assert.deepEqual(f.poll(0, [writer.id]).reviews, [
    { jobId: writer.id, digest: reviewDigest(patch) },
  ]);
  f.finish(0, writer.id, {
    kind: 'done',
    revision: sha,
    summary: 'Integrated the reviewed change.',
  });
  assert.equal(f.view().sadeRuns[0].state, 'done');
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', backup).used, 1);
});

test('a locked group seat cannot stall another project on the same desktop', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const groupId = randomUUID();
  const secondProject = 'c'.repeat(64);
  const eligibleGrant = randomUUID();
  f.call(1, { action: 'create', id: groupId, name: 'Another project' });
  f.call(1, {
    action: 'teammates',
    groupId,
    teammates: [{ localId: f.members[1], name: 'Mây', provider: 'codex' }],
  });
  f.call(1, {
    action: 'sade-grant',
    groupId,
    id: eligibleGrant,
    teammateId: f.members[1],
    projectKey: secondProject,
    projectName: 'Another project',
    role: 'researcher',
    platform: 'win32',
    turns: 2,
    allowWrites: false,
  });
  f.call(1, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Nhờ Mây đọc tài liệu cho nhóm thứ nhất.',
    sade: { projectKey: key },
  });
  f.call(1, {
    action: 'message',
    groupId,
    id: randomUUID(),
    content: 'Nhờ Mây đọc tài liệu cho nhóm thứ hai.',
    sade: { projectKey: secondProject },
  });
  f.call(0, { action: 'seats', groupId: f.groupId, userIds: ['owner-A'] });

  const result = f.poll(1, [], [f.grants[1], eligibleGrant]);
  assert.equal(result.delivery?.grantId, eligibleGrant);
  assert.deepEqual(f.poll(1, [result.delivery.id], [f.grants[1], eligibleGrant]).active, [
    result.delivery.id,
  ]);
  const locked = f.view().sadeRuns[0];
  assert.equal(locked.state, 'blocked');
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
  assert.throws(
    () => f.finish(1, locked.jobs[0].id, { kind: 'done', summary: 'Stale contribution' }),
    /seat is locked/,
  );
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Đọc lại tài liệu nhóm thứ nhất với teammate còn quyền.',
    sade: { projectKey: key },
  });
  const replanned = f.poll(0);
  assert.deepEqual(
    replanned.delivery?.team.map(({ id }) => id),
    [f.grants[0]],
  );
  assert.throws(
    () => f.call(1, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[0] }),
    /Only this harness owner/,
  );
  assert.deepEqual(f.call(1, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[1] }), {
    revoked: true,
  });
  f.call(0, { action: 'seats', groupId: f.groupId, userIds: ['owner-A', 'owner-B'] });
  assert.equal(f.store.get<{ revoked: boolean }>('sharedSadeGrant', f.grants[1]).revoked, true);
});

test('Shared Sade admission fences a group and shared repository without scanning run history', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const secondGroup = randomUUID();
  const anotherProject = 'c'.repeat(64);
  f.call(1, { action: 'create', id: secondGroup, name: 'Another group on the same repository' });
  f.call(1, {
    action: 'teammates',
    groupId: secondGroup,
    teammates: [{ localId: f.members[1], name: 'Mây', provider: 'codex' }],
  });
  const grant = (index: number, groupId: string, projectKey: string) => {
    const id = randomUUID();
    f.call(index, {
      action: 'sade-grant',
      groupId,
      id,
      teammateId: f.members[index],
      projectKey,
      projectName: 'Fixture project',
      role: 'researcher',
      platform: 'win32',
      allowWrites: false,
      turns: 2,
    });
    return id;
  };
  const secondGrant = grant(1, secondGroup, key);
  grant(0, f.groupId, anotherProject);
  const message = (groupId: string, projectKey: string) => ({
    action: 'message',
    groupId,
    id: randomUUID(),
    content: 'Nhờ đọc tài liệu từ project này.',
    sade: { projectKey },
  });
  const scans = t.mock.method(f.store, 'all');
  const original = message(f.groupId, key);
  f.call(0, original);
  const delivered = f.poll(0).delivery!;
  const retry = message(secondGroup, key);
  assert.throws(() => f.call(1, retry), /active Sade request/);
  assert.throws(() => f.call(0, message(f.groupId, anotherProject)), /active Sade request/);

  f.call(0, { action: 'sade-cancel', groupId: f.groupId, runId: original.id });
  assert.throws(() => f.call(1, retry), /previous Sade request is stopping/);
  const stopped = f.store.get<{ id: string; jobs: { id: string; deadline?: number }[] }>(
    'sharedSadeRun',
    original.id,
  );
  stopped.jobs.find((job) => job.id === delivered.id)!.deadline = Date.now() - 1;
  f.store.put('sharedSadeRun', stopped);
  f.call(1, retry);
  f.call(1, retry);
  const next = f.poll(1, [], [secondGrant]).delivery!;
  assert.equal(next.groupId, secondGroup);
  assert.equal(next.projectKey, key);
  assert.equal(next.grantId, secondGrant);
  const { messages, sadeRuns } = f.call(1, { action: 'read', groupId: secondGroup });
  assert.equal(messages.length, 1);
  assert.deepEqual(
    sadeRuns.map(({ id }: { id: string }) => id),
    [retry.id],
  );
  assert.ok(scans.mock.calls.every(({ arguments: [kind] }) => kind !== 'sharedSadeRun'));
});

test('Shared Sade polls only groups from the desktop grant page', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const secondGroup = randomUUID();
  const secondProject = 'c'.repeat(64);
  const secondGrant = randomUUID();
  f.call(1, { action: 'create', id: secondGroup, name: 'Unrelated project' });
  f.call(1, {
    action: 'teammates',
    groupId: secondGroup,
    teammates: [{ localId: f.members[1], name: 'Mây', provider: 'codex' }],
  });
  f.call(1, {
    action: 'sade-grant',
    groupId: secondGroup,
    id: secondGrant,
    teammateId: f.members[1],
    projectKey: secondProject,
    projectName: 'Unrelated project',
    role: 'researcher',
    platform: 'win32',
    turns: 2,
    allowWrites: false,
  });
  const open = (index: number, groupId: string, projectKey: string) =>
    f.call(index, {
      action: 'message',
      id: randomUUID(),
      groupId,
      content: 'Đọc tài liệu trong project này giúp mình.',
      sade: { projectKey },
    });
  open(0, f.groupId, key);
  open(1, secondGroup, secondProject);

  const reads = t.mock.method(f.store, 'get');
  const scans = t.mock.method(f.store, 'all');
  const first = f.poll(0, [], [f.grants[0], secondGrant]);
  assert.equal(first.delivery?.grantId, f.grants[0]);
  assert.deepEqual(
    reads.mock.calls
      .filter(({ arguments: [kind] }) => kind === 'sharedGroup')
      .map(({ arguments: [, id] }) => id),
    [f.groupId],
  );
  assert.equal(f.poll(0, [], [secondGrant]).delivery, undefined);
  assert.deepEqual(f.poll(0, [first.delivery.id]).active, [first.delivery.id]);

  const second = f.poll(1, [], [secondGrant]).delivery!;
  assert.equal(second.grantId, secondGrant);
  const result: SharedFinish = { kind: 'plan', plan: { summary: 'No work needed.', tasks: [] } };
  assert.deepEqual(f.finish(0, first.delivery.id, result), { accepted: true });
  assert.deepEqual(f.finish(0, first.delivery.id, result), { accepted: true });
  assert.deepEqual(f.finish(1, second.id, result), { accepted: true });
  assert.deepEqual(
    scans.mock.calls
      .map(({ arguments: [kind] }) => kind)
      .filter((kind) => kind === 'sharedSadeGrant' || kind === 'sharedSadeRun'),
    [],
  );
});

test('the owning desktop reports and clears a Shared Sade capacity wait', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Nhờ xem lại tài liệu dự án.',
    sade: { projectKey: key },
  });
  const packet = f.poll(0);
  const job = packet.delivery!;
  const summary = () => f.view().sadeRuns[0].jobs[0].summary;
  const heartbeat = (index: number, waitingForCapacity?: string[]) =>
    f.call(index, {
      action: 'sade-poll',
      grants: [f.grants[index]],
      active: [job.id],
      waitingForCapacity,
    });

  heartbeat(1, [job.id]);
  assert.equal(summary(), undefined);
  heartbeat(0, [job.id]);
  assert.match(summary() || '', /waiting.*desktop/i);
  assert.equal(packet.supportsCapacityWait, true);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
  heartbeat(0);
  assert.equal(summary(), undefined);
});

test('desktop identity revocation fences an active Shared Sade task and its dependants', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const identity = new DesktopIdentity(f.store, 'https://example.test');
  f.call(0, {
    action: 'message',
    groupId: f.groupId,
    id: randomUUID(),
    content: 'Nhờ Mây đọc tài liệu rồi để Bếp kiểm tra phần bàn giao.',
    sade: { projectKey: key },
  });
  const planner = f.poll(0).delivery!;
  f.finish(0, planner.id, {
    kind: 'plan',
    plan: {
      summary: 'Read the document and then check the handoff.',
      tasks: [
        work('read', { preferredMemberId: f.grants[1] }),
        work('verify', { preferredMemberId: f.grants[0], dependsOn: ['read'] }),
      ],
    },
  });
  const active = f.poll(1).delivery!;
  assert.deepEqual(f.poll(1, [active.id]).active, [active.id]);
  identity.revokeOwner('owner-B');
  const old = f.store.get<DesktopDevice>('desktopDevice', f.devices[1]);
  assert.equal(old.revoked, true);
  assert.equal(f.store.get<DesktopDevice>('desktopDevice', f.devices[0]).revoked, false);
  assert.throws(
    () => f.finish(1, active.id, { kind: 'done', summary: 'Late result.' }),
    /grant is no longer valid/,
  );
  assert.equal(f.poll(0).delivery, undefined);
  assert.equal(f.view().sadeRuns[0].state, 'blocked');

  const signedBackIn = randomUUID();
  f.store.put('desktopDevice', {
    ...old,
    id: signedBackIn,
    tokenHash: 'new-fixture-token-hash',
    revoked: false,
  });
  assert.deepEqual(f.poll(1, [active.id], [f.grants[1]], signedBackIn).active, []);
  assert.equal(f.poll(1, [], [f.grants[1]], signedBackIn).delivery, undefined);
  assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
});

test('the desktop polls all valid grants across project pages', async (t) => {
  const store = new Store(':memory:');
  const workspace = new Workspace(store, os.tmpdir(), os.tmpdir());
  t.after(async () => {
    await workspace.close();
    store.close();
  });
  const worker = workspace.sharedSade;
  const snapshot = async (grantCursor?: string) =>
    (await worker.execute({ action: 'snapshot', ...(grantCursor ? { grantCursor } : {}) })) as {
      grants: string[];
      nextGrantCursor?: string;
    };
  const grants = Array.from({ length: 36 }, (_, index) => fixtureGrantId(index));
  const expiresAt = Date.now() + 60_000;
  for (const grantId of grants)
    store.put('sharedSadeLocalGrant', { id: grantId, projectId: randomUUID(), expiresAt });
  store.put('sharedSadeLocalGrant', { id: randomUUID(), expiresAt: Date.now() - 1 });

  const first = await snapshot();
  assert.deepEqual(first.grants, grants.slice(0, 32));
  assert.equal(first.nextGrantCursor, grants[31]);
  assert.deepEqual(await snapshot(), first, 'A poll retry must offer the same grant page');
  await worker.execute({ action: 'revoke', grantId: first.nextGrantCursor });
  const next = await snapshot(first.nextGrantCursor);
  assert.deepEqual(next.grants.slice(0, 4), grants.slice(32));
  assert.equal(next.grants.length, 32);
  assert.ok(next.grants.every((grantId) => grantId !== first.nextGrantCursor));
  assert.deepEqual(new Set([...first.grants, ...next.grants]), new Set(grants));
});

for (const departure of ['leave', 'remove'] as const) {
  test(`${departure} ends Shared Sade grants even when the member rejoins before the next poll`, (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nhờ Mây đọc tài liệu rồi báo kết quả.',
      sade: { projectKey: key },
    });
    const plan = f.poll(0).delivery!;
    f.finish(0, plan.id, {
      kind: 'plan',
      plan: {
        summary: 'Let the named teammate check the document.',
        tasks: [work('check', { preferredMemberId: f.grants[1] })],
      },
    });
    const oldJob = f.poll(1).delivery!;
    assert.equal(oldJob.grantId, f.grants[1]);
    f.call(departure === 'leave' ? 1 : 0, {
      action: departure,
      groupId: f.groupId,
      ...(departure === 'remove' ? { userId: 'owner-B' } : {}),
    });
    f.call(0, { action: 'invite', groupId: f.groupId, account: 'owner-B' });
    f.call(1, { action: 'accept', groupId: f.groupId });
    f.call(1, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [{ localId: f.members[1], name: 'Mây', provider: 'codex' }],
    });
    const retried = f.poll(1, [oldJob.id]);
    assert.deepEqual(retried.active, []);
    assert.equal(retried.delivery, undefined);
    assert.equal(f.view().sadeRuns[0].state, 'blocked');
    assert.throws(
      () => f.finish(1, oldJob.id, { kind: 'done', summary: 'A late result' }),
      /grant is no longer valid/,
    );
    const listing = f.call(0, { action: 'read', groupId: f.groupId });
    assert.deepEqual(
      listing.sadeGrants.map(({ id }: { id: string }) => id),
      [f.grants[0]],
    );
  });
}

test('sharing the same profile again requires fresh Sade approval', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const teammate = { localId: f.members[1], name: 'Mây', provider: 'codex' };
  const share = (teammates: object[]) =>
    f.call(1, { action: 'teammates', groupId: f.groupId, teammates });
  const read = () => f.call(0, { action: 'read', groupId: f.groupId });
  const sharingId = () =>
    read().group.teammates.find((member: SharedTeammate) => member.localId === teammate.localId)
      .sharingId as string;
  const initial = sharingId();
  assert.ok(initial);
  assert.equal(read().sadeSharingId, true);
  const prior = f.store.get('sharedSadeGrant', f.grants[1]);
  share([{ ...teammate, name: 'Mây kiểm thử' }]);
  assert.deepEqual(f.store.get('sharedSadeGrant', f.grants[1]), prior);
  assert.equal(sharingId(), initial);
  share([]);
  share([teammate]);
  assert.equal(f.store.get<{ revoked?: boolean }>('sharedSadeGrant', f.grants[1]).revoked, true);
  const current = sharingId();
  assert.notEqual(current, initial);
  const grantIds = () => read().sadeGrants.map(({ id }: { id: string }) => id);
  assert.deepEqual(grantIds(), [f.grants[0]]);
  const delayed = {
    action: 'sade-grant',
    groupId: f.groupId,
    id: randomUUID(),
    teammateId: teammate.localId,
    sharingId: initial,
    projectKey: key,
    projectName: 'Fixture project',
    role: 'reviewer',
    platform: 'win32',
    allowWrites: true,
    turns: 8,
  };
  assert.throws(() => f.call(1, delayed), /Confirm the grant again/);
  assert.equal(f.store.lookup('sharedSadeGrant', delayed.id), undefined);
  const fresh = { ...delayed, id: randomUUID(), sharingId: current };
  f.call(1, fresh);
  assert.deepEqual(grantIds(), [f.grants[0], fresh.id]);
  assert.ok(read().sadeGrants.every((grant: object) => !('sharingId' in grant)));
  share([{ ...teammate, provider: 'claude' }]);
  assert.notEqual(sharingId(), current);
  assert.equal(f.store.get<{ revoked?: boolean }>('sharedSadeGrant', fresh.id).revoked, true);
  assert.deepEqual(grantIds(), [f.grants[0]]);
});

for (const change of ['leave', 'remove', 'unshare', 'replace provider'] as const) {
  test(`rejects a first grant from an older desktop after a teammate's ${change}`, (t) => {
    const f = fixture(undefined, { grantB: false });
    t.after(() => f.store.close());
    const teammate = { localId: f.members[1], name: 'Mây', provider: 'codex' };
    const publish = (teammates: object[]) =>
      f.call(1, { action: 'teammates', groupId: f.groupId, teammates });
    const read = () => f.call(1, { action: 'read', groupId: f.groupId });
    const delayed = {
      action: 'sade-grant',
      groupId: f.groupId,
      id: f.grants[1],
      teammateId: teammate.localId,
      projectKey: key,
      projectName: 'Fixture project',
      role: 'reviewer',
      platform: 'win32',
      allowWrites: false,
      turns: 1,
    };
    if (change === 'leave' || change === 'remove') {
      f.call(change === 'leave' ? 1 : 0, {
        action: change,
        groupId: f.groupId,
        ...(change === 'remove' ? { userId: 'owner-B' } : {}),
      });
      f.call(0, { action: 'invite', groupId: f.groupId, account: 'owner-B' });
      f.call(1, { action: 'accept', groupId: f.groupId });
    } else if (change === 'unshare') {
      publish([]);
    }
    const firstShare = { localId: randomUUID(), name: 'Gió', provider: 'gemini' };
    publish([
      { ...teammate, provider: change === 'replace provider' ? 'claude' : teammate.provider },
      firstShare,
    ]);

    assert.throws(() => f.call(1, delayed), /Update Kivuno to confirm the grant again/);
    assert.equal(f.store.lookup('sharedSadeGrant', delayed.id), undefined);
    const unrelated = { ...delayed, teammateId: firstShare.localId, id: randomUUID() };
    f.call(1, unrelated);
    const member = read().group.teammates.find(
      (member: SharedTeammate) => member.localId === teammate.localId,
    ) as SharedTeammate;
    assert.ok(member.sharingId);
    const fresh = { ...delayed, id: randomUUID(), sharingId: member.sharingId };
    f.call(1, fresh);
    assert.deepEqual(
      read().sadeGrants.map(({ id }: { id: string }) => id),
      [f.grants[0], unrelated.id, fresh.id],
    );
  });
}

test('an owner can finish syncing a revocation after leaving and being invited back', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const revoke = { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[1] };
  f.call(1, { action: 'leave', groupId: f.groupId });
  f.call(0, { action: 'invite', groupId: f.groupId, account: 'owner-B' });
  assert.throws(() => f.call(0, revoke), /Only this harness owner/);
  assert.deepEqual(f.call(1, revoke), { revoked: true });
  assert.deepEqual(f.call(1, revoke), { revoked: true });
  f.call(1, { action: 'accept', groupId: f.groupId });
  f.call(1, {
    action: 'teammates',
    groupId: f.groupId,
    teammates: [{ localId: f.members[1], name: 'Mây', provider: 'codex' }],
  });
  assert.equal(f.store.get<{ revoked: boolean }>('sharedSadeGrant', f.grants[1]).revoked, true);
});

test('a grant registration retry preserves its deadline and never reactivates a revoked grant', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const payload = {
    action: 'sade-grant',
    groupId: f.groupId,
    id: f.grants[1],
    teammateId: f.members[1],
    projectKey: key,
    projectName: 'Fixture project',
    role: 'reviewer',
    platform: 'win32',
    allowWrites: true,
    turns: 8,
  };
  const readGrant = () => f.store.get('sharedSadeGrant', payload.id);
  const before = readGrant();
  f.call(1, payload);
  assert.deepEqual(readGrant(), before);
  f.call(1, { action: 'sade-revoke', groupId: payload.groupId, grantId: payload.id });
  f.call(1, payload);
  assert.deepEqual(readGrant(), { ...(before as object), revoked: true });
});

test('the desktop keeps staged patches local after a grant is revoked or expires', async (t) => {
  const store = new Store(':memory:');
  const workspace = new Workspace(store, os.tmpdir(), os.tmpdir());
  t.after(async () => {
    await workspace.close();
    store.close();
  });
  const worker = workspace.sharedSade;
  const snapshot = async () =>
    (await worker.execute({ action: 'snapshot' })) as {
      results: { jobId: string }[];
      revocations: { groupId: string; grantId: string }[];
    };
  const queued = Array.from({ length: 3 }, () => ({
    id: randomUUID(),
    grantId: randomUUID(),
    phase: 'task',
    result: { kind: 'change', diff: patch, summary: 'Ready for independent review' },
  }));
  for (const { grantId } of queued)
    store.put('sharedSadeLocalGrant', { id: grantId, expiresAt: Date.now() + 60_000 });
  for (const receipt of queued) store.put('sharedSadeLocalReceipt', receipt);
  assert.deepEqual(
    (await snapshot()).results.map((entry) => entry.jobId),
    queued.map(({ id }) => id),
  );

  const [revoked, expired, stillGranted] = queued;
  const groupId = randomUUID();
  await worker.execute({ action: 'revoke', grantId: revoked.grantId, groupId });
  store.put('sharedSadeLocalGrant', { id: expired.grantId, expiresAt: Date.now() - 1 });
  assert.deepEqual(
    (await snapshot()).results.map((entry) => entry.jobId),
    [stillGranted.id],
  );
  assert.deepEqual(store.get('sharedSadeLocalReceipt', revoked.id), revoked);
  assert.deepEqual(store.get('sharedSadeLocalReceipt', expired.id), expired);
  assert.deepEqual((await snapshot()).revocations, [{ groupId, grantId: revoked.grantId }]);
  await worker.execute({ action: 'ack-revocations', ids: [revoked.grantId] });
  assert.deepEqual((await snapshot()).revocations, []);
});

test('the desktop replaces an unsafe queued patch with a versioned block before sync', async (t) => {
  const store = new Store(':memory:');
  const workspace = new Workspace(store, os.tmpdir(), os.tmpdir());
  t.after(async () => {
    await workspace.close();
    store.close();
  });
  const worker = workspace.sharedSade;
  const grantId = randomUUID();
  const jobId = randomUUID();
  const otherId = randomUUID();
  const grantExpiresAt = Date.now() + 60_000;
  const marker = 'sk-fixture-credential-000';
  store.put('sharedSadeLocalGrant', { id: grantId, expiresAt: grantExpiresAt });
  for (const id of [jobId, otherId]) {
    store.put('sharedSadeLocalReceipt', {
      id,
      grantId,
      phase: 'task',
      version: 2,
      result: {
        kind: 'change',
        diff: id === jobId ? { ...patch, stat: marker } : patch,
        summary: 'Ready for independent review.',
      },
    });
  }
  const queued = async () =>
    (
      (await worker.execute({ action: 'snapshot' })) as {
        results: { jobId: string; version: number; result: SharedFinish }[];
      }
    ).results;
  const first = await queued();
  assert.doesNotMatch(JSON.stringify(first), /fixture-credential-000/);
  assert.equal(first.find((entry) => entry.jobId === jobId)?.result.kind, 'blocked');
  assert.equal(first.find((entry) => entry.jobId === jobId)?.version, 3);
  assert.equal(first.find((entry) => entry.jobId === otherId)?.result.kind, 'change');
  assert.deepEqual(await queued(), first);
  assert.doesNotMatch(
    JSON.stringify(store.get('sharedSadeLocalReceipt', jobId)),
    /fixture-credential-000/,
  );
  for (const version of [2, 3]) {
    await worker.execute({
      action: 'exchange',
      acknowledged: [{ jobId, version }],
      active: [],
      reviews: [],
      updates: [],
    });
    assert.equal(
      (await queued()).some((entry) => entry.jobId === jobId),
      version === 2,
    );
  }
});

const managedHandoff =
  (providers: readonly ['claude', 'antigravity'] | readonly ['antigravity', 'claude']) =>
  async (t: TestContext) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sade-managed-handoff-')));
    const desktops: {
      workspace: Workspace;
      store: Store;
      memberId: string;
      projectId: string;
      repo: string;
    }[] = [];
    const command = path.resolve('tests/fixtures/managed-peer.mjs');
    const overrides = ['RELAY_CLAUDE_COMMAND', 'RELAY_ANTIGRAVITY_COMMAND'];
    const previous = overrides.map((name) => process.env[name]);
    for (const name of overrides) process.env[name] = command;
    t.after(async () => {
      for (const { workspace, store } of desktops) {
        await workspace.close();
        store.close();
      }
      for (const [index, name] of overrides.entries()) {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      }
      assert.equal(path.dirname(root), await realpath(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('sade-managed-handoff-'));
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    });

    const names = providers.map((provider) => (provider === 'claude' ? 'Claude' : 'Antigravity'));
    const origin = 'https://example.test/shared/managed-fixture.git';
    const fingerprint = canonicalSharedRepository(origin, 'main');
    const plan = {
      summary: `Hand the independently reviewed contract to ${names[1]}.`,
      tasks: [
        {
          ...work('contract', { scope: ['contract.txt'] }),
          kind: 'edit-files',
          preferredMemberId: 'member-1',
          requiredPlatform: 'any',
        },
        {
          ...work('check', { dependsOn: ['contract'], scope: ['contract.txt'] }),
          kind: 'research-read-only',
          preferredMemberId: 'member-2',
          requiredPlatform: 'any',
        },
      ],
    };
    const originRepo = path.join(root, names[0] + ' project');
    const reviewRepo = path.join(root, names[1] + ' project');
    await mkdir(originRepo);
    await git(originRepo, ['init', '-b', 'main']);
    await writeFile(path.join(originRepo, '.gitattributes'), 'contract.txt text eol=lf\n');
    await writeFile(path.join(originRepo, 'contract.txt'), 'Baseline contract\n');
    await git(originRepo, ['add', '.gitattributes', 'contract.txt']);
    await git(originRepo, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'Baseline',
    ]);
    await git(root, ['clone', '--', originRepo, reviewRepo]);
    for (const [index, provider] of providers.entries()) {
      const repo = index ? reviewRepo : originRepo;
      await git(repo, ['config', 'remote.origin.url', origin]);
      const dataDir = path.join(root, provider);
      const store = new Store(':memory:');
      const workspace = new Workspace(store, dataDir, repo);
      const member = store.addMember({
        name: provider,
        provider,
        role: index ? 'reviewer' : 'engineer',
      });
      store.updateMember(member.id, { managedRuntime: true });
      const projectId = randomUUID();
      store.put('project', {
        id: projectId,
        path: repo,
        name: 'Fixture project',
        goal: 'Verify a handoff',
        memberIds: [member.id],
        createdAt: new Date().toISOString(),
      });
      desktops.push({ workspace, store, memberId: member.id, projectId, repo });
      const home = workspace.home(member.id);
      await mkdir(home, { recursive: true });
      await writeFile(
        path.join(home, 'managed-fixture-account.json'),
        JSON.stringify({ marker: `fixture-profile-marker-${provider}` }),
      );
      await writeFile(path.join(home, 'managed-fixture-shared-plan.json'), JSON.stringify(plan));
      const signedIn = await workspace.refresh(member.id);
      assert.equal(
        signedIn.account?.type,
        provider === 'antigravity' ? 'antigravity-google' : 'claude-subscription',
      );
    }

    const cloud = fixture(providers, {
      key: fingerprint,
      members: desktops.map(({ memberId }) => memberId),
      patchHandoff: true,
      allowWritesB: false,
      turnsA: 2,
      turnsB: 2,
    });
    t.after(() => cloud.store.close());
    for (const [index, { workspace, memberId, projectId }] of desktops.entries()) {
      await workspace.sharedSade.execute({
        action: 'grant',
        groupId: cloud.groupId,
        id: cloud.grants[index],
        projectId,
        teammateId: memberId,
        turns: 2,
        allowWrites: !index,
      });
    }
    const request = {
      action: 'message',
      groupId: cloud.groupId,
      id: randomUUID(),
      content: `${names[0]} viết hợp đồng trong contract.txt, rồi cho ${names[1]} review và dùng hợp đồng đã duyệt để kiểm tra nha.`,
      sade: { projectKey: fingerprint },
    };
    cloud.call(0, request);
    const deliveries: SharedDelivery[] = [];
    async function pump(index: number) {
      const worker = desktops[index].workspace.sharedSade;
      const snapshot = (await worker.execute({ action: 'snapshot' })) as {
        grants: typeof cloud.grants;
        active: string[];
        waitingForCapacity?: string[];
        results: { jobId: string; result: SharedFinish; version: number }[];
      };
      assert.doesNotMatch(JSON.stringify(snapshot), /fixture-profile-marker|accessToken|projectId/);
      for (const { jobId, result } of snapshot.results) cloud.finish(index, jobId, result);
      const packet = cloud.call(index, {
        action: 'sade-poll',
        patchHandoff: true,
        active: snapshot.active,
        grants: snapshot.grants,
        waitingForCapacity: snapshot.waitingForCapacity,
      }) as ReturnType<typeof cloud.poll>;
      assert.doesNotMatch(JSON.stringify(packet), /fixture-profile-marker|accessToken|projectId/);
      if (packet.delivery) deliveries.push(packet.delivery);
      await worker.execute({
        action: 'exchange',
        active: packet.active,
        delivery: packet.delivery,
        reviews: packet.reviews,
        updates: packet.updates,
        revisionHandoff: packet.revisionHandoff,
        acknowledged: snapshot.results.map(({ jobId, version }) => ({ jobId, version })),
      });
    }
    function run() {
      return cloud.view().sadeRuns[0];
    }
    async function waitFor<T>(label: string, read: () => T | undefined | false) {
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        for (const index of [0, 1]) await pump(index);
        const state = run();
        assert.notEqual(state.state, 'blocked', JSON.stringify(state));
        const value = read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(run())}`);
    }

    const [author, reader] = desktops;
    const occupied = Array.from({ length: author.workspace.autonomy.capacity }, () =>
      author.workspace.autonomy.reserve(randomUUID(), author.memberId),
    );
    const releaseSlots = () => occupied.forEach((release) => release());
    t.after(releaseSlots);
    const reservations = t.mock.method(author.workspace.autonomy, 'reserve');
    await waitFor(
      'the same planner to wait for desktop capacity',
      () =>
        reservations.mock.callCount() >= 2 && /waiting.*desktop/i.test(run().jobs[0].summary || ''),
    );
    const waiting = author.store.sessions();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].status, 'idle');
    assert.equal(waiting[0].threadId, null);
    assert.deepEqual(
      new Set(reservations.mock.calls.map(({ arguments: [id] }) => id)),
      new Set([waiting[0].id]),
    );
    const planner = deliveries[0];
    assert.equal(planner.phase, 'plan');
    assert.equal(deliveries.length, 1);
    assert.equal(cloud.store.get<{ used: number }>('sharedSadeGrant', cloud.grants[0]).used, 1);
    assert.ok(
      !author.store.get<{ providerTurnConsumed?: boolean }>('sharedSadeLocalReceipt', planner.id)
        .providerTurnConsumed,
    );
    releaseSlots();

    const approval = await waitFor(
      'scoped file approval',
      () => author.workspace.sessions.approvals()[0],
    );
    assert.equal(approval.method, 'item/fileChange/requestApproval');
    const authorTask = author.store.get<Task>('task', approval.taskId);
    assert.equal(
      await readFile(path.join(authorTask.worktree!, 'contract.txt'), 'utf8'),
      'Baseline contract\n',
    );
    assert.deepEqual(
      deliveries.map(({ phase }) => phase),
      ['plan', 'task'],
    );
    assert.equal(reader.store.sessions().length, 0);
    await assert.rejects(author.workspace.accept(authorTask.id), /review|running/i);
    author.workspace.sessions.decide(approval.id, 'accept');
    await waitFor('independent review', () => {
      assert.equal(reader.workspace.sessions.approvals().length, 0, 'Review is already granted');
      return run().jobs.some(({ phase, state }) => phase === 'review' && state === 'done');
    });
    assert.ok(!deliveries.some(({ task }) => task?.key === 'check'));
    assert.equal(author.store.get<Task>('task', authorTask.id).status, 'review');
    assert.equal(
      await readFile(path.join(reader.repo, 'contract.txt'), 'utf8'),
      'Baseline contract\n',
    );
    await pump(0);
    const integrated = await author.workspace.accept(authorTask.id);
    assert.ok(integrated);
    await waitFor('dependent read', () => {
      assert.equal(reader.workspace.sessions.approvals().length, 0, 'The scoped read is granted');
      return run().state === 'done';
    });

    assert.deepEqual(
      deliveries.map(({ phase, grantId }) => [phase, grantId]),
      [
        ['plan', cloud.grants[0]],
        ['task', cloud.grants[0]],
        ['review', cloud.grants[1]],
        ['task', cloud.grants[1]],
      ],
    );
    assert.equal(
      await readFile(path.join(author.repo, 'contract.txt'), 'utf8'),
      'Native shared contract v1\n',
    );
    assert.equal(
      await readFile(path.join(reader.repo, 'contract.txt'), 'utf8'),
      'Baseline contract\n',
    );
    cloud.call(0, request);
    assert.equal(cloud.view().sadeRuns.length, 1);
    assert.equal(cloud.view().messages.length, 1);
    for (const [index, { workspace, store, memberId }] of desktops.entries()) {
      const calls = await readFile(
        path.join(workspace.home(memberId), 'managed-peer-events.jsonl'),
        'utf8',
      );
      const prompts = calls
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(
        prompts.filter(({ type, method }) => type === 'user' || method === 'session/prompt').length,
        2,
      );
      assert.doesNotMatch(calls, /authenticate/);
      assert.equal(store.all('providerTurnGrant').length, 0);
      assert.equal(
        cloud.store.get<{ used: number }>('sharedSadeGrant', cloud.grants[index]).used,
        2,
      );
      assert.deepEqual(
        store.sessions().map(({ model, reasoningEffort }) => [model, reasoningEffort]),
        providers[index] === 'antigravity'
          ? [
              [index ? 'agy-flash' : 'agy-controlled', 'high'],
              ['agy-controlled', 'medium'],
            ]
          : [
              [index ? 'sonnet' : 'default', 'high'],
              ['default', 'medium'],
            ],
      );
    }
  };

test(
  'one group message hands off through the actual Claude and Antigravity adapters',
  { timeout: 55000 },
  managedHandoff(['claude', 'antigravity']),
);
test(
  'one group message lets Antigravity plan and write with one file approval',
  { timeout: 55000 },
  managedHandoff(['antigravity', 'claude']),
);
test('matching owner on a different device cannot receive a granted job; another owner cannot revoke it', () => {
  const f = fixture();
  try {
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Sade plan this project.',
      sade: { projectKey: key },
    });
    assert.equal(f.poll(0, [], [f.grants[0]], randomUUID()).delivery, undefined);
    assert.equal(f.poll(1, [], [f.grants[0]]).delivery, undefined);
    assert.throws(
      () => f.call(1, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[0] }),
      /owner/,
    );
    assert.ok(f.poll(0).delivery);
  } finally {
    f.store.close();
  }
});

test('Shared Sade balances open implementation work without consuming the only independent reviewer', () => {
  for (const pinBackend of [false, true]) {
    const f = fixture(['gemini', 'codex']);
    try {
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content:
          'Bếp làm hợp đồng, Mây làm giao diện. Sade chia backend rồi nhờ một người độc lập kiểm tra cả giao diện và backend.',
        sade: { projectKey: key },
      });
      const planner = f.poll(0).delivery!;
      f.finish(0, planner.id, {
        kind: 'plan',
        plan: {
          summary: 'Use one contract for frontend and backend, then independently review both.',
          tasks: [
            work('contract', {
              kind: 'code',
              scope: ['docs/contract.md'],
              preferredMemberId: f.grants[0],
            }),
            work('frontend', {
              kind: 'design',
              preferredMemberId: f.grants[1],
              dependsOn: ['contract'],
            }),
            work('backend', {
              kind: 'code',
              dependsOn: ['contract'],
              ...(pinBackend && { preferredMemberId: f.grants[0] }),
            }),
            work('review', {
              kind: 'review',
              scope: ['src/frontend.ts', 'src/backend.ts'],
              dependsOn: ['frontend', 'backend'],
            }),
          ],
        },
      });
      const run = f.view().sadeRuns[0];
      if (pinBackend) {
        assert.equal(run.state, 'blocked');
        assert.match(run.error || '', /Independent review needs another/);
        assert.equal(f.poll(0).delivery, undefined);
        assert.equal(f.poll(1).delivery, undefined);
        continue;
      }
      assert.equal(run.state, 'running', run.error ?? 'The plan should be runnable.');
      assert.deepEqual(
        run.jobs.filter((job) => job.task).map((job) => [job.task!.key, job.grantId]),
        [
          ['contract', f.grants[0]],
          ['frontend', f.grants[1]],
          ['backend', f.grants[1]],
          ['review', f.grants[0]],
        ],
      );
      const contract = f.poll(0).delivery!;
      assert.equal(contract.task?.key, 'contract');
      f.finish(0, contract.id, {
        kind: 'unchanged',
        revision: sha,
        summary: 'The required contract already exists.',
      });
      for (const name of ['frontend', 'backend']) {
        const implementation = f.poll(1).delivery!;
        assert.equal(implementation.task?.key, name);
        const diff = { ...patch, files: [`src/${name}.ts`] };
        f.finish(1, implementation.id, { kind: 'change', diff, summary: `Updated ${name}.` });
        const patchReview = f.poll(0).delivery!;
        assert.equal(patchReview.phase, 'review');
        assert.deepEqual(patchReview.review, diff);
        f.finish(0, patchReview.id, {
          kind: 'review',
          verdict: 'approved',
          summary: 'The patch matches the assigned scope.',
        });
        f.finish(1, implementation.id, {
          kind: 'done',
          revision: sha,
          published: true,
          summary: `Integrated ${name}.`,
        });
      }
      const turnsUsed = () => f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used;
      const usedBefore = turnsUsed();
      assert.equal(f.poll(0).delivery, undefined, 'An older desktop cannot skip file validation');
      assert.equal(turnsUsed(), usedBefore);
      assert.match(
        f.view().sadeRuns[0].jobs.find((job) => job.task?.key === 'review')?.summary || '',
        /verify the files/,
      );
      const packet = f.call(0, {
        action: 'sade-poll',
        grants: [f.grants[0]],
        active: [],
        reviewedRevisionFiles: true,
        unchangedRevisionScopes: true,
      }) as ReturnType<typeof f.poll>;
      assert.equal(packet.supportsReviewedRevisionFiles, true);
      const review = packet.delivery!;
      assert.equal(review.task?.key, 'review');
      assert.deepEqual(review.task?.scope, ['src/frontend.ts', 'src/backend.ts']);
      assert.deepEqual(
        review.prerequisites.map(({ revision, patch }) => [revision, patch]),
        [
          [sha, undefined],
          [sha, undefined],
          [sha, undefined],
        ],
      );
      assert.deepEqual(
        review.prerequisites.map((item) => item.publishedFiles),
        [undefined, ['src/frontend.ts'], ['src/backend.ts']],
      );
      assert.doesNotMatch(JSON.stringify(f.view()), /publishedFiles/);
      f.finish(0, review.id, { kind: 'done', summary: 'Both integrated files checked.' });
      assert.equal(f.view().sadeRuns[0].state, 'done');
      assert.doesNotMatch(JSON.stringify(f.store.all('sharedSadeRun')), /publishedFiles/);
    } finally {
      f.store.close();
    }
  }
});

test('Shared Sade saves the last turn on the desktop required by a later task', () => {
  const f = fixture(['gemini', 'codex'], { turnsA: 2, mac: true, roleA: 'researcher' });
  try {
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Đọc phần cấu hình chung, rồi kiểm tra lỗi mở app trên Windows.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Keep a Windows turn available for verification after checking the configuration.',
        tasks: [
          work('configuration', { effort: 8 }),
          work('windows-check', { requiredPlatform: 'win32', dependsOn: ['configuration'] }),
        ],
      },
    });
    const run = f.view().sadeRuns[0];
    assert.equal(run.state, 'running', run.error ?? 'The plan should be runnable.');
    assert.equal(f.poll(0).delivery, undefined);
    assert.equal(run.jobs.find((job) => job.task?.key === 'windows-check')?.grantId, f.grants[0]);
    const configuration = f.poll(1).delivery!;
    assert.equal(configuration.task?.key, 'configuration');
    f.finish(1, configuration.id, { kind: 'done', summary: 'Read the shared configuration.' });
    const windows = f.poll(0).delivery!;
    assert.equal(windows.task?.key, 'windows-check');
    f.finish(0, windows.id, { kind: 'done', summary: 'Windows check completed.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
  } finally {
    f.store.close();
  }
});

test('an opted-in status update can close planning without assigning any work', () => {
  const f = fixture();
  try {
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Mình báo để nhóm biết thôi, chưa chạy việc gì nhé.',
      sade: { projectKey: key },
    };
    f.call(0, request);
    const plan = f.poll(0).delivery!;
    assert.equal(plan.phase, 'plan');
    f.finish(0, plan.id, {
      kind: 'plan',
      plan: { summary: 'The message shares progress with the group.', tasks: [] },
    });
    f.call(0, request);
    assert.equal(f.poll(0).delivery, undefined);
    assert.equal(f.poll(1).delivery, undefined);
    const [run] = f.view().sadeRuns;
    assert.equal(run.state, 'done');
    assert.deepEqual(
      run.jobs.map(({ phase, state }) => [phase, state]),
      [['plan', 'done']],
    );
    assert.equal(run.jobs[0].summary, 'The message shares progress with the group.');
  } finally {
    f.store.close();
  }
});

test('only the requester can clarify a duplicate harness name before any Shared Sade task starts', () => {
  const f = fixture(['gemini', 'gemini'], { names: ['Gemini', 'Gemini'] });
  try {
    const id = randomUUID();
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id,
      content: 'Nhờ Gemini kiểm tra phần cấu hình.',
      sade: { projectKey: key },
    });
    const original = f.poll(0).delivery!;
    assert.deepEqual(
      original.team.map(({ name, owner, ownedByRequester }) => [name, owner, ownedByRequester]),
      [
        ['Gemini', 'An', true],
        ['Gemini', 'Bình', false],
      ],
    );
    const summary = 'Bạn muốn Gemini của An hay Gemini của Bình kiểm tra cấu hình?';
    f.finish(0, original.id, { kind: 'question', summary });
    assert.equal(f.view().sadeRuns[0].jobs[0].state, 'waiting');
    assert.equal(f.poll(0).delivery, undefined);
    assert.equal(f.poll(1).delivery, undefined);
    const answer = {
      action: 'sade-answer',
      groupId: f.groupId,
      runId: id,
      jobId: original.id,
      answer: 'Gemini của Bình nhé.',
    };
    assert.throws(() => f.call(1, answer), /only the request author/i);
    f.call(0, answer);
    const resumed = f.poll(0).delivery!;
    assert.notEqual(resumed.id, original.id);
    assert.deepEqual(resumed.clarification, { question: summary, answer: answer.answer });
    assert.throws(
      () => f.finish(0, resumed.id, { kind: 'question', summary }),
      /cannot ask another question/,
    );
    const task = work('config', {
      preferredMemberId: sharedPlanMemberRef(
        resumed.team.findIndex((entry) => entry.owner === 'Bình'),
      ),
    });
    const plan = parseSharedGroupPlan(
      {
        summary: 'Check the configuration with the requester’s selected harness.',
        tasks: [{ ...task, kind: 'research-read-only', requiredPlatform: 'any' }],
      },
      resumed.team.map((entry) => entry.id),
    );
    f.finish(0, resumed.id, { kind: 'plan', plan });
    assert.equal(f.poll(0).delivery, undefined);
    const delivery = f.poll(1).delivery!;
    assert.equal(delivery.grantId, f.grants[1]);
    assert.equal(delivery.task?.key, 'config');
    f.finish(1, delivery.id, { kind: 'done', summary: 'Reviewed the scoped configuration.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
  } finally {
    f.store.close();
  }
});

test('a requester can resume planning after the named owner grants this project access', () => {
  const f = fixture(['gemini', 'gemini'], { grantB: false, turnsA: 2 });
  try {
    const id = randomUUID();
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id,
      content: 'Nhờ Gemini của Bình kiểm tra phần cấu hình.',
      sade: { projectKey: key },
    });
    const original = f.poll(0).delivery!;
    assert.deepEqual(
      original.team.map((entry) => entry.id),
      [f.grants[0]],
    );
    f.finish(0, original.id, {
      kind: 'question',
      summary: 'Bình cần cấp quyền cho project này. Báo lại khi quyền đã được bật nhé.',
    });
    const grant = {
      action: 'sade-grant',
      groupId: f.groupId,
      teammateId: f.members[1],
      projectName: 'Fixture project',
      role: 'researcher',
      platform: 'win32',
      allowWrites: false,
      turns: 1,
    };
    f.call(1, { ...grant, id: randomUUID(), projectKey: 'b'.repeat(64) });
    f.call(1, { ...grant, id: f.grants[1], projectKey: key });
    assert.equal(f.poll(1).delivery, undefined, 'granting access must not resume the request');
    f.call(0, {
      action: 'sade-answer',
      groupId: f.groupId,
      runId: id,
      jobId: original.id,
      answer: 'Bình đã cấp quyền cho project này.',
    });
    const resumed = f.poll(0).delivery!;
    assert.deepEqual(
      resumed.team.map((entry) => entry.id),
      f.grants,
    );
    f.finish(0, resumed.id, {
      kind: 'plan',
      plan: {
        summary: 'Use the newly granted teammate to read the configuration.',
        tasks: [work('config', { preferredMemberId: f.grants[1] })],
      },
    });
    const check = f.poll(1).delivery!;
    assert.equal(check.grantId, f.grants[1]);
    assert.equal(check.task?.key, 'config');
    f.finish(1, check.id, { kind: 'done', summary: 'Configuration checked in scope.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
    assert.equal(f.view().messages.filter((message) => message.id === id).length, 1);
  } finally {
    f.store.close();
  }
});

test('planner references resolve only to the supplied roster and preserve explicit platforms', () => {
  const reviewer = randomUUID();
  const draft = {
    summary: 'Review a general request and an explicitly assigned Mac check.',
    tasks: [
      { ...work('general'), preferredMemberId: 'auto', requiredPlatform: 'any' },
      work('named', { preferredMemberId: 'member-1', requiredPlatform: 'darwin' }),
    ],
  };
  const plan = parseSharedGroupPlan(draft, [reviewer]);
  assert.equal(plan.tasks[0].preferredMemberId, undefined);
  assert.equal(plan.tasks[0].requiredPlatform, undefined);
  assert.equal(plan.tasks[1].preferredMemberId, reviewer);
  assert.equal(plan.tasks[1].requiredPlatform, 'darwin');
  assert.throws(
    () => parseSharedGroupPlan({ summary: plan.summary, tasks: [work('missing')] }, [reviewer]),
    /requiredPlatform/,
  );
  assert.throws(() => parseSharedGroupPlan(draft, []), /teammate reference/);
  for (const fallbackMemberId of [randomUUID(), 'member-1']) {
    assert.throws(
      () =>
        parseSharedGroupPlan({ ...draft, tasks: [{ ...draft.tasks[1], fallbackMemberId }] }, [
          reviewer,
        ]),
      /teammate reference|different named primary/,
    );
  }
  assert.throws(
    () =>
      parseSharedGroupPlan(
        {
          ...draft,
          tasks: [work('outside', { preferredMemberId: randomUUID(), requiredPlatform: 'darwin' })],
        },
        [reviewer],
      ),
    /teammate reference/,
  );
});

test('an active request rejects a second Shared Groups dispatch until it completes', () => {
  const f = fixture();
  try {
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Check src/menu.ts.',
      sade: { projectKey: key },
    };
    const followup = { ...request, id: randomUUID(), content: 'Check the menu branch again.' };
    f.call(0, request);
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Check existing commits before editing the menu.',
        tasks: [
          work('menu', { kind: 'code', scope: ['src/menu.ts'], preferredMemberId: f.grants[0] }),
        ],
      },
    });
    const writing = f.poll(0).delivery!;
    assert.equal(writing.task?.key, 'menu');
    assert.throws(() => f.call(1, followup), /active Sade request/);
    assert.equal(f.view().messages.length, 1);
    assert.equal(f.poll(1).delivery, undefined);
    f.finish(0, writing.id, {
      kind: 'unchanged',
      summary: 'The first scoped change was already present.',
    });
    f.call(1, followup);
    assert.equal(f.view().messages.length, 2);
    assert.equal(f.poll(1).delivery?.phase, 'plan');
  } finally {
    f.store.close();
  }
});

test('a revoked assignment blocks pending deliveries and a clean writing result does not reserve a reviewer', () => {
  const f = fixture();
  try {
    const start = () => {
      const id = randomUUID();
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id,
        content: 'Phần này đã có trong commit. Kiểm tra rồi tránh làm lại nhé.',
        sade: { projectKey: key },
      });
      return f.poll(0).delivery!;
    };
    const first = start();
    f.finish(0, first.id, {
      kind: 'plan',
      plan: {
        summary: 'Check existing code before making changes.',
        tasks: [work('already-done', { kind: 'code', preferredMemberId: f.grants[0] })],
      },
    });
    const writer = f.poll(0).delivery!;
    assert.throws(
      () =>
        f.finish(0, writer.id, {
          kind: 'change',
          diff: patch,
          summary: 'This legacy grant only shares with a reviewer.',
          portable: true,
        }),
      /not granted reviewed patch handoff/,
    );
    f.finish(0, writer.id, {
      kind: 'unchanged',
      summary: 'The expected patch is already in the project.',
    });
    assert.equal(f.view().sadeRuns.at(-1)?.state, 'done');
    assert.equal(f.poll(1).delivery, undefined);
    const second = start();
    f.finish(0, second.id, {
      kind: 'plan',
      plan: {
        summary: 'Coordinate each owner’s part of the remaining work.',
        tasks: [
          work('first', { preferredMemberId: f.grants[0] }),
          work('second', { preferredMemberId: f.grants[1] }),
        ],
      },
    });
    f.call(1, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[1] });
    assert.equal(
      f.poll(0).delivery,
      undefined,
      'Check all queued permissions before dispatching the first task',
    );
    assert.equal(f.view().sadeRuns.at(-1)?.state, 'blocked');
  } finally {
    f.store.close();
  }
});

for (const firstChanges of [false, true]) {
  test(`a concurrent writer waits while the first task ${firstChanges ? 'uses its review turn' : 'can release its review turn'}`, () => {
    const f = fixture(['gemini', 'codex'], { turnsB: 1 });
    try {
      const device = randomUUID();
      const profile = randomUUID();
      const secondGrant = randomUUID();
      f.store.put('desktopDevice', {
        id: device,
        owner: { id: 'owner-A', name: 'An' },
        revoked: false,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        tokenHash: 'alternate-device-fixture',
      });
      f.call(0, {
        action: 'teammates',
        groupId: f.groupId,
        teammates: [
          { localId: f.members[0], provider: 'gemini', name: 'Bếp' },
          { localId: profile, provider: 'claude', name: 'Second author profile' },
        ],
      });
      f.call(
        0,
        {
          action: 'sade-grant',
          groupId: f.groupId,
          id: secondGrant,
          teammateId: profile,
          projectKey: key,
          projectName: 'Fixture project',
          role: 'engineer',
          platform: 'win32',
          allowWrites: true,
          turns: 2,
        },
        device,
      );
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content: 'Kiểm tra hai file riêng, sửa chỗ nào còn thiếu và nhờ Bình xem phần sửa.',
        sade: { projectKey: key },
      });
      const planner = f.poll(0).delivery!;
      f.finish(0, planner.id, {
        kind: 'plan',
        plan: {
          summary: 'Check both scoped files and review any changes independently.',
          tasks: [
            work('first', { kind: 'code', preferredMemberId: f.grants[0] }),
            work('second', { kind: 'code', preferredMemberId: secondGrant, scope: patch.files }),
          ],
        },
      });
      const first = f.poll(0).delivery!;
      assert.equal(first.task?.key, 'first');
      assert.equal(f.poll(0, [], [secondGrant], device).delivery, undefined);
      assert.match(
        f.view().sadeRuns[0].jobs.find((job) => job.task?.key === 'second')?.summary || '',
        /Waiting for an independent review turn/,
      );
      assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', secondGrant).used, 0);
      assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);

      if (firstChanges) {
        const firstPatch = { ...patch, files: ['src/first.ts'] };
        f.finish(0, first.id, {
          kind: 'change',
          diff: firstPatch,
          summary: 'Completed the first file.',
        });
        assert.equal(f.poll(0, [], [secondGrant], device).delivery, undefined);
        const review = f.poll(1).delivery!;
        assert.deepEqual(review.review, firstPatch);
        f.finish(1, review.id, {
          kind: 'review',
          verdict: 'approved',
          summary: 'Verified the change.',
        });
        assert.equal(f.poll(0, [], [secondGrant], device).delivery, undefined);
        assert.equal(f.poll(0, [first.id]).reviews[0]?.digest, reviewDigest(firstPatch));
        f.finish(0, first.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });

        assert.equal(f.poll(0, [], [secondGrant], device).delivery, undefined);
        assert.equal(f.view().sadeRuns[0].state, 'blocked');
        assert.equal(f.view().sadeRuns[0].jobs.find((job) => job.id === first.id)?.state, 'done');
        assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', secondGrant).used, 0);
        return;
      }

      f.finish(0, first.id, { kind: 'unchanged', summary: 'The scoped file is already correct.' });
      const second = f.poll(0, [], [secondGrant], device).delivery!;
      assert.equal(second.task?.key, 'second');
      f.call(
        0,
        {
          action: 'sade-finish',
          jobId: second.id,
          result: { kind: 'change', diff: patch, summary: 'Completed the second file.' },
        },
        device,
      );
      const review = f.poll(1).delivery!;
      assert.equal(review.phase, 'review');
      assert.equal(review.grantId, f.grants[1]);
      assert.deepEqual(review.review, patch);
      assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 1);
      f.finish(1, review.id, {
        kind: 'review',
        verdict: 'approved',
        summary: 'Verified the change.',
      });
      f.call(
        0,
        {
          action: 'sade-finish',
          jobId: second.id,
          result: { kind: 'done', revision: sha, summary: 'Integrated locally.' },
        },
        device,
      );
      assert.equal(f.view().sadeRuns[0].state, 'done');
    } finally {
      f.store.close();
    }
  });
}

test('Shared Sade reports a missing review turn before dispatching a writer', () => {
  const f = fixture(['gemini', 'codex'], { turnsB: 1 });
  try {
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nhờ Bếp sửa file còn Mây viết báo cáo về phần đã tích hợp.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Edit the file and report after integration.',
        tasks: [
          work('write', { kind: 'code', preferredMemberId: f.grants[0] }),
          work('report', { preferredMemberId: f.grants[1], dependsOn: ['write'] }),
        ],
      },
    });
    assert.equal(f.poll(0).delivery, undefined);
    assert.equal(f.poll(1).delivery, undefined);
    assert.equal(f.view().sadeRuns[0].state, 'blocked');
    assert.match(f.view().sadeRuns[0].error || '', /no spare independent review turn/);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used, 1);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
  } finally {
    f.store.close();
  }
});

for (const siblingRunning of [false, true]) {
  test(`Shared Sade releases a rejected workflow ${siblingRunning ? 'after its running sibling expires' : 'as soon as its review finishes'}`, (t) => {
    const f = fixture();
    t.after(() => f.store.close());
    const request = {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nhờ Bếp sửa file rồi Mây kiểm tra giúp.',
      sade: { projectKey: key },
    };
    f.call(0, request);
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Prepare the change and review it before integration.',
        tasks: [
          work('edit', { kind: 'code', preferredMemberId: f.grants[0], scope: patch.files }),
          ...(siblingRunning ? [work('notes', { preferredMemberId: f.grants[0] })] : []),
        ],
      },
    });
    const writer = f.poll(0).delivery!;
    f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'Draft ready.' });
    const sibling = siblingRunning ? f.poll(0, [writer.id]).delivery : undefined;
    if (siblingRunning) assert.equal(sibling?.task?.key, 'notes');
    const review = f.poll(1).delivery!;
    assert.equal(review.phase, 'review');
    f.finish(1, review.id, {
      kind: 'review',
      verdict: 'changes',
      summary: 'Handle the boundary case.',
    });
    assert.equal(f.view().sadeRuns[0].state, 'blocked');
    assert.throws(
      () => f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Old change.' }),
      /no longer running/,
    );

    const retry = { ...request, id: randomUUID(), content: 'Sửa lại cùng file ở trường hợp biên.' };
    if (sibling) {
      assert.throws(() => f.call(0, retry), /previous Sade request is stopping/);
      assert.equal(f.view().messages.length, 1);
      assert.deepEqual(f.poll(0, [sibling.id]).active, []);
      const record = f.store.get<{ id: string; jobs: { id: string; deadline?: number }[] }>(
        'sharedSadeRun',
        request.id,
      );
      record.jobs.find((job) => job.id === sibling.id)!.deadline = 0;
      f.store.put('sharedSadeRun', record);
    }

    f.call(0, retry);
    assert.equal(f.view().messages.length, 2);
    const next = f.poll(0).delivery!;
    assert.equal(next.phase, 'plan');
    assert.notEqual(next.id, planner.id);
  });
}

for (const scenario of [
  'author exhausted',
  'reviewer exhausted',
  'desktop disconnected',
  'second rejection',
  'unchanged patch',
  'empty revision',
  'older desktop',
] as const) {
  test(`Shared Sade stops automatic revision after ${scenario}`, () => {
    const f = fixture(['gemini', 'codex'], {
      reviewRevision: scenario !== 'older desktop',
      turnsA: scenario === 'author exhausted' ? 2 : 5,
      turnsB: scenario === 'reviewer exhausted' ? 1 : 3,
    });
    try {
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content: 'Sửa file và nhờ một người độc lập review.',
        sade: { projectKey: key },
      });
      const plan = f.poll(0).delivery!;
      f.finish(0, plan.id, {
        kind: 'plan',
        plan: {
          summary: 'Run the scoped edit with independent patch review.',
          tasks: [
            work('write', { kind: 'code', scope: patch.files, preferredMemberId: f.grants[0] }),
          ],
        },
      });
      const writer = f.poll(0).delivery!;
      const propose = (job: SharedDelivery, diff = patch) =>
        f.finish(0, job.id, { kind: 'change', diff, summary: 'Scoped proposal.' });
      const reject = (job: SharedDelivery) =>
        f.finish(1, job.id, {
          kind: 'review',
          verdict: 'changes',
          summary: 'Handle the limit case.',
        });
      propose(writer);
      reject(f.poll(1).delivery!);
      const revised = ['second rejection', 'unchanged patch', 'empty revision'].includes(scenario);
      if (revised) {
        const revision = f.poll(0, [writer.id]).delivery!;
        assert.equal(revision.reviewRevision?.previousJobId, writer.id);
        assert.throws(
          () =>
            f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Obsolete attempt.' }),
          /unavailable/,
        );
        if (scenario === 'second rejection') {
          propose(revision, { ...patch, diff: '+export const value = 2;\n' });
          reject(f.poll(1).delivery!);
        } else if (scenario === 'unchanged patch') {
          propose(revision);
          assert.match(f.view().sadeRuns[0].error || '', /same rejected change/);
        } else {
          f.finish(0, revision.id, {
            kind: 'unchanged',
            summary: 'Returned to the initial state.',
          });
          assert.match(f.view().sadeRuns[0].error || '', /produced no patch/);
        }
      } else if (scenario === 'desktop disconnected') {
        assert.equal(f.view().sadeRuns[0].state, 'running');
        assert.equal(f.poll(0).delivery, undefined);
        assert.match(f.view().sadeRuns[0].error || '', /original author session/);
      }
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
      assert.equal(f.poll(0, [writer.id]).delivery, undefined);
      assert.equal(f.poll(1).delivery, undefined);
      assert.equal(
        f.store.get<{ used: number }>('sharedSadeGrant', f.grants[0]).used,
        2 + Number(revised),
      );
      assert.equal(
        f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used,
        1 + Number(scenario === 'second rejection'),
      );
    } finally {
      f.store.close();
    }
  });
}

for (const [backupChoice, expectation] of [
  ['named', 'uses the named review backup'],
  ['none', 'keeps the pinned reviewer'],
  ['author', 'rejects a backup owned by the author'],
] as const) {
  test(`a revised patch ${expectation} when the first reviewer exhausts its turns`, (t) => {
    const f = fixture(['gemini', 'codex'], { turnsA: 5, turnsB: 1, reviewRevision: true });
    t.after(() => f.store.close());
    const backupProfile = randomUUID();
    const backup = randomUUID();
    const backupOwner = backupChoice === 'author' ? 0 : 1;
    f.call(backupOwner, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [
        {
          localId: f.members[backupOwner],
          provider: backupOwner ? 'codex' : 'gemini',
          name: backupOwner ? 'Mây' : 'Bếp',
        },
        { localId: backupProfile, provider: 'claude', name: 'Sổ tay' },
      ],
    });
    f.call(backupOwner, {
      action: 'sade-grant',
      groupId: f.groupId,
      id: backup,
      teammateId: backupProfile,
      projectKey: key,
      projectName: 'Fixture project',
      role: 'reviewer',
      platform: 'win32',
      allowWrites: false,
      turns: 1,
    });
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content:
        backupChoice === 'named'
          ? 'Bếp sửa file rồi Mây review. Nếu Mây hết lượt thì nhờ Sổ tay.'
          : backupChoice === 'author'
            ? 'Bếp sửa file rồi Mây review. Nếu Mây hết lượt thì nhờ Sổ tay của Bếp.'
            : 'Bếp sửa file rồi chỉ nhờ Mây review.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Prepare the change and preserve the requested reviewer and fallback.',
        tasks: [
          work('write', { kind: 'code', scope: patch.files, preferredMemberId: f.grants[0] }),
          work('audit', {
            kind: 'review',
            scope: patch.files,
            dependsOn: ['write'],
            preferredMemberId: f.grants[1],
            ...(backupChoice === 'none' ? {} : { fallbackMemberId: backup }),
          }),
        ],
      },
    });
    const writer = f.poll(0).delivery!;
    f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'Initial change.' });
    const review = f.poll(1, [], [f.grants[1], backup]).delivery!;
    assert.equal(review.grantId, f.grants[1]);
    const verdict = {
      kind: 'review',
      verdict: 'changes',
      summary: 'Adjust the boundary.',
    } as const;
    f.finish(1, review.id, verdict);
    if (backupChoice !== 'named') {
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
      assert.equal(f.poll(1, [], [backup]).delivery, undefined);
      assert.equal(f.poll(0, [writer.id], [f.grants[0], backup]).delivery, undefined);
      return;
    }

    const revision = f.poll(0, [writer.id]).delivery!;
    assert.equal(revision?.reviewRevision?.previousJobId, writer.id);
    const revised = { ...patch, diff: '+export const value = 2;\n' };
    f.finish(0, revision.id, { kind: 'change', diff: revised, summary: 'Corrected the boundary.' });
    const second = f.poll(1, [], [f.grants[1], backup]).delivery!;
    assert.equal(second.grantId, backup);
    assert.equal(second.phase, 'review');
    assert.deepEqual(second.review?.files, patch.files);
    assert.equal(second.review?.diff, revised.diff);
    assert.throws(() => f.finish(1, review.id, verdict), /unavailable/);
    f.finish(1, second.id, {
      kind: 'review',
      verdict: 'approved',
      summary: 'Verified the change.',
    });
    f.finish(0, revision.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
    for (const id of [f.grants[1], backup])
      assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', id).used, 1);
  });
}

test('planned patch reviews use their allocated turns and all verdicts are required', () => {
  const f = fixture(['gemini', 'codex'], { turnsB: 2 });
  try {
    const scope = ['src/example.ts'];
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Sửa phép tính rồi nhờ Mây kiểm cả giá trị biên và logic tính.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Check logic and boundary cases in the exact change.',
        tasks: [
          work('write', { kind: 'code', scope, preferredMemberId: f.grants[0] }),
          work('logic', {
            kind: 'review',
            scope,
            preferredMemberId: f.grants[1],
            dependsOn: ['write'],
          }),
          work('limits', {
            kind: 'review',
            scope,
            preferredMemberId: f.grants[1],
            dependsOn: ['write'],
          }),
        ],
      },
    });
    const writer = f.poll(0).delivery!;
    assert.equal(writer.requiresPublication, false);
    assert.equal(f.poll(1).delivery, undefined);
    const change = { kind: 'change', diff: patch, summary: 'Ready for both checks.' } as const;
    f.finish(0, writer.id, change);
    f.finish(0, writer.id, change);
    const approvals = {
      kind: 'review',
      verdict: 'approved',
      summary: 'Verified the assigned check.',
    } as const;
    const first = f.poll(1).delivery!;
    assert.equal(first.phase, 'review');
    assert.deepEqual(first.review, patch);
    f.finish(1, first.id, approvals);
    assert.deepEqual(f.poll(0, [writer.id]).reviews, []);
    assert.throws(
      () => f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' }),
      /independent review/,
    );
    const second = f.poll(1).delivery!;
    assert.equal(second.phase, 'review');
    assert.deepEqual(second.review, patch);
    assert.notEqual(second.id, first.id);
    f.finish(1, second.id, approvals);
    assert.deepEqual(f.poll(0, [writer.id]).reviews, [
      { jobId: writer.id, digest: reviewDigest(patch) },
    ]);
    f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
    assert.equal(f.poll(1).delivery, undefined);
    assert.equal(f.view().sadeRuns[0].state, 'done');
    assert.equal(f.view().sadeRuns[0].jobs.filter((job) => job.phase === 'review').length, 2);
  } finally {
    f.store.close();
  }
});

test('a planned review skips a different provider profile owned by the author', () => {
  const f = fixture(['gemini', 'codex'], { roleB: 'researcher' });
  try {
    const profile = randomUUID();
    const alternateGrant = randomUUID();
    f.call(0, {
      action: 'teammates',
      groupId: f.groupId,
      teammates: [
        { localId: f.members[0], provider: 'gemini', name: 'Bếp' },
        { localId: profile, provider: 'claude', name: 'Alternate reviewer' },
      ],
    });
    f.call(0, {
      action: 'sade-grant',
      id: alternateGrant,
      groupId: f.groupId,
      teammateId: profile,
      projectKey: key,
      projectName: 'Fixture project',
      role: 'reviewer',
      platform: 'win32',
      allowWrites: false,
      turns: 2,
    });
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nhờ Gemini sửa file, rồi chọn người khác xem lại bản sửa.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Route the reviewed change to another owner.',
        tasks: [
          work('write', { kind: 'code', scope: patch.files, preferredMemberId: f.grants[0] }),
          work('audit', { kind: 'review', scope: patch.files, dependsOn: ['write'] }),
        ],
      },
    });
    const planned = f.view().sadeRuns[0].jobs.find((job) => job.task?.key === 'audit')!;
    assert.equal(planned.grantId, f.grants[1]);
    assert.equal(planned.phase, 'review');
    const writer = f.poll(0).delivery!;
    f.finish(0, writer.id, { kind: 'change', diff: patch, summary: 'A bounded change.' });
    assert.equal(f.poll(0, [writer.id], [f.grants[0], alternateGrant]).delivery, undefined);
    assert.equal(f.poll(1).delivery?.id, planned.id);
  } finally {
    f.store.close();
  }
});

for (const olderPlan of [false, true]) {
  test(`Shared Sade ${olderPlan ? 'blocks an old self-review assignment' : 'allows an independent tester to review'} through an intermediate task`, () => {
    const f = fixture();
    try {
      const runId = randomUUID();
      const scope = ['src/signup.ts'];
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: runId,
        content: 'Bếp làm phần đăng ký. Cho kiểm thử rồi review riêng phần code.',
        sade: { projectKey: key },
      });
      const planner = f.poll(0).delivery!;
      f.finish(0, planner.id, {
        kind: 'plan',
        plan: {
          summary: 'Write the signup change, test it, then review the source.',
          tasks: [
            work('source', { kind: 'code', scope, preferredMemberId: f.grants[0] }),
            work('test', { scope, dependsOn: ['source'], preferredMemberId: f.grants[1] }),
            work('audit', { kind: 'review', scope: ['src'], dependsOn: ['test'] }),
          ],
        },
      });
      const persisted = f.store.get<SharedSadeRun>('sharedSadeRun', runId);
      const audit = persisted.jobs.find((job) => job.task?.key === 'audit')!;
      assert.equal(audit.grantId, f.grants[1]);
      if (olderPlan) {
        audit.grantId = f.grants[0];
        f.store.put('sharedSadeRun', persisted);
      }
      const writer = f.poll(0).delivery!;
      f.finish(0, writer.id, {
        kind: 'unchanged',
        revision: sha,
        summary: 'Source already exists.',
      });
      const testing = f.poll(1).delivery!;
      assert.equal(testing.task?.key, 'test');
      f.finish(1, testing.id, { kind: 'done', summary: 'Read-only verification passed.' });
      if (olderPlan) {
        assert.equal(f.poll(0).delivery, undefined);
        assert.match(f.view().sadeRuns[0].error || '', /did not write the files under review/);
      } else {
        const reviewing = f.poll(1).delivery!;
        assert.equal(reviewing.id, audit.id);
        assert.deepEqual(
          reviewing.prerequisites.map((item) => item.revision),
          [sha, undefined],
        );
        f.finish(1, reviewing.id, { kind: 'done', summary: 'Independent review finished.' });
        assert.equal(f.view().sadeRuns[0].state, 'done');
      }
    } finally {
      f.store.close();
    }
  });
}

test('a planned review checks existing files when the author has no diff', () => {
  const f = fixture(['gemini', 'codex'], { turnsB: 1 });
  try {
    const scope = ['src/example.ts'];
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: randomUUID(),
      content: 'Nếu đã có bản sửa thì nhờ Mây đọc lại file hiện có.',
      sade: { projectKey: key },
    });
    const planner = f.poll(0).delivery!;
    f.finish(0, planner.id, {
      kind: 'plan',
      plan: {
        summary: 'Keep the requested read-only check even if the worktree is unchanged.',
        tasks: [
          work('write', { kind: 'code', scope, preferredMemberId: f.grants[0] }),
          work('check', {
            kind: 'review',
            scope,
            preferredMemberId: f.grants[1],
            dependsOn: ['write'],
          }),
        ],
      },
    });
    const writer = f.poll(0).delivery!;
    f.finish(0, writer.id, {
      kind: 'unchanged',
      summary: 'The fix is already present.',
      revision: sha,
    });
    const oldDesktop = f.call(1, {
      action: 'sade-poll',
      grants: [f.grants[1]],
      active: [],
    }) as ReturnType<typeof f.poll>;
    assert.equal(oldDesktop.delivery, undefined);
    assert.equal(f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used, 0);
    const check = f.poll(1).delivery!;
    assert.equal(check.phase, 'task');
    assert.equal(check.task?.kind, 'review');
    assert.equal(check.review, undefined);
    assert.equal(check.prerequisites[0]?.revision, sha);
    assert.deepEqual(check.prerequisites[0]?.unchangedCheckout, {
      scopes: scope,
      importedPatchDigests: [],
    });
    assert.doesNotMatch(JSON.stringify(f.view()), /unchangedCheckout/);
    f.finish(1, check.id, { kind: 'done', summary: 'Verified the existing file.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
    assert.doesNotMatch(JSON.stringify(f.store.all('sharedSadeRun')), /unchangedCheckout/);
  } finally {
    f.store.close();
  }
});

for (const missing of ['Git revision', 'matching prerequisite patch'] as const) {
  test(`an unchanged result without a ${missing} cannot release dependent work`, () => {
    const f = fixture();
    try {
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: randomUUID(),
        content: 'Use the existing implementation for the follow-up if present.',
        sade: { projectKey: key },
      });
      const plan = f.poll(0).delivery!;
      f.finish(0, plan.id, {
        kind: 'plan',
        plan: {
          summary: 'Use the author’s existing work before the dependent check.',
          tasks: [
            work('write', { kind: 'code', preferredMemberId: f.grants[0] }),
            work('check', { preferredMemberId: f.grants[1], dependsOn: ['write'] }),
          ],
        },
      });
      const writer = f.poll(0).delivery!;
      f.finish(0, writer.id, {
        kind: 'unchanged',
        summary: 'The existing implementation is enough.',
        ...(missing === 'matching prerequisite patch'
          ? { revision: sha, importedPatchDigests: [key] }
          : {}),
      });
      assert.equal(f.poll(1).delivery, undefined);
      assert.equal(f.view().sadeRuns[0].state, 'blocked');
      assert.match(
        f.view().sadeRuns[0].error || '',
        missing === 'Git revision'
          ? /share the Git revision with dependent tasks/
          : /patch outside its prerequisites/,
      );
    } finally {
      f.store.close();
    }
  });
}

for (const responseLost of [false, true]) {
  test(`a completed author can revoke permission ${responseLost ? 'before retrying delivery of a reviewed prerequisite' : 'before a reviewed prerequisite reaches a dependent harness'}`, () => {
    const f = fixture(['gemini', 'codex'], { patchHandoff: true });
    try {
      const runId = randomUUID();
      f.call(0, {
        action: 'message',
        groupId: f.groupId,
        id: runId,
        content: 'Prepare the contract, then implement the interface.',
        sade: { projectKey: key },
      });
      const plan = f.poll(0).delivery!;
      f.finish(0, plan.id, {
        kind: 'plan',
        plan: {
          summary: 'Share the reviewed contract before starting the interface.',
          tasks: [
            work('contract', {
              kind: 'code',
              scope: ['src/example.ts'],
              preferredMemberId: f.grants[0],
            }),
            work('interface', { dependsOn: ['contract'], preferredMemberId: f.grants[1] }),
          ],
        },
      });
      const author = f.poll(0).delivery!;
      f.finish(0, author.id, {
        kind: 'change',
        summary: 'Ready for independent review.',
        diff: patch,
        portable: true,
      });
      const reviewer = f.poll(1).delivery!;
      f.finish(1, reviewer.id, {
        kind: 'review',
        verdict: 'approved',
        summary: 'Verified the source change.',
      });
      f.finish(0, author.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
      if (responseLost) {
        const first = f.poll(1).delivery;
        assert.equal(first?.task?.key, 'interface');
        assert.deepEqual(first?.prerequisites[0]?.patch?.change, patch);
      }
      f.call(0, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[0] });
      assert.equal(f.poll(1).delivery, undefined);
      assert.match(f.view().sadeRuns[0].error || '', /withdrew permission/);
      assert.doesNotMatch(
        JSON.stringify(f.store.get('sharedSadeRun', runId)),
        /export const value/,
      );
    } finally {
      f.store.close();
    }
  });
}

test('private review data stays local on submission and in previously stored Shared Sade patches', async (t) => {
  const marker = 'sk-fixture-credential-000';
  const unsafePatches = [
    { label: 'diff body', change: { ...patch, diff: `+const value = "${marker}";\\n` } },
    { label: 'diff stat', change: { ...patch, stat: `src/${marker}.ts | 1 +` } },
    { label: 'file list', change: { ...patch, files: [`src/${marker}.ts`] } },
    {
      label: 'private key block',
      change: {
        ...patch,
        diff: `+-----BEGIN OPENSSH PRIVATE KEY-----\\n+${marker.slice(3)}\\n+-----END OPENSSH PRIVATE KEY-----\\n`,
      },
    },
  ];
  const scenarios = [
    ...unsafePatches.map(({ label, change }) => ({ label, change, stage: 'submission' })),
    { label: 'queued review', change: unsafePatches[1].change, stage: 'stored review' },
    { label: 'approved prerequisite', change: unsafePatches[3].change, stage: 'stored handoff' },
    { label: 'review finishing', change: unsafePatches[2].change, stage: 'stored finish' },
  ];
  for (const { label, change, stage } of scenarios) {
    await t.test(label, () => {
      const f = fixture(['claude', 'antigravity'], { patchHandoff: true });
      try {
        const runId = randomUUID();
        f.call(0, {
          action: 'message',
          groupId: f.groupId,
          id: runId,
          content: 'Prepare the contract and then implement the interface.',
          sade: { projectKey: key },
        });
        const plan = f.poll(0).delivery!;
        f.finish(0, plan.id, {
          kind: 'plan',
          plan: {
            summary: 'Prepare the contract with independent review before the interface.',
            tasks: [
              work('contract', {
                kind: 'code',
                scope: ['src'],
                preferredMemberId: f.grants[0],
              }),
              work('interface', { dependsOn: ['contract'], preferredMemberId: f.grants[1] }),
            ],
          },
        });
        const writer = f.poll(0).delivery!;
        f.finish(0, writer.id, {
          kind: 'change',
          diff: stage === 'submission' ? change : patch,
          summary: 'Ready for independent review.',
          portable: true,
        });
        const approval = {
          kind: 'review',
          verdict: 'approved',
          summary: 'Verified the source change.',
        } as const;
        const reviewer =
          stage === 'stored finish' || stage === 'stored handoff' ? f.poll(1).delivery! : undefined;
        if (stage === 'stored handoff') {
          f.finish(1, reviewer!.id, approval);
          f.finish(0, writer.id, { kind: 'done', revision: sha, summary: 'Integrated locally.' });
        }
        const stored = () =>
          f.store.get<
            Omit<SharedSadeRun, 'jobs'> & {
              jobs: { id: string; change?: typeof patch }[];
            }
          >('sharedSadeRun', runId);
        if (stage !== 'submission') {
          const run = stored();
          const source = run.jobs.find(({ id }) => id === writer.id)!;
          assert.deepEqual(source.change, patch);
          source.change = change;
          f.store.put('sharedSadeRun', run);
        }
        if (stage === 'stored finish') {
          assert.deepEqual(f.finish(1, reviewer!.id, approval), { accepted: true });
          assert.equal(stored().state, 'blocked');
        }
        assert.equal(Boolean(f.poll(1).delivery), false);
        assert.equal(f.poll(0, [writer.id]).reviews.length, 0);
        assert.equal(f.view().sadeRuns[0].state, 'blocked');
        assert.match(f.view().sadeRuns[0].error || '', /cannot be safely shared/);
        assert.doesNotMatch(
          JSON.stringify(stored()),
          /fixture-credential-000|BEGIN OPENSSH PRIVATE KEY/,
        );
        assert.equal(
          f.store.get<{ used: number }>('sharedSadeGrant', f.grants[1]).used,
          reviewer ? 1 : 0,
        );
      } finally {
        f.store.close();
      }
    });
  }
});

test('an unread task update blocks a stale completion without releasing dependent work', () => {
  const f = fixture(['claude', 'antigravity'], { taskUpdates: true });
  try {
    const runId = randomUUID();
    f.call(0, {
      action: 'message',
      groupId: f.groupId,
      id: runId,
      content: 'Read the contract before continuing.',
      sade: { projectKey: key },
    });
    const plan = f.poll(0).delivery!;
    f.finish(0, plan.id, {
      kind: 'plan',
      plan: {
        summary: 'Verify the contract before the next task starts.',
        tasks: [
          work('contract', { preferredMemberId: f.grants[0] }),
          work('interface', { dependsOn: ['contract'], preferredMemberId: f.grants[1] }),
        ],
      },
    });
    const job = f.poll(0).delivery!;
    const text = `Use the existing commit instead of repeating the task. ${'password=x '.repeat(85)}`;
    f.call(0, {
      action: 'sade-update-task',
      groupId: f.groupId,
      runId,
      jobId: job.id,
      id: randomUUID(),
      text,
    });
    const notes = sharedSadeUpdates.parse(f.poll(0, [job.id]).updates?.[0]?.notes);
    assert.match(notes[0].text, /password=\[REDACTED\]/);
    assert.doesNotMatch(notes[0].text, /password=x/);
    const wrongOwner = f.poll(1, [job.id], [f.grants[0]], f.devices[1], [
      { jobId: job.id, through: 1 },
    ]);
    assert.deepEqual(wrongOwner.updates, []);
    assert.equal(
      f.view().sadeRuns[0].jobs.find((entry) => entry.id === job.id)?.updatesRead,
      undefined,
    );
    f.finish(0, job.id, { kind: 'done', summary: 'Completed using stale instructions.' });
    assert.match(f.view().sadeRuns[0].error || '', /before reading the latest/);
    assert.equal(f.poll(1).delivery, undefined);
    assert.doesNotMatch(
      JSON.stringify(f.store.get('sharedSadeRun', runId)),
      /Use the existing commit/,
    );
  } finally {
    f.store.close();
  }
});
