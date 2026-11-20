// Production React UI with two separate local stores and the real cloud group
// service. Only desktop transport/identity is a fixture; no real invitations.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { SharedGroups } from '../server/collaboration.ts';
import { CodexClient } from '../server/codex.ts';
import { randomUUID } from 'node:crypto';
import type { SharedDelivery } from '../server/group-sade.ts';
import type { SharedGroup } from '../shared/collaboration.ts';

class LoginClient extends CodexClient {
  override readonly provider: 'codex' | 'gemini';
  signedIn = false;
  loginId = randomUUID();
  release!: () => void;
  catalog = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  constructor(provider: 'codex' | 'gemini', home: string) {
    super({ home, cwd: home });
    this.provider = provider;
  }
  override async start() {}
  override async stop() {
    this.release();
  }
  override async request<T = any>(method: string): Promise<T> {
    if (method === 'plugin/installed') {
      await this.catalog;
      return { marketplaces: [] } as T;
    }
    if (method === 'account/login/start')
      return {
        type: this.provider === 'codex' ? 'chatgpt' : 'geminiGoogle',
        loginId: this.loginId,
        ...(this.provider === 'codex' ? { authUrl: 'https://auth.openai.com/test-fixture' } : {}),
      } as T;
    if (method === 'account/read')
      return {
        account: this.signedIn
          ? {
              type: this.provider === 'codex' ? 'chatgpt' : 'gemini-google',
              email: `${this.provider}@example.test`,
            }
          : null,
      } as T;
    if (method === 'skills/list')
      return { data: [{ skills: [{ name: 'my-profile-skill', enabled: true }] }] } as T;
    return {} as T;
  }
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'kivuno-group-ui-'));
const cloud = new Store(path.join(dir, 'groups.db'));
const users = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
];
const groups = new SharedGroups(
  cloud,
  (account) =>
    users.find((user) => user.id === account || `${user.id}@example.test` === account) || null,
);
const browser = await chromium.launch();
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: Store[] = [];
const workspaces: Workspace[] = [];
const errors: string[] = [];
const fixture = async (index: number) => {
  const user = users[index];
  const deviceId = randomUUID();
  cloud.put('desktopDevice', {
    id: deviceId,
    owner: user,
    revoked: false,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });
  const directory = path.join(dir, user.id);
  await mkdir(directory);
  const store = new Store(path.join(directory, 'workspace.db'));
  stores.push(store);
  const workspace = new Workspace(store, directory, directory);
  workspaces.push(workspace);
  workspace.autonomy.ready = async () => {};
  workspace.client = async (id) => {
    let client = workspace.clients.get(id);
    if (!client) {
      client = new LoginClient(
        store.members().find((member) => member.id === id)?.provider === 'gemini'
          ? 'gemini'
          : 'codex',
        directory,
      );
      workspace.clients.set(id, client);
    }
    return client;
  };
  workspace.runtime.codexAvailable = true;
  workspace.autonomy.addAccount('codex');
  workspace.store.updateMember(workspace.store.members()[0].id, { name: `${user.name} Codex` });
  const app = await buildApp(workspace, { distDir: path.resolve('dist') });
  apps.push(app);
  const context = await browser.newContext();
  await context.addInitScript(`
    sessionStorage.setItem('kivuno-guide-v3', 'seen');
    const reservedProfiles = new Set();
    window.relayDesktop = {
      platform: 'win32', version: '0.8.5', getStatus: async () => ({ signedIn: true, runtime: 'ready', owner: ${JSON.stringify(user)}, cloudOrigin: location.origin }),
      prepareProvider: async (provider) => ({ provider, available: true }),
      profiles: async ({action, profileId}) => {
        if (action === 'sync') return { lockedIds: [] };
        if (action === 'reserve') { reservedProfiles.add(profileId); return { reserved: true }; }
        if (action === 'release') { reservedProfiles.delete(profileId); return { released: true }; }
        if (action === 'commit' && reservedProfiles.delete(profileId)) return { committed: true };
        throw new Error('Missing profile reservation in the desktop fixture');
      },
      onStatus: () => () => {}, getWindowState: async () => ({ maximized: false, fullscreen: false }), onWindowState: () => () => {}, controlWindow: async () => ({}),
      groups: async (input) => {
        const response = await fetch('/__groups', { method: 'POST', body: JSON.stringify(input) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
      }, openExternal: async () => {},
    };
  `);
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname === '/__groups') {
      try {
        await route.fulfill({ json: groups.execute(user, req.postDataJSON(), deviceId) });
      } catch (cause) {
        await route.fulfill({ status: 403, json: { error: (cause as Error).message } });
      }
      return;
    }
    if (url.pathname === '/api/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const result = await app.inject({
        method: req.method() as 'GET',
        url: url.pathname + url.search,
        headers: {
          ...(await req.allHeaders()),
          host: '127.0.0.1:4317',
          origin: 'http://127.0.0.1:4317',
        },
        ...(req.postData() ? { payload: req.postData()! } : {}),
      });
      await route.fulfill({
        status: result.statusCode,
        headers: Object.fromEntries(
          Object.entries(result.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
        ),
        body: result.body,
      });
      return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const mime: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
    };
    await route.fulfill({
      contentType: mime[path.extname(file)] || 'application/octet-stream',
      body: await readFile(path.join('dist', file)),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4317/#mesh');
  const guide = page.getByRole('button', { name: 'Đóng hướng dẫn', exact: true });
  if (await guide.isVisible()) await guide.click();
  try {
    await page.getByRole('button', { name: 'Groups', exact: true }).click({ timeout: 12000 });
  } catch (error) {
    console.error(await page.locator('body').innerText(), errors);
    throw error;
  }
  return { page, store, workspace, deviceId };
};
try {
  const a = await fixture(0),
    b = await fixture(1);
  await a.page.getByLabel('New group name').fill('Shared research');
  await a.page.getByRole('button', { name: 'Create group', exact: true }).click();
  await a.page.getByRole('button', { name: 'Members', exact: true }).click();
  await a.page.getByLabel('Kivuno account email or ID').fill('bob@example.test');
  await a.page.getByRole('button', { name: 'Invite account', exact: true }).click();
  await a.page.getByRole('checkbox', { name: 'Alice Codex · codex', exact: true }).check();
  await a.page.getByRole('button', { name: 'Save my teammates', exact: true }).click();
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.page
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click({ timeout: 15000 });
  await b.page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(
    b.page.getByRole('group', { name: 'Your teammates' }).getByRole('checkbox'),
  ).toHaveCount(1);
  await b.page.getByRole('checkbox', { name: 'Bob Codex · codex', exact: true }).check();
  await b.page.getByRole('button', { name: 'Save my teammates', exact: true }).click();
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(a.page.getByLabel('Shared teammates')).toContainText('Bob Codex');
  await expect(a.page.getByLabel('Shared teammates')).toContainText('Alice Codex');
  await a.page.getByLabel('Message group', { exact: true }).fill('Hello from Alice');
  await a.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(b.page.getByRole('log', { name: 'Group messages' })).toContainText(
    'Hello from Alice',
  );
  await b.page.getByLabel('Message group', { exact: true }).fill('Reply from Bob');
  await b.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(a.page.getByRole('log', { name: 'Group messages' })).toContainText('Reply from Bob');
  await a.page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(a.page.getByRole('region', { name: 'All chats' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Open group Shared research', exact: true }).click();
  await expect(a.page.getByRole('log', { name: 'Group messages' })).toContainText('Reply from Bob');
  await a.page.screenshot({ path: '.local/kivuno-07-groups.png' });
  await b.page.reload();
  await b.page.getByRole('button', { name: 'Groups', exact: true }).click();
  await b.page.getByRole('button', { name: 'Shared research', exact: true }).click();
  await expect(b.page.getByRole('log')).toContainText('Hello from Alice');

  const group = cloud.all<SharedGroup>('sharedGroup')[0];
  const grantId = randomUUID();
  const projectKey = 'a'.repeat(64);
  const dispatch = (input: object) => groups.execute(users[0], input, a.deviceId);
  dispatch({
    action: 'sade-grant',
    groupId: group.id,
    id: grantId,
    teammateId: group.teammates.find((member) => member.ownerId === users[0].id)!.localId,
    projectKey,
    projectName: 'Group demo',
    role: 'engineer',
    platform: 'win32',
    allowWrites: true,
    turns: 4,
  });
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.getByLabel('Ask Sade in this group').selectOption(projectKey);
  await a.page.getByLabel('Read-only request').check();
  await a.page.getByLabel('Message group', { exact: true }).fill('Check the current plan.');
  await a.page.getByRole('button', { name: 'Ask Sade', exact: true }).click();
  await expect(a.page.getByLabel('Ask Sade in this group')).toHaveValue('');
  await expect(a.page.getByLabel('Read-only request')).toHaveCount(0);
  await a.page.getByLabel('Message group', { exact: true }).fill('Cảm ơn, nghe rõ rồi.');
  await a.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(b.page.getByRole('log')).toContainText('Cảm ơn, nghe rõ rồi.');
  assert.equal(cloud.all('sharedSadeRun').length, 1);
  const poll = (
    active: string[] = [],
    readUpdates?: { jobId: string; through: number }[],
    waitingForCapacity?: string[],
  ) =>
    dispatch({
      action: 'sade-poll',
      grants: [grantId],
      active,
      taskUpdates: true,
      readUpdates,
      waitingForCapacity,
    });
  const firstPlan = (poll() as { delivery: SharedDelivery }).delivery;
  assert.ok(firstPlan.team.length);
  assert.ok(firstPlan.team.every(({ allowWrites }) => !allowWrites));
  const question = 'Should Alice Codex or Bob Codex check the plan?';
  dispatch({
    action: 'sade-finish',
    jobId: firstPlan.id,
    result: { kind: 'question', summary: question },
  });
  const progress = a.page.getByRole('region', { name: 'Sade progress' });
  const peerProgress = b.page.getByRole('region', { name: 'Sade progress' });
  for (const { page } of [a, b])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(peerProgress).toContainText(question);
  await expect(peerProgress.getByLabel('Reply to Sade')).toHaveCount(0);
  const clarification = progress.getByLabel('Reply to Sade');
  await clarification.fill('Alice Codex should check the plan.');
  await progress.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(clarification).toHaveCount(0);
  const plan = (poll() as { delivery: SharedDelivery }).delivery;
  assert.notEqual(plan.id, firstPlan.id);
  assert.equal(plan.clarification?.answer, 'Alice Codex should check the plan.');
  dispatch({
    action: 'sade-finish',
    jobId: plan.id,
    result: {
      kind: 'plan',
      plan: {
        summary: 'Check the current plan.',
        tasks: [
          {
            key: 'inspect',
            title: 'Check the current plan',
            description: 'Read the project plan.',
            kind: 'research',
            effort: 1,
            scope: ['README.md'],
            acceptance: 'Summarize the current plan.',
            dependsOn: [],
            stage: 'Review',
          },
        ],
      },
    },
  });
  const task = (poll() as { delivery: SharedDelivery }).delivery;
  await expect(
    progress.getByRole('listitem').filter({ hasText: /^Check the current plan\s+·/ }),
  ).toContainText('Alice Codex · Alice');
  poll([task.id], undefined, [task.id]);
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const capacityStatus = peerProgress.getByText(
    'Waiting for the teammate’s desktop to finish other work.',
  );
  await expect(capacityStatus).toBeVisible();
  poll([task.id]);
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(capacityStatus).toHaveCount(0);
  await progress.getByRole('button', { name: 'Update task', exact: true }).click();
  await progress.getByLabel('Task update', { exact: true }).fill('Use the revised checklist.');
  await progress.getByRole('button', { name: 'Send update', exact: true }).click();
  await expect(progress.getByText('0/1 task updates read')).toBeVisible();
  const notes = (poll([task.id]) as { updates: { jobId: string; notes: { text: string }[] }[] })
    .updates;
  assert.equal(notes[0]?.jobId, task.id);
  assert.equal(notes[0]?.notes[0]?.text, 'Use the revised checklist.');
  poll([task.id], [{ jobId: task.id, through: 1 }]);
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(progress.getByText('1/1 task updates read')).toBeVisible();
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(peerProgress.getByText('1/1 task updates read')).toBeVisible();
  await expect(peerProgress.getByRole('button', { name: 'Update task', exact: true })).toHaveCount(
    0,
  );

  await a.page.getByRole('button', { name: 'Members', exact: true }).click();
  await a.page.getByRole('button', { name: 'Remove Bob', exact: true }).click();
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(b.page.getByRole('log')).toHaveCount(0, { timeout: 10000 });
  await a.page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Team', exact: true })
    .click();
  for (const provider of ['codex', 'gemini'] as const) {
    await a.page.getByRole('button', { name: 'Add account', exact: true }).first().click();
    if (provider === 'gemini') {
      await a.page.getByRole('combobox', { name: 'AI provider' }).click();
      await a.page.getByRole('option', { name: 'Gemini', exact: true }).click();
    }
    await a.page
      .getByRole('button', {
        name: provider === 'codex' ? 'Connect Codex' : 'Connect Gemini',
        exact: true,
      })
      .click();
    const dialog = a.page.getByRole('dialog', {
      name: provider === 'codex' ? 'OpenAI sign-in' : 'Google sign-in',
    });
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '1');
    const memberId = a.workspace.loginOwner!;
    const client = a.workspace.clients.get(memberId) as LoginClient;
    client.signedIn = true;
    const started = Date.now();
    await a.workspace.notification(memberId, 'account/login/completed', {
      loginId: client.loginId,
      success: true,
    });
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible({
      timeout: 4000,
    });
    assert.ok(Date.now() - started < 4000);
    assert.equal(
      a.store.members().find((member) => member.id === memberId)?.capabilitiesLoading,
      true,
    );
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '3');
    client.release();
    await expect
      .poll(() => a.store.members().find((member) => member.id === memberId)?.skills)
      .toContain('my-profile-skill');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Group and sign-in UI passed: two isolated Kivuno accounts, create/invite/accept, messages, task updates and read receipts, reload persistence, membership revocation, Codex/Gemini login and skills loading. No model turns.',
  );
} finally {
  await browser.close();
  for (const app of apps) await app.close();
  for (const store of stores) store.close();
  cloud.close();
  assert.equal(path.dirname(dir), os.tmpdir());
  await rm(dir, { recursive: true, force: true });
}
