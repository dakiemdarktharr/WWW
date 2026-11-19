import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

const endpoint = 'http://127.0.0.1:11565';
const model = 'qwen3:4b-instruct-2507-q4_K_M';
const output = path.resolve(process.argv[2] || '.local/shared-sade-planner.json');
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
        assert.equal(
          poll(1)?.phase,
          'review',
          'the coordinator must dispatch the independent review',
        );
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

function assess(scenario: Case, plan: ReturnType<typeof parseTeamPlan>, run: SharedSadeRun) {
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
    const contract = scopedWriter(jobs, 'docs/contract.md');
    const frontend = scopedWriter(jobs, 'src/signup.ts');
    assert.equal(contract.grantId, grants[0], 'preserve the named contract owner');
    assert.equal(frontend.grantId, grants[1], 'preserve the named frontend owner');
    assert.deepEqual(
      frontend.task?.dependsOn,
      [contract.task?.key],
      'handoff must precede frontend',
    );
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
const installed = (await (await local('/api/tags', { signal: AbortSignal.timeout(5000) })).json())
  .models;
const selected = installed.find((entry: { name: string }) => entry.name === model);
assert.ok(selected, 'Install the specified Qwen in the local Ollama directory.');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const cases = Object.entries(messages).flatMap(([scenario, inputs]) =>
  inputs.map((message, index) => ({
    scenario: scenario as Case,
    id: `${scenario}/${index + 1}`,
    message,
  })),
);
const rows = [];
await mkdir(path.dirname(output), { recursive: true });
for (const { scenario, id, message } of cases) {
  const row = await withGroup(scenario, message, async (group) => {
    const prompt = sharedGroupPlanningPrompt(group.delivery);
    assert.doesNotMatch(prompt, /fixture-private-token-hash/);
    const started = performance.now();
    let parsed = false;
    let plan;
    let run;
    let error;
    let toolName;
    try {
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
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const { message: reply } = await response.json();
      assert.equal(reply.tool_calls?.length, 1, 'expected exactly one tool call');
      const tool = reply.tool_calls[0].function;
      toolName = tool.name;
      if (toolName === groupNoWorkTool.name) plan = parseGroupNoWork(tool.arguments);
      else {
        assert.equal(toolName, groupPlanTool.name);
        plan = parseSharedGroupPlan(tool.arguments);
      }
      parsed = true;
      group.finish(plan);
      run = group.jobs();
      const writer = assess(scenario, plan, run);
      if (writer) group.verifyReview(writer);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return {
      id,
      scenario,
      promptSha256: sha256(prompt),
      parsed,
      pass: !error,
      milliseconds: Math.round(performance.now() - started),
      plan,
      toolName,
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
    }),
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        model,
        digest: selected.digest,
        toolsSha256: sha256(JSON.stringify(tools)),
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
