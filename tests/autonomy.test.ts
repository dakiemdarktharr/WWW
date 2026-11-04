import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { chooseModel, skillFiles } from '../server/autonomy.ts';
import { exportSkills, installSkills } from '../server/skill-sharing.ts';
import type { CodexModel, Project, CodexSession } from '../shared/types.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-autonomy-'));
  const store = new Store(path.join(root, 'state.db'));
  const host = new Workspace(store, root, root);
  t.after(async () => {
    await host.close();
    store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, store, host };
}
test('one-click profiles receive unique durable names and introductions stay inside the explicitly selected group', async (t) => {
  const { host, store } = await fixture(t);
  const a = host.autonomy.addAccount(),
    b = host.autonomy.addAccount();
  assert.equal(a.name, 'Atlas');
  assert.equal(b.name, 'Vega');
  assert.equal(a.managed, true);
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Challenge',
    goal: 'Test',
    path: process.cwd(),
    createdAt: new Date().toISOString(),
    memberIds: [a.id],
  } satisfies Project);
  host.autonomy.join();
  assert.equal(store.all('meshCursor').length, 0);
  store.updateMember(a.id, { account: { type: 'chatgpt', planType: 'plus' } });
  host.autonomy.join();
  host.autonomy.join();
  assert.equal(store.all('meshCursor').length, 1);
  assert.equal(store.all('message').length, 1);
  store.updateMember(b.id, { account: { type: 'chatgpt', planType: 'pro' } });
  host.autonomy.join(undefined, project.id);
  assert.equal(store.all('meshCursor').length, 1);
  host.mesh.setMembers(project.id, [a.id, b.id]);
  assert.equal(store.all('meshCursor').length, 2);
});
const model = (name: string, isDefault: boolean, levels: string[]): CodexModel => ({
  id: name,
  model: name,
  displayName: name,
  isDefault,
  defaultReasoningEffort: levels[0],
  supportedReasoningEfforts: levels.map((reasoningEffort) => ({
    reasoningEffort,
    description: '',
  })),
});
test('automatic model selection uses supported catalog values and increases reasoning for complex tasks', () => {
  const catalog = [
    model('general', true, ['medium', 'high']),
    model('mini', false, ['low', 'medium']),
  ];
  assert.deepEqual(
    Object.values(
      chooseModel(catalog, { kind: 'code', title: 'Security architecture', description: '' }),
    ).slice(0, 2),
    ['general', 'high'],
  );
  assert.deepEqual(
    Object.values(
      chooseModel(catalog, { kind: 'research', title: 'Summarize notes', description: '' }),
    ).slice(0, 2),
    ['mini', 'low'],
  );
  assert.throws(
    () => chooseModel([], { kind: 'code', title: 'Task', description: '' }),
    /no available/,
  );
  assert.equal(
    chooseModel([model('special', true, ['adaptive'])], {
      kind: 'review',
      title: 'Review',
      description: '',
    }).reasoningEffort,
    'adaptive',
  );
});
test('team skill distribution is versioned, bounded, preserves target files and excludes credentials', async (t) => {
  const { host, store } = await fixture(t);
  const source = host.autonomy.addAccount(),
    target = host.autonomy.addAccount();
  store.updateMember(source.id, { account: { type: 'chatgpt' } });
  store.put('project', {
    id: randomUUID(),
    name: 'Shared skill group',
    goal: '',
    path: host.defaultCwd,
    createdAt: new Date().toISOString(),
    memberIds: [source.id, target.id],
  } satisfies Project);
  const dir = path.join(host.home(source.id), 'skills', 'writing');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), '---\nname: writing\n---\nUse clear language.');
  await writeFile(path.join(dir, 'auth.json'), 'private-token');
  await writeFile(path.join(dir, '.env'), 'PASSWORD=secret');
  await host.autonomy.shareSkills(target.id);
  const installed = await readdir(path.join(host.home(target.id), 'skills'));
  assert.equal(installed.length, 1);
  const copied = path.join(host.home(target.id), 'skills', installed[0]);
  assert.deepEqual(await readdir(copied), ['SKILL.md']);
  assert.match(await readFile(path.join(copied, 'SKILL.md'), 'utf8'), /clear language/);
  await host.autonomy.shareSkills(target.id);
  assert.equal(store.all('skillReceipt').length, 1);
  await writeFile(path.join(dir, 'key.md'), '-----BEGIN PRIVATE KEY-----');
  await assert.rejects(skillFiles(dir), /credentials/);
});

test('automatic sharing skips executable skills and plugin inventory never installs code', async (t) => {
  const { host, store } = await fixture(t);
  const member = host.autonomy.addAccount();
  const dir = path.join(host.home(member.id), 'skills', 'executable');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), 'Run scripts only after approval.');
  await writeFile(path.join(dir, 'helper.js'), 'process.exit(0)');
  assert.deepEqual(await exportSkills(host.home(member.id)), []);
  host.client = async () => {
    throw new Error('Plugin install must not call the provider');
  };
  store.updateMember(member.id, { plugins: ['helpful-plugin'] });
  await host.autonomy.sharePlugins(member.id);
  assert.equal(store.all('pluginReceipt').length, 0);
  assert.equal(store.all('capabilitySnapshot').length, 1);
});
test('capacity reservations include preflight work and release independently of persisted running sessions', async (t) => {
  const { host, store } = await fixture(t);
  const releases = Array.from({ length: host.autonomy.capacity }, (_, index) =>
    host.autonomy.reserve(`preflight-${index}`),
  );
  assert.throws(() => host.autonomy.reserve('overflow'), /capacity/);
  releases[0]();
  const release = host.autonomy.reserve('next');
  release();
  releases.forEach((fn) => fn());
  store.put('session', { id: 'running', status: 'running' } as CodexSession);
  const active = host.autonomy.reserve('running');
  active();
  assert.equal(host.sessions.all()[0].status, 'running');
});
test('agent-created conversations stay in their project/account and cannot escalate a read-only parent', async (t) => {
  const { host, store } = await fixture(t);
  const member = host.autonomy.addAccount();
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Test',
    goal: 'Test',
    path: process.cwd(),
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const parent = await host.sessions.create({
    memberId: member.id,
    projectId: project.id,
    title: 'Parent',
    readOnly: true,
  });
  const child = await host.autonomy.conversation(parent.id, {
    title: 'Research child',
    prompt: 'Read requirements',
    readOnly: false,
  });
  assert.equal(child.projectId, project.id);
  assert.equal(child.memberId, member.id);
  assert.equal(child.readOnly, true);
  assert.equal(child.modelPolicy, 'auto');
  assert.equal(child.threadId, null);
  assert.equal(store.all<any>('conversationQueue')[0].status, 'queued');
});
test('skills imported from the machine remain eligible for sharing with another account', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'personal'),
    target = path.join(root, 'profile');
  await mkdir(path.join(source, 'skills', 'example'), { recursive: true });
  await writeFile(
    path.join(source, 'skills', 'example', 'SKILL.md'),
    'Use a bounded source review.',
  );
  await installSkills(target, await exportSkills(source), true);
  assert.equal((await exportSkills(target))[0].name, 'example');
});
