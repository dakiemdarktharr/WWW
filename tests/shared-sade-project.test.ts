import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { SharedGroups } from '../server/collaboration.ts';
import { Store } from '../server/store.ts';
import type { SharedSadeRun } from '../shared/collaboration.ts';
import type { SharedDelivery, SharedFinish, SharedSadeCloudOffer } from '../server/group-sade.ts';
import type { CodexSession, ProviderId } from '../shared/types.ts';
import type { SadeProjectContext } from '../shared/sade-project.ts';
import { projectStatusQuestion, requestedSadeProject } from '../server/shared-sade-project.ts';
import {
  settleHostedSade,
  usesHostedSade,
  hostedSadeBudgetMs,
} from '../cloud/shared-sade-gateway.ts';
import { projectMessages } from './fixtures/sade-project-messages.ts';
import { Workspace } from '../server/service.ts';
import { CodexClient } from '../server/codex.ts';
import { git } from '../server/git.ts';
import { canonicalSharedRepository } from '../server/shared-sade-worker.ts';
import { renderProjectSlides } from '../server/shared-sade-project-render.ts';

const providerNames: ProviderId[] = ['gemini', 'claude', 'antigravity', 'codex'];
function fixture(onlyLegacy = false, project?: { key: string; memberIds: string[] }) {
  const store = new Store(':memory:');
  const people = ['Mai', 'Long', 'Vy', 'Duyên'].map((name) => ({ id: randomUUID(), name }));
  const role = ['researcher', 'engineer', 'designer', 'reviewer'];
  const devices = people.map(() => randomUUID());
  const grants: string[] = people.map(() => randomUUID());
  const groupId = randomUUID();
  const projectKey = project?.key ?? 'b'.repeat(64);
  const groups = new SharedGroups(store, (id) => people.find((person) => person.id === id) ?? null);
  const command = (
    index: number,
    input: { action: string; [name: string]: unknown },
    cloud?: 'extended',
  ) =>
    groups.execute(
      people[index],
      ['create', 'sade-poll', 'sade-finish'].includes(input.action) ? input : { groupId, ...input },
      devices[index],
      cloud,
    ) as any;
  command(0, { action: 'create', id: groupId, name: 'Studio' });
  store.put('billingEntitlement', {
    id: people[0].id,
    ownerId: people[0].id,
    tier: 'plus',
    paidUntil: Date.now() + 86400000,
  });
  people.forEach((person, index) => {
    store.put('desktopDevice', {
      id: devices[index],
      owner: person,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
    });
    if (index) {
      command(0, { action: 'invite', account: person.id });
      command(index, { action: 'accept' });
    }
    const localId = project?.memberIds[index] ?? randomUUID();
    command(index, {
      action: 'teammates',
      teammates: [
        { localId, name: ['Aria', 'Alex', 'Jen', 'Noor'][index], provider: providerNames[index] },
      ],
    });
    command(index, {
      action: 'sade-grant',
      id: grants[index],
      teammateId: localId,
      projectKey,
      role: role[index],
      projectName: 'Studio',
      platform: 'win32',
      allowWrites: index !== 0 && index !== 3,
      turns: 10,
      ...(!onlyLegacy ? { projectOrchestration: true } : {}),
    });
  });
  const start = (content: string, cloud?: 'extended') => {
    const id = randomUUID();
    const response = command(0, { action: 'message', id, content, sade: { projectKey } }, cloud);
    return { id, response };
  };
  const view = (id?: string): SharedSadeRun => {
    const runs: SharedSadeRun[] = command(0, { action: 'read' }).sadeRuns;
    return id ? runs.find((run) => run.id === id)! : runs.at(-1)!;
  };
  const poll = (index: number, active: string[] = [], extra: Record<string, unknown> = {}) =>
    command(index, {
      action: 'sade-poll',
      active,
      grants: [grants[index]],
      projectOrchestration: true,
      taskUpdates: true,
      ...extra,
    }) as {
      active: string[];
      delivery?: SharedDelivery;
      projectContexts?: { jobId: string; context: SadeProjectContext }[];
      projectAcknowledged?: string[];
    };
  const finish = (index: number, jobId: string, result: object, cloud?: 'extended') =>
    command(index, { action: 'sade-finish', jobId, result }, cloud);
  const transfer = (index: number, body: object) =>
    groups.projectFile(people[index].id, devices[index], { groupId, ...body });
  const writer = (task: string) => {
    const run = view();
    const job = run.jobs.find(({ task: entry }) => entry?.key === task);
    assert.ok(job, `Missing project task ${task}. State: ${run.state}. ${run.error ?? ''}`);
    return grants.indexOf(job.grantId);
  };
  const close = () => store.close();
  return {
    start,
    view,
    grants,
    finish,
    poll,
    command,
    close,
    transfer,
    writer,
    groups,
    people,
    devices,
    groupId,
  };
}

const brief = (title = 'Making sense of the evidence') => ({
  kind: 'project-brief',
  brief: {
    title,
    summary:
      'Checked input sources, scope and audience. The work can proceed with the documented constraints.',
    sources: ['https://example.com/source-notes'],
  },
});

function evidenceBytes(file: string) {
  if (file.endsWith('.pdf')) return Buffer.from('%PDF-1.6\nfixture\n%%EOF\n');
  if (file.endsWith('.pptx'))
    return Buffer.concat([
      Buffer.from('504b0304', 'hex'),
      Buffer.from('[Content_Types].xml ppt/presentation.xml'),
    ]);
  if (file.endsWith('.html'))
    return Buffer.from('<!doctype html><main>Audited fixture for the storefront</main>');
  if (file.endsWith('.json')) return Buffer.from('{"evidence":"synthetic fixture"}');
  return Buffer.from('Synthetic test input or output\n');
}

function upload(
  f: ReturnType<typeof fixture>,
  index: number,
  delivery: SharedDelivery,
  file: string,
) {
  const data = evidenceBytes(file);
  return f.transfer(index, {
    action: 'upload',
    jobId: delivery.id,
    runId: delivery.project!.runId,
    path: file,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    part: 0,
    data: data.toString('base64'),
  });
}

test('25 new casual and formal requests are routed through Shared Groups without making projects from status, holds or narrow requests', () => {
  for (const row of projectMessages) {
    const f = fixture();
    try {
      assert.equal(requestedSadeProject(row.text), row.kind, row.text);
      f.start(row.text);
      assert.equal(f.view()?.project?.kind, row.kind, row.text);
      if (row.kind) assert.equal(f.view().project?.stage, 'preparation', row.text);
    } finally {
      f.close();
    }
  }
});

test('Vietnamese project intake distinguishes dựng from đừng', () => {
  assert.equal(
    requestedSadeProject('@Sade dựng lại trang bán hàng cho tiệm túi vải nhé.'),
    'storefront',
  );
  assert.equal(
    requestedSadeProject('@Sade đừng dựng lại trang bán hàng cho tiệm túi vải vội.'),
    undefined,
  );
});

test('status questions and clear holds stay outside project starts', () => {
  assert(projectStatusQuestion('@Sade công việc nào đang chạy và phần nào đang chờ dữ liệu?'));
  assert(projectStatusQuestion('Sade ơi, phần nào đang kẹt?'));
  assert.equal(
    requestedSadeProject(
      'Postpone work on the online shop. We need approval before naming the collectors.',
    ),
    undefined,
  );
  assert.equal(
    requestedSadeProject('@Sade defer building the sales dashboard until the counts are checked.'),
    undefined,
  );
});

test('English directives to lead or oversee a project route as project work', () => {
  assert.equal(
    requestedSadeProject('Could you oversee a paper and PowerPoint on park volunteer training?'),
    'paper-and-slides',
  );
  assert.equal(
    requestedSadeProject('Our lead already sent the research article and slide deck.'),
    undefined,
  );
});

test('an explicit request to ask before work survives the local planner fallback', () => {
  const f = fixture();
  try {
    const { id } = f.start(
      '@Sade dựng một web bán hàng cho gian pop-up. Hỏi mình về mặt hàng trước khi bắt đầu.',
    );
    const paused = f.view(id);
    assert.equal(paused.project?.stage, 'preparation');
    const question = paused.jobs.find(({ state }) => state === 'waiting');
    assert.ok(question?.summary);
    assert.ok(!paused.jobs.some(({ task }) => task));
    f.command(0, {
      action: 'sade-answer',
      runId: id,
      jobId: question.id,
      answer: 'Gian bán khăn vải nhuộm chàm, khách đến lấy tại chỗ.',
    });
    assert.equal(f.view(id).jobs.find(({ task }) => task?.key === 'brief')?.state, 'queued');
  } finally {
    f.close();
  }
});

test('a project does not run under legacy grants with no permission to share session and deliverables', () => {
  const f = fixture(true);
  try {
    f.start(projectMessages[0].text);
    assert.equal(f.view().state, 'blocked');
    assert.match(f.view().error!, /enable project orchestration/i);
    assert.equal(f.poll(0).delivery, undefined);
  } finally {
    f.close();
  }
});

test('complex preparation, directed live messages, paper compilation ownership and independent audit progress automatically', () => {
  const f = fixture();
  try {
    const { id } = f.start(projectMessages[4].text);
    const research = f.view().jobs.filter(({ project }) => project?.stage === 'preparation');
    assert.equal(research.length, 2);
    assert.notEqual(research[0].grantId, research[1].grantId);
    for (const job of research) {
      const index = f.grants.indexOf(job.grantId);
      assert.equal(f.poll(index).delivery?.id, job.id);
      f.finish(index, job.id, brief());
    }
    const plan = f.view();
    assert.equal(plan.project?.stage, 'delivery');
    const jobs = Object.fromEntries(
      plan.jobs.filter((job) => job.task).map((job) => [job.task!.key, job]),
    );
    assert.match(jobs.paper.task!.title, /write and compile/i);
    assert.deepEqual(jobs.paper.task!.dependsOn, ['synthesis']);
    assert.ok(!jobs.slides.task!.dependsOn.includes('paper'));
    assert.notEqual(jobs.audit.grantId, jobs.paper.grantId);
    assert.notEqual(jobs.audit.grantId, jobs.slides.grantId);
    const next = (task: string) => f.poll(f.writer(task)).delivery!;
    const synthesis = next('synthesis'),
      slide = next('slides');
    assert.equal(synthesis.task?.key, 'synthesis');
    assert.equal(slide.task?.key, 'slides');
    assert.equal(
      f.poll(f.writer('paper'), f.writer('paper') === f.writer('synthesis') ? [synthesis.id] : [])
        .delivery,
      undefined,
    );
    const noteId = randomUUID(),
      eventId = randomUUID(),
      sessionId = randomUUID();
    const report = {
      jobId: slide.id,
      sessionId,
      status: 'running',
      activity: [
        {
          id: eventId,
          role: 'assistant',
          text: 'Working title is on the slide outline.',
          at: new Date().toISOString(),
        },
      ],
      notes: [
        {
          id: noteId,
          kind: 'question',
          to: 'paper',
          text: 'Can we keep the current title for the opening slide?',
        },
      ],
    };
    assert.deepEqual(
      f.poll(f.writer('slides'), [slide.id], { projectReports: [report] }).projectAcknowledged,
      [noteId],
    );
    f.poll(f.writer('slides'), [slide.id], { projectReports: [report] });
    assert.equal(f.view().project?.messages.filter((message) => message.id === noteId).length, 1);
    assert.equal(
      f.view().project?.sessions.find(({ id }) => id === sessionId)?.activity[0].id,
      eventId,
    );
    const write = (delivery: SharedDelivery) => {
      const index = f.writer(delivery.task!.key);
      for (const file of delivery.project!.outputs) upload(f, index, delivery, file);
      f.finish(index, delivery.id, { kind: 'done', summary: 'Output verified in the fixture.' });
    };
    assert.throws(
      () => upload(f, f.writer('slides'), slide, synthesis.project!.outputs[0]),
      /outside the assigned/i,
    );
    write(synthesis);
    const paper = next('paper');
    assert.equal(paper.task?.key, 'paper');
    assert.equal(paper.project?.inputs.length, 2);
    assert.ok(paper.project?.context.messages.some(({ id }) => id === noteId));
    const prerequisite = paper.project!.inputs[0];
    const chunk = f.transfer(f.writer('paper'), {
      action: 'download',
      runId: id,
      jobId: paper.id,
      fileId: prerequisite.id,
      part: 0,
    });
    assert.ok('data' in chunk);
    assert.equal(
      createHash('sha256').update(Buffer.from(chunk.data, 'base64')).digest('hex'),
      prerequisite.sha256,
    );
    assert.throws(
      () =>
        f.transfer(f.writer('slides'), {
          action: 'download',
          runId: id,
          jobId: slide.id,
          fileId: prerequisite.id,
          part: 0,
        }),
      /not an approved input/i,
    );
    write(slide);
    write(paper);
    assert.equal(f.view().project?.stage, 'audit');
    const audit = next('audit');
    assert.equal(audit.project?.inputs.length, 7);
    const output = audit.project!.inputs[0];
    assert.throws(
      () => f.transfer(0, { action: 'download', runId: id, fileId: output.id, part: 0 }),
      /not available/i,
    );
    f.finish(f.writer('audit'), audit.id, {
      kind: 'project-audit',
      audit: { summary: 'The presentation needs a clearer limitation.', revise: ['slides'] },
    });
    const revising = next('slides');
    assert.equal(revising.project?.resumeJobId, slide.id);
    write(revising);
    const finalAudit = next('audit');
    assert.equal(finalAudit.project?.resumeJobId, audit.id);
    f.finish(f.writer('audit'), finalAudit.id, {
      kind: 'project-audit',
      audit: { summary: 'Output scope and claims verified in the fixture.', revise: [] },
    });
    assert.equal(f.view().state, 'done');
    assert.equal(f.view().project?.stage, 'complete');
    assert.equal(f.view().project?.artifacts.length, 7);
    const published = f.transfer(0, { action: 'download', runId: id, fileId: output.id, part: 0 });
    assert.ok('data' in published);
    assert.equal(published.file.id, output.id);
  } finally {
    f.close();
  }
});

test('Responses calls are scoped to intake and roadmap, and a worker receipt can wake the roadmap for another account', async (t) => {
  const f = fixture();
  try {
    const runId = randomUUID();
    const projectKey = 'b'.repeat(64);
    const image = Buffer.from('ffd8ffd9', 'hex').toString('base64');
    f.transfer(0, { action: 'catalogue', runId, projectKey, data: image });
    const response = f.command(
      0,
      {
        action: 'message',
        id: runId,
        content: projectMessages[1].text,
        sade: { projectKey, catalogue: true },
      },
      'extended',
    );
    assert.ok(response.sadePlanner);
    const proposal = {
      title: 'Brown rice catalogue',
      summary: 'I’ll confirm the catalogue and buyer’s path.',
      question: null,
      research: 'one',
      instructions: [],
    };
    const calls: { url: string; model?: string; reasoning?: string; hasImage: boolean }[] = [];
    const previous = process.env.SADE_OPENAI_API_KEY;
    process.env.SADE_OPENAI_API_KEY = 'test-orchestration-key';
    t.after(() => {
      if (previous) process.env.SADE_OPENAI_API_KEY = previous;
      else delete process.env.SADE_OPENAI_API_KEY;
    });
    let actor = 0;
    let providerGate: Promise<void> | undefined;
    t.mock.method(globalThis, 'fetch', async (input: string, options?: RequestInit) => {
      const sent = JSON.parse(String(options?.body || '{}'));
      if (input === 'https://api.openai.com/v1/responses') {
        await providerGate;
        const hasImage = Array.isArray(sent.input.at(-1).content);
        if (hasImage)
          assert.equal(sent.input.at(-1).content[1].image_url, 'data:image/jpeg;base64,' + image);
        calls.push({ url: input, model: sent.model, reasoning: sent.reasoning.effort, hasImage });
        return Response.json({
          model: 'gpt-6-luna',
          status: 'completed',
          error: null,
          incomplete_details: null,
          usage: null,
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    ...proposal,
                    ...(hasImage
                      ? {
                          catalogueObservations: 'Two packaging sizes are visible.',
                          question: 'What email should the shop use?',
                        }
                      : {}),
                  }),
                },
              ],
            },
          ],
        });
      }
      assert.equal(input, 'http://runner.local/api/cloud/shared-sade/finish');
      return Response.json(f.groups.finishCloudPlan(f.people[actor], f.devices[actor], sent));
    });
    const hosted = async (offer: SharedSadeCloudOffer) => {
      let release!: () => void;
      providerGate = new Promise<void>((resolve) => (release = resolve));
      let pending: Promise<unknown> | undefined;
      try {
        const admitted = await settleHostedSade(
          Response.json({ accepted: true, sadePlanner: offer }),
          'http://runner.local',
          new Headers(),
          Date.now() + 4_550,
          {},
          (work) => (pending = work),
        );
        assert.deepEqual(admitted, { accepted: true });
        assert.equal(f.view().state, 'planning');
        assert.ok(pending, 'The project decision must continue after the response.');
      } finally {
        release();
      }
      await pending;
    };
    await hosted(response.sadePlanner);
    assert.equal(f.view().project?.title, proposal.title);
    assert.equal(f.view().project?.stage, 'preparation');
    actor = f.writer('brief');
    const research = f.poll(actor).delivery!;
    assert.equal(research.project?.stage, 'preparation');
    assert.match(research.task!.description, /investigate this possible ambiguity.*what email/i);
    assert.ok(
      research.project.context.messages.some(({ text }) => text.includes('Two packaging sizes')),
    );
    assert.ok(!JSON.stringify(f.view()).includes(image));
    const command = Buffer.from(
      JSON.stringify({ action: 'sade-finish', jobId: research.id, result: brief() }),
    );
    assert(usesHostedSade(command));
    assert.equal(hostedSadeBudgetMs(command), 4_550);
    const next = f.finish(actor, research.id, brief(), 'extended');
    assert.equal(next.sadePlanner?.delivery.projectPlanning?.stage, 'roadmap');
    await hosted(next.sadePlanner);
    assert.equal(f.view().project?.stage, 'delivery');
    assert.deepEqual(
      calls.map(({ model, reasoning }) => [model, reasoning]),
      [
        ['gpt-6-luna', 'low'],
        ['gpt-6-luna', 'medium'],
      ],
    );
    assert.deepEqual(
      calls.map(({ hasImage }) => hasImage),
      [true, false],
    );
    for (const key of ['catalogue', 'journey', 'storefront'] as const) {
      const owner = f.writer(key);
      const task = f.poll(owner).delivery!;
      assert.equal(task.task!.key, key);
      if (key === 'storefront')
        assert.deepEqual(
          task.project!.inputs.map(({ path }) => path.split('/').at(-1)),
          ['products.json'],
        );
      for (const file of task.project!.outputs) upload(f, owner, task, file);
      f.finish(owner, task.id, {
        kind: 'done',
        summary: 'Delivered and checked the scoped storefront fixture.',
      });
    }
    const auditor = f.writer('audit');
    assert.notEqual(auditor, f.writer('storefront'));
    const audit = f.poll(auditor).delivery!;
    const page = audit.project!.inputs.find(({ path }) => path.endsWith('/storefront/index.html'))!;
    assert.ok(page);
    assert.throws(() =>
      f.transfer(0, { action: 'download', runId: response.id, fileId: page.id, part: 0 }),
    );
    f.finish(auditor, audit.id, {
      kind: 'project-audit',
      audit: { summary: 'Checked catalogue and ordering path.', revise: [] },
    });
    assert.equal(f.view().project?.stage, 'complete');
    const downloaded = f.transfer(0, {
      action: 'download',
      runId: response.id,
      fileId: page.id,
      part: 0,
    }) as { data: string };
    assert.match(
      Buffer.from(downloaded.data, 'base64').toString('utf8'),
      /Audited fixture for the storefront/,
    );
  } finally {
    f.close();
  }
});

test('a slides task can produce an auditable PowerPoint file without a second harness', async (t) => {
  const prefix = 'sade-slides-tool-';
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(async () => {
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  });
  const files = ['output/slides.pptx', 'output/slides.md'];
  const parameters = {
    title: 'Bản kiểm tra của Sade',
    slides: [{ title: 'Số liệu thử', bullets: ['Một kết luận cần kiểm tra'], source: 'Fixture' }],
  };
  const info = await renderProjectSlides(root, files, parameters, () => {});
  assert.equal(info.totalSlides, 2);
  const data = await readFile(path.join(root, files[0]));
  assert.equal(data.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(data.includes('ppt/slides/slide2.xml'));
  assert.match(await readFile(path.join(root, files[1]), 'utf8'), /Một kết luận/);
  await assert.rejects(
    renderProjectSlides(root, ['output/slides.md'], parameters, () => {}),
    /did not grant that output/,
  );
});

const accountsByProvider = {
  codex: 'chatgpt',
  gemini: 'gemini-google',
  claude: 'claude-subscription',
  antigravity: 'antigravity-google',
} as const;

class ProjectCliFixture extends CodexClient {
  replied?: { success: boolean; contentItems?: { text: string }[] };
  constructor(
    cwd: string,
    override readonly provider: ProviderId,
  ) {
    super({ home: cwd, cwd });
  }
  override async start() {}
  override async stop() {}
  override async request<T = any>(method: string, params: any = {}): Promise<T> {
    let value: unknown = {};
    if (method === 'account/read') value = { account: { type: accountsByProvider[this.provider] } };
    if (method === 'account/rateLimits/read')
      value = {
        ordinaryUsageAllowed: true,
        rateLimits:
          this.provider === 'codex'
            ? {
                primary: {
                  usedPercent: 10,
                  windowDurationMins: 300,
                  resetsAt: Math.floor(Date.now() / 1000) + 3600,
                },
              }
            : null,
      };
    if (method === 'model/list')
      value = {
        data: [
          {
            id: 'fixture-model',
            model: 'fixture-model',
            displayName: 'Fixture',
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'fixture' }],
          },
        ],
      };
    if (method === 'thread/start' || method === 'thread/resume')
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
    if (method === 'turn/start') value = { turn: { id: randomUUID() } };
    return value as T;
  }
  override respond(_id: string | number, value: any) {
    this.replied = value;
  }
}

test('different desktop workers resume the same session after clarification and deliver checked inputs and a preview across worktrees', async (t) => {
  const prefix = 'sade-project-worker-';
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const origin = 'https://example.test/festival-kpi.git';
  const key = canonicalSharedRepository(origin, 'main');
  const desktops: {
    workspace: Workspace;
    store: Store;
    peer: ProjectCliFixture;
    repo: string;
    projectId: string;
    memberId: string;
  }[] = [];
  let group: ReturnType<typeof fixture> | undefined;
  t.after(async () => {
    await Promise.all(
      desktops.map(async ({ workspace, store }) => {
        await workspace.close();
        store.close();
      }),
    );
    group?.close();
    assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith(prefix));
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  for (const [index, provider] of providerNames.entries()) {
    const repo = path.join(directory, 'repo-' + index),
      data = path.join(directory, 'desktop-' + index);
    await Promise.all([mkdir(repo), mkdir(data)]);
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['remote', 'add', 'origin', origin]);
    await writeFile(path.join(repo, 'README.md'), 'Unchanged baseline\n');
    await git(repo, ['add', '--', 'README.md']);
    await git(repo, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'Baseline',
    ]);
    const store = new Store(':memory:'),
      workspace = new Workspace(store, data, repo);
    const role = (['researcher', 'engineer', 'designer', 'reviewer'] as const)[index];
    const member = store.addMember({
      name: ['Aria', 'Alex', 'Jen', 'Noor'][index],
      role,
      provider,
    });
    store.updateMember(member.id, {
      status: 'ready',
      account: { type: accountsByProvider[provider] },
      managedRuntime: true,
      integration: 'native',
    });
    const projectId = randomUUID();
    store.put('project', {
      id: projectId,
      path: repo,
      name: 'Sales test',
      goal: 'Validate a dashboard chain',
      memberIds: [member.id],
      createdAt: new Date().toISOString(),
    });
    const peer = new ProjectCliFixture(repo, provider);
    workspace.client = async () => new ProjectCliFixture(repo, provider);
    workspace.sessions.createClient = () => peer;
    workspace.refresh = async () => store.get('member', member.id);
    desktops.push({ workspace, store, peer, repo, projectId, memberId: member.id });
  }
  const f = (group = fixture(false, { key, memberIds: desktops.map(({ memberId }) => memberId) }));
  for (const [index, { workspace, memberId, projectId }] of desktops.entries())
    await workspace.sharedSade.execute({
      action: 'grant',
      groupId: f.groupId,
      id: f.grants[index],
      projectId,
      teammateId: memberId,
      turns: 10,
      allowWrites: index === 1 || index === 2,
      projectOrchestration: true,
    });

  type Snapshot = {
    active: string[];
    projectReports?: unknown[];
    projectTransfer?: {
      action: 'download' | 'upload';
      jobId: string;
      runId: string;
      groupId: string;
      part: number;
      path?: string;
    };
    results: { jobId: string; result: SharedFinish; version: number; updatesRead?: number }[];
  };
  const tick = async (index: number) => {
    const desktop = desktops[index].workspace.sharedSade;
    const snapshot = (await desktop.execute({ action: 'snapshot' })) as Snapshot;
    const acknowledged = snapshot.results.map(({ jobId, result, version, updatesRead }) => {
      f.command(index, { action: 'sade-finish', jobId, result, updatesRead });
      return { jobId, version };
    });
    const receipt = f.poll(index, snapshot.active, { projectReports: snapshot.projectReports });
    const transfer = snapshot.projectTransfer;
    let projectTransferred;
    if (transfer && receipt.active.includes(transfer.jobId)) {
      const { jobId, part } = transfer;
      if (transfer.action === 'download') {
        const downloaded = f.transfer(index, transfer);
        assert.ok('data' in downloaded);
        await desktop.execute({
          action: 'project-input-chunk',
          jobId,
          fileId: downloaded.file.id,
          part,
          data: downloaded.data,
        });
      } else {
        const { data } = (await desktop.execute({
          action: 'project-output-chunk',
          jobId,
          path: transfer.path,
          part,
        })) as { data: string };
        f.transfer(index, { ...transfer, data });
        projectTransferred = { jobId, path: transfer.path, part };
      }
    }
    await desktop.execute({
      action: 'exchange',
      active: receipt.active,
      delivery: receipt.delivery,
      acknowledged,
      projectContexts: receipt.projectContexts,
      projectAcknowledged: receipt.projectAcknowledged,
      projectTransferred,
    });
  };
  const current = async (taskKey: string) => {
    const index = f.writer(taskKey);
    const host = desktops[index];
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = f.view().jobs.find(({ task }) => task?.key === taskKey)!;
      const task = host.store.tasks().find(({ sharedSadeJobId }) => sharedSadeJobId === job.id);
      const session = task?.sessionId && host.store.get<CodexSession>('session', task.sessionId);
      if (session && session.status === 'running' && session.threadId && session.turnId)
        return { ...host, index, session, task: task!, job };
      await tick(index);
      await pause(20);
    }
    assert.fail('Project task did not start: ' + taskKey + ' ' + JSON.stringify(f.view().error));
  };
  type Running = Awaited<ReturnType<typeof current>>;
  const call = async (row: Running, tool: string, args: object) => {
    row.peer.replied = undefined;
    await row.workspace.sessions.request(row.session.id, row.peer, {
      id: randomUUID(),
      method: 'item/tool/call',
      params: {
        threadId: row.session.threadId,
        turnId: row.session.turnId,
        tool,
        arguments: args,
      },
    });
    const result = row.peer.replied as ProjectCliFixture['replied'];
    return { success: result?.success, content: result?.contentItems?.[0].text };
  };
  const finish = async (row: Running, summary: string) => {
    const ids = { threadId: row.session.threadId, turnId: row.session.turnId };
    await row.workspace.sessions.notification(row.session.id, row.peer, 'item/completed', {
      ...ids,
      item: { type: 'agentMessage', text: summary },
    });
    await row.workspace.sessions.notification(row.session.id, row.peer, 'turn/completed', {
      ...ids,
      turn: { id: row.session.turnId, status: 'completed' },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      await tick(row.index);
      if (f.view().jobs.find(({ id }) => id === row.job.id)?.state !== 'running') return;
      await pause(20);
    }
    assert.fail('Project receipt did not settle: ' + row.job.task!.key);
  };

  const { id } = f.start(
    'Làm giúp mình một dashboard bán hàng cho chợ sách cũ, tụi mình muốn đối chiếu hàng hoàn và tiền thu theo ngày.',
  );
  const first = await current('brief');
  assert.equal(
    (
      await call(first, 'relay_ask_shared_requester', {
        summary: 'Bạn có nguồn dữ liệu nào cho hàng hoàn và tiền thu?',
      })
    ).success,
    true,
  );
  await finish(first, 'Waiting for the source and refund definition.');
  assert.equal(f.view().jobs.find(({ task }) => task?.key === 'brief')?.state, 'waiting');
  const evidence = await current('evidence');
  assert.equal(
    (await call(evidence, 'relay_project_brief', brief('Refund constraints').brief)).success,
    true,
  );
  await finish(evidence, 'Checked the independent calculation constraints.');
  f.command(0, {
    action: 'sade-answer',
    runId: id,
    jobId: first.job.id,
    answer: 'Dùng dữ liệu kiểm thử, tiền thu đã trừ hàng hoàn.',
  });
  const followup = await current('brief');
  assert.equal(followup.session.id, first.session.id);
  assert.equal(followup.session.threadId, first.session.threadId);
  assert.equal(
    (await call(followup, 'relay_project_brief', brief('Chợ sách cũ').brief)).success,
    true,
  );
  await finish(followup, 'The requester confirmed sample data and net revenue.');

  const metrics = await current('metrics'),
    layout = await current('dashboard-layout');
  assert.notEqual(metrics.index, layout.index);
  const dashboardFile = f.view().jobs.find(({ task }) => task?.key === 'dashboard')!.project!
    .outputs[0];
  assert.equal(
    (
      await call(metrics, 'workspace_write_file', {
        path: dashboardFile,
        content: 'This belongs to the dashboard harness',
      })
    ).success,
    false,
  );
  await tick(metrics.index);
  assert.ok(f.view().project?.messages.some(({ kind }) => kind === 'scope'));
  assert.equal(
    (
      await call(metrics, 'workspace_write_file', {
        path: metrics.job.project!.outputs[0],
        content: '{"netRevenue":45,"sample":true}',
      })
    ).success,
    true,
  );
  await finish(metrics, 'Verified demo refund arithmetic.');
  assert.equal(
    (
      await call(layout, 'relay_project_report', {
        kind: 'handoff',
        to: 'dashboard',
        text: 'Use one net revenue card and a day filter for the reviewed prototype.',
      })
    ).success,
    true,
  );
  await finish(layout, 'Published the testable layout checks.');
  const dashboard = await current('dashboard');
  assert.ok(
    (
      await readFile(path.join(dashboard.task.worktree!, metrics.job.project!.outputs[0]), 'utf8')
    ).includes('netRevenue'),
  );
  assert.equal(
    (
      await call(dashboard, 'workspace_write_file', {
        path: dashboardFile,
        content: '<!doctype html><main>Verified preview fixture</main>',
      })
    ).success,
    true,
  );
  await finish(dashboard, 'Stored the fixture preview and checked the requested scope.');
  const auditor = await current('audit');
  assert.equal(
    (
      await call(auditor, 'relay_project_audit', {
        summary: 'Confirmed the preview used marked sample data.',
        revise: [],
      })
    ).success,
    true,
  );
  await finish(auditor, 'The preview is ready.');
  assert.equal(f.view().project?.stage, 'complete');
  assert.ok(f.view().project?.artifacts.find(({ path }) => path === dashboardFile));
  assert.ok(f.view().project?.sessions.some(({ id }) => id === followup.session.id));
  for (const { repo } of desktops) assert.equal(await git(repo, ['status', '--porcelain']), '');
});
