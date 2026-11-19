import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CodexSession, ProviderId, PlanTask, Task } from '../shared/types.ts';
import type { SharedSadeRun } from '../shared/collaboration.ts';
import { SharedGroups } from '../server/collaboration.ts';
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
import { canonicalSharedRepository } from '../server/shared-sade-worker.ts';
import { MachineExecutor } from '../server/machine-execution.ts';
import { startCrossHostBridge } from './fixtures/shared-sade-cross-host.ts';

const key = 'a'.repeat(64);
const sha = 'b'.repeat(40);
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
    turnsB?: number;
    mac?: boolean;
    key?: string;
    members?: string[];
    patchHandoff?: boolean;
    taskUpdates?: boolean;
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
      teammates: [{ localId: member, provider: providers[index], name: index ? 'Mây' : 'Bếp' }],
    });
    if (!index || options.grantB !== false)
      call(index, {
        action: 'sade-grant',
        groupId,
        id: grants[index],
        teammateId: member,
        projectKey: options.key || key,
        projectName: 'Fixture project',
        role: index ? 'reviewer' : 'engineer',
        platform: index && options.mac ? 'darwin' : 'win32',
        allowWrites: true,
        ...(options.patchHandoff ? { patchHandoff: true } : {}),
        turns: index ? options.turnsB || 8 : 8,
      });
  }
  const poll = (
    index: number,
    active: string[] = [],
    grantIds = [grants[index]],
    deviceId = devices[index],
    readUpdates: { jobId: string; through: number }[] = [],
  ) =>
    call(
      index,
      {
        action: 'sade-poll',
        grants: grantIds,
        active,
        ...(options.patchHandoff ? { patchHandoff: true } : {}),
        ...(options.taskUpdates ? { taskUpdates: true, readUpdates } : {}),
      },
      deviceId,
    ) as {
      delivery?: SharedDelivery;
      active: string[];
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

test('1,000 distinct Shared Groups messages pass the admission and routing contract with controlled planner outputs', () => {
  const cases = sharedSadeCorpus();
  assert.equal(new Set(cases.map((item) => item.message)).size, 1000);
  const counts: Record<string, number> = {};
  for (const item of cases) {
    const f = fixture(item.providers, {
      grantB: item.scenario !== 'no-access',
      turnsB: item.scenario === 'budget' ? 1 : 8,
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
        assert.equal(f.poll(0).delivery, undefined, 'Do not redeliver an uncertain planner turn');
        const [a, b] = f.grants;
        if (item.scenario === 'lost') {
          // Simulate a persisted lease deadline after desktop loss. Never start it twice.
          const current = f.store.get<any>('sharedSadeRun', msgId);
          current.jobs[0].deadline = 0;
          f.store.put('sharedSadeRun', current);
          assert.equal(f.poll(0).delivery, undefined);
          assert.equal(f.view().sadeRuns[0].state, 'blocked');
          counts[item.scenario] = (counts[item.scenario] || 0) + 1;
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
      counts[item.scenario] = (counts[item.scenario] || 0) + 1;
    } catch (error) {
      throw new Error(`${item.id}: ${item.message}`, { cause: error });
    } finally {
      f.store.close();
    }
  }
  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    1000,
  );
  console.log('Shared Sade corpus (fixture, not live model semantics):', JSON.stringify(counts));
});

const crossHostOrigin = process.env.KIVUNO_CROSS_HOST_ORIGIN;
const pathProgram = 'module.exports = (value) => value.split(require("node:path").sep).at(-1);\n';
const portablePathProgram = 'module.exports = (value) => value.split(/[\\\\/]/).at(-1);\n';
const smokeProgram = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(fs.existsSync('.env.local'), process.platform === 'win32');
if (process.platform === 'darwin') assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(require('./path-label.cjs')('C:\\kivuno\\registration'), 'registration');
console.log(process.platform);
`;

class DesktopPeer extends CodexClient {
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
        this.provider === 'gemini'
          ? { rateLimits: null }
          : {
              ordinaryUsageAllowed: true,
              rateLimits: {
                primary: {
                  usedPercent: 10,
                  windowDurationMins: 300,
                  resetsAt: Math.floor(Date.now() / 1000) + 3600,
                },
              },
            };
    else if (method === 'model/list')
      value = {
        data: [
          {
            id: 'fixture',
            model: 'fixture',
            displayName: 'Fixture model',
            defaultReasoningEffort: '',
            supportedReasoningEfforts: [],
            isDefault: true,
          },
        ],
      };
    else if (method === 'thread/start')
      value = {
        thread: { id: randomUUID() },
        model: params.model,
        approvalsReviewer: 'user',
        approvalPolicy: 'on-request',
        sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' },
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
    const pump = async (index: number) => {
      const worker = setups[index].workspace.sharedSade;
      const hello = (await worker.execute({ action: 'snapshot' })) as any;
      for (const result of hello.results)
        cloud.finish(index, result.jobId, result.result, result.updatesRead);
      const packet = cloud.poll(
        index,
        hello.active,
        hello.grants,
        cloud.devices[index],
        hello.readUpdates,
      );
      assert.doesNotMatch(
        JSON.stringify(packet),
        /provider-private|accessToken|tokenHash|projectId/,
      );
      await worker.execute({
        action: 'exchange',
        ...packet,
        acknowledged: hello.results.map(
          ({ jobId, version }: { jobId: string; version: number }) => ({ jobId, version }),
        ),
      });
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
    const chat = {
      action: 'message',
      groupId: cloud.groupId,
      id: randomUUID(),
      content: 'Bếp dựng cấu trúc rồi Mây đọc cấu trúc và xác nhận frontend.',
      sade: { projectKey: fingerprint },
    };
    cloud.call(0, chat);
    cloud.call(0, chat);
    const plan = await pump(0);
    assert.ok(plan && plan.phase === 'plan');
    const planner = await sessionFor(0, plan);
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
    assert.match(plannerCalls, /unaccentedName.*Bep/);
    assert.doesNotMatch(plannerCalls, new RegExp(cloud.grants.join('|')));
    const validPlan = {
      summary: 'Build architecture then inspect the result in another harness.',
      tasks: [
        {
          ...work('architecture', { scope: ['architecture.txt'], preferredMemberId: 'member-1' }),
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
          ...work('verify-ui', { preferredMemberId: 'member-1', dependsOn: ['frontend'] }),
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
    assert.equal(planner.peer.calls.filter((call) => call.method === 'turn/start').length, 1);
    await complete(0, planner.session, planner.peer, 'Plan submitted.');
    const writer = (await pump(0))!;
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
      'Shared verified contract\n',
    );
    await complete(0, author.session, author.peer, 'Architecture contract prepared.');
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
    assert.match(JSON.stringify(check.peer.calls), /Shared verified contract/);
    assert.match(JSON.stringify(check.peer.calls), /Verify the registration field names/);
    await submit(1, check.session, check.peer, 'relay_submit_shared_review', {
      verdict: 'approved',
      summary: 'Contract is present and scoped.',
    });
    await complete(1, check.session, check.peer, 'Reviewed the architecture text.');
    assert.equal(await pump(1), undefined, 'Dependency still needs local human integration');
    await pump(0);
    await setups[0].workspace.accept(author.task.id);
    assert.equal(await remoteHead(), startingRevision);
    await assert.rejects(readFile(path.join(setups[1].repo, 'architecture.txt')), {
      code: 'ENOENT',
    });
    await pump(0);
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
    assert.ok(frontend.prerequisites[0]?.patch);
    const reader = await sessionFor(1, frontend);
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
    assert.match(
      JSON.stringify(frontendCheck.peer.calls),
      /The form preserves the agreed registration field names/,
    );
    assert.match(JSON.stringify(frontendCheck.peer.calls), /tự chọn phong cách nhé/);
    await submit(0, frontendCheck.session, frontendCheck.peer, 'relay_submit_shared_review', {
      verdict: 'approved',
      summary: 'Frontend changes stay within their assigned file.',
    });
    await complete(0, frontendCheck.session, frontendCheck.peer, 'Frontend reviewed.');
    await pump(0);
    await pump(1);
    await setups[1].workspace.accept(resumed.task.id);
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
    assert.match(
      await readFile(path.join(verifier.task.worktree!, 'frontend.txt'), 'utf8'),
      /Frontend uses the contract/,
    );
    await complete(0, verifier.session, verifier.peer, 'Verified the assembled worktree.');
    await pump(0);
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
      content: `Dùng AI của mình để kiểm thử project trên máy ghép cặp ${pairedPlatform} của bạn.`,
    };
    cloud.call(0, debug);
    const debugPlan = (await pump(0))!;
    assert.match(JSON.stringify(debugPlan.team), /pairedPlatform/);
    assert.doesNotMatch(JSON.stringify(debugPlan), new RegExp(node.id + '|' + permission.id));
    const debugPlanner = await sessionFor(0, debugPlan);
    await submit(0, debugPlanner.session, debugPlanner.peer, 'relay_submit_plan', {
      summary: 'Verify the app with the requester’s harness and the paired machine.',
      tasks: [
        work('platform-smoke', {
          kind: 'code',
          ...(live ? { scope: ['path-label.cjs'] } : {}),
          preferredMemberId: nextGrant.id,
          requiredPlatform: pairedPlatform,
        }),
      ],
    });
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
    await assert.rejects(use('info', {}, randomUUID()), /Only the approved/);
    if (machineCall) {
      assert.equal(machineCall.mock.callCount(), 0);
      await assert.rejects(use('info'), /requested operating system/);
      simulateRequestedOS = true;
    }
    const machine = async (operation: string, args: object = {}) => {
      const result = await submit(0, debuggerSession.session, debuggerSession.peer, 'machine_use', {
        runnerId: node.id,
        operation,
        args,
      });
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
        const failed = await machine('run', args);
        assert.equal(failed.platform, 'darwin');
        assert.equal(failed.code, 1);
        assert.match(failed.stderr, /registration/);
        await machine('write', { path: 'path-label.cjs', content: portablePathProgram });
        const fixed = await machine('run', args);
        assert.equal(fixed.code, 0, fixed.stderr);
        assert.equal(fixed.stdout.trim(), 'darwin');
        await machine('pull');
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
          'Windows passed, macOS reproduced the path bug, macOS passed after the fix, and Windows received the scoped change.',
        );
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
    } else {
      await machine('info');
      await machine('sync');
      await machine('run', { command: 'node', args: ['--version'] });
      await advertise({ ...permission, id: randomUUID() });
      await assert.rejects(use('info'), /authorization changed/);
    }
    await complete(
      0,
      debuggerSession.session,
      debuggerSession.peer,
      'Paired OS fixture finished the smoke check.',
    );
    if (live) {
      let review: SharedDelivery | undefined;
      for (let attempt = 0; attempt < 100 && !review; attempt++) {
        await pump(0);
        review = await pump(1);
        if (!review) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.deepEqual(review?.review?.files, ['path-label.cjs']);
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
    };
    cloud.call(0, update);
    const noWorkJob = (await pump(0))!;
    assert.equal(noWorkJob.phase, 'plan');
    const noWork = await sessionFor(0, noWorkJob);
    const empty = await callTool(0, noWork.session, noWork.peer, 'relay_submit_plan', {
      summary: 'A status update for the team.',
      tasks: [],
    });
    assert.equal(empty?.success, false);
    await submit(0, noWork.session, noWork.peer, 'relay_finish_shared_without_work', {
      summary: 'A status update for the team.',
    });
    await complete(0, noWork.session, noWork.peer, 'A status update for the team.');
    assert.equal(await pump(0), undefined);
    const closed = cloud.view().sadeRuns.at(-1);
    assert.equal(closed?.state, 'done');
    assert.deepEqual(
      closed?.jobs.map((job) => job.phase),
      ['plan'],
    );
  },
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
    f.finish(0, writer.id, { kind: 'unchanged', summary: 'The fix is already present.' });
    const check = f.poll(1).delivery!;
    assert.equal(check.phase, 'task');
    assert.equal(check.task?.kind, 'review');
    assert.equal(check.review, undefined);
    f.finish(1, check.id, { kind: 'done', summary: 'Verified the existing file.' });
    assert.equal(f.view().sadeRuns[0].state, 'done');
  } finally {
    f.store.close();
  }
});

test('a completed author can revoke permission before a reviewed prerequisite reaches a dependent harness', () => {
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
    f.call(0, { action: 'sade-revoke', groupId: f.groupId, grantId: f.grants[0] });
    assert.equal(f.poll(1).delivery, undefined);
    assert.match(f.view().sadeRuns[0].error || '', /withdrew permission/);
    assert.doesNotMatch(JSON.stringify(f.store.get('sharedSadeRun', runId)), /export const value/);
  } finally {
    f.store.close();
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
