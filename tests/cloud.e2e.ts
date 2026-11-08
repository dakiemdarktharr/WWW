// Production desktop UI with a preload fixture, real Fastify/SQLite/web owner auth.
// The hosted portal never renders a workspace. No Codex login or model turns.
import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import { createCloudIdentity } from '../server/cloud-auth.ts';

const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-cloud-browser-'));
const screenshots = path.join(os.tmpdir(), 'kivuno-ui-review');
await mkdir(screenshots, { recursive: true });
let reviewPage: Page | undefined;
const data = path.join(directory, 'state');
await mkdir(data);
const store = new Store(path.join(data, 'workspace.db'));
const workspace = new Workspace(store, data, directory);
workspace.login = async () => ({
  type: 'chatgptDeviceCode',
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'TEST-ONLY',
});
workspace.client = async () => {
  throw new Error('Sign in to this Codex account to read its available models.');
};
workspace.runtime.deployment = 'cloud';
const origin = 'https://relay.example';
const password = randomBytes(24).toString('hex');
const gatewaySecret = randomBytes(32).toString('hex');
const auth = await createCloudIdentity({
  directory: data,
  origin,
  secret: randomBytes(32).toString('hex'),
  bootstrapPassword: password,
});
const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth } });
const browser = await chromium.launch();
const errors: string[] = [],
  forbidden: string[] = [];
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
async function device() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  context.setDefaultTimeout(12000);
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('kivuno-guide-v3', 'seen');
      for (const key of [
        'local:intro',
        'cloud:intro',
        ...['mesh', 'sessions', 'team', 'settings', 'workroom', 'tasks', 'reviews'].map(
          (stage) => `stage:${stage}`,
        ),
      ])
        sessionStorage.setItem(`relay-guide-v2:${key}`, 'seen');
    } catch {
      /* about:blank has no storage */
    }
  });
  context.on('request', (req) => {
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(req.url())) forbidden.push(req.url());
  });
  context.on('page', (page) => page.on('pageerror', (e) => errors.push(e.message)));
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/events') {
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = await request.allHeaders();
      const response = await app.inject({
        method: request.method() as 'GET' | 'POST' | 'PATCH',
        url: url.pathname + url.search,
        headers: { ...headers, 'x-relay-gateway': gatewaySecret },
        ...(request.postData() ? { payload: request.postData()! } : {}),
      });
      await route.fulfill({
        status: response.statusCode,
        body: response.body,
        headers: Object.fromEntries(
          Object.entries(response.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value.join('\n') : String(value)]),
        ),
      });
      return;
    }
    await route.fulfill({
      body: await readFile(path.join('dist', url.pathname === '/' ? 'index.html' : url.pathname)),
      contentType: mime[path.extname(url.pathname)] || 'text/html',
      headers: Object.fromEntries(
        config.headers[0].headers.map((header: { key: string; value: string }) => [
          header.key,
          header.value,
        ]),
      ),
    });
  });
  return context;
}
async function login(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${origin}/?login`);
  await page.getByRole('button', { name: 'Chủ workspace cũ', exact: true }).click();
  await page.getByLabel('Mật khẩu chủ workspace').fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByLabel('Mã từ app desktop', { exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).count(), 0);
  // Only this test installs the native capability; production web has no preload.
  // Actual Electron and PKCE consent are covered separately by desktop/portal E2E.
  await context.addInitScript(`
    window.relayDesktop = {
      platform: 'win32',
      version: '0.6.2',
      getStatus: async () => ({
        signedIn: true,
        runtime: 'ready',
        cloudOrigin: location.origin,
        owner: { id: 'workspace-owner', name: 'Workspace owner' },
        machines: [],
      }),
      chooseDirectory: async () => null,
      openExternal: async () => {},
      openPreview: async () => {},
      signOut: async () => {},
      joinMachine: async () => null,
      stopMachine: async () => {},
      getWindowState: async () => ({ maximized: false, fullscreen: false }),
      controlWindow: async () => ({ maximized: false, fullscreen: false }),
      onWindowState: () => () => {},
        onStatus: () => () => {},
    };
  `);
  await page.goto(`${origin}/#mesh`);
  try {
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
  } catch (cause) {
    console.error(
      'Desktop fixture failed:',
      await page.evaluate(() => ({
        native: !!window.relayDesktop,
        text: document.body.innerText.slice(0, 1000),
      })),
      errors,
    );
    throw cause;
  }
  return page;
}
try {
  const first = await device(),
    second = await device();
  const page = await login(first);
  reviewPage = page;
  const nav = (name: string) =>
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true });
  async function advanced(name: string) {
    const details = page.locator('.advanced-nav');
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
      await details.locator('summary').click();
    await nav(name).click();
  }
  await nav('Team').click();
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await page.getByText('TEST-ONLY', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('heading', { name: 'Atlas', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'Connect project', exact: true });
  await project.getByLabel('Project type', { exact: true }).selectOption('hackathon');
  await project.getByLabel('Project name', { exact: true }).fill('Cloud project');
  await project.getByLabel('Project owner', { exact: true }).selectOption({ label: 'Atlas' });
  await project.getByLabel('Competition', { exact: true }).fill('Browser challenge');
  await project
    .getByLabel('Competition URL', { exact: true })
    .fill('https://example.com/challenge');
  await project
    .getByLabel('Shared goal', { exact: true })
    .fill('Verify real cloud workspace interactions');
  await expect(project.getByRole('combobox', { name: 'Deadline', exact: true })).toHaveText(
    'No deadline',
  );
  await expect(project.getByLabel('Deadline date and time')).toHaveCount(0);
  await project.getByRole('combobox', { name: 'Deadline', exact: true }).click();
  await project.getByRole('option', { name: 'Set deadline', exact: true }).click();
  await project.getByLabel('Deadline date and time').fill('2027-08-14T18:45');
  await project.getByRole('combobox', { name: 'Deadline', exact: true }).click();
  await project.getByRole('option', { name: 'No deadline', exact: true }).click();
  await expect(project.getByLabel('Deadline date and time')).toHaveCount(0);
  await project.getByRole('button', { name: 'Create project', exact: true }).click();
  await project.waitFor({ state: 'hidden' });
  assert.equal(store.projects()[0].repositoryName, 'NoSleepClub_Browser-challenge_Cloud-project');
  assert.equal(store.projects()[0].competition?.deadline, null);
  await nav('Neralu').click();
  await page.getByRole('button', { name: 'Open project Cloud project', exact: true }).click();
  await page.getByLabel('Message the project team').fill('Shared across devices');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Shared across devices', { exact: true }).waitFor();
  const message = page
    .locator('.chat-message')
    .filter({ has: page.getByText('Shared across devices', { exact: true }) });
  await message.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await message.getByRole('button', { name: 'Understood', exact: true }).click();
  await expect(message.getByRole('button', { name: 'Understood', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  assert.equal(
    workspace.snapshot().messages.find((item) => item.content === 'Shared across devices')
      ?.reactions?.[0]?.meaning,
    'understood',
  );
  await page.screenshot({ path: path.join(screenshots, 'chat-dark.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Use light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  await expect(page.locator('.project-chat')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(message.locator('.chat-bubble')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(message.locator('.chat-bubble')).toHaveCSS('border-top-color', 'rgb(23, 27, 29)');
  await expect(page.locator('.nav-item.active')).toHaveCSS('color', 'rgb(23, 52, 46)');
  await page.screenshot({ path: path.join(screenshots, 'chat-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Use dark mode', exact: true }).click();
  await page.getByLabel('Message the project team').fill('/g');
  await page.getByRole('option', { name: '/goal Set the project goal', exact: true }).click();
  await expect(page.getByLabel('Message the project team')).toHaveValue('/goal ');
  await page.getByLabel('Message the project team').fill('');
  await page.getByRole('button', { name: 'Group team', exact: true }).click();
  await page.getByRole('button', { name: /Edit group members/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Choose group members' }).getByRole('checkbox'),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save members', exact: true }).click();
  await page.getByRole('button', { name: 'Close context panel', exact: true }).click();
  await page.getByLabel('Message the project team').fill('Plan our next iteration');
  await page.getByRole('button', { name: 'Plan project', exact: true }).click();
  await expect(page.getByLabel('Team prompt', { exact: true })).toHaveValue(
    'Plan our next iteration',
  );
  await nav('Neralu').click();
  const other = await login(second);
  await other.getByText('Shared across devices', { exact: true }).waitFor();
  await advanced('Sessions');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const session = page.getByRole('dialog', { name: 'New agent session' });
  await session.getByLabel('Session title').fill('Saved conversation');
  await session.getByRole('button', { name: 'Create session', exact: true }).click();
  await session.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Saved conversation', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await session.getByLabel('Session title').fill('Research conversation');
  await session.getByRole('button', { name: 'Create session', exact: true }).click();
  await session.waitFor({ state: 'hidden' });
  assert.equal(store.sessions()[0].threadId, null);
  assert.equal(first.pages().length, 1); // All work happens inline, no runner popup.
  await other.reload();
  await other.locator('.advanced-nav > summary').click();
  await other
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Sessions', exact: true })
    .click();
  await other.getByRole('heading', { name: 'Saved conversation', exact: true }).waitFor();
  await nav('Neralu').click();
  await page.getByRole('button', { name: 'Session view', exact: true }).click();
  await expect(page.locator('.session-node')).toHaveCount(2);
  const researchNode = page.getByRole('button', {
    name: 'Research conversation, Atlas, idle',
    exact: true,
  });
  await researchNode.focus();
  await researchNode.press('Enter');
  await expect(researchNode).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Saved conversation, Atlas, idle', exact: true }).click();
  await page.getByRole('heading', { name: 'Saved conversation', exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'session-map.png') });
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByText('Mở trong Kivuno desktop', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close context panel', exact: true }).click();
  // Provider choice and safe external connection lifecycle; no provider login or model calls.
  await nav('Team').click();
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Claude', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add Claude connection', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Create a profile first', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Claude', exact: true }).click();
  await page.getByLabel('Agent name').fill('Claude test');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('heading', { name: 'Claude test', exact: true }).waitFor();
  const claude = store.members().find((member) => member.provider === 'claude')!;
  assert.ok(claude);
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Antigravity', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add Antigravity connection', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Create a profile first', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Antigravity', exact: true }).click();
  await page.getByLabel('Agent name').fill('Antigravity test');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('heading', { name: 'Antigravity test', exact: true }).waitFor();
  const antigravity = store.members().find((member) => member.provider === 'antigravity')!;
  assert.equal(antigravity.integration, 'external');
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Gemini', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Gemini', exact: true })).toBeDisabled();
  await expect(page.getByText('Google sign-in on this computer.', { exact: false })).toBeHidden();
  await page.getByText('Connection help', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Google sign-in on this computer.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Create a profile first', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI provider' }).click();
  await page.getByRole('option', { name: 'Gemini', exact: true }).click();
  await page.getByLabel('Agent name').fill('Gemini test');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('heading', { name: 'Gemini test', exact: true }).waitFor();
  const gemini = store.members().find((member) => member.name === 'Gemini test')!;
  assert.equal(gemini.provider, 'gemini');
  const geminiCard = page
    .locator('.account-card-group')
    .filter({ has: page.getByRole('heading', { name: 'Gemini test', exact: true }) });
  await expect(
    geminiCard.getByRole('button', { name: 'Sign in with Google', exact: true }),
  ).toBeDisabled();
  await expect(
    geminiCard.getByRole('button', { name: 'Sign in with OpenAI', exact: true }),
  ).toHaveCount(0);
  await nav('Neralu').click();
  await page.getByRole('button', { name: 'Group team', exact: true }).click();
  await page.getByRole('button', { name: /Edit group members/ }).click();
  for (const name of [claude.name, gemini.name, antigravity.name])
    await page
      .locator('.roster-option')
      .filter({ has: page.getByText(name, { exact: true }) })
      .getByRole('checkbox')
      .check();
  await page.getByRole('button', { name: 'Save members', exact: true }).click();
  await nav('Team').click();
  await geminiCard.locator('.member-settings > summary').click();
  await geminiCard
    .getByRole('checkbox', { name: 'I understand remaining quota cannot be checked' })
    .check();
  await geminiCard.getByRole('button', { name: 'Allow prompts', exact: true }).click();
  await expect(geminiCard.getByRole('button', { name: 'Revoke', exact: true })).toBeVisible();
  assert.equal(workspace.snapshot().providerTurnGrants?.[0].usedTurns, 0);
  await geminiCard.getByRole('button', { name: 'Revoke', exact: true }).click();
  const claudeCard = page
    .locator('.account-card-group')
    .filter({ has: page.getByRole('heading', { name: claude.name, exact: true }) });
  await claudeCard.getByRole('button', { name: 'MESH connection', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Claude · MESH connection' });
  await expect(connection.getByRole('alert')).toBeVisible();
  await expect(
    connection.getByRole('button', { name: 'Generate MCP config', exact: true }),
  ).toHaveCount(0);
  await expect(connection.getByLabel('MCP configuration')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await advanced('Sessions');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const providerSession = page.getByRole('dialog', { name: 'New agent session' });
  assert.equal(await providerSession.locator(`option[value="${claude.id}"]`).count(), 0);
  assert.equal(await providerSession.locator(`option[value="${antigravity.id}"]`).count(), 0);
  await providerSession.getByLabel('Account', { exact: true }).selectOption(gemini.id);
  await providerSession.getByRole('checkbox', { name: 'Automatic model', exact: true }).uncheck();
  await expect(providerSession.getByLabel('Reasoning', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await nav('Team').click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
    await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
    await page.getByText('TEST-ONLY', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  const codexTeam = store.members().filter((member) => member.provider === 'codex');
  assert.equal(codexTeam.length, 4);
  for (const [index, member] of codexTeam.entries()) {
    store.updateMember(member.id, {
      account: { email: `profile-${index}@example.test`, planType: 'plus' },
      skills: ['research', 'testing'],
      plugins: ['fixture-plugin'],
    });
    workspace.quota.ingest(member.id, {
      primary: { usedPercent: 10 + index * 10, windowDurationMins: 300 },
    });
  }
  await page.reload();
  for (const [index, member] of codexTeam.entries()) {
    const card = page
      .locator('.account-card-group')
      .filter({ has: page.getByRole('heading', { name: member.name, exact: true }) });
    await expect(card.getByText(`profile-${index}@example.test`, { exact: true })).toBeVisible();
    await expect(card.locator('.capability-toggle')).toHaveText('2 skills·1 plugins');
    await expect(card.locator('.member-quota strong')).toHaveText(`${90 - index * 10}% left`);
    await expect(card.locator('.member-settings')).not.toHaveAttribute('open');
    await expect(
      card.getByRole('button', { name: `Remove ${member.name} from team` }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: path.join(screenshots, 'team-compact-dark.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Use light mode', exact: true }).click();
  await page.screenshot({
    path: path.join(screenshots, 'team-compact-light.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Use dark mode', exact: true }).click();
  // This fixture has no actual provider login; removal must not need a model call.
  const disposable = codexTeam[3];
  store.updateMember(disposable.id, { account: null });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: `Remove ${disposable.name} from team` }).click();
  assert.ok(store.members().some((member) => member.id === disposable.id));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Remove ${disposable.name} from team` }).click();
  await expect(page.getByRole('heading', { name: disposable.name, exact: true })).toHaveCount(0);
  assert.equal(store.members().filter((member) => member.provider === 'codex').length, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: path.join(screenshots, 'team-compact-mobile.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await advanced('AEGIS');
  await page.getByRole('heading', { name: 'Set up AEGIS', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh AEGIS', exact: true }).click();
  await page.getByRole('heading', { name: 'Set up AEGIS', exact: true }).waitFor();
  assert.equal(await page.getByText('Not deployed', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Not configured', { exact: true }).count(), 1);
  await expect(
    page.getByText('A receipt verifies the recorded content and signer.', { exact: false }),
  ).toBeHidden();
  await page.screenshot({ path: path.join(screenshots, 'aegis-minimal.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ownerLogin: true,
      hostedPortalOnly: true,
      desktopPreloadFixture: true,
      aegisUnconfiguredState: true,
      projectGit: true,
      meshAcrossDevices: true,
      savedConversation: true,
      sessionGraph: true,
      groupRoster: true,
      reactionFeedback: true,
      chatCommands: true,
      lightDarkChat: true,
      planDraft: true,
      sessionMapKeyboard: true,
      browserCapabilityBoundary: true,
      screenshots,
      noLocalhost: true,
      noPopup: true,
      noModelUsage: true,
      providerSelection: true,
      geminiBoundedAllowance: true,
      claudeCloudBoundary: true,
      explicitNoDeadline: true,
      collapsedSetupHelp: true,
      pageErrors: 0,
    }),
  );
} catch (error) {
  await reviewPage?.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
