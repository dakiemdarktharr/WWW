// Real production UI, HTTP routes, store, quota and dispatcher. Runtime execution
// is controlled; this suite never consumes a signed-in account's model usage.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { CodexClient } from '../server/codex.ts';
import type { CodexSession, RoomMessage } from '../shared/types.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-chat-'));
const store = new Store(path.join(root, 'workspace.db'));
const workspace = new Workspace(store, root, root);
const models = [
  {
    id: 'test-model',
    model: 'test-model',
    displayName: 'Controlled model',
    isDefault: true,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low' },
      { reasoningEffort: 'high', description: 'High' },
    ],
    defaultReasoningEffort: 'low',
  },
];
class Client extends CodexClient {
  override async start() {}
  override async stop() {}
  override async request<T = any>(method: string): Promise<T> {
    if (method === 'model/list') return { data: models } as T;
    if (method === 'account/read')
      return { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'pro' } } as T;
    if (method === 'account/rateLimits/read')
      return {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 91, windowDurationMins: 10080, resetsAt: 2_000_000_000 },
        },
      } as T;
    throw new Error(`Unexpected provider call: ${method}`);
  }
}
const client = new Client({ home: root, cwd: root });
workspace.client = async () => client;
workspace.runtime.codexAvailable = true;
const members = ['Atlas', 'Vega'].map((name) => {
  const member = store.addMember({ name, role: 'engineer' });
  return store.updateMember(member.id, {
    status: 'ready',
    account: { type: 'chatgpt', planType: 'pro' },
    maxSessions: 4,
  });
});
const project = store.put('project', {
  id: randomUUID(),
  name: 'Chat interactions',
  path: root,
  goal: 'Controlled UI regression',
  createdAt: new Date().toISOString(),
  memberIds: members.map((m) => m.id),
});
for (const member of members) {
  workspace.mesh.ensureMember(project.id, member.id);
  workspace.quota.ingest(member.id, {
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 91, windowDurationMins: 10080, resetsAt: 2_000_000_000 },
    },
  });
}
let starts = 0;
workspace.sessions.create = async (options) => {
  starts++;
  const task = store.addTask({
    projectId: project.id,
    title: options.title || `Chat request ${starts}`,
    description: options.prompt || '',
    kind: 'research',
    priority: 'medium',
    scope: [],
    dependsOn: [],
    acceptance: 'Explain the result',
    assignedTo: options.memberId,
  });
  const id = randomUUID(),
    now = new Date().toISOString();
  store.updateTask(task.id, { sessionId: id });
  return store.put('session', {
    id,
    projectId: project.id,
    taskId: task.id,
    memberId: options.memberId,
    provider: 'codex',
    title: 'Installer research',
    readOnly: true,
    status: 'running',
    threadId: 'controlled',
    turnId: 'controlled-turn',
    pid: null,
    error: null,
    modelPolicy: 'auto',
    createdAt: now,
    updatedAt: now,
  } satisfies CodexSession);
};
workspace.sessions.send = async (id) => store.updateSession(id, { status: 'running' });
const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve, reject) =>
  probe.close((error) => (error ? reject(error) : resolve())),
);
const app = await buildApp(workspace, { distDir: path.resolve('dist'), port });
await app.listen({ host: '127.0.0.1', port });
const origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(`
  sessionStorage.setItem('kivuno-guide-v3', 'seen');
  window.relayDesktop = { platform: 'win32', version: '0.8.1', getStatus: async () => ({ signedIn: true, runtime: 'ready', owner: { id: 'fixture', name: 'Fixture' }, cloudOrigin: location.origin }), onStatus: () => () => {}, getWindowState: async () => ({maximized:false,fullscreen:false}), onWindowState: () => () => {}, controlWindow: async () => ({}), openExternal: async () => {} };
`);
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`${origin}/#mesh`);
  const guide = page.getByRole('button', { name: 'Đóng hướng dẫn', exact: true });
  if (await guide.isVisible()) await guide.click();
  await expect(page.getByRole('region', { name: 'All chats' })).toBeVisible();
  await expect(page.getByLabel('Message the project team', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open project Chat interactions', exact: true }).click();
  const input = page.getByLabel('Message the project team', { exact: true });
  await input.fill('@');
  await expect(page.getByRole('listbox', { name: 'Group teammates' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('@Vega ');
  await input.fill('@Vega review installer recovery');
  await input.press('Enter');
  await expect(
    page.getByText('Team usage needs your decision', { exact: false }).first(),
  ).toBeVisible();
  assert.equal(starts, 0);
  await input.fill('/rea');
  await input.press('Escape');
  await expect(input).toHaveValue('/rea');
  await input.fill('Tôi cho phép Vega tiếp tục');
  await input.press('Enter');
  await expect(page.getByRole('log', { name: 'Project messages' })).toContainText(
    '9% remaining, already at or below your 20% stop limit',
  );
  assert.equal(starts, 0);
  await input.fill('@Vega I allow you to continue until 5% remaining');
  await input.press('Enter');
  await expect(page.getByLabel('sessions panel')).toBeVisible();
  await expect(page.getByLabel('Vega is working', { exact: true })).toBeVisible();
  assert.equal(starts, 1);
  const grant = store.all<any>('quotaGrant').find((item) => !item.revokedAt);
  assert.equal(grant.floor, 5);
  assert.ok(Date.parse(grant.expiresAt) - Date.now() <= 3600000);
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await page.getByLabel('Automatic model and reasoning', { exact: true }).uncheck();
  await page.getByLabel('Model', { exact: true }).selectOption('test-model');
  await page.getByLabel('Reasoning', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(store.sessions()[0].reasoningEffort, 'high');
  await page.getByRole('button', { name: 'Close context panel', exact: true }).click();
  const session = store.sessions()[0];
  const answer = workspace.mesh.post({
    projectId: project.id,
    authorId: members[1].id,
    sessionId: session.id,
    kind: 'message',
    content: 'Installer finding: recovery is verified.',
  });
  await expect(
    page.getByRole('log', { name: 'Project messages' }).getByText(answer.content, { exact: true }),
  ).toBeVisible();
  const bubble = page.locator('article').filter({ hasText: answer.content });
  await bubble.getByRole('button', { name: /react/i }).click();
  await bubble.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect
    .poll(() => store.get<RoomMessage>('message', answer.id).reactions?.[0]?.meaning)
    .toBe('agree');
  await bubble.getByRole('button', { name: 'Reply to Vega', exact: true }).click();
  await input.fill('Explain the recovery checkpoint');
  await input.press('Enter');
  await expect
    .poll(() =>
      store
        .all<RoomMessage>('message')
        .some(
          (entry) =>
            entry.replyTo === answer.id && entry.content === 'Explain the recovery checkpoint',
        ),
    )
    .toBe(true);
  assert.equal(starts, 1);
  await page.getByPlaceholder('Search this chat').fill('Installer finding');
  await expect(
    page.getByRole('log', { name: 'Project messages' }).getByText(answer.content, { exact: true }),
  ).toBeVisible();
  workspace.research.reader = async (url) => ({
    url,
    type: 'text/html',
    html: url.endsWith('/rules')
      ? '<p>Submit code and a three minute video before the published deadline.</p>'
      : '<h1>Competition research fixture with public resources</h1><a href="/rules">Rules</a>',
  });
  await input.fill('https://contest.example.org/');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Competition research', exact: true }).click();
  await expect(page.getByLabel('research panel')).toContainText('2 sources');
  await expect(page.getByLabel('research panel')).toContainText('unknown');
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.getByRole('region', { name: 'All chats' })).toBeVisible();
  await page.screenshot({
    path: '.local/kivuno-081-home.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    'Chat UI passed: mention keyboard, quota allowance, pending prompt, activity, auto Sessions, live model settings, reaction, reply, search; no model turns.',
  );
} catch (error) {
  console.error(await page.locator('body').innerText(), errors);
  throw error;
} finally {
  await browser.close();
  await workspace.close();
  await app.close();
  store.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('kivuno-chat-'));
  await rm(root, { recursive: true, force: true });
}
