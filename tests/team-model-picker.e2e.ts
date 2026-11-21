import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import type { CodexModel, Member } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import { CodexClient } from '../server/codex.ts';
import { Workspace } from '../server/service.ts';
import { Store } from '../server/store.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-team-picker-'));
const store = new Store(path.join(root, 'workspace.db'));
const workspace = new Workspace(store, root, root);
const model = (id: string, displayName: string, isDefault = false): CodexModel => ({
  id,
  model: id,
  displayName,
  isDefault,
  defaultReasoningEffort: '',
  supportedReasoningEfforts: [],
});

// This suite changes the Codex catalog without signing into an account or consuming a model turn.
class CatalogClient extends CodexClient {
  reads = 0;
  constructor(
    public email: string,
    public models: CodexModel[],
  ) {
    super({ home: root, cwd: root });
  }
  override async start() {}
  override async stop() {}
  override async request<T = any>(method: string): Promise<T> {
    if (method === 'account/read')
      return { account: { type: 'chatgpt', email: this.email, planType: 'pro' } } as T;
    if (method === 'model/list') {
      this.reads++;
      return { data: this.models } as T;
    }
    throw new Error(`Unexpected Codex call: ${method}`);
  }
}

const atlas = store.addMember({ name: 'Atlas', role: 'engineer' });
const vega = store.addMember({ name: 'Vega', role: 'researcher' });
const atlasClient = new CatalogClient('atlas@example.test', [
  model('fixture-luna', 'Fixture Luna'),
  model('fixture-sol', 'Fixture Sol', true),
  model('fixture-astra', 'Fixture Astra'),
]);
const vegaClient = new CatalogClient('vega@example.test', [model('vega-model', 'Vega only')]);
for (const [member, client] of [
  [atlas, atlasClient],
  [vega, vegaClient],
] as const) {
  store.updateMember(member.id, {
    status: 'ready',
    account: { type: 'chatgpt', email: client.email, planType: 'pro' },
  });
}
workspace.client = async (id) => {
  if (id === atlas.id) return atlasClient;
  if (id === vega.id) return vegaClient;
  throw new Error('Unexpected Codex profile');
};
workspace.runtime.codexAvailable = true;

const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve, reject) =>
  probe.close((error) => (error ? reject(error) : resolve())),
);
const app = await buildApp(workspace, { distDir: path.resolve('dist'), port });
let browser;
try {
  await app.listen({ host: '127.0.0.1', port });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await context.addInitScript(`
    sessionStorage.setItem('kivuno-guide-v3', 'seen');
    window.relayDesktop = {
      platform: 'darwin', version: '0.9.14',
      getStatus: async () => ({ signedIn: true, runtime: 'ready', owner: { id: 'fixture' }, cloudOrigin: location.origin }),
      onStatus: () => () => {}, onUpdateProgress: () => () => {}, onWindowState: () => () => {},
      getWindowState: async () => ({ maximized: false, fullscreen: false }),
      checkForUpdates: async () => ({ hasUpdate: false, downloadAvailable: false }),
      controlWindow: async () => ({}),
    };
  `);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/#team`);
  const guide = page.getByRole('button', { name: 'Đóng hướng dẫn', exact: true });
  if (await guide.isVisible()) await guide.click();
  const card = page.locator('.member-card').filter({
    has: page.getByRole('heading', { name: 'Atlas', exact: true }),
  });
  const trigger = card.getByRole('button', { name: /^Model for Atlas/ });
  const panel = card.getByRole('group', { name: 'Models for Atlas' });
  const bounds = await card.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
  assert.ok(bounds && (await trigger.boundingBox())!.y < bounds.y);
  assert.equal(atlasClient.reads, 0);
  assert.equal(vegaClient.reads, 0);

  await trigger.focus();
  await trigger.press('Enter');
  await expect(panel.getByRole('button', { name: 'Fixture Astra' })).toBeVisible();
  assert.deepEqual(
    await panel
      .locator('.team-model-tier')
      .evaluateAll((tiers) => tiers.map((tier) => tier.getAttribute('aria-label'))),
    ['High capacity', 'Standard', 'Fast'],
  );
  await expect(panel.getByRole('button', { name: 'Automatic' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await trigger.press('Tab');
  await expect(panel.getByRole('button', { name: 'Automatic' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  const fresh = model('fixture-ultra-next', 'Fixture Ultra Next');
  await expect(panel.getByRole('button', { name: 'Fixture Sol' })).toBeVisible();
  atlasClient.models.push(fresh);
  const option = panel.getByRole('button', { name: fresh.displayName });
  await expect(option).toBeVisible({ timeout: 25_000 });
  // Withdraw it after display. The save must read the provider, rather than accepting a stale row.
  atlasClient.models.pop();
  await option.click();
  await expect(panel.getByRole('alert')).toContainText('no longer available');
  assert.equal(store.get<Member>('member', atlas.id).preferredModel, undefined);
  atlasClient.models.push(fresh);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(option).toBeVisible();
  await option.click();
  await expect(trigger).toHaveAccessibleName(`Model for Atlas: ${fresh.displayName}`);
  assert.equal(store.get<Member>('member', atlas.id).preferredModel, fresh.model);
  assert.equal(store.get<Member>('member', vega.id).preferredModel, undefined);

  await page.reload();
  await trigger.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Automatic' }).click();
  await expect(trigger).toHaveAccessibleName('Model for Atlas: Automatic');
  assert.equal(store.get<Member>('member', atlas.id).preferredModel, undefined);
  const other = page.getByRole('button', { name: 'Model for Vega: Automatic' });
  await other.click();
  const otherPanel = page.getByRole('group', { name: 'Models for Vega' });
  await expect(otherPanel.getByRole('button', { name: 'Vega only' })).toBeVisible();
  await expect(otherPanel.getByRole('button', { name: fresh.displayName })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'Codex Team picker passed placement, keyboard, tier order, live refresh, stale-model rejection, persistence, reset and profile isolation.',
  );
} finally {
  await browser?.close();
  await app.close();
  await workspace.close();
  store.close();
  await rm(root, { recursive: true, force: true });
}
