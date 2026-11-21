import { z } from 'zod';
import {
  sadeProjectKinds,
  type SadeProjectKind,
  type SadeProjectTask,
} from '../shared/sade-project.ts';
import type { PlanTask } from '../shared/types.ts';
import type { SharedGroup, SharedTeammate } from '../shared/collaboration.ts';
import { redact } from './security.ts';
import { sadeProjectArtifact } from './shared-sade-project-files.ts';

const text = (limit: number) => z.string().trim().min(1).max(limit);
export const sadeProjectKind = z.enum(sadeProjectKinds);
export const projectBrief = z.strictObject({
  title: text(140),
  summary: text(1600),
  sources: z.array(text(350)).max(12),
});
export const projectPlanReply = z.strictObject({
  title: text(140),
  summary: text(1400),
  question: text(500).nullable(),
  research: z.enum(['one', 'parallel']),
  instructions: z.array(z.strictObject({ task: text(60), brief: text(800) })).max(12),
  catalogueObservations: text(1400).nullable().optional(),
});
export const projectAudit = z.strictObject({
  summary: text(1600),
  revise: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(6),
});
export type ProjectBrief = z.infer<typeof projectBrief>;
export type ProjectPlanReply = z.infer<typeof projectPlanReply>;
export type ProjectAudit = z.infer<typeof projectAudit>;

const taskKey = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const projectNoteInput = z.strictObject({
  kind: z.enum(['progress', 'handoff', 'question', 'scope']),
  text: text(1200),
  to: taskKey.optional(),
});
const projectNote = projectNoteInput.extend({ id: z.uuid() });
const activity = z.strictObject({
  id: z.uuid(),
  role: z.enum(['assistant', 'status']),
  text: text(1200),
  at: z.string().datetime(),
});
export const projectWorkerReport = z.strictObject({
  jobId: z.uuid(),
  sessionId: z.uuid(),
  status: text(40),
  activity: z.array(activity).max(6),
  notes: z.array(projectNote).max(8),
});
export const projectContext = z.strictObject({
  tasks: z
    .array(
      z.strictObject({
        key: taskKey,
        title: text(140),
        harness: text(100),
        owner: z.string().max(200),
        state: text(40),
        scope: z.array(text(300)).max(12),
        after: z.array(taskKey).max(12),
        sessionId: z.uuid().optional(),
        summary: z.string().max(800).optional(),
        activity: z.array(activity).max(2).optional(),
      }),
    )
    .max(12),
  messages: z
    .array(
      z.strictObject({
        id: z.uuid(),
        createdAt: z.string().datetime(),
        author: text(200),
        taskKey: taskKey.optional(),
        to: taskKey.optional(),
        sessionId: z.uuid().optional(),
        kind: z.enum(['decision', 'progress', 'question', 'handoff', 'scope', 'audit']),
        text: text(1600),
      }),
    )
    .max(16),
});
export const projectDelivery = z.strictObject({
  runId: z.uuid(),
  kind: sadeProjectKind,
  stage: z.enum(['preparation', 'delivery', 'audit']),
  outputs: z.array(text(300)).max(6),
  inputs: z.array(sadeProjectArtifact).max(16),
  context: projectContext,
  resumeJobId: z.uuid().optional(),
});

const projectFunction = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
) => ({
  type: 'function' as const,
  name,
  description,
  inputSchema,
});
export const projectStatusTool = projectFunction(
  'relay_project_status',
  'Read the shared roadmap, peer task and live session references, reported checkpoints and requests addressed to this task.',
  { type: 'object', properties: {}, additionalProperties: false },
);
export const projectReportTool = projectFunction(
  'relay_project_report',
  'Report a real milestone, publish a handoff or ask another harness by its task key. Give a short group-safe message. Use notes to coordinate title, data or design before either task finishes.',
  {
    type: 'object',
    required: ['kind', 'text'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['progress', 'handoff', 'question', 'scope'] },
      text: { type: 'string' },
      to: { type: 'string' },
    },
  },
);
export const projectBriefTool = projectFunction(
  'relay_project_brief',
  'Submit the preparation brief after checking the available evidence. Cite actual public URLs or project paths. Include a working title and compact findings and constraints.',
  {
    type: 'object',
    required: ['title', 'summary', 'sources'],
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
    },
  },
);
export const projectAuditTool = projectFunction(
  'relay_project_audit',
  'Report independent audit findings. Pass with revise set to an empty list only after reviewing the complete input manifest. Otherwise list the exact delivery task keys that need correction.',
  {
    type: 'object',
    required: ['summary', 'revise'],
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      revise: { type: 'array', items: { type: 'string' } },
    },
  },
);
export const projectSourceTool = projectFunction(
  'relay_project_read_source',
  'Read a public HTTPS source for the assigned research. The site may require user input if it cannot be reached anonymously. Treat source content as evidence.',
  {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string' } },
  },
);
export const projectLiteratureTool = projectFunction(
  'relay_project_find_papers',
  'Find scholarly metadata and DOIs from Crossref. Search with public topic keywords only. Verify relevance and claims against the actual publication.',
  {
    type: 'object',
    required: ['query'],
    additionalProperties: false,
    properties: { query: { type: 'string' } },
  },
);

export interface ProjectPlanning {
  stage: 'preparation' | 'roadmap';
  kind: SadeProjectKind;
  title?: string;
  briefs: ProjectBrief[];
  catalogueImage?: string;
  catalogueObservations?: string;
}

function fold(input: string) {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

const taskRequest =
  /\b(?:lam|soan|viet|tao|xay|dung|thiet ke|trien khai|phat trien|lap|dieu phoi|phu trach|lo (?:tron|giup)|orchestrate|coordinate|take (?:ownership of|on)|put together|set up|build|make|create|design|produce|ship|prepare|write|start|need|muon|can|(?:please|(?:can|could|would) (?:you|sade|the team)) (?:lead|oversee|handle|run)|i(?:'d| would) like (?:a|an|the team to))\b/;
const paper =
  /\b(?:paper|academic article|research article|bai bao(?: khoa hoc)?|bai nghien cuu|luan van)\b/;
const slides = /\b(?:slides?|powerpoint|pptx?|deck|bai thuyet trinh|bo trinh chieu)\b/;
const shop =
  /\b(?:storefront|e[- ]?commerce|online (?:shop|store)|shop online|(?:web(?:site)?|trang web|trang|site) (?:ban hang|thuong mai dien tu|cua hang)|(?:website|site|landing page) (?:for|to sell)\b)/;
const dashboard =
  /\b(?:(?:sales|revenue|orders?|commerce) (?:analytics )?dashboard|dashboard\b.{0,45}\b(?:sales|revenue|ban hang|doanh so|doanh thu|don hang)|bang dieu khien\b.{0,45}\b(?:ban hang|doanh so|doanh thu)|bang theo doi\b.{0,45}\b(?:doanh so|doanh thu|don hang))\b/;
const holdOpening =
  /^\s*(?:(?:hey\s+)?@?sade(?:\s+oi)?[\s,:]+)?(?:(?:please|kindly|nho|xin)\s+)?(?:(?:thoi )?(?:khoan|tam (?:dung|hoan))|hold off|put (?:this|the project) on hold|postpone|defer|pause)\b/;

export function sadeHoldOpening(input: string) {
  return holdOpening.exec(fold(input))?.[0];
}

export function requestedSadeProject(input: string): SadeProjectKind | undefined {
  const visible = fold(input.normalize('NFC').replace(/(?<!\p{L})đừng(?!\p{L})/giu, 'do not'))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/["“«][^"”»]+["”»]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:hey\s+)?@?sade(?:\s+oi)?[,: ]+/, '');
  if (
    !taskRequest.test(visible) ||
    sadeHoldOpening(visible) ||
    /^\s*(?:please )?(?:chua|chi hoi|chi muon hoi|fyi|don.t|do not|not yet)\b/.test(visible) ||
    /\b(?:chua can (?:lam|tao|viet)|(?:dung|do not) (?:lam|tao|viet|mo viec)|not (?:asking|requesting) (?:you )?to|no (?:action|work) (?:needed|yet)|don.t (?:start|build|write) yet|chua giao viec|chi (?:bao|nhac) (?:de|cho) (?:nhom|moi nguoi)|(?:is|co) (?:the|do) .* (?:khong\?|yet\?))\b/.test(
      visible,
    )
  )
    return;
  // Narrow requests targeting existing files keep their normal scope and assignment route.
  if (
    /\b(?:chi|only|exactly|dung)\s+(?:sua|doc|edit|read|review|kiem tra)\b/.test(visible) ||
    (/\b[\w.-]+(?:\/[\w.-]+)+\.(?:tsx?|jsx?|css|html|md|tex|pptx)\b/.test(visible) &&
      !/\b(?:tu dau den cuoi|trong goi|end.to.end|build (?:me |us )?a new|xay (?:moi|dung))\b/.test(
        visible,
      ))
  )
    return;
  if (paper.test(visible) && slides.test(visible)) return 'paper-and-slides';
  if (dashboard.test(visible)) return 'sales-dashboard';
  if (shop.test(visible)) return 'storefront';
}

export function asksForProjectStatus(input: string) {
  return /^(?:\s*@sade[ ,:]+)?\s*(?:tien do\b|cap nhat (?:giup |cho )?(?:minh |toi |em )?(?:tien do|du an)|du an (?:den dau|toi dau)|(?:cho|minh muon biet)\b.{0,30}\b(?:den dau|tien do)|(?:any |project )?status\b|what(?:'s| is) (?:the |our )?(?:status|progress)|how(?:'s| is) (?:the |our )?(?:project|work) going)/.test(
    fold(input),
  );
}

export function projectStatusQuestion(input: string) {
  if (asksForProjectStatus(input)) return true;
  return /^(?:\s*@?sade(?: oi)?[ ,:]+)?\s*(?:ai dang lam gi|(?:cong |con )?viec nao (?:dang|con|da|chua)|dang ket o dau|phan nao (?:dang|con) (?:cho|ket)|who is working on what|what (?:is|'s) (?:blocked|in progress)|which tasks are (?:waiting|blocked|running))\b/.test(
    fold(input),
  );
}

export function needsAnswerBeforePreparation(input: string) {
  const asks = /\b(?:hoi|xac nhan|ask|confirm|check with)\b/;
  const before =
    /\b(?:truoc khi (?:bat dau|lam|giao viec|mo viec)|before (?:starting|beginning|you (?:start|begin)|doing any work|assigning anything))\b/;
  return fold(input)
    .split(/[.!?;\n]+/)
    .some(
      (clause) =>
        !/\b(?:dung|khong can|do not|don.t) (?:hoi|xac nhan|ask|confirm|check with)\b/.test(
          clause,
        ) &&
        ((asks.test(clause) && before.test(clause)) ||
          /\b(?:chua (?:biet|chot|xac dinh) (?:chu de|mat hang|san pham)|no (?:topic|products?) (?:is |are )?(?:chosen|specified|defined))\b/.test(
            clause,
          )),
    );
}

const responsibility: Partial<Record<string, RegExp>> = {
  brief:
    /\b(?:preparation|research (?:the|this|our)|tim (?:hieu|nguon)|nghien cuu chu de|product research)\b/,
  evidence: /\b(?:methodology|phuong phap|doi chieu nguon|check (?:the )?evidence)\b/,
  synthesis:
    /\b(?:tong hop (?:du lieu|data|nguon|research)|synthesi[sz]e|evidence table|consolidate (?:the )?data)\b/,
  paper:
    /\b(?:viet(?: va)? (?:paper|bai|latex)|soan bai|write (?:the |our )?(?:paper|manuscript)|compile|latex)\b/,
  slides: /\b(?:slides?|powerpoint|pptx?|deck|thuyet trinh)\b/,
  catalogue: /\b(?:products\.json|catalogue data|product records|du lieu san pham)\b/,
  journey: /\b(?:buying flow|checkout flow|luong mua|luong dat hang|ux)\b/,
  storefront: /\b(?:storefront|web ban hang|online (?:shop|store)|site ban hang)\b/,
  metrics: /\b(?:metrics|kpis?|chi so|tinh doanh thu|du lieu ban hang)\b/,
  'dashboard-layout': /\b(?:layout|bo cuc|giao dien dashboard|chart selection)\b/,
  dashboard: /\b(?:dashboard|bang dieu khien|bang theo doi)\b/,
  audit: /\b(?:audit|review|kiem dinh|ra soat|kiem tra doc lap)\b/,
};

export function namedProjectHarnesses(
  key: string,
  content: string,
  group: SharedGroup,
  answer?: string,
): SharedTeammate[] | undefined {
  const subject = responsibility[key];
  if (!subject) return;
  const clauses = fold(content.replace(/["“«][^"”»]+["”»]/g, ' ')).split(/[\r\n,;.!?]+/);
  const active = clauses.filter(
    (phrase) =>
      subject.test(phrase) &&
      /\b(?:nho|giao|cho|de|phu trach|lo|lam|take|own|handle|assign|ask|let|have|writes?|viet|soan|compile|audit|review)\b/.test(
        phrase,
      ) &&
      !/\b(?:da xong|da lam|da viet|chua can|dung giao|do not|last week|previously|already finished)\b/.test(
        phrase,
      ),
  );
  const contains = (phrase: string, name: string) =>
    (' ' + phrase.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ').includes(
      ' ' +
        fold(name)
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim() +
        ' ',
    );
  const members = group.teammates.filter((teammate) =>
    group.people.some(
      ({ id, state, quotaLocked }) => id === teammate.ownerId && state === 'active' && !quotaLocked,
    ),
  );
  const mentioned = members.filter((teammate) =>
    active.some((phrase) => contains(phrase, teammate.name)),
  );
  if (!mentioned.length) return;
  const ownerSelected = mentioned.filter((teammate) => {
    const owner = group.people.find(({ id }) => id === teammate.ownerId)!;
    return active.some((phrase) => contains(phrase, teammate.name) && contains(phrase, owner.name));
  });
  const base = ownerSelected.length ? ownerSelected : mentioned;
  if (base.length === 1 || !answer) return base;
  const exact = base.filter((teammate) => {
    const owner = group.people.find(({ id }) => id === teammate.ownerId)!;
    return contains(fold(answer), owner.name);
  });
  return exact.length ? exact : base;
}

const names: Record<SadeProjectKind, string> = {
  'paper-and-slides': 'Paper and presentation',
  storefront: 'Online storefront',
  'sales-dashboard': 'Sales dashboard',
};

export function defaultProjectReply(
  kind: SadeProjectKind,
  request: string,
  stage: ProjectPlanning['stage'],
): ProjectPlanReply {
  const complex =
    /\b(?:he thong|doi chieu|so sanh|nhieu nguon|nhieu thi truong|phan tich tong hop|chia (?:hai|2) nhanh|systematic|compare|comparative|meta.analysis|multiple datasets|interdisciplinary|replication)\b/.test(
      fold(request),
    );
  return {
    title: names[kind],
    summary:
      stage === 'preparation'
        ? 'I’ll start by establishing the brief, checking available evidence, and asking for decisions that affect the result.'
        : 'The research brief is in. I’ve scheduled the work by dependency, with separate write scopes and an independent audit.',
    question:
      stage === 'preparation' && needsAnswerBeforePreparation(request)
        ? /\b(?:hoi|truoc khi|chua|xac nhan)\b/.test(fold(request))
          ? 'Bạn có thể xác nhận thông tin còn thiếu trước khi tôi bắt đầu không?'
          : 'What needs to be confirmed before I start preparing the project?'
        : null,
    research: complex ? 'parallel' : 'one',
    instructions: [],
  };
}

export type ProjectPlanTask = PlanTask & { project: SadeProjectTask };
function job(
  key: string,
  title: string,
  kind: PlanTask['kind'],
  stage: SadeProjectTask['stage'],
  description: string,
  acceptance: string,
  effort: number,
  dependsOn: string[],
  scope: string[],
  outputs: string[] = [],
): ProjectPlanTask {
  return {
    key,
    title,
    kind,
    stage,
    description,
    acceptance,
    effort,
    dependsOn,
    scope,
    project: { stage, outputs },
  };
}

function addGuidance(tasks: ProjectPlanTask[], reply: ProjectPlanReply) {
  return tasks.map((task) => {
    const suggestion = reply.instructions.find(({ task: key }) => key === task.key)?.brief;
    return suggestion
      ? { ...task, description: task.description + '\nProject guidance: ' + redact(suggestion) }
      : task;
  });
}

export function preparationTasks(
  kind: SadeProjectKind,
  reply: ProjectPlanReply,
  parallel: boolean,
  questionToInvestigate?: string,
) {
  const brief =
    kind === 'paper-and-slides'
      ? 'Confirm the topic, audience, contribution, target length and presentation language. Search for primary literature, identify credible sources and settle a working title and claims that the slide author can use early. Record missing data and avoid invented citations or findings.'
      : kind === 'storefront'
        ? 'Use the supplied catalogue, images or public shop links to identify products, types of buyers, purchase channels, prices actually observed and the main buying path. Ask the requester only for essential missing choices such as what is sold, target audience or checkout versus enquiry. Never invent inventory, price or policies.'
        : 'Identify the data source, KPI definitions, date range, currency, filters and intended audience. Ask for essential missing facts. Mark demo data explicitly if the requester approves a demo.';
  const tasks = [
    job(
      'brief',
      'Research the brief',
      'research',
      'preparation',
      questionToInvestigate
        ? brief +
            '\nWhile preparing, investigate this possible ambiguity. Ask only if it remains essential: ' +
            redact(questionToInvestigate)
        : brief,
      'Submit an evidence-based brief with a working title and references. Ask a focused question only if the missing answer changes the useful outcome.',
      3,
      [],
      ['.'],
    ),
  ];
  if (parallel)
    tasks.push(
      job(
        'evidence',
        'Check evidence and constraints',
        'research',
        'preparation',
        kind === 'paper-and-slides'
          ? 'Trace methods, data provenance and limitations independently of the main literature brief. Distinguish measured results from hypotheses and record reproducibility requirements.'
          : 'Check the input data and workflow constraints that affect feasibility, independently of audience and product discovery. Note unavailable sources and assumptions.',
        'Submit distinct evidence and constraints for the delivery roadmap. Avoid duplicating the lead brief.',
        3,
        [],
        ['.'],
      ),
    );
  return addGuidance(tasks, reply);
}

export function projectRoadmap(
  kind: SadeProjectKind,
  runId: string,
  reply: ProjectPlanReply,
  preparationKeys: string[],
): ProjectPlanTask[] {
  const root = 'kivuno-deliverables/' + runId;
  const writer = (
    key: string,
    title: string,
    kind: 'code' | 'design',
    description: string,
    acceptance: string,
    effort: number,
    after: string[],
    files: string[],
  ) => {
    const scope = root + '/' + key;
    return job(
      key,
      title,
      kind,
      'delivery',
      description,
      acceptance,
      effort,
      after,
      [scope],
      files.map((name) => scope + '/' + name),
    );
  };
  const wanted: ProjectPlanTask[] =
    kind === 'paper-and-slides'
      ? [
          writer(
            'synthesis',
            'Synthesize sources and data',
            'code',
            'Consolidate the verified preparation findings into a traceable evidence table. Include source, claim, limits and data provenance. Notify the paper and slides harnesses as soon as the useful findings are ready.',
            'Write evidence.md and evidence.csv. Clearly identify unavailable or simulated data.',
            4,
            preparationKeys,
            ['evidence.md', 'evidence.csv'],
          ),
          writer(
            'paper',
            'Write and compile the LaTeX paper',
            'code',
            'Own paper authoring and compilation in this session. Use the agreed title and evidence. Tell the slides harness promptly if the title, terminology or central findings change. Use relay_project_compile_paper or an approved paired machine and report the actual compile result.',
            'Produce paper.tex, references.bib and a compiled paper.pdf. Check references and build results. Keep all of this work with the same harness.',
            7,
            ['synthesis'],
            ['paper.tex', 'references.bib', 'paper.pdf'],
          ),
          writer(
            'slides',
            'Create the PowerPoint presentation',
            'design',
            'Start with title, outline and slide layout from the preparation brief while synthesis and writing proceed. Ask the paper or synthesis task by key when a decision matters. Check the latest paper title and claims, then use relay_project_render_slides.',
            'Produce slides.pptx and slides.md for audit. Title, claims and figures must agree with the audited paper. Cite the original evidence.',
            5,
            preparationKeys,
            ['slides.pptx', 'slides.md'],
          ),
        ]
      : kind === 'storefront'
        ? [
            writer(
              'catalogue',
              'Organize the product catalogue',
              'code',
              'Turn the researched assortment into product records with actual descriptions, audience, categories and known ordering details. Mark unavailable prices and image rights.',
              'Produce products.json with source-grounded information.',
              3,
              preparationKeys,
              ['products.json'],
            ),
            job(
              'journey',
              'Define the buying flow',
              'design',
              'delivery',
              'Specify navigation, product discovery, mobile product details, and the confirmed checkout or contact path. Coordinate layout and interaction requirements with the storefront harness.',
              'Share the interaction decisions with the storefront harness.',
              3,
              preparationKeys,
              ['.'],
            ),
            writer(
              'storefront',
              'Build the storefront preview',
              'design',
              'Implement the storefront using the validated catalogue and buying flow. Ship a self-contained static preview for Kivuno with inline assets and clear placeholders for unconfigured services. Do not initiate transactions.',
              'Produce index.html. Check phone and desktop layouts, filters, empty states and the enquiry or cart flow.',
              7,
              ['catalogue', 'journey'],
              ['index.html'],
            ),
          ]
        : [
            writer(
              'metrics',
              'Prepare and validate sales metrics',
              'code',
              'Map the input into auditable calculations, date/currency conventions and filterable dimensions. Distinguish unknown values from zero and keep any personal data outside the deliverable.',
              'Produce metrics.json explaining each KPI and data checks.',
              4,
              preparationKeys,
              ['metrics.json'],
            ),
            job(
              'dashboard-layout',
              'Design the dashboard views',
              'research',
              'delivery',
              'Specify useful charts, date and segment controls, and empty/loading/error states. Coordinate with the metrics harness before choosing aggregates.',
              'Share the view decisions and checks with the dashboard harness.',
              3,
              preparationKeys,
              ['.'],
            ),
            writer(
              'dashboard',
              'Implement the sales dashboard',
              'design',
              'Build a self-contained static preview using the validated metric definitions and available data. Honor the requested filtering and do not make up live sales.',
              'Produce index.html with source/fixture labeling, checked totals and usable interactions.',
              7,
              ['metrics', 'dashboard-layout'],
              ['index.html'],
            ),
          ];
  // A design note can be delivered as conversation evidence and owns no files.
  const work = wanted.map((task) =>
    task.project.outputs.length ? task : { ...task, kind: 'research' as const },
  );
  const deliverableScopes = work
    .filter((task) => task.project.outputs.length)
    .flatMap((task) => task.scope);
  work.push(
    job(
      'audit',
      'Independently audit the project',
      'review',
      'audit',
      kind === 'paper-and-slides'
        ? 'Audit sources, data, LaTeX/PDF results and agreement between paper and slides. Check each deliverable in the input manifest. Specify the task keys that need revision instead of changing the files.'
        : 'Audit the preview against the preparation brief. Check facts, key interactions, data or catalogue accuracy and responsive usability. Specify task keys for any corrections.',
      'Submit an independent verdict with evidence. Approve only after each required output is present and checked.',
      4,
      work.map((task) => task.key),
      deliverableScopes,
    ),
  );
  return addGuidance(work, reply);
}
