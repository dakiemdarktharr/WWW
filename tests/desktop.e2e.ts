// Actual Electron + bundled workspace server + installed Codex probe.
// The local identity fixture authorizes the test app only; it never creates a Codex login or model turn.
import assert from 'node:assert/strict';
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { git } from '../server/git.ts';
import type { Member } from '../shared/types.ts';

const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-desktop-e2e-'));
const accessToken = 'desktop-test-session-' + '0'.repeat(64);
let challenge = '';
let approved = false;
let accountId = 'desktop-test-owner';
let tokenRequests = 0;
let revoked = false;
let bridgePolls = 0;
let bridgeRejectedInvalidMachine = false;
let sharedPolls = 0;
const sharedCapabilityProbes: unknown[] = [];
const rosterCapabilities: unknown[] = [];
const revisionFileCapabilities: unknown[] = [];
const unchangedScopeCapabilities: unknown[] = [];
const referenceCapabilities: unknown[] = [];
const handoffAssignmentCapabilities: unknown[] = [];
const handoffDeliverableCapabilities: unknown[] = [];
const sharedGrantPages: string[][] = [];
let sharedGrantCursorSentToCloud = false;
const reportedSharedJobs: string[] = [];
const reportedRevocations: { grantId: string; groupId: string }[] = [];
let allowSharedRevocations = false;
const grantResponses: number[] = [];
const reportedGrants: { id: string }[] = [];
const fixtureSharingId = randomUUID();
let sharedTeammateId: string | undefined;
let releaseFirstSharedFinish!: () => void;
const firstSharedFinish = new Promise<void>((resolve) => {
  releaseFirstSharedFinish = resolve;
});
type FixtureProfile = {
  profileId: string;
  name: string;
  provider: string;
  state: 'reserved' | 'active' | 'released';
  selected: boolean;
};
// Match the cloud profile protocol while keeping every reservation in this fixture.
const accountProfiles = new Map<string, Map<string, FixtureProfile>>();
let profileReservations = 0;
let profileCommits = 0;
let lostReservationResponseId: string | undefined;
let recoveredReservation = false;
const webJob = randomUUID();
let webGrant:
  { connectionId: string; memberId: string; projectId: string; tokenHash: string } | undefined;
let webRead = false;
let webRevoked = false;
const expiresAt = new Date(Date.now() + 600000).toISOString();
const previewIds = { groupId: randomUUID(), runId: randomUUID(), fileId: 'd'.repeat(64) };
const previewFixture = Buffer.from(
  '<main><h1>Project preview fixture</h1><button id="change">Change value</button><output id="value">10</output></main>' +
    '<script>document.getElementById("change").onclick=()=>document.getElementById("value").textContent="20"</script>',
);
const fixture = createServer(async (request, response) => {
  let input = '';
  for await (const chunk of request) input += chunk;
  const payload = input ? JSON.parse(input) : {};
  response.setHeader('Content-Type', 'application/json');
  const identity = {
    accessToken,
    expiresAt,
    owner: { id: accountId, name: accountId },
    deviceId: '1c62a82e-a094-43ce-b1c3-bf5df6c1387b',
  };
  if (request.url?.startsWith('/browser-fixture')) {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Project page</title><h1>Ready to review</h1><p>Public project summary</p><input type="password" value="never-share-password"><textarea>never-share-textarea</textarea><div contenteditable>never-share-editable</div><span hidden>never-share-hidden</span><div style="opacity:0"><span>never-share-transparent</span></div><script>window.secret="never-share-script"</script>',
    );
  } else if (request.url === '/api/desktop/authorize') {
    challenge = payload.challenge;
    response.end(
      JSON.stringify({
        deviceCode: 'd'.repeat(64),
        userCode: 'TEST-CODE',
        verificationUri: `${fixtureOrigin}/activate?code=TEST-CODE`,
        expiresAt,
      }),
    );
  } else if (request.url === '/api/desktop/token') {
    tokenRequests++;
    assert.equal(createHash('sha256').update(payload.verifier).digest('base64url'), challenge);
    response.statusCode = approved ? 200 : 202;
    response.end(JSON.stringify(approved ? identity : { error: 'authorization_pending' }));
  } else if (request.url === '/api/desktop/me') {
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    response.end(JSON.stringify(identity));
  } else if (request.url === '/api/desktop/claude-web') {
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    if (payload.action === 'enroll') {
      assert.match(payload.tokenHash, /^[0-9a-f]{64}$/);
      assert.doesNotMatch(input, /kwc_|KIVUNO_MCP_TOKEN/);
      webGrant = payload;
      response.end('{"enrolled":true}');
    } else if (payload.action === 'poll') {
      assert.ok(webGrant);
      response.end(
        JSON.stringify({
          jobs:
            webRead || webRevoked
              ? []
              : [
                  {
                    jobId: webJob,
                    connectionId: webGrant.connectionId,
                    memberId: webGrant.memberId,
                    projectId: webGrant.projectId,
                  },
                ],
        }),
      );
    } else if (payload.action === 'complete') {
      assert.equal(payload.jobId, webJob);
      assert.equal(payload.connectionId, webGrant?.connectionId);
      assert.ok(!payload.result.isError);
      const data = JSON.parse(payload.result.content[0].text);
      assert.deepEqual(Object.keys(data.project), ['name']);
      assert.ok(Array.isArray(data.messages));
      webRead = true;
      response.end('{"completed":true}');
    } else {
      assert.equal(payload.action, 'revoke');
      assert.equal(payload.connectionId, webGrant?.connectionId);
      webRevoked = true;
      response.end('{"revoked":true}');
    }
  } else if (request.url === '/api/desktop/bridge/poll') {
    bridgePolls++;
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    assert.match(payload.bridgeKey, /^[a-f0-9]{64}$/);
    response.end(
      JSON.stringify({
        requests:
          bridgePolls === 1
            ? [
                {
                  id: '71bd203f-83de-45c6-86e0-40b20d62e4ed',
                  authorization: `Bearer ${'x'.repeat(43)}`,
                  body: { epoch: '', ready: true, busy: false, version: 'bridge-test', events: [] },
                },
              ]
            : [],
        ack: payload.responses.map((item: { id: string }) => item.id),
      }),
    );
    if (payload.responses.some((item: { status: number }) => item.status === 401))
      bridgeRejectedInvalidMachine = true;
  } else if (request.url === '/api/desktop/sade-project-file') {
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    assert.deepEqual(payload, { action: 'download', ...previewIds, part: 0 });
    response.end(
      JSON.stringify({
        data: previewFixture.toString('base64'),
        file: {
          id: previewIds.fileId,
          path: 'deliverables/index.html',
          bytes: previewFixture.length,
          sha256: createHash('sha256').update(previewFixture).digest('hex'),
        },
      }),
    );
  } else if (request.url === '/api/desktop/groups' && payload.action === 'sade-finish') {
    reportedSharedJobs.push(payload.jobId);
    if (reportedSharedJobs.length === 1) await firstSharedFinish;
    response.end('{}');
  } else if (request.url === '/api/desktop/groups' && payload.action === 'sade-poll') {
    if (!payload.grants.length && !payload.active.length) {
      sharedCapabilityProbes.push(payload);
    } else {
      sharedPolls++;
      rosterCapabilities.push(payload.rosterLookup);
      revisionFileCapabilities.push(payload.reviewedRevisionFiles);
      unchangedScopeCapabilities.push(payload.unchangedRevisionScopes);
      referenceCapabilities.push(payload.referencedMessage);
      handoffAssignmentCapabilities.push(payload.handoffAssignments);
      handoffDeliverableCapabilities.push(payload.handoffDeliverables);
      sharedGrantPages.push(payload.grants);
      sharedGrantCursorSentToCloud ||= 'grantCursor' in payload || 'nextGrantCursor' in payload;
      if (sharedGrantPages.length === 2) response.statusCode = 503;
    }
    response.end(
      JSON.stringify({
        active: [],
        reviews: [],
        updates: [],
        supportsRosterLookup: true,
        supportsReviewedRevisionFiles: true,
        supportsUnchangedRevisionScopes: true,
        supportsReferencedMessage: true,
        supportsHandoffAssignments: true,
        supportsHandoffDeliverables: true,
      }),
    );
  } else if (request.url === '/api/desktop/groups' && payload.action === 'sade-revoke') {
    reportedRevocations.push({ grantId: payload.grantId, groupId: payload.groupId });
    response.statusCode = allowSharedRevocations ? 200 : 503;
    response.end(
      JSON.stringify(
        allowSharedRevocations
          ? { revoked: true }
          : { error: 'Shared Groups service is reconnecting.' },
      ),
    );
  } else if (request.url === '/api/desktop/groups' && payload.action === 'read') {
    response.end(
      JSON.stringify({
        group: {
          id: payload.groupId,
          name: 'Consent fixture',
          teammates: [
            { ownerId: accountId, localId: sharedTeammateId, sharingId: fixtureSharingId },
          ],
        },
        sadeSharingId: true,
      }),
    );
  } else if (request.url === '/api/desktop/groups' && payload.action === 'sade-grant') {
    assert.doesNotMatch(JSON.stringify(payload), /tokenHash|private-profile|accessToken|projectId/);
    assert.equal(payload.sharingId, fixtureSharingId);
    reportedGrants.push(payload);
    const status = grantResponses.shift() ?? 200;
    if (!status) {
      response.destroy();
      return;
    }
    response.statusCode = status;
    response.end(JSON.stringify({ error: 'Grant request declined in the fixture.' }));
  } else if (request.url === '/api/desktop/profiles') {
    assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
    const profiles = accountProfiles.get(accountId) || new Map<string, FixtureProfile>();
    accountProfiles.set(accountId, profiles);
    const selectedCount = () => [...profiles.values()].filter((p) => p.selected).length;
    if (payload.action === 'reserve') {
      if (payload.name === 'Locked reservation fixture') {
        response.end(JSON.stringify({ reserved: false, locked: true }));
        return;
      }
      const existing = profiles.get(payload.profileId);
      if (existing && existing.state !== 'released') {
        if (payload.profileId === lostReservationResponseId) recoveredReservation = true;
        response.end(JSON.stringify({ reserved: existing.selected, locked: !existing.selected }));
      } else if (selectedCount() >= 3) {
        response.statusCode = 429;
        response.end(
          JSON.stringify({ error: 'The fixture Free plan supports 3 active profiles.' }),
        );
      } else {
        profiles.set(payload.profileId, { ...payload, state: 'reserved', selected: true });
        profileReservations++;
        if (!lostReservationResponseId && payload.name === 'Browser fixture') {
          lostReservationResponseId = payload.profileId;
          response.destroy();
          return;
        }
        response.end(JSON.stringify({ reserved: true, locked: false }));
      }
    } else if (payload.action === 'commit') {
      const profile = profiles.get(payload.profileId);
      assert.ok(profile && profile.state !== 'released' && profile.selected);
      profiles.set(payload.profileId, { ...profile, ...payload, state: 'active' });
      profileCommits++;
      response.end(JSON.stringify({ committed: true }));
    } else if (payload.action === 'release') {
      const profile = profiles.get(payload.profileId);
      if (profile?.state === 'reserved') {
        profile.state = 'released';
        profile.selected = false;
      }
      response.end(JSON.stringify({ released: true }));
    } else {
      assert.equal(payload.action, 'sync');
      const ids = new Set(payload.profiles.map((p: FixtureProfile) => p.profileId));
      for (const profile of profiles.values()) {
        if (profile.state === 'active' && !ids.has(profile.profileId)) {
          profile.state = 'released';
          profile.selected = false;
        }
      }
      for (const supplied of payload.profiles as FixtureProfile[]) {
        const existing = profiles.get(supplied.profileId);
        const selected =
          existing && existing.state !== 'released' ? existing.selected : selectedCount() < 3;
        profiles.set(supplied.profileId, { ...supplied, state: 'active', selected });
      }
      response.end(
        JSON.stringify({
          lockedIds: [...profiles.values()]
            .filter((p) => p.state === 'active' && !p.selected)
            .map((p) => p.profileId),
        }),
      );
    }
  } else if (request.url === '/api/desktop/revoke') {
    revoked = true;
    response.end('{}');
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
});
await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = (fixture.address() as { port: number }).port;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const env = { ...process.env } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
Object.assign(env, {
  RELAY_DESKTOP_TESTING: '1',
  RELAY_DESKTOP_DATA_DIR: directory,
  RELAY_NODE_BINARY: process.execPath,
  RELAY_CLOUD_ORIGIN: fixtureOrigin,
});
let desktop: ElectronApplication | undefined;
try {
  desktop = await electron.launch({ args: [path.resolve('desktop')], env, timeout: 60000 });
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).relayDesktop), { timeout: 30000 });
  const before = await page.evaluate(() => (window as any).relayDesktop.getStatus());
  assert.equal(before.signedIn, false);
  assert.equal(before.runtime, 'ready');
  assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
  const lockedOrigin = new URL(page.url()).origin;
  const unauthorized = await fetch(lockedOrigin + '/api/session');
  assert.equal(
    unauthorized.status,
    403,
    'ordinary processes cannot bootstrap a desktop browser session',
  );

  const pending = await page.evaluate(() => (window as any).relayDesktop.beginSignIn());
  assert.equal(pending.pending.userCode, 'TEST-CODE');
  assert.equal(pending.signedIn, false);
  approved = true;
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
      { timeout: 20000 },
    )
    .toBe(true);
  assert.ok(tokenRequests > 0);
  await page.waitForURL((url) => url.origin !== lockedOrigin, { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  const localOrigin = new URL(page.url()).origin;
  const state = await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/state', { headers: { 'X-Relay-Token': session.token } });
    return response.json();
  });
  assert.equal(state.members.length, 0);
  assert.equal(state.runtime.codexAvailable, true, 'real bundled Codex must pass --version');
  const publicStatus = await page.evaluate(() => (window as any).relayDesktop.getStatus());
  assert.equal(publicStatus.owner.id, 'desktop-test-owner');
  assert.equal(JSON.stringify(publicStatus).includes(accessToken), false);
  const opened = desktop.waitForEvent('window');
  await page.evaluate((values) => window.relayDesktop!.projectPreview(values), previewIds);
  const projectPreview = await opened;
  await expect(
    projectPreview.getByRole('heading', { name: 'Project preview fixture' }),
  ).toBeVisible();
  await projectPreview.getByRole('button', { name: 'Change value' }).click();
  await expect(projectPreview.locator('output')).toHaveText('20');
  assert.equal(await projectPreview.evaluate(() => typeof window.relayDesktop), 'undefined');
  await projectPreview.close();
  const encrypted = await readFile(path.join(directory, 'desktop-session.bin'));
  assert.equal(encrypted.includes(Buffer.from(accessToken)), false);
  await expect.poll(() => bridgePolls, { timeout: 15000 }).toBeGreaterThan(1);
  assert.equal(
    bridgeRejectedInvalidMachine,
    true,
    'the cloud bridge must forward to the authenticated local runner boundary',
  );

  const unrelated = { id: randomUUID(), grantId: randomUUID() };
  const withdrawn = { id: randomUUID(), grantId: randomUUID() };
  const withdrawalGroup = randomUUID();
  const store = new Store(path.join(state.runtime.dataDir, 'workspace.db'));
  try {
    const lastGrant = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    store.transaction(() => {
      for (let index = 0; index < 35; index++)
        store.put('sharedSadeLocalGrant', {
          id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
          expiresAt: Date.now() + 90_000,
        });
      store.put('sharedSadeLocalGrant', { id: lastGrant, expiresAt: Date.now() + 90_000 });
      for (const queued of [unrelated, withdrawn]) {
        store.put('sharedSadeLocalGrant', {
          id: queued.grantId,
          expiresAt: Date.now() + 60_000,
        });
        store.put('sharedSadeLocalReceipt', {
          ...queued,
          phase: 'task',
          result: { kind: 'done', summary: 'Synthetic project result' },
        });
      }
    });
    await expect.poll(() => reportedSharedJobs[0], { timeout: 15000 }).toBe(unrelated.id);
    await assert.rejects(
      page.evaluate((input) => (window as any).relayDesktop.groups(input), {
        action: 'sade-revoke',
        grantId: withdrawn.grantId,
        groupId: withdrawalGroup,
      }),
      /Shared Groups service is reconnecting/,
    );
    assert.ok(store.get('sharedSadeLocalRevocation', withdrawn.grantId));
    const pollsBeforeRevoke = sharedPolls;
    releaseFirstSharedFinish();
    await expect.poll(() => sharedPolls, { timeout: 15000 }).toBeGreaterThan(pollsBeforeRevoke);
    assert.deepEqual(sharedCapabilityProbes[0], { action: 'sade-poll', grants: [], active: [] });
    assert.equal(rosterCapabilities[0], true);
    assert.equal(revisionFileCapabilities[0], true);
    assert.equal(unchangedScopeCapabilities[0], true);
    assert.equal(referenceCapabilities[0], true);
    assert.equal(handoffAssignmentCapabilities[0], true);
    assert.equal(handoffDeliverableCapabilities[0], true);
    await expect.poll(() => sharedGrantPages.length, { timeout: 18000 }).toBeGreaterThanOrEqual(3);
    assert.deepEqual(sharedCapabilityProbes[1], sharedCapabilityProbes[0]);
    assert.equal(handoffAssignmentCapabilities[2], true);
    assert.equal(handoffDeliverableCapabilities[2], true);
    assert.equal(sharedGrantPages[0].length, 32);
    assert.ok(!sharedGrantPages[0].includes(lastGrant));
    assert.ok(sharedGrantPages[1].includes(lastGrant));
    assert.deepEqual(sharedGrantPages[2], sharedGrantPages[1]);
    assert.equal(sharedGrantCursorSentToCloud, false);
    assert.ok(!reportedSharedJobs.includes(withdrawn.id));
    assert.ok(store.get('sharedSadeLocalReceipt', withdrawn.id));
    store.transaction(() => {
      for (const { id } of store.all<{ id: string }>('sharedSadeLocalGrant'))
        store.remove('sharedSadeLocalGrant', id);
    });
    allowSharedRevocations = true;
    await expect
      .poll(() => store.lookup('sharedSadeLocalRevocation', withdrawn.grantId), { timeout: 15000 })
      .toBeUndefined();
    assert.ok(reportedRevocations.length >= 2);
    assert.ok(
      reportedRevocations.every(
        ({ grantId, groupId }) => grantId === withdrawn.grantId && groupId === withdrawalGroup,
      ),
    );
  } finally {
    releaseFirstSharedFinish();
    store.close();
  }

  const memory = async () =>
    desktop!.evaluate(({ app }) =>
      app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
    );
  const rendererCount = async () =>
    desktop!.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  const baselineRenderers = await rendererCount();
  const beforeBrowserKb = await memory();
  const bounds = { x: 200, y: 100, width: 700, height: 500 };
  await page.evaluate(
    async ({ url, bounds }) =>
      (window as any).relayDesktop.browser.open({ projectId: 'browser-project-a', url, bounds }),
    { url: fixtureOrigin + '/browser-fixture?secret=query-token', bounds },
  );
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).loading,
    )
    .toBe(false);
  assert.equal(await rendererCount(), baselineRenderers + 1, 'only one on-demand browser renderer');
  const browserCapabilities = await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    return browser.executeJavaScript(
      '({bridge:typeof window.relayDesktop,node:typeof require,inputs:document.querySelector("input").value})',
    );
  });
  assert.deepEqual(browserCapabilities, {
    bridge: 'undefined',
    node: 'undefined',
    inputs: 'never-share-password',
  });
  const snapshot = await page.evaluate(() => (window as any).relayDesktop.browser.snapshot());
  assert.match(snapshot.text, /Public project summary/);
  assert.equal(snapshot.text.includes('never-share'), false);
  assert.equal(snapshot.url, fixtureOrigin + '/browser-fixture');
  const withBrowserKb = await memory();
  await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    await browser.executeJavaScript('document.cookie="project_cookie=project_a"');
  });
  await page.evaluate(
    async ({ url, bounds }) =>
      (window as any).relayDesktop.browser.open({ projectId: 'browser-project-b', url, bounds }),
    { url: fixtureOrigin + '/browser-fixture', bounds },
  );
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).loading,
    )
    .toBe(false);
  const isolatedCookie = await desktop.evaluate(async ({ webContents }) => {
    const browser = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('/browser-fixture'))!;
    return browser.executeJavaScript('document.cookie');
  });
  assert.equal(isolatedCookie, '', 'project browser cookies are partitioned by owner and project');
  await assert.rejects(
    page.evaluate(
      async ({ url, bounds }) =>
        (window as any).relayDesktop.browser.open({ projectId: 'browser-project-b', url, bounds }),
      { url: localOrigin, bounds },
    ),
    /cannot open/,
  );
  await page.evaluate(() => (window as any).relayDesktop.browser.close());
  await expect.poll(rendererCount).toBe(baselineRenderers);
  const afterBrowserKb = await memory();
  console.log(
    `Desktop memory (Electron working-set KB, no model workers): idle=${beforeBrowserKb}, browser=${withBrowserKb}, released=${afterBrowserKb}; browser renderer removed on close.`,
  );
  const guide = page.getByRole('button', { name: 'Đóng hướng dẫn', exact: true });
  if (await guide.isVisible()) await guide.click();
  const titlebar = page.getByRole('banner', { name: 'Điều khiển cửa sổ' });
  await expect(titlebar.getByRole('button')).toHaveCount(3);
  const windowState = () => page.evaluate(() => (window as any).relayDesktop.getWindowState());
  const initialWindow = await windowState();
  console.log(`Desktop initial window state: ${JSON.stringify(initialWindow)}`);
  assert.equal(initialWindow.fullscreen, false);
  // macOS can launch zoomed when the work area is about the default window size.
  if (initialWindow.maximized) {
    await titlebar.getByRole('button', { name: 'Khôi phục cửa sổ', exact: true }).click();
    await expect.poll(async () => (await windowState()).maximized).toBe(false);
  }
  await titlebar.getByRole('button', { name: 'Phóng to', exact: true }).click();
  await expect.poll(async () => (await windowState()).maximized).toBe(true);
  await titlebar.getByRole('button', { name: 'Khôi phục cửa sổ', exact: true }).click();
  await expect.poll(async () => (await windowState()).maximized).toBe(false);
  await page.locator('body').click({ position: { x: 300, y: 150 } });
  await page.keyboard.press('F11');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).fullscreen,
    )
    .toBe(true);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(0);
  await page.mouse.move(300, 2);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(0);
  await page.mouse.move(300, 150);
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(0);
  await page.keyboard.press('F10');
  await expect
    .poll(() => titlebar.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(0);
  await page.keyboard.press('F11');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).relayDesktop.getWindowState())).fullscreen,
    )
    .toBe(false);

  // Real React panel + native view, with deterministic HTTPS content served only
  // inside this test owner's project partition. No external account or model turn.
  const post = (route: string, body: unknown) =>
    page.evaluate(
      async ({ route, body }) => {
        const { token } = await (await fetch('/api/session')).json();
        const result = await fetch(`/api${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token },
          body: JSON.stringify(body),
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        return data;
      },
      { route, body },
    );
  const addProfile = async (input: {
    name: string;
    role: 'researcher' | 'engineer';
    provider?: 'codex' | 'claude' | 'antigravity';
  }) => {
    const profile = {
      profileId: randomUUID(),
      name: input.name,
      provider: input.provider || 'codex',
    };
    await page.evaluate(
      (profile) => (window as any).relayDesktop.profiles({ action: 'reserve', ...profile }),
      profile,
    );
    const member = await post('/members', { ...input, profileId: profile.profileId });
    assert.equal(member.id, profile.profileId);
    await page.evaluate(
      (profile) => (window as any).relayDesktop.profiles({ action: 'commit', ...profile }),
      profile,
    );
    return member;
  };
  await assert.rejects(
    post('/members', { name: 'Unreserved fixture', role: 'researcher' }),
    /Reserve this profile/,
  );
  const lockedProfile = {
    profileId: randomUUID(),
    name: 'Locked reservation fixture',
    provider: 'claude',
  };
  await assert.rejects(
    page.evaluate(
      (profile) => (window as any).relayDesktop.profiles({ action: 'reserve', ...profile }),
      lockedProfile,
    ),
    /locked by your Kivuno plan/,
  );
  await assert.rejects(
    post('/members', { ...lockedProfile, role: 'researcher' }),
    /reservation is missing/,
  );
  const member = await addProfile({ name: 'Browser fixture', role: 'researcher' });
  assert.ok(
    recoveredReservation,
    'A lost reservation response is retried with the original profile ID.',
  );
  sharedTeammateId = member.id;
  const project = await post('/hackathons', {
    memberId: member.id,
    name: 'Browser test project',
    competitionName: 'Browser fixture',
    competitionUrl: 'https://example.org/challenge',
    goal: 'Verify desktop browser controls without starting a model.',
  });
  await git(project.path, [
    'config',
    'remote.origin.url',
    'https://example.test/kivuno/consent-fixture',
  ]);
  const grantStore = new Store(path.join(state.runtime.dataDir, 'workspace.db'));
  try {
    const beforeGrant = grantStore.get<Member>('member', member.id);
    grantStore.updateMember(member.id, {
      status: 'ready',
      account: { type: 'chatgpt', email: 'private-profile@example.test' },
    });
    const share = async () => {
      await desktop!.evaluate(({ dialog }) => {
        const original = dialog.showMessageBox;
        (dialog as any).showMessageBox = (...args: any[]) => {
          if (args.at(-1)?.title === 'Allow Sade to use your teammate?') {
            dialog.showMessageBox = original;
            return Promise.resolve({ response: 1, checkboxChecked: false });
          }
          return (original as any).apply(dialog, args);
        };
      });
      return page.evaluate(
        (input) => (window as any).relayDesktop.groups({ action: 'sade-connect', ...input }),
        {
          groupId: randomUUID(),
          projectId: project.id,
          teammateId: member.id,
          allowWrites: false,
          turns: 1,
        },
      );
    };
    grantResponses.push(0, 200);
    await share();
    assert.equal(reportedGrants.length, 2);
    assert.deepEqual(reportedGrants[0], reportedGrants[1]);
    assert.ok(grantStore.lookup('sharedSadeLocalGrant', reportedGrants[0].id));
    grantResponses.push(503, 503);
    await assert.rejects(share(), /desktop recorded your approval/);
    assert.equal(reportedGrants.length, 4);
    assert.deepEqual(reportedGrants[2], reportedGrants[3]);
    assert.ok(grantStore.lookup('sharedSadeLocalGrant', reportedGrants[2].id));
    grantResponses.push(403);
    await assert.rejects(share(), /Grant request declined/);
    assert.equal(reportedGrants.length, 5);
    assert.equal(grantStore.lookup('sharedSadeLocalGrant', reportedGrants[4].id), undefined);
    grantStore.updateMember(member.id, {
      status: beforeGrant.status,
      account: beforeGrant.account,
    });
  } finally {
    grantStore.close();
  }
  const session = await post('/sessions', {
    memberId: member.id,
    projectId: project.id,
    title: 'Browser review',
    readOnly: true,
  });
  await page.evaluate(() => sessionStorage.setItem('kivuno-guide-v3', 'seen'));
  const uiFixture = { projectId: project.id, sessionId: session.id };
  const partition =
    'persist:kivuno-browser-' +
    createHash('sha256')
      .update('desktop-test-owner\0' + uiFixture.projectId)
      .digest('hex');
  await desktop.evaluate(({ session }, partition) => {
    session
      .fromPartition(partition)
      .protocol.handle(
        'https',
        () =>
          new Response(
            '<!doctype html><title>Reviewed page</title><h1>Browser integration</h1><p>Human reviewed project details.</p><input type="password" value="never-share-login">',
            { headers: { 'Content-Type': 'text/html' } },
          ),
      );
  }, partition);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open project Browser test project', exact: true })
    .click();
  await page.getByRole('button', { name: 'Session view', exact: true }).click();
  await page
    .getByRole('button', { name: 'Browser review, Browser fixture, idle', exact: true })
    .click();
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await page
    .getByLabel('Địa chỉ website')
    .fill('https://browser.kivuno.test/project?token=private');
  await page.getByRole('button', { name: 'Mở website', exact: true }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.browser.state())).title,
    )
    .toBe('Reviewed page');
  await page.getByRole('button', { name: 'Chia sẻ trang', exact: true }).click();
  const reviewed = page.getByLabel('Xem lại nội dung chia sẻ');
  await expect(reviewed).toHaveValue(/Human reviewed project details\./);
  assert.equal((await reviewed.inputValue()).includes('never-share-login'), false);
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.filter((view) => !view.getVisible())
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await reviewed.fill('Reviewed and edited by the human.');
  await page.getByRole('button', { name: /Chia sẻ & tiếp tục|Gửi cho Codex/ }).click();
  await expect(reviewed).toHaveCount(0);
  const sharedPage = await page.evaluate(async ({ projectId, sessionId }) => {
    const { token } = await (await fetch('/api/session')).json();
    return (
      await fetch(`/api/projects/${projectId}/browser?sessionId=${sessionId}`, {
        headers: { 'X-Relay-Token': token },
      })
    ).json();
  }, uiFixture);
  assert.equal(sharedPage.snapshot.text, 'Reviewed and edited by the human.');
  assert.equal(sharedPage.snapshot.url, 'https://browser.kivuno.test/project');
  await page.getByRole('button', { name: 'Close context panel', exact: true }).click();
  await expect.poll(rendererCount).toBe(baselineRenderers);

  const addClaudeFromTeam = async (): Promise<Member> => {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Team', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add account', exact: true }).first().click();
    const picker = page.getByRole('dialog', { name: 'Add account' });
    await picker.getByRole('combobox', { name: 'AI provider' }).click();
    await picker.getByRole('option', { name: 'Claude', exact: true }).click();
    await expect(picker.getByRole('checkbox')).toHaveCount(0);
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/accounts/connect',
      ),
      picker.getByRole('button', { name: 'Add Claude connection', exact: true }).click(),
    ]);
    assert.ok(response.ok(), 'Team should create the external Claude profile.');
    const { member } = await response.json();
    await expect(page.getByRole('dialog', { name: 'Claude · MESH connection' })).toBeVisible();
    return member;
  };
  // Both real-client connection types use scoped local MCP, not native model dispatch.
  for (const provider of ['claude', 'antigravity'] as const) {
    const label = provider === 'claude' ? 'Claude' : 'Antigravity';
    const external =
      provider === 'claude'
        ? await addClaudeFromTeam()
        : await addProfile({
            name: `${label} local`,
            role: 'engineer',
            provider,
          });
    await page.evaluate(
      async ({ projectId, memberId }) => {
        const { token } = await (await fetch('/api/session')).json();
        const state = await (
          await fetch('/api/state', { headers: { 'X-Relay-Token': token } })
        ).json();
        const project = state.projects.find((entry: { id: string }) => entry.id === projectId);
        const response = await fetch(`/api/projects/${projectId}/members`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token },
          body: JSON.stringify({ memberIds: [...project.memberIds, memberId] }),
        });
        if (!response.ok) throw new Error('Could not add the external fixture member.');
      },
      { projectId: uiFixture.projectId, memberId: external.id },
    );
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Team', exact: true })
      .click();
    const externalCard = page
      .locator('.account-card-group')
      .filter({ has: page.getByRole('heading', { name: external.name, exact: true }) });
    await externalCard.getByRole('button', { name: 'MESH connection', exact: true }).click();
    const externalDialog = page.getByRole('dialog', { name: `${label} · MESH connection` });
    if (provider === 'claude') {
      await expect(
        externalDialog.getByRole('button', { name: 'Open Claude sign-in in browser' }),
      ).toBeVisible();
      await expect(externalDialog.getByRole('checkbox')).toHaveCount(0);
      await externalDialog.getByRole('button', { name: 'Create read-only web connector' }).click();
      const header = externalDialog.getByLabel('Private header value');
      await expect(header).toBeHidden();
      await expect(externalDialog.getByText(/choose Connect \(Connecter\)/)).toBeVisible();
      await externalDialog.getByText('Advanced: connect with a private request header').click();
      await expect(header).toBeVisible();
      assert.equal(
        await externalDialog.getByLabel('Connector URL').inputValue(),
        fixtureOrigin + '/api/claude/mcp',
      );
      const value = await header.inputValue();
      assert.ok(/^Bearer kwc_[A-Za-z0-9_-]{43}$/.test(value));
      assert.ok(createHash('sha256').update(value.slice(7)).digest('hex') === webGrant?.tokenHash);
      await expect.poll(() => webRead).toBe(true);
      await externalDialog.getByRole('button', { name: 'Revoke connection' }).click();
      await expect.poll(() => webRevoked).toBe(true);
      await externalDialog.getByRole('combobox', { name: 'Claude client' }).click();
      await externalDialog.getByRole('option', { name: 'Claude Desktop · Free or paid' }).click();
    }
    await expect(externalDialog.getByRole('checkbox').nth(0)).not.toBeChecked();
    await expect(externalDialog.getByRole('checkbox').nth(1)).not.toBeChecked();
    await externalDialog.getByRole('button', { name: 'Generate MCP config', exact: true }).click();
    const configInput = externalDialog.getByLabel('MCP configuration');
    await expect(configInput).toBeVisible();
    const config = JSON.parse(await configInput.inputValue());
    const mcp = Object.values(config.mcpServers)[0] as {
      env: { KIVUNO_MCP_URL: string; KIVUNO_MCP_TOKEN: string };
    };
    assert.equal(mcp.env.KIVUNO_MCP_URL, localOrigin + '/api/external-agent/rpc');
    assert.match(mcp.env.KIVUNO_MCP_TOKEN, /^[A-Za-z0-9_-]{43}$/);
    await expect(externalDialog.getByRole('progressbar')).toHaveAttribute('value', '1');
    const connectedClient = await fetch(mcp.env.KIVUNO_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mcp.env.KIVUNO_MCP_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'controlled-ui-fixture', version: '1' },
        },
      }),
    });
    assert.equal(connectedClient.status, 200);
    await expect(externalDialog.getByRole('progressbar')).toHaveAttribute('value', '3', {
      timeout: 5000,
    });
    await externalDialog
      .getByRole('button', { name: 'Revoke connection', exact: true })
      .and(page.locator(':enabled'))
      .click();
    await expect(configInput).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }

  await page.evaluate(() => {
    void (window as any).relayDesktop.signOut();
  });
  await page.waitForURL((url) => url.origin !== localOrigin, { timeout: 30000 });
  await page.waitForFunction(() => Boolean((window as any).relayDesktop));
  await expect
    .poll(
      async () => (await page.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
      { timeout: 15000 },
    )
    .toBe(false);
  await expect.poll(() => revoked).toBe(true);
  // Same OS profile, two distinct Kivuno identities; projects and AI profiles must
  // survive switching back, never follow the machine's last user.
  const switchIn = async (id: string) => {
    accountId = id;
    const oldOrigin = new URL(page.url()).origin;
    await page.evaluate(() => (window as any).relayDesktop.beginSignIn());
    await page.waitForURL((url) => url.origin !== oldOrigin, { timeout: 60000 });
    await page.waitForFunction(() => Boolean((window as any).relayDesktop));
    return page.evaluate(async () => {
      const session = await (await fetch('/api/session')).json();
      return (await fetch('/api/state', { headers: { 'X-Relay-Token': session.token } })).json();
    });
  };
  const bob = await switchIn('second-kivuno-user');
  assert.equal(bob.members.length, 0);
  assert.equal(bob.projects.length, 0);
  assert.notEqual(bob.runtime.dataDir, state.runtime.dataDir);
  await addProfile({ name: 'Only Bob', role: 'researcher' });
  const bobOrigin = new URL(page.url()).origin;
  await page.evaluate(() => {
    void (window as any).relayDesktop.signOut();
  });
  await page.waitForURL((url) => url.origin !== bobOrigin, { timeout: 30000 });
  const returned = await switchIn('desktop-test-owner');
  assert.ok(returned.projects.some((item: { id: string }) => item.id === uiFixture.projectId));
  assert.ok(!returned.members.some((item: { name: string }) => item.name === 'Only Bob'));
  assert.equal(profileReservations, 4, 'Each created profile reserved its cloud quota slot.');
  assert.equal(profileCommits, 4, 'Each created profile confirmed the cloud quota record.');
  // A new app launch must show sign-in even while a prior session file exists.
  await desktop.close();
  desktop = await electron.launch({ args: [path.resolve('desktop')], env, timeout: 60000 });
  const reopened = await desktop.firstWindow();
  await reopened.waitForFunction(() => Boolean((window as any).relayDesktop));
  assert.equal(
    (await reopened.evaluate(() => (window as any).relayDesktop.getStatus())).signedIn,
    false,
  );
  await expect(
    reopened.getByRole('button', { name: 'Đăng nhập Kivuno', exact: true }),
  ).toBeVisible();

  console.log(
    'Desktop E2E passed: Electron/runtime/Codex probe, activation, protected local API, Shared Sade consent retry and revocation sync, isolated project browser, explicit safe page snapshot, browser release, fullscreen controls, DPAPI session and sign-out.',
  );
} finally {
  if (desktop) await desktop.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  // Only this test-created absolute temporary directory is removed.
  if (
    path.dirname(directory) === os.tmpdir() &&
    path.basename(directory).startsWith('relay-desktop-e2e-')
  )
    await rm(directory, { recursive: true, force: true });
}
