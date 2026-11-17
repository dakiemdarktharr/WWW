import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Sade, reviewDigest, type SadeReview } from '../server/sade.ts';
import { Store } from '../server/store.ts';
import { Mesh } from '../server/mesh.ts';
import { allocatePlan, parseTeamPlan } from '../server/workflow-plan.ts';
import { chooseModel } from '../server/autonomy.ts';
import type { Workspace } from '../server/service.ts';
import type { CodexModel, CodexSession, PlanTask, Task, TaskDiff } from '../shared/types.ts';

function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const author = store.addMember({ name: 'Gemini', role: 'engineer' });
  const reviewer = store.addMember({ name: 'Astra', role: 'reviewer' });
  for (const member of [author, reviewer])
    store.updateMember(member.id, { status: 'ready', account: { type: 'chatgpt' } });
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Sade demo',
    path: process.cwd(),
    goal: 'Controlled test; no live models.',
    createdAt: new Date().toISOString(),
    memberIds: [author.id, reviewer.id],
  });
  const workflowId = randomUUID();
  store.put('workflow', {
    id: workflowId,
    orchestrator: 'sade',
    projectId: project.id,
    status: 'running',
  });
  const source = store.addTask({
    projectId: project.id,
    title: 'Add welcome page',
    description: 'A small welcome page for the demo.',
    kind: 'code',
    priority: 'medium',
    assignedTo: author.id,
    scope: ['src'],
    dependsOn: [],
    acceptance: 'Welcome page is readable.',
    workflowId,
  });
  const task = store.updateTask(source.id, { status: 'review' });
  let diff: TaskDiff = {
    files: ['src/index.ts'],
    diff: '+export const greeting = "Hello";',
    stat: '1 file',
    truncated: false,
  };
  const calls: any[] = [];
  const host = {
    store,
    closing: false,
    canStart: () => true,
    diff: async () => diff,
    mesh: new Mesh({ store }),
    quota: { assertCanRun() {} },
    sessions: {
      get: (id: string) => store.get<CodexSession>('session', id),
      async send(id: string, _prompt: string) {
        return store.get<CodexSession>('session', id);
      },
      async create(options: any) {
        calls.push(options);
        const reviewTask = store.addTask({
          projectId: project.id,
          title: options.title,
          description: 'Read-only independent review.',
          kind: 'review',
          priority: 'medium',
          scope: [],
          dependsOn: [],
          acceptance: 'Report findings.',
          assignedTo: options.memberId,
        });
        store.updateTask(reviewTask.id, { status: 'running' });
        return store.put('session', {
          id: randomUUID(),
          taskId: reviewTask.id,
          projectId: project.id,
          memberId: options.memberId,
          status: 'running',
          readOnly: true,
        } as CodexSession);
      },
    },
  };
  const sade = new Sade(host as unknown as Workspace);
  t.after(async () => {
    await sade.idle();
    store.close();
  });
  return {
    store,
    sade,
    task,
    author,
    reviewer,
    calls,
    setDiff: (value: TaskDiff) => {
      diff = value;
    },
    diff: () => diff,
  };
}

test('Sade dispatches exactly one independent read-only review and binds approval to the reviewed change', async (t) => {
  const f = fixture(t);
  await Promise.all([f.sade.schedule(f.task), f.sade.schedule(f.task)]);
  await f.sade.schedule(f.task);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].memberId, f.reviewer.id);
  assert.equal(f.calls[0].readOnly, true);
  assert.equal(f.calls[0].kind, 'review');
  const original = f.diff();
  f.setDiff({ ...original, diff: '+changed during review' });
  await f.sade.schedule(f.task);
  assert.equal(f.calls.length, 1);
  f.setDiff(original);
  await assert.rejects(f.sade.assertReviewed(f.task, f.diff()), /completed independent review/);
  const review = f.store.get<SadeReview>('sadeReview', f.task.id);
  const session = f.store.get<CodexSession>('session', review.sessionId!);
  f.sade.observe(session, true);
  await f.sade.assertReviewed(f.task, f.diff());
  await assert.rejects(
    f.sade.assertReviewed(f.task, { ...f.diff(), diff: '+changed after review' }),
    /exact change/,
  );
});

test('Sade cannot self-review, use an unavailable account, or silently replay an uncertain start', async (t) => {
  const f = fixture(t);
  f.store.updateMember(f.reviewer.id, { status: 'offline' });
  await f.sade.schedule(f.task);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.get<SadeReview>('sadeReview', f.task.id).status, 'blocked');
  f.store.updateMember(f.reviewer.id, { status: 'ready' });
  await f.sade.retry(f.task.id);
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.sade.retry(f.task.id), /existing reviewer/);
});

test('Sade refuses incomplete, binary, large and private-file review inputs', () => {
  const diff = { files: ['src/a.ts'], diff: '+ok', stat: '', truncated: false };
  for (const patch of [
    { truncated: true },
    { diff: 'x'.repeat(12001) },
    { files: ['.env.local'] },
    { diff: 'Binary files a/a.png and b/a.png differ' },
    { diff: '[Binary file]' },
  ])
    assert.throws(() => reviewDigest({ ...diff, ...patch }));
  assert.equal(reviewDigest(diff), reviewDigest({ ...diff }));
});

test('paused Sade workflows do not start additional reviewer turns', async (t) => {
  const f = fixture(t);
  f.store.updateWorkflow(f.task.workflowId!, { status: 'paused' });
  await f.sade.schedule(f.task);
  assert.equal(f.calls.length, 0);
});

test('Sade plan preserves Gemini architecture → Astra frontend and separates review authors', async (t) => {
  const f = fixture(t);
  const task = (key: string, patch: Partial<PlanTask>): PlanTask => ({
    key,
    title: `Build ${key}`,
    description: `Complete the ${key} artifact.`,
    kind: 'code',
    scope: [`src/${key}`],
    dependsOn: [],
    acceptance: 'The artifact is verified.',
    effort: 2,
    stage: 'Build',
    ...patch,
  });
  const plan = parseTeamPlan({
    summary: 'Build with explicit human preferences.',
    tasks: [
      task('architecture', { preferredMemberId: f.author.id }),
      task('frontend', { preferredMemberId: f.reviewer.id, dependsOn: ['architecture'] }),
      task('review', { kind: 'review', dependsOn: ['frontend'] }),
    ],
  });
  const allocation = new Map(
    allocatePlan(plan, f.store.members()).map((entry) => [entry.key, entry.memberId]),
  );
  assert.equal(allocation.get('architecture'), f.author.id);
  assert.equal(allocation.get('frontend'), f.reviewer.id);
  assert.equal(allocation.get('review'), f.author.id);
  plan.tasks[2].preferredMemberId = f.reviewer.id;
  assert.throws(() => allocatePlan(plan, f.store.members()), /own work/);
});

test('routine review selects an economy model with high reasoning; security work retains a strong model', () => {
  const model = (name: string, isDefault: boolean, efforts: string[]): CodexModel => ({
    id: name,
    model: name,
    displayName: name,
    isDefault,
    defaultReasoningEffort: efforts[0],
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: '',
    })),
  });
  const models = [
    model('general', true, ['medium', 'high']),
    model('mini', false, ['low', 'high']),
  ];
  const task = {
    kind: 'review' as const,
    title: 'Review welcome page',
    description: 'Check the change.',
  };
  assert.equal(chooseModel(models, task).model, 'mini');
  assert.equal(chooseModel(models, task).reasoningEffort, 'high');
  assert.equal(
    chooseModel(models, { ...task, title: 'Review security architecture' }).model,
    'general',
  );
  models[1].supportedReasoningEfforts = [{ reasoningEffort: 'low', description: '' }];
  assert.equal(chooseModel(models, task).model, 'general');
});
