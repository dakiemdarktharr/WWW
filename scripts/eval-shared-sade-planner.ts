import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { SharedGroups } from '../server/collaboration.ts';
import {
  groupNoWorkTool,
  groupPlanTool,
  groupQuestionTool,
  needsGroupWrite,
  parseGroupNoWork,
  parseSharedGroupPlan,
  sharedFinish,
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
const ownerHandoffs = [
  {
    id: 'owner/relative',
    scenario: 'owner-relative',
    message:
      'ê Gemini của mình viết docs/contract.md trước nha, Gemini của ông lấy hợp đồng đó làm src/signup.ts giùm.',
  },
  {
    id: 'owner/named',
    scenario: 'owner-named',
    message:
      'Gemini cua minh viet docs/contract.md truoc nhe. Astra cua Binh lay dung hop dong do roi sua src/signup.ts.',
  },
  {
    id: 'owner/ambiguous',
    scenario: 'owner-ambiguous',
    message:
      'Gemini của mình viết docs/contract.md rồi giao Astra của bạn sửa src/signup.ts theo hợp đồng đó nha.',
  },
  {
    id: 'owner/ungranted',
    scenario: 'owner-ungranted',
    message:
      'Gemini của Bình viết docs/contract.md trước nhé, xong Gemini của mình làm src/signup.ts theo đúng file đó.',
  },
] as const;
const intentContrasts = [
  {
    id: 'intent/quoted-update',
    scenario: 'chat',
    message:
      'ê hôm qua tin “Mây sửa src/menu.ts nha” là tui chép lại cho mn hiểu vụ trùng commit á. giờ tui báo tiến độ thôi.',
  },
  {
    id: 'intent/quoted-request',
    scenario: 'menu-edit',
    message:
      'ê hôm qua tui chỉ chép lại. giờ nhờ Mây sửa src/menu.ts thật nha, coi commit trước rồi bỏ qua phần đã làm.',
  },
  {
    id: 'intent/deferred',
    scenario: 'chat',
    message:
      'may se sua src/menu.ts khi nao minh nhan OK o tin khac nha. tin nay chi thong bao quy trinh de team biet.',
  },
  {
    id: 'intent/confirmed',
    scenario: 'menu-edit',
    message:
      'OK toi xac nhan bat dau tu tin nay. May sua src/menu.ts, kiem commit cu roi giu dung mot nguoi sua nhe.',
  },
  {
    id: 'intent/status',
    scenario: 'chat',
    message:
      'Mình mới dùng AI nên đang kể cách Mây đọc src/menu.ts cho nhóm hiểu. Phần đó đã xong, mình chỉ báo mọi người thôi nhé.',
  },
  {
    id: 'intent/read-only',
    scenario: 'read-menu',
    message:
      'Mình mới dùng AI, chỉ nhờ Mây đọc src/menu.ts và nói giúp file này làm gì nha. Đừng sửa file.',
  },
  {
    id: 'intent/mac-status',
    scenario: 'chat',
    message:
      'FYI, “Bếp should run src/window.ts on the paired Mac” was an example from the meeting. Windows is fine. No new run was authorized here.',
  },
  {
    id: 'intent/mac-request',
    scenario: 'mac',
    message:
      'Windows works. I’m asking Bếp now to reproduce and fix the src/window.ts issue on the authorized paired Mac. The owner supplies tools only.',
  },
] as const;
type Case =
  | keyof typeof messages
  | 'full-handoff'
  | (typeof ownerHandoffs)[number]['scenario']
  | (typeof intentContrasts)[number]['scenario'];
const workshop = {
  architecture: 'docs/workshop-contract.md',
  frontend: 'src/workshop/Form.tsx',
  backend: 'src/workshop/signup.ts',
  tests: 'tests/workshop-signup.test.ts',
};
const fullHandoffs = [
  'ê Gemini ghi hợp đồng đăng ký workshop vào docs/workshop-contract.md trước. Astra lấy hợp đồng rồi làm src/workshop/Form.tsx, hỏi tui style hay muốn để Astra tự chọn. Backend src/workshop/signup.ts cũng theo hợp đồng đó, xong thêm tests/workshop-signup.test.ts. Mấy việc chưa gọi tên Sade tự chia nha. Khi có frontend và backend rồi, kiểm tra phòng thủ hai file đó xem lỗi đăng ký có làm lộ địa chỉ email không.',
  'Gemini lam docs/workshop-contract.md truoc. Co hop dong roi thi Astra sua src/workshop/Form.tsx va hoi tui muon style nao. Backend src/workshop/signup.ts cung cho hop dong, con tests/workshop-signup.test.ts doi backend. Cac phan con lai Sade tu giao. Review chi doc frontend va backend sau khi ca hai xong de coi cach bao loi co lo email khong.',
  'Gemini owns and writes docs/workshop-contract.md. Astra implements src/workshop/Form.tsx after the contract and should offer to choose the aesthetic. Automatically assign src/workshop/signup.ts after the contract, and tests/workshop-signup.test.ts after backend. Once frontend and backend are ready, assign an independent read-only review of both source files for email leakage in errors.',
  'Cho Astra làm src/workshop/Form.tsx, nhưng chờ Gemini viết docs/workshop-contract.md trước rồi hỏi mình có thích phong cách nào không. Sade tự chọn người làm src/workshop/signup.ts từ cùng hợp đồng, rồi thêm tests/workshop-signup.test.ts khi backend xong. Riêng review bảo mật phòng thủ thì để người không viết hai file nguồn đọc kiểm tra dữ liệu lỗi sau cả backend lẫn giao diện.',
];
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
    case: { type: 'string' },
    'export-prompt': { type: 'boolean' },
    'external-plan': { type: 'string' },
    'external-decision': { type: 'string' },
    'owner-handoff': { type: 'boolean' },
    'intent-contrasts': { type: 'boolean' },
    'handoff-holdout': { type: 'boolean' },
    'handoff-varied': { type: 'boolean' },
    'full-handoff': { type: 'boolean' },
  },
});
assert.ok(
  [
    values['handoff-holdout'],
    values['handoff-varied'],
    values['full-handoff'],
    values['owner-handoff'],
    values['intent-contrasts'],
  ].filter(Boolean).length <= 1,
  'Choose one evaluation suite.',
);
const output = path.resolve(positionals[0] || '.local/shared-sade-planner.json');
const source = values.replay && path.resolve(values.replay);
const externalInput = values['external-plan'] || values['external-decision'];
const externalPath = externalInput && path.resolve(externalInput);
assert.ok(!values['external-plan'] || !values['external-decision'], 'Choose one external input.');
const exportPrompt = values['export-prompt'];
assert.ok(
  [source, externalPath, exportPrompt].filter(Boolean).length <= 1,
  'Choose replay, prompt export or an external plan.',
);
if (externalPath || exportPrompt) assert.ok(values.case, 'Select one planning case with --case.');
assert.notEqual(output, source, 'Choose a separate output file for replay');
assert.notEqual(output, externalPath, 'Choose a separate output file for external plan scoring.');
const externalReply: unknown = externalPath
  ? JSON.parse(await readFile(externalPath, 'utf8'))
  : undefined;
type SavedRun = {
  model: string;
  digest: string;
  toolsSha256: string;
  rows: {
    id: string;
    promptSha256: string;
    plan?: unknown;
    question?: string;
    error?: string;
    toolName?: string;
  }[];
};
const saved: SavedRun | undefined = source ? JSON.parse(await readFile(source, 'utf8')) : undefined;
const plannerTools = values['owner-handoff']
  ? [groupPlanTool, groupNoWorkTool, groupQuestionTool]
  : [groupPlanTool, groupNoWorkTool];
const tools = plannerTools.map(({ type, name, description, inputSchema }) => ({
  type,
  function: { name, description, parameters: inputSchema },
}));
const projectKey = 'a'.repeat(64);
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const groupId = uuid(1);
const grants = [uuid(2), uuid(3), uuid(12), uuid(13)];
const devices = [uuid(4), uuid(5), uuid(14), uuid(15)];
const teammates = [uuid(6), uuid(7), uuid(16), uuid(17)];
const people = [
  { id: 'owner-a', name: 'An' },
  { id: 'owner-b', name: 'Bình' },
  { id: 'owner-c', name: 'Chi' },
  { id: 'owner-d', name: 'Dũng' },
];

async function withGroup<T>(
  scenario: Case,
  message: string,
  run: (context: {
    delivery: SharedDelivery;
    finish: (plan: unknown) => void;
    ask: (summary: string) => void;
    jobs: () => SharedSadeRun;
    verifyReview: (job: SharedSadeJob) => void;
  }) => Promise<T>,
) {
  const store = new Store(':memory:');
  try {
    const fullHandoff = scenario === 'full-handoff';
    const names =
      scenario === 'owner-relative' || scenario === 'owner-ungranted'
        ? ['Gemini', 'Gemini']
        : scenario === 'owner-named' || scenario === 'owner-ambiguous'
          ? ['Gemini', 'Astra', 'Astra']
          : fullHandoff
            ? ['Gemini', 'Astra', 'Claude', 'Antigravity']
            : ['Bếp', 'Mây'];
    const roles = fullHandoff
      ? ['engineer', 'designer', 'engineer', 'reviewer']
      : ['engineer', 'reviewer', 'designer'];
    const providers =
      scenario === 'owner-relative' || scenario === 'owner-ungranted'
        ? ['gemini', 'gemini']
        : scenario === 'owner-named' || scenario === 'owner-ambiguous'
          ? ['gemini', 'codex', 'codex']
          : ['gemini', 'codex', 'claude', 'antigravity'];
    const groups = new SharedGroups(
      store,
      (value) => people.find((person) => person.id === value) || null,
    );
    const call = (actor: number, input: object) =>
      groups.execute(people[actor], input, devices[actor]);
    for (const [index, id] of devices.slice(0, names.length).entries())
      store.put('desktopDevice', {
        id,
        owner: people[index],
        revoked: false,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        tokenHash: 'fixture-private-token-hash',
      });
    call(0, { action: 'create', id: groupId, name: 'Local planner test' });
    for (let index = 1; index < names.length; index++) {
      call(0, { action: 'invite', groupId, account: people[index].id });
      call(index, { action: 'accept', groupId });
    }
    for (const [index, localId] of teammates.slice(0, names.length).entries()) {
      call(index, {
        action: 'teammates',
        groupId,
        teammates: [
          {
            localId,
            provider: providers[index],
            name: names[index],
          },
        ],
      });
      if (index && ['mac', 'missing-mac', 'owner-ungranted'].includes(scenario)) continue;
      call(index, {
        action: 'sade-grant',
        groupId,
        id: grants[index],
        teammateId: localId,
        projectKey,
        projectName: 'Local test project',
        role: roles[index],
        platform: 'win32',
        allowWrites: !fullHandoff || index < 3,
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
      ask(summary) {
        call(0, {
          action: 'sade-finish',
          jobId: delivery.id,
          result: { kind: 'question', summary },
        });
        assert.equal(jobs().jobs[0].state, 'waiting');
        assert.ok(jobs().jobs.every((job) => job.phase === 'plan'));
        for (let index = 1; index < names.length; index++) assert.equal(poll(index), undefined);
      },
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
  assert.notEqual(scenario, 'owner-ambiguous', 'ask which owner before assigning a named harness');
  assert.notEqual(
    scenario,
    'owner-ungranted',
    'report the missing grant before assigning a named harness',
  );
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
  if (scenario === 'full-handoff') {
    assert.equal(jobs.length, 5, 'architecture, frontend, backend, tests and a defensive review');
    const architecture = scopedWriter(jobs, workshop.architecture);
    const frontend = scopedWriter(jobs, workshop.frontend);
    const backend = scopedWriter(jobs, workshop.backend);
    const tests = scopedWriter(jobs, workshop.tests);
    const review = jobs.find((job) => job.task?.kind === 'review');
    assert.ok(review, 'use review-read-only for the coordinator to exclude patch authors');
    assert.equal(architecture.grantId, grants[0], 'architecture stays with Gemini');
    assert.equal(frontend.grantId, grants[1], 'frontend stays with Astra');
    assert.deepEqual(frontend.task?.dependsOn, [architecture.task?.key]);
    const designInstructions = `${frontend.task?.description} ${frontend.task?.acceptance}`;
    assert.match(designInstructions, /style|aesthetic|phong cách|phong cach/i);
    assert.match(
      designInstructions,
      /ask|hỏi|hoi|\boffer\b[^.]{0,80}\b(?:requester|sender|user)\b[^.]{0,100}\bor\b\s+(?:let|allow)\b[^.]{0,100}\b(?:choose|decide|pick)\b/i,
      'ask the requester about the style',
    );
    assert.match(
      designInstructions,
      /tự (chọn|quyết)|tu (chon|quyet)|choose|decide/i,
      'offer to let Astra choose the style',
    );
    assert.deepEqual(backend.task?.dependsOn, [architecture.task?.key]);
    assert.deepEqual(tests.task?.dependsOn, [backend.task?.key]);
    assert.deepEqual(new Set(review.task?.scope), new Set([workshop.frontend, workshop.backend]));
    assert.ok(review.task?.dependsOn.includes(frontend.task!.key), 'review waits for frontend');
    assert.ok(review.task?.dependsOn.includes(backend.task!.key), 'review waits for backend');
    assert.equal(review.grantId, grants[3], 'the granted independent reviewer gets the audit');
    for (const job of [backend, tests, review])
      assert.equal(job.task?.preferredMemberId, undefined, 'delegate unnamed assignments to Sade');
  } else if (['handoff', 'owner-relative', 'owner-named'].includes(scenario)) {
    assert.equal(jobs.length, 2, 'two tasks are sufficient');
    const source = scopedWriter(jobs, handoff.source);
    const target = scopedWriter(jobs, handoff.target);
    assert.equal(source.grantId, grants[handoff.sourceOwner], 'preserve the named producer');
    assert.equal(target.grantId, grants[1 - handoff.sourceOwner], 'preserve the named recipient');
    assert.deepEqual(target.task?.dependsOn, [source.task?.key], 'schedule the producer first');
  } else if (scenario === 'duplicate' || scenario === 'menu-edit') {
    const writer = scopedWriter(jobs, 'src/menu.ts');
    assert.equal(
      jobs.filter((job) => needsGroupWrite(job.task)).length,
      1,
      'do not schedule a duplicate write',
    );
    if (scenario === 'menu-edit') assert.equal(writer.grantId, grants[1], 'keep the named editor');
  } else if (scenario === 'read-menu') {
    assert.equal(jobs.length, 1, 'reading one file needs one task');
    assert.equal(jobs[0].grantId, grants[1], 'keep the named reader');
    assert.deepEqual(jobs[0].task?.scope, ['src/menu.ts'], 'keep the scoped file');
    assert.ok(!needsGroupWrite(jobs[0].task), 'keep the task read-only');
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
async function getPlannerReply(messages: unknown[], fullHandoff: boolean) {
  const response = await local('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: '45s',
      options: { temperature: 0, seed: 7013, num_ctx: 4096, num_predict: fullHandoff ? 1600 : 768 },
      tools,
      messages,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  return (await response.json()) as {
    message: PlannerReply;
    eval_count?: number;
    done_reason?: string;
  };
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const toolsSha256 = sha256(JSON.stringify(tools));
if (saved) {
  assert.equal(saved.model, model);
  assert.equal(saved.toolsSha256, toolsSha256);
}
const selected =
  !externalPath && !exportPrompt
    ? saved ||
      (await (await local('/api/tags', { signal: AbortSignal.timeout(5000) })).json()).models.find(
        (entry: { name: string }) => entry.name === model,
      )
    : undefined;
if (!externalPath && !exportPrompt)
  assert.ok(selected, 'Install the specified Qwen in the local Ollama directory.');
const cases: {
  scenario: Case;
  id: string;
  message: string;
  handoff?: typeof defaultHandoff;
}[] = values['intent-contrasts']
  ? [...intentContrasts]
  : values['owner-handoff']
    ? [...ownerHandoffs]
    : values['full-handoff']
      ? fullHandoffs.map((message, index) => ({
          scenario: 'full-handoff',
          id: `full-handoff/${index + 1}`,
          message,
        }))
      : values['handoff-varied']
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
if (saved && !values.case)
  assert.equal(savedRows.size, cases.length, 'Replay requires the same cases');
const selectedCases = values.case ? cases.filter(({ id }) => id === values.case) : cases;
assert.ok(selectedCases.length, `Unknown case: ${values.case}`);
await mkdir(path.dirname(output), { recursive: true });
const externalDecision = z.object({
  decision: z.object({ name: z.string(), arguments: z.unknown() }).strict(),
});
if (exportPrompt) {
  const { scenario, id, message } = selectedCases[0];
  await withGroup(scenario, message, async ({ delivery }) => {
    const prompt = sharedGroupPlanningPrompt(delivery);
    const decisionSchema = {
      type: 'object',
      properties: {
        decision: {
          anyOf: plannerTools.map((tool) => ({
            type: 'object',
            properties: {
              name: { type: 'string', enum: [tool.name], description: tool.description },
              arguments: tool.inputSchema,
            },
            required: ['name', 'arguments'],
            additionalProperties: false,
          })),
        },
      },
      required: ['decision'],
      additionalProperties: false,
    };
    await writeFile(
      output,
      JSON.stringify(
        {
          id,
          prompt,
          promptSha256: sha256(prompt),
          tool: groupPlanTool,
          toolsSha256,
          decisionSchema,
        },
        null,
        2,
      ),
      'utf8',
    );
  });
  console.log(JSON.stringify({ exported: id }));
  process.exit(0);
}

for (const { scenario, id, message, handoff } of selectedCases) {
  const row = await withGroup(scenario, message, async (group) => {
    const prompt = sharedGroupPlanningPrompt(group.delivery);
    assert.doesNotMatch(prompt, /fixture-private-token-hash/);
    const promptSha256 = sha256(prompt);
    const prior = savedRows.get(id);
    if (saved) assert.equal(prior?.promptSha256, promptSha256, `Prompt changed for ${id}`);
    const started = performance.now();
    let parsed = false;
    let plan;
    let question: string | undefined;
    let run;
    let error;
    let toolName;
    let correction;
    let generatedTokens = 0;
    const roster = group.delivery.team.map((member) => member.id);
    function acceptReply(tool: { name: string; arguments: unknown }) {
      toolName = tool.name;
      if (toolName === groupQuestionTool.name && values['owner-handoff']) {
        const args = z.object({ summary: z.string() }).strict().parse(tool.arguments);
        const result = sharedFinish.parse({ kind: 'question', ...args });
        assert.equal(result.kind, 'question');
        question = result.summary;
      } else if (toolName === groupNoWorkTool.name) {
        plan = parseGroupNoWork(tool.arguments);
      } else {
        assert.equal(toolName, groupPlanTool.name);
        plan = parseSharedGroupPlan(tool.arguments, roster);
      }
    }
    try {
      if (prior) {
        toolName = prior.toolName;
        if (prior.question) question = prior.question;
        else if (prior.plan) plan = parseTeamPlan(prior.plan, { allowEmpty: true });
        else throw new Error(prior.error || 'Model returned no plan.');
      } else if (externalPath) {
        acceptReply(
          values['external-decision']
            ? externalDecision.parse(externalReply).decision
            : { name: groupPlanTool.name, arguments: externalReply },
        );
      } else {
        const messages: unknown[] = [{ role: 'user', content: prompt }];
        for (let attempt = 0; attempt < 2; attempt++) {
          const {
            message: reply,
            eval_count,
            done_reason,
          } = await getPlannerReply(messages, scenario === 'full-handoff');
          generatedTokens += eval_count || 0;
          assert.equal(
            reply.tool_calls?.length,
            1,
            `expected one tool call (${done_reason || 'unknown'})`,
          );
          const tool = reply.tool_calls![0].function;
          try {
            acceptReply(tool);
            break;
          } catch (cause) {
            if (attempt !== 0 || toolName !== groupPlanTool.name) throw cause;
            correction = cause instanceof Error ? cause.message : String(cause);
            messages.push(reply, { role: 'tool', tool_name: toolName, content: correction });
          }
        }
      }
      assert.ok(plan || question, 'expected a validated plan or question');
      parsed = true;
      if (question) {
        assert.ok(
          ['owner-ambiguous', 'owner-ungranted'].includes(scenario),
          'a uniquely identified, granted harness should start work directly',
        );
        assert.match(question, /Bình|Binh/i);
        if (scenario === 'owner-ambiguous') assert.match(question, /Chi/i);
        else assert.match(question, /quyền|cho phép|grant|authoriz|permission/i);
        group.ask(question);
        run = group.jobs();
      } else {
        assert.ok(plan);
        group.finish(plan);
        run = group.jobs();
        const writer = assess(scenario, plan, run, handoff);
        if (writer) group.verifyReview(writer);
      }
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
      ...(generatedTokens ? { generatedTokens } : {}),
      plan,
      question,
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
        ...(externalPath
          ? { source: values['external-decision'] ? 'external-decision' : 'external-plan' }
          : { model, digest: selected.digest }),
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
if (externalPath && rows.some((row) => !row.pass)) process.exitCode = 1;
