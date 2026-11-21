// Run with Node 24.22.1, --experimental-test-module-mocks --import tsx.
// Live mode uses synthetic group members and a loopback Fastify coordinator through the public gateway handler.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { mock } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { buildApp } from '../server/app.ts';
import { SharedGroups } from '../server/collaboration.ts';
import { DesktopIdentity, type DesktopDevice, type DesktopOwner } from '../server/desktop-auth.ts';
import { Workspace } from '../server/service.ts';
import { Store } from '../server/store.ts';
import type { SharedSadeJob, SharedSadeRun } from '../shared/collaboration.ts';
import {
  sharedSadeCloudExtended,
  sharedSadeCloudFinishPath,
  sharedSadeCloudHeader,
} from '../shared/sade-cloud.ts';

const providerKey = process.env.SADE_OPENAI_API_KEY?.trim();
const smoke = process.argv[2] === '--smoke';
const replay = process.argv[2] === '--replay';
const responses = process.argv[2] === '--responses';
const hybrid = process.argv[2] === '--hybrid';
const offline = smoke || replay;
const thresholdMs = offline ? 2_500 : 5_000;
const cli = process.argv.slice(replay || responses || hybrid ? 3 : 2);
if (!smoke && (!cli[0] || !cli[1]))
  throw new Error(
    'Usage: [--responses|--hybrid] <corpus.json> <evidence-directory>, --replay <used-corpus.json> <acceptance.json>, or --smoke.',
  );
if (!offline && !providerKey)
  throw new Error('Live acceptance needs server-side SADE_OPENAI_API_KEY. No prompts were used.');
if (offline && providerKey)
  throw new Error('Unset SADE_OPENAI_API_KEY before offline verification.');

type Provider = 'codex' | 'gemini' | 'claude' | 'antigravity';
type Platform = 'win32' | 'darwin' | 'linux';
type Teammate = {
  id: string;
  owner: string;
  name: string;
  provider: Provider;
  allowWrites: boolean;
  platform: Platform;
  sender?: boolean;
};
type ExpectedTask = {
  as: string;
  kind: string;
  member?: string;
  scope: string[];
  after: string[];
  platform?: Platform;
  pairedMachineName?: string;
  fallback?: string;
  askBeforeEditing?: true;
  editIfMissingAfter?: string;
  waitForProviderQuota?: true;
  testOnly?: true;
  details?: string[][];
  independentOf?: string[];
};
type Case = {
  id: string;
  message: string;
  reference?: string;
  setup?: {
    extraAstraChi?: true;
    pairedMacByLan?: true;
    grantState?: Record<string, 'read-only' | 'revoked' | 'other-project'>;
  };
  expected: {
    decision: 'plan' | 'no-work' | 'question';
    tasks: ExpectedTask[];
    question?: { about: string; details: string[][] };
  };
};
type Suite = { suiteId: string; roster: Teammate[]; cases: Case[] };
const smokeScope = `fixtures/relay-smoke-${randomUUID().slice(0, 8)}.ts`;
const smokeSuite: Suite = {
  suiteId: 'kivuno-decisions-transport-smoke',
  roster: [
    {
      id: 'smoke-reviewer',
      owner: 'QA',
      name: 'Mực',
      provider: 'codex',
      allowWrites: false,
      platform: 'win32',
      sender: true,
    },
  ],
  cases: [
    {
      id: 'gateway-probe',
      message: `Nhờ Mực đọc đúng tệp ${smokeScope}, đừng sửa gì.`,
      expected: {
        decision: 'plan',
        tasks: [
          {
            as: 'probe',
            kind: 'research',
            member: 'smoke-reviewer',
            scope: [smokeScope],
            after: [],
          },
        ],
      },
    },
  ],
};
const suite: Suite = smoke ? smokeSuite : JSON.parse(await readFile(cli[0], 'utf8'));
if (!/^[a-z0-9](?:[a-z0-9.-]{0,78}[a-z0-9])?$/i.test(suite.suiteId))
  throw new Error('Invalid suite ID.');
const senderMember = suite.roster.find(({ sender }) => sender);
if (!senderMember || suite.roster.filter(({ sender }) => sender).length !== 1)
  throw new Error('Exactly one sender is required.');

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .toLocaleLowerCase('vi')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const fingerprint = (message: string) => createHash('sha256').update(fold(message)).digest('hex');
const hashes = suite.cases.map(({ message }) => fingerprint(message));
if (
  (!smoke && suite.cases.length !== 25) ||
  new Set(hashes).size !== suite.cases.length ||
  new Set(suite.cases.map(({ id }) => id)).size !== suite.cases.length
)
  throw new Error('The gate requires 25 distinct messages and case IDs.');

const evidenceDirectory = offline ? undefined : path.resolve(cli[1]);
const ledger = evidenceDirectory && path.join(evidenceDirectory, 'sade-attempted-prompts.sha256');
if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
const attempted = new Set(
  ledger
    ? (
        await readFile(ledger, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        })
      )
        .split('\n')
        .filter(Boolean)
    : [],
);
if (hashes.some((hash) => attempted.has(hash)))
  throw new Error('A prompt has already been submitted. Use a fresh holdout suite.');
type ReplayDecision = {
  id: string;
  providerDecision?: Case['expected']['decision'];
  semanticChoices?: Record<string, string>;
  semanticSpec?: string;
};
const replayReport:
  | {
      suiteId: string;
      liveProvider: boolean;
      providerRoute?: string;
      rows: ReplayDecision[];
    }
  | undefined = replay ? JSON.parse(await readFile(cli[1], 'utf8')) : undefined;
const replayDecisions = new Map(replayReport?.rows.map((row) => [row.id, row]));
if (
  replay &&
  (replayReport?.suiteId !== suite.suiteId ||
    !replayReport.liveProvider ||
    (replayReport.providerRoute !== undefined && replayReport.providerRoute !== 'decisions') ||
    suite.cases.some(
      ({ id }) =>
        !['plan', 'question', 'no-work'].includes(replayDecisions.get(id)?.providerDecision || ''),
    ))
)
  throw new Error('Replay requires a real provider decision for each case in the consumed suite.');

const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-sade-live-'));
const gatewaySecret = randomBytes(48).toString('hex');
const actors = new Map<string, DesktopOwner>(
  [...new Set([...suite.roster.map(({ owner }) => owner), 'Lan'])].map((name) => [
    name,
    { id: randomUUID(), name },
  ]),
);
const sender = actors.get(senderMember.owner)!;
const coordinatorStore = new Store(path.join(directory, 'groups.db'));
const workspace = new Workspace(coordinatorStore, directory, directory);
const groups = new SharedGroups(coordinatorStore, (name) => actors.get(name) || null);
coordinatorStore.put('billingEntitlement', {
  id: sender.id,
  ownerId: sender.id,
  tier: 'plus',
  paidUntil: Date.now() + 86_400_000,
});
const nativeFetch = globalThis.fetch;
const decisionsEndpoint = 'https://api.openai.com/v1/decisions';
const responsesEndpoint = 'https://api.openai.com/v1/responses';
const providerRoute = hybrid ? 'hybrid' : responses ? 'responses-standard-medium' : 'decisions';
const providerName = hybrid
  ? 'OpenAI Decisions and Responses Standard medium'
  : responses
    ? 'OpenAI Responses Standard medium'
    : 'OpenAI Decisions';
const originalProviderRoute = process.env.SADE_OPENAI_API_ROUTE;
type CaseTrace = {
  admissions: number;
  providerCalls: number;
  receipt: number;
  timing: string;
  providerRoute?: 'decisions' | 'responses-standard-medium';
  providerHttp?: number;
  providerStatus?: string;
  providerIncompleteReason?: string;
  providerDecision?: 'plan' | 'question' | 'no-work';
  providerConfidence?: number;
  planningBasis?:
    | 'grounded-plan'
    | 'semantic-choices'
    | 'verified-clarification'
    | 'intent-only'
    | 'responses-proposal';
  semanticChoices?: Record<string, string>;
  semanticSpec?: string;
  semanticQuestions?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};
let busyCase: CaseTrace | undefined;
let replayDecision: ReplayDecision | undefined;
let providerObservation: Promise<void> | undefined;
const gateway = createServer();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let desktop: ElectronApplication | undefined;

async function watchDecision(page: Page) {
  await page.evaluate(`(() => {
    const start = (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button?.closest('.shared-group-compose') || button.textContent?.trim() !== 'Ask Sade')
        return;
      document.removeEventListener('click', start, true);
      const started = performance.now();
      const state = { started, visible: 0, text: '', labels: [] };
      window.__sadeGate = state;
      const observer = new MutationObserver(() => {
        const progress = document.querySelector('section[aria-label="Sade progress"]');
        const header = progress?.querySelector('strong')?.textContent;
        if (
          !progress?.getClientRects().length ||
          !header ||
          (header.trim() === 'Sade · planning' && !progress.querySelector('form'))
        )
          return;
        observer.disconnect();
        requestAnimationFrame(() => {
          if (!progress.isConnected || !progress.checkVisibility()) return;
          state.visible = performance.now();
          state.text = progress.innerText;
          state.labels = [...progress.querySelectorAll('li')].map((item) => item.innerText);
        });
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    };
    document.addEventListener('click', start, true);
  })()`);
}

type RecordedRun = Omit<SharedSadeRun, 'jobs'> & {
  jobs: (SharedSadeJob & { fallbackMemberId?: string; fallbackOnProviderQuota?: true })[];
};
type BoundTeammate = { member: Teammate; grantId: string };
const same = (left: string[], right: string[]) =>
  [...left].sort().join('\0') === [...right].sort().join('\0');
const includesDetails = (text: string, groups: string[][] = []) =>
  groups.every((phrases) => phrases.some((phrase) => fold(text).includes(fold(phrase))));
function checkDecision(
  expected: Case['expected'],
  run: RecordedRun | undefined,
  bindings: BoundTeammate[],
  visible: { text: string; labels: string[] },
) {
  if (!run) return 'No committed run for the sent message';
  if (['blocked', 'cancelled'].includes(run.state)) return `Coordinator returned ${run.state}`;
  const tasks = run.jobs.filter((job) => job.phase !== 'plan');
  const plan = run.jobs.find(({ phase }) => phase === 'plan');
  if (!plan) return 'Missing plan decision';
  if (!visible.text.includes(`Sade · ${run.state}`)) return 'UI does not show the committed run';
  if (expected.decision === 'question') {
    const summary = plan.summary || '';
    if (plan.state !== 'waiting' || tasks.length || !summary || !visible.text.includes(summary))
      return 'Expected a visible clarification with zero dispatches';
    if (!expected.question || !includesDetails(summary, expected.question.details))
      return `Missing clarification detail about ${expected.question?.about || 'the specific ambiguity'}`;
    return;
  }
  if (expected.decision === 'no-work') {
    if (
      plan.state !== 'done' ||
      run.state !== 'done' ||
      tasks.length ||
      !plan.summary ||
      !visible.text.includes(plan.summary)
    )
      return 'Expected a visible completion acknowledgment with zero dispatches';
    return;
  }
  if (plan.state !== 'done' || run.state !== 'running' || tasks.length !== expected.tasks.length)
    return `Expected ${expected.tasks.length} assigned tasks, found ${tasks.length}`;
  const ownerByGrant = new Map(bindings.map(({ grantId, member }) => [grantId, member.owner]));
  const grantByMember = new Map(bindings.map(({ grantId, member }) => [member.id, grantId]));
  const assigned = new Map<string, RecordedRun['jobs'][number]>();
  const options = expected.tasks.map((target) => ({
    target,
    matches: tasks.filter((job) => {
      const task = job.task;
      return (
        task &&
        task.kind === target.kind &&
        same(task.scope, target.scope) &&
        (!target.member || job.grantId === grantByMember.get(target.member)) &&
        task.requiredPlatform === target.platform &&
        task.requiredPairedMachineName === target.pairedMachineName &&
        !!task.askBeforeEditing === !!target.askBeforeEditing &&
        !!task.waitForProviderQuota === !!target.waitForProviderQuota &&
        !!task.testOnly === !!target.testOnly &&
        !!job.fallbackOnProviderQuota === !!target.fallback &&
        job.fallbackMemberId ===
          (target.fallback === 'auto'
            ? 'auto'
            : target.fallback
              ? grantByMember.get(target.fallback)
              : undefined) &&
        ownerByGrant.has(job.grantId) &&
        visible.labels.some(
          (label) => label.includes(task.title) && label.includes(ownerByGrant.get(job.grantId)!),
        )
      );
    }),
  }));
  function matchesGraph(index: number, withInstructions: boolean): boolean {
    const option = options[index];
    if (!option)
      return expected.tasks.every((target) => {
        const job = assigned.get(target.as)!;
        return (
          same(
            job.task!.dependsOn,
            target.after.map((id) => assigned.get(id)?.task?.key || '<unbound>'),
          ) &&
          job.task!.editIfMissingAfter ===
            (target.editIfMissingAfter
              ? assigned.get(target.editIfMissingAfter)?.task?.key || '<unbound>'
              : undefined) &&
          (target.independentOf || []).every((id) => {
            const other = assigned.get(id);
            return other && ownerByGrant.get(other.grantId) !== ownerByGrant.get(job.grantId);
          })
        );
      });
    for (const job of option.matches) {
      if ([...assigned.values()].includes(job)) continue;
      if (
        withInstructions &&
        !includesDetails(
          [job.task!.title, job.task!.description, job.task!.acceptance].join(' '),
          option.target.details,
        )
      )
        continue;
      assigned.set(option.target.as, job);
      if (matchesGraph(index + 1, withInstructions)) return true;
      assigned.delete(option.target.as);
    }
    return false;
  }
  if (!matchesGraph(0, false))
    return 'Task graph, assigned account, scope, machine, fallback or displayed assignment differ from the oracle';
  assigned.clear();
  if (!matchesGraph(0, true))
    return 'Task instructions need review against the sealed acceptance criteria';
}

function buildRoom(scenario: Case, deviceByOwner: Map<string, string>) {
  const groupId = randomUUID();
  const projectKey = createHash('sha256').update(`acceptance:${groupId}`).digest('hex');
  const roomName = `Sade QA ${scenario.id}`;
  const send = (owner: DesktopOwner, command: object) =>
    groups.execute(owner, { groupId, ...command }, deviceByOwner.get(owner.id));
  groups.execute(sender, { action: 'create', id: groupId, name: roomName });
  const roster = scenario.setup?.extraAstraChi
    ? [
        ...suite.roster,
        { ...suite.roster.find(({ id }) => id === 'binh-astra')!, id: 'chi-astra', owner: 'Chi' },
      ]
    : suite.roster;
  const roomOwners = new Set(roster.map(({ owner }) => owner));
  if (scenario.setup?.pairedMacByLan) roomOwners.add('Lan');
  const bindings: BoundTeammate[] = [];
  for (const name of roomOwners) {
    const owner = actors.get(name)!;
    if (owner !== sender) {
      send(sender, { action: 'invite', account: name });
      send(owner, { action: 'accept' });
    }
    const teammates = roster
      .filter((entry) => entry.owner === name)
      .map((member) => ({
        member,
        grantId: randomUUID(),
        localId: randomUUID(),
      }));
    send(owner, {
      action: 'teammates',
      teammates: teammates.map(({ member, localId }) => ({
        localId,
        name: member.name,
        provider: member.provider,
      })),
    });
    for (const { member, grantId, localId } of teammates) {
      const grantState = scenario.setup?.grantState?.[member.id];
      send(owner, {
        action: 'sade-grant',
        id: grantId,
        teammateId: localId,
        projectKey:
          grantState === 'other-project'
            ? createHash('sha256').update(`${groupId}:unrelated`).digest('hex')
            : projectKey,
        projectName: 'Acceptance workspace',
        role: 'engineer',
        platform: member.platform,
        ...(member.id === 'binh-astra' && scenario.setup?.pairedMacByLan
          ? { pairedPlatform: 'darwin', pairedMachineName: 'Mac của Lan' }
          : {}),
        allowWrites: member.allowWrites && grantState !== 'read-only',
        turns: 10,
      });
      if (grantState === 'revoked') send(owner, { action: 'sade-revoke', grantId });
      else if (grantState !== 'other-project') bindings.push({ member, grantId });
    }
  }
  if (scenario.reference)
    send(actors.get('Bình') || sender, {
      action: 'message',
      id: randomUUID(),
      content: scenario.reference,
    });
  return { groupId, projectKey, roomName, bindings };
}

type ProviderUsage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
};

function recordUsage(trace: CaseTrace, usage: ProviderUsage | undefined) {
  const input = usage?.input_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens;
  const output = usage?.output_tokens;
  const reasoning = usage?.output_tokens_details?.reasoning_tokens;
  if (Number.isInteger(input)) trace.inputTokens = input;
  if (Number.isInteger(cached)) trace.cachedInputTokens = cached;
  if (Number.isInteger(output)) trace.outputTokens = output;
  if (Number.isInteger(reasoning)) trace.reasoningTokens = reasoning;
}

function recordProviderDecision(trace: CaseTrace, decision: unknown) {
  if (decision === 'plan' || decision === 'question' || decision === 'no-work')
    trace.providerDecision = decision;
}

function recordResponsesDecision(
  trace: CaseTrace,
  output: { type?: string; content?: { type?: string; text?: string }[] }[] | undefined,
) {
  if (!Array.isArray(output)) return;
  const text = output
    .filter(({ type }) => type === 'message')
    .flatMap(({ content }) => content ?? [])
    .filter(({ type }) => type === 'output_text')
    .map(({ text }) => text)
    .join('');
  if (text) recordProviderDecision(trace, JSON.parse(text)?.decision);
}

function stageProviderProbe() {
  if (offline) process.env.SADE_OPENAI_API_KEY = 'local-test-credential-no-external-request';
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const responsesCall = url.href === responsesEndpoint;
    const providerCall = responsesCall
      ? responses || hybrid
      : url.href === decisionsEndpoint && !responses;
    if (providerCall) {
      if (!busyCase)
        throw new Error('Unexpected model invocation outside a measured acceptance case.');
      if ((init?.method ?? (input instanceof Request ? input.method : 'GET')) !== 'POST')
        throw new Error(`A measured case requires a ${providerName} POST.`);
      if (++busyCase.providerCalls !== 1)
        throw new Error('A measured case may only make one provider call.');
      busyCase.providerRoute = responsesCall ? 'responses-standard-medium' : 'decisions';
      const request = JSON.parse(String(init?.body));
      if (request.model !== 'gpt-6-luna') throw new Error('The gate requires GPT-6 Luna.');
      if (responsesCall) {
        if (request.service_tier !== 'default' || request.reasoning?.effort !== 'medium')
          throw new Error('Responses requires GPT-6 Luna with Standard service and medium effort.');
        busyCase.planningBasis = 'responses-proposal';
      }
      const additionalQuestions = responsesCall
        ? []
        : (request.questions as { name: string; choices: { value: string }[] }[]).filter(
            ({ name }) => name !== 'sade_decision',
          );
      if (!responsesCall) {
        busyCase.semanticQuestions = additionalQuestions.length;
        const facts = JSON.parse(
          request.input.find(({ role }: { role: string }) => role === 'user').content,
        );
        busyCase.planningBasis = Array.isArray(facts.proposedSequence)
          ? 'grounded-plan'
          : additionalQuestions.length > 0
            ? 'semantic-choices'
            : typeof facts.verifiedClarification === 'string'
              ? 'verified-clarification'
              : 'intent-only';
        if (additionalQuestions.length)
          busyCase.semanticSpec = createHash('sha256')
            .update(JSON.stringify(additionalQuestions))
            .digest('hex');
      }
      if (offline) {
        const choice = smoke ? 'plan' : replayDecision?.providerDecision;
        if (!choice) throw new Error('No recorded decision available to replay.');
        busyCase.providerDecision = choice;
        const optional = additionalQuestions.map(({ name, choices }) => {
          const recorded =
            replayDecision?.semanticSpec === busyCase?.semanticSpec
              ? replayDecision?.semanticChoices?.[name]
              : undefined;
          const chosen =
            choices.find(({ value }) => value === recorded) ||
            choices.find(({ value }) => value === 'no_match');
          if (!chosen) throw new Error(`No safe replay value for ${name}`);
          return { type: 'choice', name, choice: chosen.value };
        });
        return Response.json({
          status: 'completed',
          model: 'gpt-6-luna',
          answers: [
            {
              type: 'choice',
              name: 'sade_decision',
              choice,
            },
            ...optional,
          ],
        });
      }
    } else if (url.hostname === 'api.openai.com') {
      throw new Error(`Expected ${providerName} at the selected endpoint.`);
    }
    if (offline && url.hostname !== '127.0.0.1')
      throw new Error('Offline verification may only contact the local coordinator.');
    const response = await nativeFetch(input, init);
    const trace = busyCase;
    if (trace && providerCall) {
      trace.providerHttp = response.status;
      if (response.ok) {
        providerObservation = response
          .clone()
          .json()
          .then((reply) => {
            recordUsage(trace, reply?.usage);
            if (reply?.status === 'completed' || reply?.status === 'incomplete')
              trace.providerStatus = reply.status;
            const incomplete = reply?.incomplete_details?.reason;
            if (incomplete === 'max_output_tokens' || incomplete === 'content_filter')
              trace.providerIncompleteReason = incomplete;
            if (responsesCall) {
              recordResponsesDecision(trace, reply?.output);
              return;
            }
            const routing = Array.isArray(reply?.answers)
              ? reply.answers.find((answer: { name?: string }) => answer.name === 'sade_decision')
              : undefined;
            recordProviderDecision(trace, routing?.choice);
            const confidence = routing?.confidence;
            if (typeof confidence === 'number' && confidence >= 0 && confidence <= 1)
              trace.providerConfidence = confidence;
            if (Array.isArray(reply?.answers) && reply.answers.length > 1) {
              const choices = (
                reply.answers as { type?: string; name?: string; choice?: string }[]
              ).flatMap(({ type, name, choice }) =>
                type === 'choice' &&
                typeof name === 'string' &&
                name !== 'sade_decision' &&
                typeof choice === 'string'
                  ? [[name, choice] as const]
                  : [],
              );
              trace.semanticChoices = Object.fromEntries(choices);
            }
          })
          .catch(() => {});
      }
    }
    if (busyCase && url.pathname === sharedSadeCloudFinishPath && response.ok) busyCase.receipt++;
    return response;
  };
}

try {
  if (responses || hybrid) process.env.SADE_OPENAI_API_ROUTE = providerRoute;
  else delete process.env.SADE_OPENAI_API_ROUTE;
  await new Promise<void>((resolve, reject) =>
    gateway.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const gatewayAddress = gateway.address();
  if (!gatewayAddress || typeof gatewayAddress === 'string')
    throw new Error('Missing loopback gateway address.');
  const origin = `http://127.0.0.1:${gatewayAddress.port}`;
  process.env.RELAY_PUBLIC_ORIGIN = origin;
  app = await buildApp(workspace, {
    cloud: {
      origin,
      gatewaySecret,
      auth: {
        findUser: async (account) => {
          const owner = actors.get(account);
          return owner ? { ...owner, email: `${owner.id}@example.invalid` } : null;
        },
        authorized: async () => false,
        currentUser: async () => null,
        handler: async () => new Response(null, { status: 404 }),
        onPasswordReset() {},
        flushMail: async () => ({ failures: 0 }),
        async close() {},
      },
    },
  });
  app.addHook('onRequest', async (request) => {
    if (
      busyCase &&
      request.url === '/api/desktop/groups' &&
      ['1', sharedSadeCloudExtended].includes(String(request.headers[sharedSadeCloudHeader]))
    )
      busyCase.admissions++;
  });
  const runnerOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
  const runnerModule = mock.module('../cloud/runner.ts', {
    exports: {
      cloudRunner: async () => ({ origin: runnerOrigin, secret: gatewaySecret }),
      forgetCloudRunner: () => {},
    },
  });
  const { default: handler } = await import('../api/gateway.ts');
  gateway.on('request', (request, response) => {
    response.once('finish', () => {
      const timing = response.getHeader('Server-Timing');
      if (busyCase && typeof timing === 'string') busyCase.timing = timing;
    });
    void handler(request, response);
  });
  stageProviderProbe();
  const data = path.join(directory, 'desktop');
  await mkdir(data);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !/^(?:SADE_OPENAI_|OPENAI_|SADE_QWEN_|DASHSCOPE_|VERCEL(?:_|$)|RELAY_(?:GATEWAY_SECRET|AUTH_SECRET|OWNER_PASSWORD|PUBLIC_ORIGIN)$|ELECTRON_RUN_AS_NODE$)/i.test(
          key,
        ),
    ),
  ) as Record<string, string>;
  Object.assign(env, {
    RELAY_DESKTOP_TESTING: '1',
    RELAY_DESKTOP_DATA_DIR: data,
    RELAY_NODE_BINARY: process.execPath,
    RELAY_CLOUD_ORIGIN: origin,
  });
  desktop = await electron.launch({ args: [path.resolve('desktop')], env, timeout: 60_000 });
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).relayDesktop));
  const lockedOrigin = new URL(page.url()).origin;
  const pending = await page.evaluate(() => (window as any).relayDesktop.beginSignIn());
  new DesktopIdentity(coordinatorStore, origin).approve(pending.pending.userCode, sender);
  await page.waitForURL((url) => url.origin !== lockedOrigin, { timeout: 30_000 });
  await page.evaluate(() => sessionStorage.setItem('kivuno-guide-v3', 'seen'));
  await page.reload();
  const findDevice = () =>
    coordinatorStore
      .all<DesktopDevice>('desktopDevice')
      .find((device) => device.owner?.id === sender.id);
  await expect.poll(() => Boolean(findDevice()), { timeout: 15_000 }).toBe(true);
  const deviceByOwner = new Map([[sender.id, findDevice()!.id]]);
  for (const owner of actors.values())
    if (owner !== sender) {
      const id = randomUUID();
      coordinatorStore.put<DesktopDevice>('desktopDevice', {
        id,
        owner,
        name: 'Isolated team fixture',
        revoked: false,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      deviceByOwner.set(owner.id, id);
    }
  const rooms = suite.cases.map((scenario) => buildRoom(scenario, deviceByOwner));
  await expect(page.getByRole('complementary', { name: 'Chat list' })).toBeVisible({
    timeout: 15_000,
  });
  const outcomes = [];
  let previousClick = -Infinity;
  for (const [index, scenario] of suite.cases.entries()) {
    const { groupId, projectKey, roomName, bindings } = rooms[index];
    await page
      .getByRole('navigation', { name: 'Chats by latest activity', exact: true })
      .getByRole('button', { name: `Open group ${roomName}`, exact: true })
      .click({ timeout: 8_000 });
    await expect(page.getByRole('heading', { name: roomName, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sade progress' })).toHaveCount(0);
    if (scenario.reference) await page.getByRole('button', { name: 'Ask Sade about this' }).click();
    await page.getByLabel('Ask Sade in this group').selectOption(projectKey);
    await page.getByLabel('Message group', { exact: true }).fill(scenario.message);
    await watchDecision(page);
    // Respect the coordinator's rolling per-owner admission limit. Setup and pacing are outside the measured interval.
    if (replay) coordinatorStore.db.prepare('DELETE FROM shared_sade_cloud_usage').run();
    else await pause(Math.max(0, 5_500 - (performance.now() - previousClick)));
    if (ledger) await appendFile(ledger, `${hashes[index]}\n`);
    busyCase = { admissions: 0, providerCalls: 0, receipt: 0, timing: '' };
    replayDecision = replayDecisions.get(scenario.id);
    providerObservation = undefined;
    previousClick = performance.now();
    const button = page.getByRole('button', { name: 'Ask Sade', exact: true });
    let elapsed: number | null = null;
    let error: string | undefined;
    let run: RecordedRun | undefined;
    try {
      await button.click({ timeout: thresholdMs });
      await page.waitForFunction(() => (window as any).__sadeGate?.visible > 0, undefined, {
        timeout: thresholdMs + 1_500,
      });
      const visible = await page.evaluate(
        () =>
          (window as any).__sadeGate as {
            started: number;
            visible: number;
            text: string;
            labels: string[];
          },
      );
      elapsed = visible.visible - visible.started;
      run = coordinatorStore
        .all<RecordedRun>('sharedSadeRun')
        .find((item) => item.groupId === groupId);
      error = checkDecision(scenario.expected, run, bindings, visible);
      if (!error && !(elapsed < thresholdMs))
        error = `Decision reached or exceeded the strict ${thresholdMs} ms budget`;
    } catch {
      error = 'No final UI decision observed within the timeout';
    }
    if (
      !error &&
      (busyCase.admissions !== 1 || busyCase.providerCalls !== 1 || busyCase.receipt !== 1)
    )
      error = `Expected one hosted admission, ${providerName} call and accepted coordinator receipt`;
    await providerObservation;
    const classificationError =
      busyCase.providerDecision === scenario.expected.decision
        ? undefined
        : `Expected Luna decision ${scenario.expected.decision}, received ${busyCase.providerDecision ?? 'none'}`;
    const observedTasks =
      error &&
      run?.jobs.flatMap(({ task, grantId, fallbackOnProviderQuota }) =>
        task
          ? [
              {
                key: task.key,
                kind: task.kind,
                member: bindings.find((binding) => binding.grantId === grantId)?.member.id,
                scope: task.scope,
                after: task.dependsOn,
                platform: task.requiredPlatform,
                pairedMachineName: task.requiredPairedMachineName,
                askBeforeEditing: task.askBeforeEditing,
                editIfMissingAfter: task.editIfMissingAfter,
                waitForProviderQuota: task.waitForProviderQuota,
                fallbackOnProviderQuota,
                testOnly: task.testOnly,
                title: task.title,
                instructions: [task.description, task.acceptance].join('\n'),
              },
            ]
          : [],
      );
    outcomes.push({
      id: scenario.id,
      expected: scenario.expected.decision,
      elapsed,
      ...busyCase,
      runState: run?.state,
      planState: run?.jobs.find(({ phase }) => phase === 'plan')?.state,
      ...(error ? { planSummary: run?.jobs.find(({ phase }) => phase === 'plan')?.summary } : {}),
      ...(observedTasks && observedTasks.length ? { observedTasks } : {}),
      orchestrationError: error,
      classificationError,
      error: error ?? classificationError,
    });
    busyCase = undefined;
    if (evidenceDirectory)
      await writeFile(
        path.join(evidenceDirectory, `${suite.suiteId}.json`),
        JSON.stringify(
          {
            suiteId: suite.suiteId,
            liveProvider: !smoke,
            providerRoute,
            thresholdMs,
            topology: `Electron, loopback gateway and coordinator, hosted ${providerName}`,
            platform: process.platform,
            rows: outcomes,
          },
          null,
          2,
        ),
      );
  }
  const passed = outcomes.filter(({ error }) => !error).length;
  console.log(
    JSON.stringify({
      mode: smoke
        ? 'synthetic transport smoke'
        : replay
          ? 'recorded-decision replay'
          : 'live-provider',
      provider: `${providerName} (gpt-6-luna)`,
      thresholdMs,
      passed,
      attempted: outcomes.length,
      required: suite.cases.length,
      maxLatencyMs: Math.max(0, ...outcomes.map(({ elapsed }) => elapsed ?? 0)),
      ...(replay
        ? { failures: outcomes.filter(({ error }) => error) }
        : { failure: outcomes.find(({ error }) => error) }),
    }),
  );
  process.exitCode = passed === suite.cases.length ? 0 : 1;
  runnerModule.restore();
} finally {
  globalThis.fetch = nativeFetch;
  if (offline) delete process.env.SADE_OPENAI_API_KEY;
  if (originalProviderRoute === undefined) delete process.env.SADE_OPENAI_API_ROUTE;
  else process.env.SADE_OPENAI_API_ROUTE = originalProviderRoute;
  await desktop?.close();
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  await app?.close();
  coordinatorStore.close();
  if (
    path.dirname(directory) === path.resolve(os.tmpdir()) &&
    path.basename(directory).startsWith('kivuno-sade-live-')
  )
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
