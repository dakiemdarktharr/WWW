import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SharedGroups } from '../server/collaboration.ts';
import {
  groupNoWorkTool,
  groupPlanTool,
  needsGroupWrite,
  parseGroupNoWork,
  parseSharedGroupPlan,
  type SharedDelivery,
} from '../server/group-sade.ts';
import { sharedGroupPlanningPrompt } from '../server/shared-sade-worker.ts';
import { Store } from '../server/store.ts';
import { parseTeamPlan } from '../server/workflow-plan.ts';
import type { SharedSadeJob, SharedSadeRun } from '../shared/collaboration.ts';

const messages = {
  handoff: [
    'ê Bếp làm hợp đồng dữ liệu trong docs/contract.md trước nha, Mây chờ đúng file đó rồi làm màn đăng ký ở src/signup.ts',
    'Bep sua docs/contract.md truoc nhe, May lay ket qua do moi lam giao dien trong src/signup.ts. Mot lan nhan thoi nhe.',
    'Bếp owns docs/contract.md. Assign Mây src/signup.ts with a hard dependency on the contract from Bếp.',
  ],
  duplicate: [
    'hai con đều tính sửa src/menu.ts rồi á. giữ đúng một đứa làm file này thôi, nhớ coi commit cũ trước tránh làm đôi.',
    'ca Bep voi May dang dinh sua src/menu.ts. Chi giao mot nguoi sua file do thoi nha, coi cai da commit truoc.',
    'Avoid duplicate changes to src/menu.ts. Read the existing commits first and give that file exactly one writer.',
  ],
  review: [
    'nhờ Bếp sửa phép làm tròn src/total.ts rồi để Mây coi diff và test độc lập trước khi tích hợp nha',
    'Bep sua src/total.ts giup; May coi lai diff va loi lam tron, doc lap truoc luc hop thay doi.',
    'Bếp fixes the rounding in src/total.ts. Have Mây independently inspect the final diff before local integration.',
  ],
  mac: [
    'máy mình windows chạy rồi, Sade cho Bếp dùng cái mac đã ghép cặp của bạn test src/window.ts và sửa lỗi mở cửa sổ nha. bạn ấy không đăng nhập AI.',
    'Cho Bep dung Mac da ghep cap de chay kiem tra src/window.ts va sua loi chi xay ra tren mac. Chu may khong co tai khoan AI.',
    'Bếp should debug src/window.ts on the consented paired macOS runner. The Mac owner offers tools only and has no model sign-in.',
  ],
  'missing-mac': [
    'cần Bếp chạy test src/window.ts trên đúng máy Mac nha, chỉ Windows thì để chờ chứ chưa có kết quả đâu',
    'kiem src/window.ts bang may Mac that nha, thieu quyen Mac thi bao nhom doi; dung chay thay tren Windows.',
    'Verify src/window.ts on actual macOS. If the machine is unavailable, preserve that requirement and wait for an approved Mac.',
  ],
  chat: [
    'cảm ơn nha. Bếp với Mây nói vụ review rồi, mình báo lại cho team biết thôi, đừng chạy việc gì',
    'May nhac Mac va diff trong cuoc hop, tui nhan lai de mn biet thoi, chua nho Sade lam gi.',
    'FYI for the human team: “start a Mac check and inspect the diff” was a quote from yesterday. No harness should run now.',
  ],
};
type Case = keyof typeof messages;
const handoffHoldout = [
  'Mây làm src/signup.ts sau khi nhận docs/contract.md, cái file tài liệu em nhờ Bếp cập nhật trước nghen.',
  'Cho Bep dien quy uoc vao docs/contract.md. Khi nao nhan dung file thi May moi sua src/signup.ts nha.',
  'Have Mây implement src/signup.ts only once Bếp has written the required signup rules to docs/contract.md.',
];
const defaultHandoff = { source: 'docs/contract.md', target: 'src/signup.ts', sourceOwner: 0 };
const variedHandoffs = [
  {
    message:
      'May chot bang mau vao assets/palette.json giup nha. Xong Bep lay no ra chinh src/theme.css. Bep doi co bang mau roi moi chinh.',
    source: 'assets/palette.json',
    target: 'src/theme.css',
    sourceOwner: 1,
  },
  {
    message:
      'Nhờ Bếp thêm các trường hồ sơ vào config/fields.yaml. Mây cập nhật src/profile.ts theo cấu hình Bếp gửi sau khi đã hoàn tất.',
    source: 'config/fields.yaml',
    target: 'src/profile.ts',
    sourceOwner: 0,
  },
  {
    message:
      'Mây should add tests/widget.test.ts against the contract Bếp will write to docs/widget-api.md first. Mây needs the actual document before writing the tests.',
    source: 'docs/widget-api.md',
    target: 'tests/widget.test.ts',
    sourceOwner: 0,
  },
  {
    message:
      'Ê Bếp chờ Mây cập nhật data/columns.csv xong thì hãy sửa src/importer.ts theo tên cột mới giùm tui nhe.',
    source: 'data/columns.csv',
    target: 'src/importer.ts',
    sourceOwner: 1,
  },
  {
    message:
      'Bếp: implement the invoice total in src/invoice.ts. Mây: update docs/invoice.md once Bếp’s implementation is ready so the examples reflect the final behavior.',
    source: 'src/invoice.ts',
    target: 'docs/invoice.md',
    sourceOwner: 0,
  },
  {
    message:
      'Lam mot luot nhe: Bep se bo sung index vao db/products.sql, con May sua truy van trong src/products.ts sau khi nhan schema moi cua Bep.',
    source: 'db/products.sql',
    target: 'src/products.ts',
    sourceOwner: 0,
  },
];

const endpoint = 'http://127.0.0.1:11565';
const model = 'qwen3:4b-instruct-2507-q4_K_M';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    replay: { type: 'string' },
    'handoff-holdout': { type: 'boolean' },
    'handoff-varied': { type: 'boolean' },
  },
});
assert.ok(!(values['handoff-holdout'] && values['handoff-varied']), 'Choose one handoff suite');
const output = path.resolve(positionals[0] || '.local/shared-sade-planner.json');
const source = values.replay && path.resolve(values.replay);
assert.notEqual(output, source, 'Choose a separate output file for replay');
type SavedRun = {
  model: string;
  digest: string;
  toolsSha256: string;
  rows: { id: string; promptSha256: string; plan?: unknown; error?: string; toolName?: string }[];
};
const saved: SavedRun | undefined = source ? JSON.parse(await readFile(source, 'utf8')) : undefined;
const tools = [groupPlanTool, groupNoWorkTool].map(({ type, name, description, inputSchema }) => ({
  type,
  function: { name, description, parameters: inputSchema },
}));
const projectKey = 'a'.repeat(64);
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const groupId = uuid(1);
const grants = [uuid(2), uuid(3)];
const devices = [uuid(4), uuid(5)];
const teammates = [uuid(6), uuid(7)];
const people = [
  { id: 'owner-a', name: 'An' },
  { id: 'owner-b', name: 'Bình' },
];
const authors = ['Bếp', 'Mây'];

async function withGroup<T>(
  scenario: Case,
  message: string,
  run: (context: {
    delivery: SharedDelivery;
    finish: (plan: unknown) => void;
    jobs: () => SharedSadeRun;
    verifyReview: (job: SharedSadeJob) => void;
  }) => Promise<T>,
) {
  const store = new Store(':memory:');
  try {
    const groups = new SharedGroups(
      store,
      (value) => people.find((person) => person.id === value) || null,
    );
    const call = (actor: number, input: object) =>
      groups.execute(people[actor], input, devices[actor]);
    for (const [index, id] of devices.entries())
      store.put('desktopDevice', {
        id,
        owner: people[index],
        revoked: false,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        tokenHash: 'fixture-private-token-hash',
      });
    call(0, { action: 'create', id: groupId, name: 'Local planner test' });
    call(0, { action: 'invite', groupId, account: people[1].id });
    call(1, { action: 'accept', groupId });
    for (const [index, localId] of teammates.entries()) {
      call(index, {
        action: 'teammates',
        groupId,
        teammates: [
          {
            localId,
            provider: index ? 'codex' : 'gemini',
            name: authors[index],
          },
        ],
      });
      if (index && (scenario === 'mac' || scenario === 'missing-mac')) continue;
      call(index, {
        action: 'sade-grant',
        groupId,
        id: grants[index],
        teammateId: localId,
        projectKey,
        projectName: 'Local test project',
        role: index ? 'reviewer' : 'engineer',
        platform: 'win32',
        allowWrites: true,
        turns: 8,
        ...(!index && scenario === 'mac' ? { pairedPlatform: 'darwin' } : {}),
      });
    }
    const poll = (index: number, active: string[] = []) =>
      (
        call(index, {
          action: 'sade-poll',
          grants: [grants[index]],
          active,
        }) as { delivery?: SharedDelivery }
      ).delivery;
    call(0, { action: 'message', groupId, id: uuid(8), content: message, sade: { projectKey } });
    const delivery = poll(0);
    assert.ok(delivery?.phase === 'plan');
    const jobs = () =>
      (call(0, { action: 'read', groupId }) as { sadeRuns: SharedSadeRun[] }).sadeRuns[0];
    return await run({
      delivery,
      finish: (plan) =>
        call(0, { action: 'sade-finish', jobId: delivery.id, result: { kind: 'plan', plan } }),
      jobs,
      verifyReview(job) {
        assert.equal(poll(0)?.id, job.id, 'the implementation must be the first delivery');
        call(0, {
          action: 'sade-finish',
          jobId: job.id,
          result: {
            kind: 'change',
            summary: 'Synthetic implementation changed rounding.',
            diff: {
              files: ['src/total.ts'],
              diff: '+export const rounding = Math.round;\n',
              stat: '1 file',
              truncated: false,
            },
          },
        });
        const review = poll(1);
        assert.equal(
          review?.phase,
          'review',
          'the coordinator must dispatch the independent review',
        );
        assert.equal(jobs().jobs.filter((item) => item.phase === 'review').length, 1);
        call(1, {
          action: 'sade-finish',
          jobId: review!.id,
          result: {
            kind: 'review',
            verdict: 'approved',
            summary: 'Verified rounding in the supplied diff.',
          },
        });
        call(0, {
          action: 'sade-finish',
          jobId: job.id,
          result: {
            kind: 'done',
            revision: 'b'.repeat(40),
            summary: 'The reviewed change was integrated locally.',
          },
        });
        assert.equal(poll(1), undefined, 'no duplicate review should be dispatched');
        assert.equal(jobs().state, 'done');
      },
    });
  } finally {
    store.close();
  }
}

function scopedWriter(jobs: SharedSadeJob[], file: string) {
  const matches = jobs.filter((job) => needsGroupWrite(job.task) && job.task?.scope.includes(file));
  assert.equal(matches.length, 1, `expected one writer for ${file}`);
  assert.deepEqual(matches[0].task?.scope, [file], `expected a narrow scope for ${file}`);
  return matches[0];
}

function assess(
  scenario: Case,
  plan: ReturnType<typeof parseTeamPlan>,
  run: SharedSadeRun,
  handoff = defaultHandoff,
) {
  if (scenario === 'missing-mac') {
    assert.equal(run.state, 'blocked', 'missing Mac must stop assignment');
    assert.ok(
      plan.tasks.some((task) => task.requiredPlatform === 'darwin'),
      'keep the Mac requirement',
    );
    assert.match(
      run.error || '',
      /No authorized teammate can run/,
      'report the missing eligible Mac',
    );
    assert.ok(!run.jobs.some((job) => job.phase === 'task'));
    return;
  }
  if (scenario === 'chat') {
    assert.equal(run.state, 'done', 'complete without any execution');
    assert.equal(plan.tasks.length, 0);
    return;
  }
  assert.equal(run.state, 'running', run.error || 'a valid plan should be queued');
  const jobs = run.jobs.filter((job) => job.phase === 'task');
  if (scenario === 'handoff') {
    assert.equal(jobs.length, 2, 'two tasks are sufficient');
    const source = scopedWriter(jobs, handoff.source);
    const target = scopedWriter(jobs, handoff.target);
    assert.equal(source.grantId, grants[handoff.sourceOwner], 'preserve the named producer');
    assert.equal(target.grantId, grants[1 - handoff.sourceOwner], 'preserve the named recipient');
    assert.deepEqual(target.task?.dependsOn, [source.task?.key], 'schedule the producer first');
  } else if (scenario === 'duplicate') {
    scopedWriter(jobs, 'src/menu.ts');
    assert.equal(
      jobs.filter((job) => needsGroupWrite(job.task)).length,
      1,
      'do not schedule a duplicate write',
    );
  } else if (scenario === 'review') {
    const writer = scopedWriter(jobs, 'src/total.ts');
    assert.equal(writer.grantId, grants[0], 'preserve the named author');
    assert.equal(jobs.length, 1, 'the coordinator already creates the independent review');
    return writer;
  } else {
    assert.equal(jobs.length, 1, 'one paired task can verify and fix');
    const task = scopedWriter(jobs, 'src/window.ts');
    assert.equal(task.grantId, grants[0]);
    assert.equal(task.task?.requiredPlatform, 'darwin', 'preserve actual macOS');
  }
}

const local = (route: string, options?: RequestInit) => fetch(`${endpoint}${route}`, options);
type PlannerReply = {
  role: 'assistant';
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
};
async function getPlannerReply(messages: unknown[]): Promise<PlannerReply> {
  const response = await local('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: '45s',
      options: { temperature: 0, seed: 7013, num_ctx: 4096, num_predict: 768 },
      tools,
      messages,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  return (await response.json()).message;
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const toolsSha256 = sha256(JSON.stringify(tools));
if (saved) {
  assert.equal(saved.model, model);
  assert.equal(saved.toolsSha256, toolsSha256);
}
const selected =
  saved ||
  (await (await local('/api/tags', { signal: AbortSignal.timeout(5000) })).json()).models.find(
    (entry: { name: string }) => entry.name === model,
  );
assert.ok(selected, 'Install the specified Qwen in the local Ollama directory.');
const cases: {
  scenario: Case;
  id: string;
  message: string;
  handoff?: typeof defaultHandoff;
}[] = values['handoff-varied']
  ? variedHandoffs.map(({ message, ...handoff }, index) => ({
      scenario: 'handoff',
      id: `handoff/varied-${index + 1}`,
      message,
      handoff,
    }))
  : values['handoff-holdout']
    ? handoffHoldout.map((message, index) => ({
        scenario: 'handoff' as const,
        id: `handoff/holdout-${index + 1}`,
        message,
      }))
    : Object.entries(messages).flatMap(([scenario, inputs]) =>
        inputs.map((message, index) => ({
          scenario: scenario as Case,
          id: `${scenario}/${index + 1}`,
          message,
        })),
      );
const rows = [];
const savedRows = new Map(saved?.rows.map((row) => [row.id, row]));
if (saved) assert.equal(savedRows.size, cases.length, 'Replay requires the same cases');
await mkdir(path.dirname(output), { recursive: true });
for (const { scenario, id, message, handoff } of cases) {
  const row = await withGroup(scenario, message, async (group) => {
    const prompt = sharedGroupPlanningPrompt(group.delivery);
    assert.doesNotMatch(prompt, /fixture-private-token-hash/);
    const promptSha256 = sha256(prompt);
    const prior = savedRows.get(id);
    if (saved) assert.equal(prior?.promptSha256, promptSha256, `Prompt changed for ${id}`);
    const started = performance.now();
    let parsed = false;
    let plan;
    let run;
    let error;
    let toolName;
    let correction;
    try {
      if (prior) {
        if (!prior.plan) throw new Error(prior.error || 'Model returned no plan.');
        toolName = prior.toolName;
        plan = parseTeamPlan(prior.plan, { allowEmpty: true });
      } else {
        const messages: unknown[] = [{ role: 'user', content: prompt }];
        const roster = group.delivery.team.map((member) => member.id);
        for (let attempt = 0; attempt < 2; attempt++) {
          const reply = await getPlannerReply(messages);
          assert.equal(reply.tool_calls?.length, 1, 'expected exactly one tool call');
          const tool = reply.tool_calls![0].function;
          toolName = tool.name;
          try {
            if (toolName === groupNoWorkTool.name) plan = parseGroupNoWork(tool.arguments);
            else {
              assert.equal(toolName, groupPlanTool.name);
              plan = parseSharedGroupPlan(tool.arguments, roster);
            }
            break;
          } catch (cause) {
            if (attempt !== 0 || toolName !== groupPlanTool.name) throw cause;
            correction = cause instanceof Error ? cause.message : String(cause);
            messages.push(reply, { role: 'tool', tool_name: toolName, content: correction });
          }
        }
        assert.ok(plan, 'expected a validated plan');
      }
      parsed = true;
      group.finish(plan);
      run = group.jobs();
      const writer = assess(scenario, plan, run, handoff);
      if (writer) group.verifyReview(writer);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return {
      id,
      scenario,
      promptSha256,
      parsed,
      pass: !error,
      milliseconds: Math.round(performance.now() - started),
      plan,
      toolName,
      correction,
      state: run?.state,
      error,
    };
  });
  rows.push(row);
  console.log(
    JSON.stringify({
      id,
      pass: row.pass,
      parsed: row.parsed,
      milliseconds: row.milliseconds,
      error: row.error,
      correction: row.correction,
    }),
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        model,
        digest: selected.digest,
        toolsSha256,
        ...(source ? { replayedFrom: path.basename(source) } : {}),
        rows,
      },
      null,
      2,
    ),
    'utf8',
  );
}
console.log(
  JSON.stringify({
    tested: rows.length,
    parsed: rows.filter((row) => row.parsed).length,
    passed: rows.filter((row) => row.pass).length,
  }),
);
