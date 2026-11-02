import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexClient } from '../server/codex.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { git } from '../server/git.ts';
import { buildApp } from '../server/app.ts';
import type { Project, Proposal, Task, TeamPlan, Workflow } from '../shared/types.ts';

/** In-process protocol peer: no child process, account login, network or model usage. */
class PlanningCodex extends CodexClient {
  calls: { method: string; params: any }[] = [];
  responses: { id: string | number; result: any }[] = [];
  rejections: { id: string | number; message?: string }[] = [];
  stopCalls = 0;
  private sequence = 0;
  constructor(
    directory: string,
    readonly memberId: string,
  ) {
    super({ home: path.join(directory, 'profiles', memberId), cwd: directory });
  }
  override async start(): Promise<void> {}
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.calls.push({ method, params });
    let result: unknown = {};
    if (method === 'account/read')
      result = {
        account: { type: 'chatgpt', email: `${this.memberId}@example.test`, planType: 'plus' },
      };
    else if (method === 'thread/start') {
      result = {
        thread: { id: `${this.memberId}-thread-${++this.sequence}` },
        sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' },
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      };
    } else if (method === 'turn/start') result = { turn: { id: `${params.threadId}-turn` } };
    return result as T;
  }
  override respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }
  override rejectRequest(id: string | number, message?: string): void {
    this.rejections.push({ id, message });
  }
  override async stop(): Promise<void> {
    this.stopCalls++;
  }
}

const proposal = (name: string): Proposal => ({
  summary: `${name} proposes a bounded implementation with independent reviewable artifacts.`,
  risks: ['Keep task ownership and dependency order explicit.'],
  suggestions: [
    {
      title: `${name} artifact`,
      kind: 'code',
      scope: [`${name}.txt`],
      acceptance: 'The artifact exists and contains verified output.',
      effort: 2,
    },
  ],
});
const plan = (): TeamPlan => ({
  summary: 'Create four independent artifacts with one explicit integration dependency.',
  tasks: ['alpha', 'bravo', 'charlie', 'delta'].map((key, index) => ({
    key,
    title: `Create ${key} artifact`,
    description: `Write and verify the ${key} artifact for the project.`,
    kind: (['code', 'research', 'design', 'review'] as const)[index],
    scope: [`${key}.txt`],
    dependsOn: key === 'delta' ? ['alpha'] : [],
    acceptance: `The ${key}.txt artifact exists with verified content.`,
    effort: 2,
    stage: index < 3 ? 'Build' : 'Verify',
  })),
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-workflows-test-'));
  const repo = path.join(root, 'repo'),
    data = path.join(root, 'data');
  await mkdir(repo);
  await mkdir(data);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), '# Controlled workflow repository\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, [
    '-c',
    'user.name=RELAY test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'Initial fixture',
  ]);
  const store = new Store(path.join(data, 'workspace.sqlite'));
  const workspace = new Workspace(store, data, repo);
  const workspaces = [workspace];
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Workflow test',
    path: repo,
    goal: 'Coordinate controlled agents without model calls.',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const roles = ['engineer', 'researcher', 'designer', 'reviewer'] as const;
  const members = roles.map((role, index) => store.addMember({ name: `Agent ${index + 1}`, role }));
  const clients = new Map(members.map((member) => [member.id, new PlanningCodex(root, member.id)]));
  function connect(target: Workspace) {
    for (const [id, client] of clients) target.clients.set(id, client);
    target.client = async (id) => {
      const client = clients.get(id)!;
      target.clients.set(id, client);
      return client;
    };
    target.refresh = async (id) =>
      store.updateMember(id, {
        status: target.running.has(id) ? 'working' : 'ready',
        account: { type: 'chatgpt', email: `${id}@example.test`, planType: 'plus' },
      });
  }
  connect(workspace);
  t.after(async () => {
    for (const target of workspaces) await target.close();
    store.close();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('relay-workflows-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  const currentTask = (task: Task) => store.get<Task>('task', task.id);
  const workflow = (id: string) => store.get<Workflow>('workflow', id);
  const tasks = (id: string, phase?: Task['phase']) =>
    store.tasks().filter((task) => task.workflowId === id && (!phase || task.phase === phase));
  async function submit(
    task: Task,
    tool: string,
    input: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    const current = currentTask(task),
      client = clients.get(current.assignedTo!)!;
    const id = randomUUID();
    await workspace.workerRequest(current.assignedTo!, client, {
      id,
      method: 'item/tool/call',
      params: {
        threadId: current.threadId,
        turnId: current.turnId,
        tool,
        arguments: input,
        ...overrides,
      },
    });
    return {
      result: client.responses.find((response) => response.id === id)?.result,
      rejection: client.rejections.find((response) => response.id === id),
    };
  }
  async function finish(task: Task, success = true) {
    const current = currentTask(task);
    await workspace.notification(current.assignedTo!, 'item/completed', {
      threadId: current.threadId,
      turnId: current.turnId,
      item: { type: 'agentMessage', text: `Controlled handoff for ${current.title}.` },
    });
    await workspace.notification(current.assignedTo!, 'turn/completed', {
      threadId: current.threadId,
      turn: {
        id: current.turnId,
        status: success ? 'completed' : 'failed',
        error: success ? null : { message: 'Controlled failure.' },
      },
    });
    await workspace.workflows.idle();
    return currentTask(task);
  }
  async function start() {
    const created = await workspace.workflows.start(
      project.id,
      'Build the requested artifacts and verify each one as a team.',
    );
    await workspace.workflows.idle();
    return workflow(created.id);
  }
  async function synthesize(id: string) {
    const proposals = tasks(id, 'proposal');
    for (const task of proposals)
      assert.equal(
        (await submit(task, 'relay_submit_proposal', proposal(task.assignedTo!))).result.success,
        true,
      );
    await Promise.all(proposals.map((task) => finish(task)));
    assert.equal(workflow(id).phase, 'synthesis');
    return tasks(id, 'plan')[0];
  }
  async function execute(id: string, input = plan()) {
    const planning = await synthesize(id);
    assert.equal((await submit(planning, 'relay_submit_plan', input)).result.success, true);
    await finish(planning);
    return tasks(id, 'execution');
  }
  async function artifact(task: Task) {
    const current = currentTask(task);
    assert.ok(current.worktree);
    await writeFile(
      path.join(current.worktree!, current.scope[0]),
      `Verified ${current.planKey}\n`,
    );
    await finish(current);
  }
  const turnCount = () =>
    [...clients.values()].reduce(
      (sum, client) => sum + client.calls.filter((call) => call.method === 'turn/start').length,
      0,
    );
  return {
    root,
    repo,
    data,
    store,
    workspace,
    workspaces,
    project,
    members,
    clients,
    connect,
    currentTask,
    workflow,
    tasks,
    submit,
    finish,
    start,
    synthesize,
    execute,
    artifact,
    turnCount,
  };
}

async function apiFor(workspace: Workspace) {
  const app = await buildApp(workspace);
  const session = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4317' },
  });
  const headers = {
    host: '127.0.0.1:4317',
    cookie: String(session.headers['set-cookie']).split(';')[0],
    'x-relay-token': session.json().token,
    'content-type': 'application/json',
  };
  return {
    app,
    post: (url: string, payload: Record<string, unknown> = {}) =>
      app.inject({ method: 'POST', url, headers, payload }),
    get: (url: string) => app.inject({ method: 'GET', url, headers }),
  };
}

test('workflow HTTP controls validate prompts and expose the coordinated lifecycle in state', async (t) => {
  const f = await fixture(t),
    api = await apiFor(f.workspace);
  try {
    const url = `/api/projects/${f.project.id}/workflows`;
    assert.equal((await api.post(url, { prompt: '' })).statusCode, 400);
    assert.equal(
      (
        await api.post(url, {
          prompt: 'A valid prompt with forged ownership.',
          leadId: f.members[0].id,
        })
      ).statusCode,
      400,
    );
    assert.equal(f.store.workflows().length, 0);
    assert.equal(f.turnCount(), 0);
    const created = await api.post(url, {
      prompt: 'Coordinate the team to build a verified artifact.',
    });
    assert.equal(created.statusCode, 202);
    const workflow = created.json<Workflow>();
    await f.workspace.workflows.idle();
    assert.equal(workflow.memberIds.length, 4);
    assert.equal(f.turnCount(), 4);
    const state = await api.get('/api/state');
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().workflows[0].id, workflow.id);
    const paused = await api.post(`/api/workflows/${workflow.id}/pause`);
    assert.equal(paused.statusCode, 200);
    assert.equal(paused.json().status, 'paused');
    const resumed = await api.post(`/api/workflows/${workflow.id}/resume`);
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().status, 'planning');
    assert.equal(f.turnCount(), 4);
    const cancelled = await api.post(`/api/workflows/${workflow.id}/cancel`);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().status, 'cancelled');
    assert.equal(f.store.leases().length, 0);
  } finally {
    await api.app.close();
  }
});

test('review feedback cannot release a task lease while its project is integrating', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  const tasks = await f.execute(workflow.id),
    task = tasks.find((entry) => entry.planKey === 'alpha')!;
  await f.artifact(task);
  const lease = f.store.lease(task.id)!,
    description = f.currentTask(task).description;
  const turns = f.turnCount(),
    api = await apiFor(f.workspace);
  f.workspace.mergeBusy.add(f.project.id);
  try {
    const response = await api.post(`/api/tasks/${task.id}/revise`, {
      feedback: 'Add another verification case.',
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /integration/i);
    assert.equal(f.store.lease(task.id)?.token, lease.token);
    assert.equal(f.currentTask(task).status, 'review');
    assert.equal(f.currentTask(task).description, description);
    assert.equal(f.turnCount(), turns);
  } finally {
    f.workspace.mergeBusy.delete(f.project.id);
    await api.app.close();
  }
});

test('all four profiles propose concurrently in read-only mode; only the lead synthesizes after all handoffs', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  assert.equal(workflow.memberIds.length, 4);
  const proposals = f.tasks(workflow.id, 'proposal');
  assert.equal(proposals.length, 4);
  assert.equal(f.workspace.running.size, 4);
  assert.equal(f.store.leases().length, 4);
  for (const task of proposals) {
    assert.equal(task.status, 'running');
    assert.equal(task.worktree, null);
    assert.deepEqual(task.scope, []);
    const parameters = f.clients
      .get(task.assignedTo!)!
      .calls.find((call) => call.method === 'thread/start')!.params;
    assert.equal(parameters.cwd, f.repo);
    assert.equal(parameters.sandbox, 'read-only');
    assert.ok(parameters.dynamicTools.some((tool: any) => tool.name === 'relay_submit_proposal'));
    assert.ok(!parameters.dynamicTools.some((tool: any) => tool.name === 'relay_submit_plan'));
  }
  for (const task of proposals.slice(0, 3)) {
    assert.equal(
      (await f.submit(task, 'relay_submit_proposal', proposal(task.assignedTo!))).result.success,
      true,
    );
    assert.equal(
      f.workflow(workflow.id).contributions.some((item) => item.taskId === task.id),
      false,
    );
    await f.finish(task);
    assert.equal(f.tasks(workflow.id, 'plan').length, 0);
  }
  const last = proposals[3];
  await f.submit(last, 'relay_submit_proposal', proposal(last.assignedTo!));
  await f.finish(last);
  assert.equal(f.workflow(workflow.id).contributions.length, 4);
  assert.equal(f.tasks(workflow.id, 'plan').length, 1);
  const synthesis = f.tasks(workflow.id, 'plan')[0];
  assert.equal(synthesis.assignedTo, workflow.leadId);
  assert.equal(synthesis.status, 'running');
  assert.equal(synthesis.worktree, null);
  assert.equal(f.turnCount(), 5);
  assert.equal(f.store.leases().length, 1);
  const leadParameters = f.clients
    .get(workflow.leadId)!
    .calls.filter((call) => call.method === 'thread/start')
    .at(-1)!.params;
  assert.equal(leadParameters.sandbox, 'read-only');
  assert.ok(leadParameters.dynamicTools.some((tool: any) => tool.name === 'relay_submit_plan'));
});

test('a validated DAG assigns equal effort and starts dependants only after explicit integration', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  const tasks = await f.execute(workflow.id);
  assert.equal(tasks.length, 4);
  assert.equal(new Set(tasks.map((task) => task.assignedTo)).size, 4);
  const hierarchy = f.workflow(workflow.id).hierarchy;
  assert.deepEqual(
    hierarchy.map((node) => node.effort),
    [2, 2, 2, 2],
  );
  assert.ok(
    hierarchy.every(
      (node) => node.reportsTo === (node.memberId === workflow.leadId ? null : workflow.leadId),
    ),
  );
  assert.ok(tasks.every((task) => task.parentTaskId === f.tasks(workflow.id, 'plan')[0].id));
  const alpha = tasks.find((task) => task.planKey === 'alpha')!,
    delta = tasks.find((task) => task.planKey === 'delta')!;
  assert.equal(delta.status, 'ready');
  assert.equal(delta.threadId, null);
  assert.deepEqual(delta.dependsOn, [alpha.id]);
  for (const task of tasks.filter((entry) => entry.planKey !== 'delta')) await f.artifact(task);
  assert.equal(f.workflow(workflow.id).status, 'review');
  assert.equal(f.currentTask(delta).status, 'ready');
  assert.equal(f.store.leases().length, 3);
  await assert.rejects(readFile(path.join(f.repo, 'alpha.txt')), /ENOENT/);
  await f.workspace.accept(alpha.id);
  await f.workspace.workflows.idle();
  assert.equal(f.currentTask(delta).status, 'running');
  assert.equal(
    (await readFile(path.join(f.currentTask(delta).worktree!, 'alpha.txt'), 'utf8')).trim(),
    'Verified alpha',
  );
  for (const task of tasks.filter((entry) => !['alpha', 'delta'].includes(entry.planKey!)))
    await f.workspace.accept(task.id);
  await f.artifact(delta);
  assert.notEqual(f.workflow(workflow.id).status, 'completed');
  await f.workspace.accept(delta.id);
  await f.workspace.workflows.idle();
  assert.equal(f.workflow(workflow.id).status, 'completed');
  assert.equal(f.store.leases().length, 0);
  assert.equal((await readFile(path.join(f.repo, 'delta.txt'), 'utf8')).trim(), 'Verified delta');
});

test('invalid plans never persist execution tasks and missing submissions block without automatic usage retries', async (t) => {
  const f = await fixture(t),
    workflow = await f.start(),
    synthesis = await f.synthesize(workflow.id);
  const invalid = plan();
  invalid.tasks[0].dependsOn = ['delta'];
  const response = await f.submit(synthesis, 'relay_submit_plan', invalid);
  assert.equal(response.result.success, false);
  assert.match(response.result.contentItems[0].text, /cycle/i);
  assert.equal(f.workflow(workflow.id).plan, null);
  assert.equal(f.tasks(workflow.id, 'execution').length, 0);
  await f.finish(synthesis);
  assert.equal(f.workflow(workflow.id).status, 'blocked');
  assert.match(f.currentTask(synthesis).error!, /valid structured submission/);
  const previousTurns = f.turnCount();
  for (let index = 0; index < 4; index++) f.workspace.workflows.wake(workflow.id);
  await f.workspace.workflows.idle();
  assert.equal(f.turnCount(), previousTurns);
  await f.workspace.workflows.resume(workflow.id);
  await f.workspace.workflows.idle();
  assert.equal(f.currentTask(synthesis).status, 'running');
  assert.notEqual(f.currentTask(synthesis).threadId, synthesis.threadId);
  assert.equal(f.turnCount(), previousTurns + 1);
  assert.equal(f.tasks(workflow.id, 'plan').length, 1);
});

test('planning submissions require the assigned phase and a current thread and turn lease', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  const task = f
    .tasks(workflow.id, 'proposal')
    .find((entry) => entry.assignedTo !== workflow.leadId)!;
  assert.equal((await f.submit(task, 'relay_submit_plan', plan())).result.success, false);
  assert.equal(
    (await f.submit(task, 'relay_submit_proposal', { summary: 'short' })).result.success,
    false,
  );
  assert.ok(
    (
      await f.submit(task, 'relay_submit_proposal', proposal('stale'), {
        threadId: 'expired-thread',
      })
    ).rejection,
  );
  assert.ok(
    (await f.submit(task, 'relay_submit_proposal', proposal('stale'), { turnId: 'expired-turn' }))
      .rejection,
  );
  assert.equal(f.workflow(workflow.id).contributions.length, 0);
  await f.finish(task);
  assert.equal(f.currentTask(task).status, 'blocked');
  assert.equal(f.workflow(workflow.id).status, 'blocked');
  assert.equal(f.workflow(workflow.id).plan, null);
});

test('a task added after plan validation rolls back every assignment and resumes fresh synthesis', async (t) => {
  const f = await fixture(t),
    workflow = await f.start(),
    synthesis = await f.synthesize(workflow.id);
  const submitted = plan();
  assert.equal((await f.submit(synthesis, 'relay_submit_plan', submitted)).result.success, true);
  const last = submitted.tasks.at(-1)!;
  f.store.addTask({
    projectId: f.project.id,
    title: last.title,
    description: 'A manual task arrived while the lead was finishing.',
    kind: last.kind,
    priority: 'medium',
    scope: last.scope,
    dependsOn: [],
    acceptance: last.acceptance,
  });
  await f.finish(synthesis);
  assert.equal(f.workflow(workflow.id).status, 'blocked');
  assert.equal(f.workflow(workflow.id).phase, 'synthesis');
  assert.equal(f.workflow(workflow.id).plan, null);
  assert.equal(f.tasks(workflow.id, 'execution').length, 0);
  assert.ok(f.workflow(workflow.id).hierarchy.every((node) => node.taskIds.length === 0));
  assert.equal(f.currentTask(synthesis).status, 'blocked');
  assert.equal(f.store.leases().length, 0);
  await f.workspace.workflows.resume(workflow.id);
  await f.workspace.workflows.idle();
  assert.equal(f.currentTask(synthesis).status, 'running');
  assert.notEqual(f.currentTask(synthesis).threadId, synthesis.threadId);
  assert.ok(
    (
      await f.submit(synthesis, 'relay_submit_plan', submitted, {
        threadId: synthesis.threadId,
        turnId: synthesis.turnId,
      })
    ).rejection,
  );
  const earlyConflict = await f.submit(synthesis, 'relay_submit_plan', submitted);
  assert.equal(earlyConflict.result.success, false);
  assert.match(earlyConflict.result.contentItems[0].text, /unfinished task/);
  last.title = 'Produce another delta result';
  assert.equal((await f.submit(synthesis, 'relay_submit_plan', submitted)).result.success, true);
  await f.finish(synthesis);
  assert.equal(f.tasks(workflow.id, 'execution').length, 4);
  assert.equal(f.workflow(workflow.id).status, 'running');
});

test('a paused workflow lets current planning turns finish but never starts synthesis until resume', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  f.workspace.workflows.pause(workflow.id);
  for (const task of f.tasks(workflow.id, 'proposal')) {
    await f.submit(task, 'relay_submit_proposal', proposal(task.assignedTo!));
    await f.finish(task);
  }
  assert.equal(f.workflow(workflow.id).status, 'paused');
  assert.equal(f.workflow(workflow.id).contributions.length, 4);
  assert.equal(f.tasks(workflow.id, 'plan').length, 0);
  assert.equal(f.turnCount(), 4);
  await f.workspace.workflows.resume(workflow.id);
  await f.workspace.workflows.idle();
  assert.equal(f.tasks(workflow.id, 'plan').length, 1);
  assert.equal(f.tasks(workflow.id, 'plan')[0].status, 'running');
  assert.equal(f.turnCount(), 5);
});

test('pause during asynchronous preflight fences every late claim', async (t) => {
  const f = await fixture(t);
  const refresh = f.workspace.refresh.bind(f.workspace);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const counts = new Map<string, number>();
  f.workspace.refresh = async (id) => {
    const count = (counts.get(id) || 0) + 1;
    counts.set(id, count);
    if (count > 1) {
      entered();
      await gate;
    }
    return refresh(id);
  };
  const workflow = await f.workspace.workflows.start(
    f.project.id,
    'Coordinate a bounded team workflow.',
  );
  await waiting;
  try {
    f.workspace.workflows.pause(workflow.id);
  } finally {
    release();
  }
  await f.workspace.workflows.idle();
  assert.equal(f.turnCount(), 0);
  assert.equal(f.store.leases().length, 0);
  assert.ok(f.tasks(workflow.id).every((task) => task.status === 'ready'));
  await f.workspace.workflows.resume(workflow.id);
  await f.workspace.workflows.idle();
  assert.equal(f.turnCount(), 4);
});

test('concurrent starts create one workflow and reserved members cannot be stolen by other work', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.workspace.workflows.start(f.project.id, 'Coordinate a bounded team workflow.'),
    f.workspace.workflows.start(f.project.id, 'Duplicate request must not consume extra turns.'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  await f.workspace.workflows.idle();
  assert.equal(f.store.workflows().length, 1);
  assert.equal(f.turnCount(), 4);
  const manual = f.store.addTask({
    projectId: f.project.id,
    title: 'Separate manual task',
    description: 'This work must not take a reserved member.',
    kind: 'code',
    priority: 'low',
    scope: ['manual.txt'],
    dependsOn: [],
    acceptance: 'The manual artifact exists.',
  });
  assert.throws(() => f.store.claim(manual.id, f.members[0].id), /reserved/);
  const secondProject = f.store.put('project', {
    ...f.project,
    id: randomUUID(),
    name: 'Other project',
  });
  await assert.rejects(
    f.workspace.workflows.start(secondProject.id, 'Try to reserve the same team twice.'),
    /reserved/,
  );
  assert.equal(f.store.workflows().length, 1);
});

test('cancelling stops current turns and permits a fresh workflow with the same team', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  await f.workspace.workflows.cancel(workflow.id);
  assert.equal(f.workflow(workflow.id).status, 'cancelled');
  assert.equal(f.workspace.running.size, 0);
  assert.equal(f.store.leases().length, 0);
  assert.ok([...f.clients.values()].every((client) => client.stopCalls === 1));
  assert.ok(f.tasks(workflow.id).every((task) => task.status === 'backlog'));
  const replacement = await f.start();
  assert.notEqual(replacement.id, workflow.id);
  assert.equal(f.tasks(replacement.id, 'proposal').length, 4);
  assert.equal(f.workspace.running.size, 4);
});

test('cancellation cannot be resumed or paused while a worker is still stopping', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  const client = f.clients.get(f.tasks(workflow.id)[0].assignedTo!)!;
  const stop = client.stop.bind(client);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  client.stop = async () => {
    entered();
    await gate;
    await stop();
  };
  const cancelling = f.workspace.workflows.cancel(workflow.id);
  await waiting;
  try {
    assert.equal(f.workflow(workflow.id).status, 'cancelling');
    await assert.rejects(f.workspace.workflows.resume(workflow.id), /paused or blocked/);
    assert.throws(() => f.workspace.workflows.pause(workflow.id), /cancelling/);
    await assert.rejects(f.workspace.workflows.cancel(workflow.id), /already cancelling/);
    // Another worker can finish while the first process is still stopping.
    const finishedNaturally = f.tasks(workflow.id)[1];
    await f.submit(
      finishedNaturally,
      'relay_submit_proposal',
      proposal(finishedNaturally.assignedTo!),
    );
    await f.finish(finishedNaturally);
    assert.equal(f.currentTask(finishedNaturally).status, 'done');
  } finally {
    release();
    await cancelling;
    client.stop = stop;
  }
  assert.equal(f.workflow(workflow.id).status, 'cancelled');
  assert.equal(f.workspace.running.size, 0);
  assert.equal(f.store.leases().length, 0);
  assert.equal(f.turnCount(), 4);
});

test('a newer pause wins over an earlier resume waiting for account refresh', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  f.workspace.workflows.pause(workflow.id);
  for (const task of f.tasks(workflow.id, 'proposal')) {
    await f.submit(task, 'relay_submit_proposal', proposal(task.assignedTo!));
    await f.finish(task);
  }
  const refresh = f.workspace.refresh.bind(f.workspace);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.workspace.refresh = async (id) => {
    entered();
    await gate;
    return refresh(id);
  };
  const resuming = f.workspace.workflows.resume(workflow.id);
  await waiting;
  const rejected = assert.rejects(resuming, /Workflow state changed/);
  try {
    f.workspace.workflows.pause(workflow.id);
  } finally {
    release();
  }
  await rejected;
  await f.workspace.workflows.idle();
  assert.equal(f.workflow(workflow.id).status, 'paused');
  assert.equal(f.tasks(workflow.id, 'plan').length, 0);
  assert.equal(f.turnCount(), 4);
});

test('failed worker termination keeps its lease and blocks cancellation until a successful retry', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  const task = f.tasks(workflow.id)[0],
    client = f.clients.get(task.assignedTo!)!;
  const stop = client.stop.bind(client),
    token = f.store.lease(task.id)!.token;
  client.stop = async () => {
    throw new Error('Controlled worker refused to stop.');
  };
  await assert.rejects(f.workspace.workflows.cancel(workflow.id), /refused to stop/);
  assert.equal(f.workflow(workflow.id).status, 'blocked');
  assert.equal(f.store.lease(task.id)!.token, token);
  assert.equal(f.currentTask(task).status, 'running');
  await assert.rejects(
    f.workspace.workflows.start(f.project.id, 'This must not steal the live worker.'),
    /active workflow/,
  );
  client.stop = stop;
  await f.workspace.workflows.cancel(workflow.id);
  assert.equal(f.workflow(workflow.id).status, 'cancelled');
  assert.equal(f.store.leases().length, 0);
});

test('a coordinator restart pauses active workflows without automatically consuming more turns', async (t) => {
  const f = await fixture(t),
    workflow = await f.start();
  await f.workspace.close();
  const previousTurns = f.turnCount();
  const restarted = new Workspace(f.store, f.data, f.repo);
  f.workspaces.push(restarted);
  assert.equal(f.workflow(workflow.id).status, 'paused');
  assert.equal(restarted.running.size, 0);
  assert.equal(
    f.store.members().every((member) => member.status === 'offline'),
    true,
  );
  await restarted.workflows.idle();
  assert.equal(f.turnCount(), previousTurns);
  f.connect(restarted);
  await restarted.workflows.resume(workflow.id);
  await restarted.workflows.idle();
  assert.equal(restarted.running.size, 4);
  assert.equal(f.turnCount(), previousTurns + 4);
});
