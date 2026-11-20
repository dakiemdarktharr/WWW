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
  type SharedFinish,
} from '../server/group-sade.ts';
import { sharedGroupPlanningPrompt } from '../server/shared-sade-worker.ts';
import { Store } from '../server/store.ts';
import { collectPrerequisites, parseTeamPlan } from '../server/workflow-plan.ts';
import type { SharedSadeJob, SharedSadeRun } from '../shared/collaboration.ts';
import {
  ownerRoutingCases,
  type OwnerRoutingCase,
} from '../tests/fixtures/shared-sade-owner-routing.ts';

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
const quotaFallbacks = [
  {
    id: 'quota/named-casual',
    scenario: 'quota-named',
    message:
      'Ê, nhờ Gemini của mình đọc src/menu.ts rồi nói ngắn gọn file đó làm gì nha. Nếu Gemini hết lượt thì cho Claude của Bình đọc thay. Chỉ xem file đó thôi.',
  },
  {
    id: 'quota/named-unaccented',
    scenario: 'quota-named',
    message:
      'mn oi nho gemini cua an doc rieng src/menu.ts va tom tat y chinh. het luot thi claude cua binh lam thay nha, dung sua file.',
  },
  {
    id: 'quota/named-expert',
    scenario: 'quota-named',
    message:
      'Create one read-only task for src/menu.ts with Gemini under An as primary. If Gemini cannot take it because its provider quota is exhausted, dispatch the same task to Claude under Bình. Keep the scope to that file.',
  },
  {
    id: 'quota/delegated',
    scenario: 'quota-delegated',
    message:
      'Cho Gemini của mình đọc src/menu.ts rồi giải thích nhanh nha. Nếu hết quota thì Sade tự chọn một AI khác đã được cấp quyền để đọc file đó.',
  },
  {
    id: 'quota/pinned',
    scenario: 'quota-pinned',
    message:
      'Claude của Bình để dành lần khác nhé. Hôm nay chỉ Gemini của An đọc và tóm tắt src/menu.ts thôi. Nếu Gemini hết lượt thì báo mình.',
  },
] as const;
type QuotaFollowup = {
  files: readonly [string, string];
  secondBackup: boolean;
};
const quotaFollowups = [
  {
    id: 'quota-followup/casual',
    scenario: 'quota-followup',
    message:
      'Ê nhờ Gemini của tui đọc docs/contract.md, rồi mới ngó src/signup.ts theo kết quả file đầu nha. Nếu Gemini hết lượt thì Claude của Bình đọc file đầu, Antigravity của Chi coi file sau. Chỉ đọc nghen.',
    quotaFollowup: { files: ['docs/contract.md', 'src/signup.ts'], secondBackup: true },
  },
  {
    id: 'quota-followup/unaccented',
    scenario: 'quota-followup',
    message:
      'gemini cua an doc config/fields.yaml truoc, roi kiem src/profile.ts sau khi co ket qua. het luot thi claude cua binh doc file dau, antigravity cua chi kiem file sau nha. chi doc dung sua.',
    quotaFollowup: { files: ['config/fields.yaml', 'src/profile.ts'], secondBackup: true },
  },
  {
    id: 'quota-followup/pinned',
    scenario: 'quota-followup',
    message:
      'Assign two dependent read-only tasks to Gemini under An. First read docs/invoice.md. Then inspect src/invoice.ts after the first result. Only the first task may fall back to Claude under Bình on provider quota. The second is exclusive to Gemini. Report it as blocked if Gemini cannot take it.',
    quotaFollowup: { files: ['docs/invoice.md', 'src/invoice.ts'], secondBackup: false },
  },
] as const;
const referenceFile = 'docs/contract.md';
const referenceCommit = '4107e5e';
const referencedRequests = [
  {
    id: 'reference/casual',
    scenario: 'referenced-read',
    reference: `Tui vừa đưa ${referenceFile} lên commit ${referenceCommit} rồi á.`,
    message: 'cái đó tui commit rồi, nhờ Mây đọc commit đó rồi tóm tắt giùm, đừng sửa nha.',
  },
  {
    id: 'reference/unaccented',
    scenario: 'referenced-read',
    reference: `Da cap nhat ${referenceFile} o commit ${referenceCommit}.`,
    message: 'may doc thu dung file trong commit tren va tom tat cho mn nhe. chi xem.',
  },
  {
    id: 'reference/expert',
    scenario: 'referenced-read',
    reference: `The current deliverable is ${referenceFile} in commit ${referenceCommit}. Previous request: give Bếp a second edit of src/menu.ts.`,
    message: 'Have Mây summarize that deliverable at the cited commit. Read-only.',
  },
  {
    id: 'reference/update',
    scenario: 'chat',
    reference: `Mây, please edit ${referenceFile} from ${referenceCommit} and integrate the patch.`,
    message: 'Cái đó đã làm xong rồi nha. Mình nhắc lại cho cả nhóm biết thôi.',
  },
  {
    id: 'reference/unaccented-other',
    scenario: 'referenced-read',
    reader: 0,
    reference: `Mây vừa chốt ${referenceFile} ở bản ${referenceCommit} cho mọi người rồi.`,
    message: 'bep coi noi dung file o ban do roi tom tat lai cho tui hieu nhe, chi doc thoi.',
  },
] as const;
type Case =
  | keyof typeof messages
  | 'full-handoff'
  | 'frontend-style'
  | 'frontend-style-ungranted'
  | 'owner-routing'
  | 'referenced-read'
  | 'quota-followup'
  | (typeof ownerHandoffs)[number]['scenario']
  | (typeof intentContrasts)[number]['scenario']
  | (typeof quotaFallbacks)[number]['scenario'];
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
const frontendRequest =
  'Tôi nhờ Gemini của tôi làm cấu trúc chung rồi ông đưa cho Astra của ông làm frontend, codebase, backend, cyber nhé.';
const frontendProjectMap = `Bản đồ dự án Workshop của Bình: cấu trúc chung nằm ở ${workshop.architecture}; frontend ở ${workshop.frontend}; codebase là bộ test ở ${workshop.tests}; backend ở ${workshop.backend}. Phần cyber là rà soát phòng thủ, chỉ đọc frontend và backend để xem thông báo lỗi có làm lộ địa chỉ email không.`;
const frontendStyleCases = [
  {
    scenario: 'frontend-style',
    id: 'frontend-style/unspecified',
    message: frontendRequest,
    reference: frontendProjectMap,
    frontendStyle: 'unspecified',
  },
  {
    scenario: 'frontend-style',
    id: 'frontend-style/supplied',
    message: `${frontendRequest} Riêng frontend dùng phong cách tối giản, nền xanh navy.`,
    reference: frontendProjectMap,
    frontendStyle: 'supplied',
  },
  {
    scenario: 'frontend-style',
    id: 'frontend-style/delegated',
    message: `${frontendRequest} Về phong cách frontend thì để Astra tự chọn luôn.`,
    reference: frontendProjectMap,
    frontendStyle: 'delegated',
  },
  {
    scenario: 'frontend-style-ungranted',
    id: 'frontend-style/ungranted',
    message: frontendRequest,
    reference: frontendProjectMap,
    frontendStyle: 'ungranted',
  },
] as const;
type FrontendStyle = (typeof frontendStyleCases)[number]['frontendStyle'];
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
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    replay: { type: 'string' },
    model: { type: 'string', default: 'qwen3:4b-instruct-2507-q4_K_M' },
    case: { type: 'string' },
    shard: { type: 'string', default: '0/1' },
    'timeout-ms': { type: 'string', default: '60000' },
    'planning-prompt': { type: 'string', default: 'baseline' },
    'export-prompt': { type: 'boolean' },
    'external-plan': { type: 'string' },
    'external-decision': { type: 'string' },
    'owner-handoff': { type: 'boolean' },
    'intent-contrasts': { type: 'boolean' },
    'quota-fallback': { type: 'boolean' },
    'quota-followup': { type: 'boolean' },
    'referenced-requests': { type: 'boolean' },
    'handoff-holdout': { type: 'boolean' },
    'handoff-varied': { type: 'boolean' },
    'full-handoff': { type: 'boolean' },
    'frontend-style': { type: 'boolean' },
    'owner-routing': { type: 'boolean' },
  },
});
const model = values.model;
const timeoutMs = Number(values['timeout-ms']);
const [shard, shardCount] = values.shard.split('/').map(Number);
assert.ok(
  Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000,
  'Choose a model request timeout between 1 and 300000 ms.',
);
assert.ok(
  /^\d+\/[1-9]\d*$/.test(values.shard) && shard < shardCount,
  'Use a zero-based shard such as 0/3.',
);
assert.ok(
  [
    'baseline',
    'constraints',
    'quota-compact',
    'quota-example',
    'frontend-style-deferred',
    'owner-routing',
  ].includes(values['planning-prompt']),
  'Unknown planning prompt.',
);
assert.ok(
  values['planning-prompt'] !== 'frontend-style-deferred' || values['frontend-style'],
  'Use the deferred frontend prompt with --frontend-style.',
);
assert.ok(
  values['planning-prompt'] !== 'owner-routing' ||
    values['owner-routing'] ||
    values['frontend-style'],
  'Use the ownership prompt with --owner-routing or --frontend-style.',
);
assert.ok(
  [
    values['handoff-holdout'],
    values['handoff-varied'],
    values['full-handoff'],
    values['frontend-style'],
    values['owner-routing'],
    values['owner-handoff'],
    values['intent-contrasts'],
    values['quota-fallback'],
    values['quota-followup'],
    values['referenced-requests'],
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
  model?: string;
  digest?: string;
  toolsSha256: string;
  rows: {
    id: string;
    promptSha256?: string;
    execution?: 'coordinator-preflight';
    plan?: unknown;
    question?: string;
    error?: string;
    toolName?: string;
  }[];
};
const saved: SavedRun | undefined = source ? JSON.parse(await readFile(source, 'utf8')) : undefined;
const plannerTools =
  values['owner-handoff'] || values['frontend-style'] || values['owner-routing']
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
  { scenario, message, reference, ownerRouting }: PlannerCase,
  run: (
    context:
      | { waiting: SharedSadeRun }
      | {
          delivery: SharedDelivery;
          finish: (plan: unknown) => void;
          ask: (summary: string) => void;
          jobs: () => SharedSadeRun;
          verifyReview: (job: SharedSadeJob) => void;
          verifyFrontendOrder: (architecture: SharedSadeJob, frontend: SharedSadeJob) => void;
          verifyQuotaFollowup: (
            plan: ReturnType<typeof parseTeamPlan>,
            expected: QuotaFollowup,
          ) => void;
          verifyOwnerQuota: (key: string, primary: number, fallback?: number) => void;
        },
  ) => Promise<T>,
) {
  const store = new Store(':memory:');
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const fullHandoff = scenario === 'full-handoff' || scenario.startsWith('frontend-style');
    if (fullHandoff || ownerRouting)
      store.put('billingEntitlement', {
        id: people[0].id,
        ownerId: people[0].id,
        tier: 'plus',
        paidUntil: Date.now() + 30 * 86400000,
        syncedBlock: 100,
        updatedAt: new Date().toISOString(),
      });
    const quotaFallback = scenario.startsWith('quota-');
    const quotaFollowup = scenario === 'quota-followup';
    const names = ownerRouting
      ? ownerRouting.roster.map(({ name }) => name)
      : scenario === 'owner-relative' || scenario === 'owner-ungranted'
        ? ['Gemini', 'Gemini']
        : scenario === 'owner-named' || scenario === 'owner-ambiguous'
          ? ['Gemini', 'Astra', 'Astra']
          : fullHandoff
            ? ['Gemini', 'Astra', 'Claude', 'Antigravity']
            : quotaFollowup
              ? ['Gemini', 'Claude', 'Antigravity']
              : quotaFallback
                ? ['Gemini', 'Claude']
                : ['Bếp', 'Mây'];
    const roles = fullHandoff
      ? ['engineer', 'designer', 'engineer', 'reviewer']
      : ['engineer', 'reviewer', 'designer'];
    const providers = ownerRouting
      ? ownerRouting.roster.map(({ provider }) => provider)
      : scenario === 'owner-relative' || scenario === 'owner-ungranted'
        ? ['gemini', 'gemini']
        : scenario === 'owner-named' || scenario === 'owner-ambiguous'
          ? ['gemini', 'codex', 'codex']
          : quotaFollowup
            ? ['gemini', 'claude', 'antigravity']
            : quotaFallback
              ? ['gemini', 'claude']
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
        expiresAt: new Date(Date.now() + Math.max(120_000, 2 * timeoutMs + 30_000)).toISOString(),
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
      if (
        (index === 1 && scenario === 'frontend-style-ungranted') ||
        ownerRouting?.roster[index].granted === false
      )
        continue;
      call(index, {
        action: 'sade-grant',
        groupId,
        id: grants[index],
        teammateId: localId,
        projectKey,
        projectName: 'Local test project',
        role: ownerRouting ? 'engineer' : roles[index],
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
          referencedMessage: true,
          ...(ownerRouting ? { readAssignment: true } : {}),
        }) as { delivery?: SharedDelivery }
      ).delivery;
    const replyTo = uuid(9);
    if (reference) call(1, { action: 'message', groupId, id: replyTo, content: reference });
    call(0, {
      action: 'message',
      groupId,
      id: uuid(8),
      content: message,
      sade: {
        projectKey,
        ...(reference ? { replyTo } : {}),
        ...(scenario === 'referenced-read' ? { readOnly: true } : {}),
      },
    });
    const delivery = poll(0);
    const jobs = () =>
      (call(0, { action: 'read', groupId }) as { sadeRuns: SharedSadeRun[] }).sadeRuns[0];
    if (!delivery && ownerRouting) {
      for (let index = 1; index < names.length; index++)
        assert.equal(poll(index), undefined, 'preflight must offer no harness work');
      return await run({ waiting: jobs() });
    }
    assert.ok(delivery?.phase === 'plan');
    if (ownerRouting) {
      const expectedTeam = ownerRouting.roster.flatMap(({ name, provider, granted }, index) =>
        granted ? [{ id: grants[index], name, provider, owner: people[index].name }] : [],
      );
      assert.deepEqual(
        delivery.team.map(({ id, name, provider, owner }) => ({ id, name, provider, owner })),
        expectedTeam,
        'the delivered team represents the fixture project grants',
      );
    }
    // Keep this fixture's delivery current while the live model is generating the plan.
    poll(0, [delivery.id]);
    heartbeat = setInterval(() => poll(0, [delivery.id]), 10_000);
    const finishJob = (index: number, jobId: string, result: SharedFinish) =>
      call(index, { action: 'sade-finish', jobId, result });
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
      verifyFrontendOrder(architecture, frontend) {
        assert.equal(poll(0)?.id, architecture.id, 'Gemini can start the architecture now');
        assert.notEqual(
          poll(1)?.id,
          frontend.id,
          'Astra waits for the architecture before starting the frontend',
        );
      },
      verifyOwnerQuota(key, primary, fallback) {
        const original = poll(primary);
        assert.ok(original?.task?.key === key, 'the requested primary receives the task first');
        finishJob(primary, original.id, { kind: 'provider-unavailable' });
        for (let index = 0; index < names.length; index++) {
          const next = poll(index);
          if (index === fallback) {
            assert.equal(next?.task?.key, key, 'the authorized fallback receives the same task');
          } else {
            assert.equal(
              next,
              undefined,
              'no other owner receives the task after quota exhaustion',
            );
          }
        }
        if (fallback === undefined)
          assert.match(jobs().error || '', /requested harness.*provider quota/);
      },
      verifyQuotaFollowup(plan, { files, secondBackup }) {
        const run = jobs();
        assert.equal(run.state, 'running', run.error || 'the plan should be queued');
        assert.equal(plan.tasks.length, 2, 'one task for each file');
        const tasks = files.map((file) => {
          const task = plan.tasks.find(({ scope }) => scope.length === 1 && scope[0] === file);
          assert.ok(task, `expected exact scope ${file}`);
          assert.equal(task.kind, 'research', 'a read-only inspection is a research task');
          assert.equal(task.preferredMemberId, grants[0], 'Gemini remains the primary');
          return task;
        });
        assert.deepEqual(tasks[0].dependsOn, []);
        assert.deepEqual(tasks[1].dependsOn, [tasks[0].key]);
        assert.equal(tasks[0].fallbackMemberId, grants[1], 'Claude backs up only the first file');
        assert.equal(tasks[1].fallbackMemberId, secondBackup ? grants[2] : undefined);
        const first = poll(0);
        assert.equal(first?.task?.key, tasks[0].key);
        assert.equal(poll(2), undefined, 'the second task waits for its prerequisite');
        finishJob(0, first!.id, { kind: 'provider-unavailable' });
        const fallback = poll(1);
        assert.equal(fallback?.task?.key, tasks[0].key);
        const summary = 'First file was read by its authorized backup.';
        finishJob(1, fallback!.id, { kind: 'done', summary });
        const next = poll(2);
        if (secondBackup) {
          assert.equal(next?.task?.key, tasks[1].key);
          assert.equal(next?.prerequisites[0]?.summary, summary);
          finishJob(2, next!.id, {
            kind: 'done',
            summary: 'Second file was read after the first.',
          });
        } else {
          assert.equal(next, undefined);
          assert.equal(poll(1), undefined, 'the first backup cannot take the pinned task');
          assert.match(jobs().error || '', /requested harness.*provider quota/);
        }
        assert.equal(jobs().state, secondBackup ? 'done' : 'blocked');
        for (const id of grants.slice(0, 3)) {
          const grant = store.get<{ used: number }>('sharedSadeGrant', id);
          assert.equal(grant.used, id === grants[2] && !secondBackup ? 0 : 1);
        }
      },
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
    clearInterval(heartbeat);
    store.close();
  }
}

function scopedWriter(jobs: SharedSadeJob[], file: string) {
  const matches = jobs.filter((job) => needsGroupWrite(job.task) && job.task?.scope.includes(file));
  assert.equal(matches.length, 1, `expected one writer for ${file}`);
  assert.deepEqual(matches[0].task?.scope, [file], `expected a narrow scope for ${file}`);
  return matches[0];
}

function checkFrontendAcceptance(frontend: SharedSadeJob, style: FrontendStyle) {
  assert.ok(frontend.task);
  const { description, acceptance } = frontend.task;
  const ask =
    /\b(?:ask|consult|confirm with|clarify with)\b|h[oỏ]i|x[aá]c nh[aậ]n v[oớ]i|tham kh[aả]o [yý]/i;
  const choice = /\b(?:choose|select|decide|pick)\b|t[uự] (?:ch[oọ]n|quy[eế]t)/i;
  if (style === 'unspecified') {
    assert.match(
      acceptance,
      /\b(?:style|aesthetic|theme)\b|phong c[aá]ch/i,
      'ask about frontend style',
    );
    assert.match(acceptance, ask, 'put the request for a style preference in frontend acceptance');
    assert.match(acceptance, /\b(?:or|alternatively)\b|ho[aặ]c|hay (?:l[aà]|[đd][eể])/i);
    assert.match(
      acceptance,
      /\b(?:astra|harness|designer|their own|itself|yourself)\b|t[uự] (?:ch[oọ]n|quy[eế]t)/i,
      'the alternate style decision belongs to Astra',
    );
    assert.match(acceptance, choice, 'include the option for Astra to choose the style');
  } else {
    const instructions = `${description} ${acceptance}`;
    const positiveInstructions = instructions
      .replace(/\b(?:do not|don't|no need to|without)\s+(?:ask|consult|confirm)[^.!?;]*/gi, '')
      .replace(/(?:kh[oô]ng(?: c[aầ]n| ph[aả]i)?|ch[aẳ]ng c[aầ]n)\s+h[oỏ]i[^.!?;]*/gi, '');
    assert.doesNotMatch(positiveInstructions, ask, 'the sender already resolved the style choice');
    if (style === 'supplied') {
      assert.match(instructions, /minimal|t[oố]i gi[aả]n/i, 'retain the minimalist style');
      assert.match(instructions, /navy|xanh h[aả]i qu[aâ]n/i, 'retain the navy background');
    } else {
      assert.equal(style, 'delegated');
      assert.match(instructions, choice, 'retain the sender’s delegation to Astra');
    }
  }
}

function assess(
  scenario: Case,
  plan: ReturnType<typeof parseTeamPlan>,
  run: SharedSadeRun,
  handoff = defaultHandoff,
  reader: 0 | 1 = 1,
  frontendStyle?: {
    style: FrontendStyle;
    verifyOrder: (architecture: SharedSadeJob, frontend: SharedSadeJob) => void;
  },
) {
  assert.notEqual(scenario, 'owner-ambiguous', 'ask which owner before assigning a named harness');
  assert.notEqual(
    scenario,
    'owner-ungranted',
    'report the missing grant before assigning a named harness',
  );
  assert.notEqual(scenario, 'frontend-style-ungranted', 'ask for Astra’s missing project grant');
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
  if (scenario.startsWith('quota-')) {
    assert.equal(jobs.length, 1, 'one scoped task regardless of backup');
    assert.equal(jobs[0].grantId, grants[0], 'try Gemini first');
    assert.deepEqual(jobs[0].task?.scope, ['src/menu.ts']);
    assert.ok(!needsGroupWrite(jobs[0].task), 'keep the task read-only');
    assert.equal(
      plan.tasks[0].fallbackMemberId,
      scenario === 'quota-named' ? grants[1] : scenario === 'quota-delegated' ? 'auto' : undefined,
      'preserve only the fallback the requester authorized',
    );
  } else if (scenario === 'full-handoff' || scenario === 'frontend-style') {
    assert.equal(jobs.length, 5, 'architecture, frontend, backend, tests and a defensive review');
    const architecture = scopedWriter(jobs, workshop.architecture);
    const frontend = scopedWriter(jobs, workshop.frontend);
    const backend = scopedWriter(jobs, workshop.backend);
    const tests = scopedWriter(jobs, workshop.tests);
    const review = jobs.find((job) => job.task?.kind === 'review');
    assert.ok(review, 'use review-read-only for the coordinator to exclude patch authors');
    assert.equal(architecture.grantId, grants[0], 'architecture stays with Gemini');
    assert.equal(frontend.grantId, grants[1], 'frontend stays with Astra');
    assert.deepEqual(new Set(review.task?.scope), new Set([workshop.frontend, workshop.backend]));
    if (frontendStyle) {
      const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
      const follows = (later: SharedSadeJob, earlier: SharedSadeJob) =>
        collectPrerequisites(later.task!.dependsOn, byKey, (task) => task.dependsOn).some(
          (task) => task.key === earlier.task!.key,
        );
      assert.ok(follows(frontend, architecture), 'frontend depends on the Gemini architecture');
      assert.ok(follows(backend, architecture), 'backend respects the architecture handoff');
      assert.ok(follows(tests, architecture), 'codebase work follows the architecture');
      assert.ok(follows(review, frontend), 'review waits for frontend');
      assert.ok(follows(review, backend), 'review waits for backend');
      assert.ok(
        review.grantId !== frontend.grantId && review.grantId !== backend.grantId,
        'the defensive review stays independent of the writers',
      );
      checkFrontendAcceptance(frontend, frontendStyle.style);
      frontendStyle.verifyOrder(architecture, frontend);
    } else {
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
      assert.ok(review.task?.dependsOn.includes(frontend.task!.key), 'review waits for frontend');
      assert.ok(review.task?.dependsOn.includes(backend.task!.key), 'review waits for backend');
      assert.equal(review.grantId, grants[3], 'the granted independent reviewer gets the audit');
      for (const job of [backend, tests, review])
        assert.equal(
          job.task?.preferredMemberId,
          undefined,
          'delegate unnamed assignments to Sade',
        );
    }
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
  } else if (scenario === 'read-menu' || scenario === 'referenced-read') {
    assert.equal(jobs.length, 1, 'reading one file needs one task');
    assert.equal(jobs[0].grantId, grants[reader], 'keep the named reader');
    assert.deepEqual(
      jobs[0].task?.scope,
      [scenario === 'referenced-read' ? referenceFile : 'src/menu.ts'],
      'keep the scoped file',
    );
    assert.ok(!needsGroupWrite(jobs[0].task), 'keep the task read-only');
    if (scenario === 'referenced-read') {
      const { title, description, acceptance } = jobs[0].task!;
      assert.equal(jobs[0].task?.kind, 'research', 'summarizing the file is read-only research');
      assert.ok(
        `${title} ${description} ${acceptance}`.includes(referenceCommit),
        'keep the cited revision',
      );
    }
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
const generation = { temperature: 0, seed: 7013, num_ctx: 4096 };
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
      options: { ...generation, num_predict: fullHandoff ? 1600 : 768 },
      tools,
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  return (await response.json()) as {
    message: PlannerReply;
    eval_count?: number;
    done_reason?: string;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_duration?: number;
  };
}
const loadedModels = z.object({
  models: z.array(z.object({ digest: z.string(), size: z.number(), size_vram: z.number() })),
});
async function sampleModelMemory(digest: string) {
  try {
    const response = await local('/api/ps', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const { models } = loadedModels.parse(await response.json());
    const active = models.find((entry) => entry.digest === digest);
    return active
      ? {
          allocatedBytes: active.size,
          estimatedRamBytes: Math.max(0, active.size - active.size_vram),
          vramBytes: active.size_vram,
        }
      : null;
  } catch {
    return null;
  }
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const toolsSha256 = sha256(JSON.stringify(tools));
if (saved) {
  if (saved.rows.some((row) => row.execution !== 'coordinator-preflight'))
    assert.equal(saved.model, model);
  assert.equal(saved.toolsSha256, toolsSha256);
}
let modelDigest = saved?.digest;
async function selectLiveModel() {
  if (modelDigest) return;
  const response = await local('/api/tags', { signal: AbortSignal.timeout(5000) });
  const { models } = (await response.json()) as { models: { name: string; digest: string }[] };
  modelDigest = models.find((entry) => entry.name === model)?.digest;
  assert.ok(modelDigest, 'Install the specified Qwen in the local Ollama directory.');
}
type PlannerCase = {
  scenario: Case;
  id: string;
  message: string;
  handoff?: typeof defaultHandoff;
  reference?: string;
  reader?: 0 | 1;
  quotaFollowup?: QuotaFollowup;
  frontendStyle?: FrontendStyle;
  ownerRouting?: OwnerRoutingCase;
};
const defaultCases: PlannerCase[] = values['quota-fallback']
  ? [...quotaFallbacks]
  : values['intent-contrasts']
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
const cases: PlannerCase[] = values['owner-routing']
  ? ownerRoutingCases.map((ownerRouting) => ({
      scenario: 'owner-routing',
      id: ownerRouting.id,
      message: ownerRouting.message,
      reference: ownerRouting.reference,
      ownerRouting,
    }))
  : values['frontend-style']
    ? [...frontendStyleCases]
    : values['referenced-requests']
      ? [...referencedRequests]
      : values['quota-followup']
        ? [...quotaFollowups]
        : defaultCases;
const rows = [];
const savedRows = new Map(saved?.rows.map((row) => [row.id, row]));
const selection = values.case ? cases.filter(({ id }) => id === values.case) : cases;
assert.ok(selection.length, `Unknown case: ${values.case}`);
assert.ok(shardCount <= selection.length, 'The selected suite has fewer cases than shards.');
const selectedCases = selection.slice(
  Math.floor((selection.length * shard) / shardCount),
  Math.floor((selection.length * (shard + 1)) / shardCount),
);
if (saved && !values.case)
  assert.equal(savedRows.size, selectedCases.length, 'Replay requires the same cases');
await mkdir(path.dirname(output), { recursive: true });
const externalDecision = z.object({
  decision: z.object({ name: z.string(), arguments: z.unknown() }).strict(),
});
function planningPrompt(delivery: SharedDelivery) {
  if (values['planning-prompt'] === 'owner-routing')
    return sharedGroupPlanningPrompt(delivery, {
      resolveNamedAssignments: true,
      deferFrontendStyle: true,
    });
  if (values['planning-prompt'] === 'frontend-style-deferred')
    return sharedGroupPlanningPrompt(delivery, { deferFrontendStyle: true });
  const base = sharedGroupPlanningPrompt(delivery);
  if (values['planning-prompt'] === 'baseline') return base;
  if (values['planning-prompt'] === 'quota-compact')
    return `For each requested file, submit one short task. Use a brief summary and one short sentence each for description and acceptance. A conditional backup belongs in that task's fallbackMemberId. Use none for every task with no authorized backup, even if an earlier task has one. Keep the exact file, read-only action and prerequisite for each task.

${base}`;
  if (values['planning-prompt'] === 'quota-example')
    return `A quota fallback changes who performs an existing task. It never adds a task, changes the scope, or changes the dependency. For this example only, use these assignments if the request says "P reads X, then P checks Y using the first result. If P is out of quota, Q reads X and R checks Y":
read-x: preferredMemberId=P, fallbackMemberId=Q, scope=[X], dependsOn=[]
check-y: preferredMemberId=P, fallbackMemberId=R, scope=[Y], dependsOn=[read-x]
If only X has an authorized backup, check-y has fallbackMemberId=none. When the primary is named once for a sequence, keep that primary for each task unless the requester says otherwise. Copy the real harness refs from the current granted team. Use short task descriptions, acceptance criteria and summaries. Keep every requested action and scope.

${base}`;
  return `Before submitting a plan, verify these three constraints:
For a request to read, explain or summarize an existing file, use research-read-only. “Read-only”, “chỉ đọc”, “chỉ xem” and “dung sua” rule out creating or editing files for that task. Do not invent an implementation or an independent review for a request to explain a file.
“A does the work, B only if A has no quota” is one task. Its preferredMemberId is A’s ref and its fallbackMemberId is B’s ref. Put the backup in that field even when the summary already mentions it. Use auto in that field only if the requester delegates the backup choice. Use none when the user requires the named assignee.
For reproducing, fixing and rerunning on one paired machine, include those three operations in one scoped edit-files task with the required OS. Do not create an extra research or review task for running the same tests on that paired machine.

${base}`;
}

function frontendExpectation(style: FrontendStyle) {
  if (style === 'ungranted')
    return {
      tool: groupQuestionTool.name,
      question: 'Astra’s owner needs to grant permission for this project.',
    };
  return {
    tool: groupPlanTool.name,
    architecture: `Gemini on ${workshop.architecture} can start before Astra.`,
    frontend: `Astra on ${workshop.frontend} waits for Gemini’s architecture.`,
    style:
      style === 'unspecified'
        ? 'Frontend acceptance asks for the sender’s preference or offers to let Astra choose.'
        : style === 'supplied'
          ? 'Frontend retains a minimalist style and navy background.'
          : 'Frontend retains the sender’s delegation to Astra.',
    remaining: 'Keep the mapped backend and codebase work and the independent defensive review.',
  };
}

function ownerRoutingEvidence({ tag, message, reference, roster, expected }: OwnerRoutingCase) {
  return { tag, input: { message, reference, roster }, expected };
}

function assessOwnerRoutingPlan(
  { expected }: OwnerRoutingCase,
  plan: ReturnType<typeof parseTeamPlan>,
  run: SharedSadeRun,
  toolName: string | undefined,
) {
  if (expected.kind === 'no-work') {
    assert.equal(toolName, groupNoWorkTool.name, 'an informational message closes without work');
    assert.equal(run.state, 'done');
    assert.ok(run.jobs.every((job) => job.phase === 'plan'));
    return;
  }
  assert.equal(expected.kind, 'plan', 'ask about the unresolved assignment before dispatch');
  assert.equal(toolName, groupPlanTool.name, 'submit a plan for the granted assignment');
  assert.equal(run.state, 'running', run.error || 'the granted tasks should be queued');
  const jobs = run.jobs.filter((job) => job.phase === 'task');
  assert.equal(plan.tasks.length, expected.tasks.length, 'preserve the requested task count');
  assert.equal(jobs.length, expected.tasks.length);
  for (const { owner, file, mode, after, fallback } of expected.tasks) {
    const task = plan.tasks.find(({ scope }) => scope.length === 1 && scope[0] === file);
    assert.ok(task, `keep exact file scope ${file}`);
    assert.equal(task.preferredMemberId, grants[owner], `keep the named primary for ${file}`);
    assert.equal(jobs.find(({ task: job }) => job?.key === task.key)?.grantId, grants[owner]);
    assert.equal(needsGroupWrite(task), mode === 'edit', `keep the access mode for ${file}`);
    if (mode === 'read') assert.equal(task.kind, 'research');
    const dependency = after && plan.tasks.find(({ scope }) => scope[0] === after);
    if (after) assert.ok(dependency, `keep the prerequisite ${after}`);
    assert.deepEqual(task.dependsOn, dependency ? [dependency.key] : []);
    assert.equal(
      task.fallbackMemberId,
      typeof fallback === 'number' ? grants[fallback] : fallback,
      `use only the authorized fallback for ${file}`,
    );
  }
}

function assessOwnerRoutingQuestion({ expected }: OwnerRoutingCase, question: string) {
  assert.equal(expected.kind, 'question', 'do not ask again when the requester resolved the route');
  const normalized = question
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll('đ', 'd');
  const words = question
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  assert.ok(words.includes(expected.harness.toLowerCase()), 'name the requested harness');
  for (const owner of expected.owners) {
    const name = people[owner].name.toLowerCase();
    const folded = name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replaceAll('đ', 'd');
    assert.ok(
      words.includes(name) || words.includes(folded),
      `refer to ${people[owner].name} in the question`,
    );
  }
  assert.match(
    normalized,
    expected.reason === 'missing-grant'
      ? /quyen|cho phep|grant|authoriz|permission|access/
      : /\b(?:ai|nao|chon|hay|which|whose|who|or)\b/,
  );
}

function ownerRoutingPreflight({ id, scenario, ownerRouting }: PlannerCase, run: SharedSadeRun) {
  assert.ok(ownerRouting, 'only owner-routing cases can be gated before model inference');
  if (saved)
    assert.equal(
      savedRows.get(id)?.execution,
      'coordinator-preflight',
      'This case no longer reaches a planner. Replay the saved model result at its original commit.',
    );
  const job = run.jobs[0];
  let error: string | undefined;
  try {
    assert.equal(run.state, 'planning');
    assert.equal(run.jobs.length, 1);
    assert.equal(job.phase, 'plan');
    assert.equal(job.state, 'waiting');
    assert.ok(job.summary);
    assessOwnerRoutingQuestion(ownerRouting, job.summary);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    id,
    scenario,
    execution: 'coordinator-preflight' as const,
    preflightPassed: !error,
    question: job?.summary,
    state: run.state,
    error,
    ...ownerRoutingEvidence(ownerRouting),
  };
}

if (exportPrompt) {
  const plannerCase = selectedCases[0];
  const { id, message, reference, frontendStyle, ownerRouting } = plannerCase;
  const execution = await withGroup(plannerCase, async (group) => {
    if ('waiting' in group) {
      const row = ownerRoutingPreflight(plannerCase, group.waiting);
      await writeFile(output, JSON.stringify(row, null, 2), 'utf8');
      if (!row.preflightPassed) process.exitCode = 1;
      return row.execution;
    }
    const { delivery } = group;
    const prompt = planningPrompt(delivery);
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
          ...(frontendStyle
            ? { input: { message, reference }, expected: frontendExpectation(frontendStyle) }
            : {}),
          ...(ownerRouting ? ownerRoutingEvidence(ownerRouting) : {}),
        },
        null,
        2,
      ),
      'utf8',
    );
  });
  console.log(JSON.stringify({ exported: id, execution }));
  process.exit(process.exitCode ?? 0);
}

for (const plannerCase of selectedCases) {
  const {
    scenario,
    id,
    message,
    handoff,
    reference,
    reader,
    quotaFollowup,
    frontendStyle,
    ownerRouting,
  } = plannerCase;
  const detailed = Boolean(frontendStyle || ownerRouting);
  const row = await withGroup(plannerCase, async (group) => {
    if ('waiting' in group) return ownerRoutingPreflight(plannerCase, group.waiting);
    const prompt = planningPrompt(group.delivery);
    assert.doesNotMatch(prompt, /fixture-private-token-hash/);
    const promptSha256 = sha256(prompt);
    const prior = savedRows.get(id);
    if (saved) assert.equal(prior?.promptSha256, promptSha256, `Prompt changed for ${id}`);
    if (!saved && !externalPath) await selectLiveModel();
    const started = performance.now();
    let parsed = false;
    let plan;
    let question: string | undefined;
    let run;
    let error;
    let toolName;
    let correction;
    let generatedTokens = 0;
    const modelReplies: Awaited<ReturnType<typeof getPlannerReply>>[] = [];
    const roster = group.delivery.team.map((member) => member.id);
    function acceptReply(tool: { name: string; arguments: unknown }) {
      toolName = tool.name;
      if (toolName === groupQuestionTool.name && (values['owner-handoff'] || detailed)) {
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
          const modelReply = await getPlannerReply(
            messages,
            scenario === 'full-handoff' || Boolean(frontendStyle),
          );
          if (detailed) modelReplies.push(modelReply);
          const { message: reply, eval_count, done_reason } = modelReply;
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
        if (ownerRouting) assessOwnerRoutingQuestion(ownerRouting, question);
        else {
          assert.ok(
            ['owner-ambiguous', 'owner-ungranted', 'frontend-style-ungranted'].includes(scenario),
            'a uniquely identified, granted harness should start work directly',
          );
          assert.match(question, scenario === 'frontend-style-ungranted' ? /Astra/i : /Bình|Binh/i);
          if (scenario === 'owner-ambiguous') assert.match(question, /Chi/i);
          else assert.match(question, /quyền|cho phép|grant|authoriz|permission/i);
        }
        group.ask(question);
        run = group.jobs();
      } else {
        assert.ok(plan);
        group.finish(plan);
        run = group.jobs();
        if (ownerRouting) {
          assessOwnerRoutingPlan(ownerRouting, plan, run, toolName);
          if (ownerRouting.tag === 'quota-named-backup' || ownerRouting.tag === 'quota-pinned') {
            assert.equal(ownerRouting.expected.kind, 'plan');
            const { owner, fallback } = ownerRouting.expected.tasks[0];
            assert.ok(fallback === undefined || typeof fallback === 'number');
            group.verifyOwnerQuota(plan.tasks[0].key, owner, fallback);
            run = group.jobs();
          }
        } else if (quotaFollowup) {
          group.verifyQuotaFollowup(plan, quotaFollowup);
          run = group.jobs();
        } else {
          const writer = assess(
            scenario,
            plan,
            run,
            handoff,
            reader,
            frontendStyle
              ? { style: frontendStyle, verifyOrder: group.verifyFrontendOrder }
              : undefined,
          );
          if (writer) group.verifyReview(writer);
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const milliseconds = Math.round(performance.now() - started);
    return {
      id,
      scenario,
      promptSha256,
      parsed,
      pass: !error,
      milliseconds,
      ...(generatedTokens ? { generatedTokens } : {}),
      plan,
      question,
      toolName,
      correction,
      state: run?.state,
      error,
      ...(frontendStyle
        ? { input: { message, reference }, expected: frontendExpectation(frontendStyle) }
        : {}),
      ...(ownerRouting ? ownerRoutingEvidence(ownerRouting) : {}),
      ...(detailed
        ? {
            prompt,
            modelReplies,
            ...(modelDigest && !saved ? { modelMemory: await sampleModelMemory(modelDigest) } : {}),
          }
        : {}),
    };
  });
  rows.push(row);
  console.log(
    JSON.stringify({
      id,
      ...('execution' in row
        ? { execution: row.execution, preflightPassed: row.preflightPassed, state: row.state }
        : {
            pass: row.pass,
            parsed: row.parsed,
            milliseconds: row.milliseconds,
            correction: row.correction,
          }),
      error: row.error,
    }),
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        ...(externalPath
          ? { source: values['external-decision'] ? 'external-decision' : 'external-plan' }
          : modelDigest
            ? { model, digest: modelDigest }
            : {}),
        toolsSha256,
        ...(values['frontend-style'] || values['owner-routing']
          ? {
              planningPrompt: values['planning-prompt'],
              generation: {
                ...generation,
                num_predict: values['frontend-style'] ? 1600 : 768,
                think: false,
              },
              memoryMeasurement:
                'Ollama /api/ps post-reply model allocation. RAM is allocation minus VRAM. Sample excludes peak process and runner memory.',
            }
          : {}),
        ...(source ? { replayedFrom: path.basename(source) } : {}),
        rows,
      },
      null,
      2,
    ),
    'utf8',
  );
}
const plannerRows = rows.filter((row) => 'pass' in row);
const preflightRows = rows.filter((row) => 'preflightPassed' in row);
console.log(
  JSON.stringify({
    tested: plannerRows.length,
    parsed: plannerRows.filter((row) => row.parsed).length,
    passed: plannerRows.filter((row) => row.pass).length,
    ...(preflightRows.length
      ? {
          preflight: {
            tested: preflightRows.length,
            passed: preflightRows.filter((row) => row.preflightPassed).length,
          },
        }
      : {}),
  }),
);
if (
  preflightRows.some((row) => !row.preflightPassed) ||
  (externalPath && plannerRows.some((row) => !row.pass))
)
  process.exitCode = 1;
