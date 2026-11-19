import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Member, PlanTask, TeamPlan } from '../shared/types.ts';
import {
  allocatePlan,
  parseProposal,
  parseTeamPlan,
  planTool,
  proposalTool,
} from '../server/workflow-plan.ts';

const task = (key: string, patch: Partial<PlanTask> = {}): PlanTask => ({
  key,
  title: `Implement ${key}`,
  description: `Implement and verify the scoped change for ${key}.`,
  kind: 'code',
  scope: [`src/${key}`],
  dependsOn: [],
  acceptance: 'The scoped behavior is implemented and verified.',
  effort: 3,
  stage: 'Implementation',
  ...patch,
});
const plan = (...tasks: PlanTask[]): TeamPlan => ({
  summary: 'A bounded workflow for the requested project change.',
  tasks,
});
const member = (id: string, role: Member['role'] = 'engineer'): Member => ({
  id,
  name: id,
  role,
  color: '#abcdef',
  status: 'ready',
  account: { type: 'chatgpt' },
  skills: [],
  plugins: [],
  rateLimits: null,
  createdAt: '2026-11-02T00:00:00.000Z',
});

test('plan validation returns prerequisites first without mutating the input', () => {
  const input = plan(
    task('ship', { dependsOn: ['test'] }),
    task('api'),
    task('test', { dependsOn: ['api', 'ui'] }),
    task('ui'),
  );
  const parsed = parseTeamPlan(input);
  assert.deepEqual(
    parsed.tasks.map((item) => item.key),
    ['api', 'ui', 'test', 'ship'],
  );
  assert.deepEqual(
    input.tasks.map((item) => item.key),
    ['ship', 'api', 'test', 'ui'],
  );
});

test('cycles, self references, unknown references and duplicate dependencies are rejected', () => {
  assert.throws(
    () =>
      parseTeamPlan(plan(task('one', { dependsOn: ['two'] }), task('two', { dependsOn: ['one'] }))),
    /cycle/,
  );
  assert.throws(() => parseTeamPlan(plan(task('one', { dependsOn: ['one'] }))), /itself/);
  assert.throws(
    () => parseTeamPlan(plan(task('one', { dependsOn: ['external'] }))),
    /Unknown dependency/,
  );
  assert.throws(
    () => parseTeamPlan(plan(task('one'), task('two', { dependsOn: ['one', 'one'] }))),
    /Duplicate dependency/,
  );
});

test('duplicate keys and normalized duplicate titles are rejected', () => {
  assert.throws(
    () => parseTeamPlan(plan(task('one'), task('one', { title: 'Another task' }))),
    /Duplicate task key/,
  );
  assert.throws(
    () =>
      parseTeamPlan(plan(task('one', { title: 'Add API' }), task('two', { title: ' add   api ' }))),
    /Duplicate task title/,
  );
});

test('plan scopes normalize Windows separators, redundant slash and duplicate paths', () => {
  const parsed = parseTeamPlan(plan(task('one', { scope: ['src\\api\\', 'src/api', 'docs/'] })));
  assert.deepEqual(parsed.tasks[0].scope, ['src/api', 'docs']);
  assert.deepEqual(parseTeamPlan(plan(task('one', { scope: ['src', '.'] }))).tasks[0].scope, ['.']);
});

test('private state, credentials, traversal, absolute paths and wildcard scopes are rejected', () => {
  for (const scope of [
    '.git',
    'src/.GIT/config',
    '.relay/state',
    '.ssh/id_rsa',
    '.aws/credentials',
    '.codex/auth.json',
    '.claude/settings.json',
    '.gemini/settings.json',
    'nested/.mcp.json',
    'auth.json',
    'src/auth.json',
    '.ENV.local',
    '.env',
    'src/../private',
    'C:\\private',
    '/private',
    'src/*.ts',
    '*',
  ]) {
    assert.throws(() => parseTeamPlan(plan(task('one', { scope: [scope] }))), scope);
  }
  assert.doesNotThrow(() =>
    parseTeamPlan(plan(task('one', { scope: ['src/auth.ts', '.env-example'] }))),
  );
});

test('Sade assigns unspecified work to usable specialists while preserving a named owner', () => {
  const roster = [member('a', 'designer'), member('b', 'engineer'), member('c', 'engineer')];
  const allocation = allocatePlan(
    plan(task('api'), task('ui', { kind: 'design' }), task('critical', { preferredMemberId: 'c' })),
    roster,
    { preferSpecialists: true, available: new Set(['a', 'b']) },
  );
  assert.deepEqual(
    allocation.map((item) => item.memberId),
    ['b', 'a', 'c'],
  );
});

test('Shared Sade accounts for named work and assigns a review outside the authors’ accounts', () => {
  const roster = [
    member('a-gemini', 'engineer'),
    member('b-astra', 'designer'),
    member('c-claude', 'engineer'),
    member('d-alternate-profile', 'reviewer'),
    member('e-teammate', 'researcher'),
  ];
  const ownerByMember = new Map([
    ['a-gemini', 'person-a'],
    ['b-astra', 'person-b'],
    ['c-claude', 'person-c'],
    ['d-alternate-profile', 'person-a'],
    ['e-teammate', 'person-e'],
  ]);
  const input = plan(
    task('architecture', { effort: 2, preferredMemberId: 'a-gemini' }),
    task('frontend', {
      kind: 'design',
      effort: 4,
      preferredMemberId: 'b-astra',
      dependsOn: ['architecture'],
    }),
    task('backend', { effort: 8, dependsOn: ['architecture'] }),
    task('review', { kind: 'review', scope: ['src'], dependsOn: ['architecture', 'backend'] }),
  );
  const options = { preferSpecialists: true, ownerByMember };
  assert.deepEqual(
    allocatePlan(input, roster, options).map(({ memberId }) => memberId),
    ['a-gemini', 'b-astra', 'c-claude', 'e-teammate'],
  );
  const selfReview = {
    ...input,
    tasks: input.tasks.map((item) =>
      item.key === 'review' ? { ...item, preferredMemberId: 'd-alternate-profile' } : item,
    ),
  };
  assert.throws(() => allocatePlan(selfReview, roster, options), /review their own work/);
});

test('Shared Sade excludes owners of overlapping writes through intermediate dependencies', () => {
  const roster = [
    member('a-writer', 'engineer'),
    member('a-reviewer', 'reviewer'),
    member('b-tester', 'researcher'),
    member('c-reviewer', 'reviewer'),
  ];
  const ownerByMember = new Map([
    ['a-writer', 'person-a'],
    ['a-reviewer', 'person-a'],
    ['b-tester', 'person-b'],
    ['c-reviewer', 'person-c'],
  ]);
  const input = plan(
    task('docs', { scope: ['docs'], preferredMemberId: 'c-reviewer' }),
    task('backend', { scope: ['src/signup.ts'], preferredMemberId: 'a-writer' }),
    task('test', {
      kind: 'research',
      scope: ['src/signup.ts'],
      dependsOn: ['docs', 'backend'],
      preferredMemberId: 'b-tester',
    }),
    task('audit', { kind: 'review', scope: ['src'], dependsOn: ['test'] }),
  );
  const options = { preferSpecialists: true, ownerByMember };
  assert.equal(allocatePlan(input, roster, options).at(-1)?.memberId, 'c-reviewer');
  const namedSelfReview = {
    ...input,
    tasks: input.tasks.map((item) =>
      item.key === 'audit' ? { ...item, preferredMemberId: 'a-reviewer' } : item,
    ),
  };
  assert.throws(() => allocatePlan(namedSelfReview, roster, options), /review their own work/);
  const namedTester = {
    ...input,
    tasks: input.tasks.map((item) =>
      item.key === 'audit' ? { ...item, preferredMemberId: 'b-tester' } : item,
    ),
  };
  assert.equal(allocatePlan(namedTester, roster, options).at(-1)?.memberId, 'b-tester');
});

test('strict schemas bound size and reject agent-selected owners or malformed estimates', () => {
  assert.throws(() => parseTeamPlan(plan()));
  assert.throws(() => parseTeamPlan(plan(...Array.from({ length: 33 }, (_, i) => task(`t${i}`)))));
  assert.throws(() => parseTeamPlan(plan({ ...task('one'), assignedTo: 'admin' } as PlanTask)));
  assert.throws(() => parseTeamPlan(plan(task('one', { effort: 0 }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { effort: 1.5 }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { effort: 9 }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { description: '   ' }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { acceptance: 'ok' }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { scope: [] }))));
  assert.throws(() => parseTeamPlan(plan(task('one', { title: 'x'.repeat(141) }))));
  assert.throws(() => parseTeamPlan(plan(task('INVALID'))));
});

test('all team members can contribute risks even without suggesting duplicate work', () => {
  const proposal = parseProposal({
    summary: 'Existing proposals cover implementation; focus on verification.',
    risks: ['Dependency changes require regression testing.'],
    suggestions: [],
  });
  assert.equal(proposal.suggestions.length, 0);
  assert.equal(proposal.risks.length, 1);
  const { key, description, dependsOn, stage, ...suggestion } = task('one');
  assert.deepEqual(
    parseProposal({ ...proposal, suggestions: [{ ...suggestion, scope: ['docs\\notes'] }] })
      .suggestions[0].scope,
    ['docs/notes'],
  );
  assert.throws(() =>
    parseProposal({ ...proposal, suggestions: [{ ...suggestion, scope: ['.env'] }] }),
  );
  assert.throws(() => parseProposal({ ...proposal, suggestions: Array(13).fill(suggestion) }));
  assert.throws(() => parseProposal({ ...proposal, risks: Array(13).fill('Some risk') }));
  assert.throws(() => parseProposal({ ...proposal, leadId: 'other-agent' }));
});

test('estimated effort is balanced before specialist preference, using the whole team', () => {
  const members = [member('a'), member('b', 'designer'), member('c', 'researcher')];
  const input = plan(
    task('first', { effort: 8 }),
    task('second', { effort: 7 }),
    task('third', { effort: 6 }),
    task('fourth', { effort: 3 }),
    task('fifth', { effort: 2 }),
    task('sixth', { effort: 1 }),
  );
  const allocation = allocatePlan(input, members);
  const load = new Map(members.map((person) => [person.id, 0]));
  for (const assignment of allocation) {
    const work = input.tasks.find((item) => item.key === assignment.key)!;
    load.set(assignment.memberId, load.get(assignment.memberId)! + work.effort);
  }
  assert.deepEqual([...load.values()], [9, 9, 9]);
  assert.deepEqual(allocation, allocatePlan(input, [...members].reverse()));
  assert.deepEqual(
    allocation.map((item) => item.key),
    input.tasks.map((item) => item.key),
  );
});

test('specialists win only equal-load ties and member ID makes ties deterministic', () => {
  const members = [member('a', 'researcher'), member('b', 'designer'), member('c', 'engineer')];
  const allocation = allocatePlan(plan(task('design', { kind: 'design' })), members);
  assert.equal(allocation[0].memberId, 'b');
  const single = allocatePlan(plan(task('code')), [member('z'), member('a')]);
  assert.equal(single[0].memberId, 'a');
  assert.equal(allocatePlan(plan(task('one')), [member('only')])[0].memberId, 'only');
  assert.throws(() => allocatePlan(plan(task('one')), []), /at least one/);
  assert.throws(
    () => allocatePlan(plan(task('one')), [member('same'), member('same')]),
    /duplicate/,
  );
});

test('dynamic tools advertise strict structured outputs and bounded task graphs', () => {
  assert.equal(proposalTool.name, 'relay_submit_proposal');
  assert.equal(planTool.name, 'relay_submit_plan');
  assert.equal(proposalTool.inputSchema.additionalProperties, false);
  assert.equal(planTool.inputSchema.properties.tasks.maxItems, 32);
  assert.equal(planTool.inputSchema.properties.tasks.items.additionalProperties, false);
  assert.ok(planTool.inputSchema.properties.tasks.items.required.includes('dependsOn'));
});
