import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeClient } from '../server/claude.ts';
import { AntigravityClient } from '../server/antigravity.ts';
import { readAccount, readModels, startTask, relayDynamicTools } from '../server/codex.ts';
import { chooseModel } from '../server/autonomy.ts';
import { providerFileTool } from '../server/provider-files.ts';
import { groupReadUpdatesTool } from '../server/group-sade.ts';
import { isExternalMember } from '../shared/providers.ts';
import { AntigravityBinding } from '../server/antigravity-binding.ts';
import { Workspace } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { DatabaseSync } from 'node:sqlite';

test('device consent is independent for each profile and Kivuno workspace', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-device-binding-'));
  const file = path.join(root, 'device.sqlite');
  const binding = new AntigravityBinding(file);
  const store = new Store(':memory:');
  const member = store.addMember({ name: 'Legacy', role: 'engineer', provider: 'antigravity' });
  store.updateMember(member.id, {
    integration: 'native',
    managedRuntime: true,
    account: { type: 'antigravity-google' },
    status: 'ready',
    connectedAt: new Date().toISOString(),
  });
  const workspace = new Workspace(store, root, root, binding);
  t.after(async () => {
    await workspace.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const home = workspace.home(member.id);
  assert.equal(store.members()[0].account, null);
  assert.equal(store.members()[0].status, 'offline');
  assert.throws(
    () => workspace.localClient(store.members()[0], root),
    /Connect the Antigravity account/,
  );
  assert.throws(() => binding.claim(home), /Confirm use/);
  assert.equal(binding.owns(home), false);
  binding.claim(home, true);
  const reopened = new AntigravityBinding(file);
  const other = path.join(root, 'another-workspace', member.id);
  assert.equal(reopened.owns(home), true);
  assert.throws(() => reopened.claim(other), /Confirm use/);
  assert.equal(reopened.owns(other), false);
  reopened.claim(other, true);
  const sameWorkspace = path.join(root, 'profiles', 'second');
  binding.claim(sameWorkspace, true);
  assert.equal(reopened.owns(sameWorkspace), true);
  assert.equal(binding.owns(home), true);
  await workspace.logout(member.id);
  assert.equal(binding.owns(home), false);
  assert.equal(reopened.owns(other), true);
  assert.equal(reopened.owns(sameWorkspace), true);
  reopened.release(other);
  assert.equal(binding.owns(other), false);
  assert.equal(binding.owns(sameWorkspace), true);
});

test('legacy exclusive binding migrates once and cannot resurrect revoked consent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-binding-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'device.sqlite');
  const home = path.join(root, 'old', 'profile');
  const key = process.platform === 'win32' ? home.toLowerCase() : home;
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE binding (slot INTEGER PRIMARY KEY CHECK(slot=1), profile TEXT NOT NULL)');
  db.prepare('INSERT INTO binding VALUES (1, ?)').run(key);
  db.close();
  const first = new AntigravityBinding(file);
  assert.equal(first.owns(home), true);
  const second = new AntigravityBinding(file);
  const other = path.join(root, 'new', 'profile');
  assert.equal(second.owns(other), false);
  second.claim(other, true);
  first.release(home);
  assert.equal(new AntigravityBinding(file).owns(home), false);
  assert.equal(first.owns(other), true);
});

for (const [Client, label] of [
  [ClaudeClient, 'Claude'],
  [AntigravityClient, 'Antigravity'],
] as const) {
  test(
    `${Client.name}: separate sign-in, advertised models, scoped tools and human edits`,
    { timeout: 20000 },
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-managed-'));
      const home = path.join(root, 'profile'),
        cwd = path.join(root, 'project');
      await mkdir(home);
      await mkdir(cwd);
      await writeFile(path.join(cwd, 'sample.txt'), 'base');
      const client = new Client({
        home,
        cwd,
        command: path.resolve('tests/fixtures/managed-peer.mjs'),
      });
      t.after(async () => {
        await client.stop();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        await rm(root, { recursive: true, force: true });
      });
      assert.equal(await readAccount(client), null);
      await assert.rejects(readModels(client), {
        message: `Sign in to this ${label} account to read its available models.`,
      });
      await assert.rejects(startTask(client, { cwd, prompt: 'edit-file', sharedGroup: true }), {
        message: `Sign in to this member's ${label} account before running a task.`,
      });
      await writeFile(path.join(home, 'managed-fixture-account.json'), '{}');
      assert.ok(await readAccount(client));
      const models = await readModels(client);
      const reviewTask = {
        kind: 'review',
        title: 'Review a small rename',
        description: '',
        effort: 1,
      } as const;
      assert.throws(() => chooseModel([], reviewTask, undefined, client.provider), {
        message: `${label} returned no available models.`,
      });
      await assert.rejects(
        startTask(client, { cwd, prompt: 'edit-file', model: 'unavailable', sharedGroup: true }),
        { message: `This model is not available to the selected ${label} account.` },
      );
      const blockedCalls = await readFile(path.join(home, 'managed-peer-events.jsonl'), 'utf8');
      assert.doesNotMatch(blockedCalls, /"type":"user"|"method":"session\/prompt"|authenticate/);
      assert.equal(await readFile(path.join(cwd, 'sample.txt'), 'utf8'), 'base');
      const chosen = chooseModel(models, reviewTask);
      assert.equal(chosen.reasoningEffort, 'high');
      if (client.provider === 'claude') assert.equal(chosen.model, 'sonnet');
      let approvals = 0,
        reports = 0,
        updateReads = 0;
      client.on('request', async (request) => {
        try {
          if (request.method === 'item/fileChange/requestApproval') {
            approvals++;
            client.respond(request.id, { decision: 'accept' });
            return;
          }
          let result: unknown;
          if (request.params.tool === 'relay_report') {
            reports++;
            result = { accepted: true };
          } else if (request.params.tool === 'relay_read_shared_updates') {
            updateReads++;
            result = {
              updates: [{ sequence: 1, text: 'Use the saved registration contract.' }],
              through: 1,
            };
          } else
            result = await providerFileTool(
              request.params.tool,
              request.params.arguments,
              { cwd, scopes: ['sample.txt'], readOnly: false },
              () => {},
            );
          client.respond(request.id, {
            success: true,
            contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
          });
        } catch (error) {
          client.rejectRequest(request.id, (error as Error).message);
        }
      });
      const completed = new Promise<any>((resolve) =>
        client.on('notification', (method, params) => {
          if (method === 'turn/completed') resolve(params.turn);
        }),
      );
      const started = await startTask(client, {
        cwd,
        prompt: 'edit-file read-task-update',
        readOnly: false,
        scopes: ['sample.txt'],
        dynamicTools: [...relayDynamicTools, groupReadUpdatesTool],
        model: chosen.model,
        reasoningEffort: chosen.reasoningEffort,
      });
      assert.ok(started.threadId);
      assert.equal((await completed).status, 'completed');
      assert.equal(approvals, 1);
      assert.equal(reports, 1);
      assert.equal(updateReads, 1);
      assert.equal(await readFile(path.join(cwd, 'sample.txt'), 'utf8'), 'reviewed change');
      if (client.provider === 'antigravity')
        assert.equal(await readFile(path.join(home, 'permission-denied'), 'utf8'), 'true');
      const calls = await readFile(path.join(home, 'managed-peer-events.jsonl'), 'utf8');
      assert.equal(
        calls.includes('authenticate'),
        false,
        'Reading cached identity must not trigger OAuth.',
      );
      await client.stop();
      assert.equal(client.pid, undefined);
    },
  );
  test(
    `${Client.name}: read-only sessions cannot request a write tool`,
    { timeout: 20000 },
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-managed-readonly-'));
      await writeFile(path.join(root, 'managed-fixture-account.json'), '{}');
      const client = new Client({
        home: root,
        cwd: root,
        command: path.resolve('tests/fixtures/managed-peer.mjs'),
      });
      t.after(async () => {
        await client.stop();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        await rm(root, { recursive: true, force: true });
      });
      let approvals = 0;
      client.on('request', (request) => {
        if (request.method === 'item/fileChange/requestApproval') approvals++;
        client.respond(request.id, {
          success: true,
          contentItems: [{ type: 'inputText', text: '{}' }],
        });
      });
      const completed = new Promise<any>((resolve) =>
        client.on('notification', (method, params) => {
          if (method === 'turn/completed') resolve(params.turn);
        }),
      );
      await startTask(client, { cwd: root, prompt: 'edit-file', readOnly: true });
      assert.equal((await completed).status, 'failed');
      assert.equal(approvals, 0);
    },
  );
}
test('existing external profiles require an explicit opt-in before Sade may start their CLI', () => {
  assert.equal(isExternalMember({ provider: 'claude', integration: 'native' }), true);
  assert.equal(
    isExternalMember({ provider: 'antigravity', integration: 'external', managedRuntime: true }),
    true,
  );
  assert.equal(
    isExternalMember({ provider: 'claude', integration: 'native', managedRuntime: true }),
    true,
  );
});

test(
  'Antigravity startup failure terminates the incompatible native process',
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-bad-acp-'));
    await writeFile(path.join(root, 'invalid-initialize'), 'true');
    const client = new AntigravityClient({
      home: root,
      cwd: root,
      command: path.resolve('tests/fixtures/managed-peer.mjs'),
    });
    client.on('error', () => {});
    t.after(async () => {
      await client.stop();
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      await rm(root, { recursive: true, force: true });
    });
    await assert.rejects(client.start(), /Unsupported/);
    assert.equal(client.pid, undefined);
  },
);

test(
  'Antigravity reviews only registered Kivuno tools in the active session and honors a one-time decision',
  { timeout: 20000 },
  async (t) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'kivuno-managed-review-'));
    await writeFile(path.join(home, 'managed-fixture-account.json'), '{}');
    const client = new AntigravityClient({
      home,
      cwd: home,
      command: path.resolve('tests/fixtures/managed-peer.mjs'),
    });
    t.after(async () => {
      await client.stop();
      await rm(home, { recursive: true, force: true });
    });
    let reviews = 0,
      posts = 0;
    let decision = 'decline';
    client.on('request', (request) => {
      if (request.method === 'item/mcp/requestApproval') {
        assert.equal(request.params.tool, 'mesh_post');
        assert.equal(request.params.arguments.content, 'QA post');
        reviews++;
        client.respond(request.id, { decision });
      } else {
        assert.equal(request.method, 'item/tool/call');
        assert.equal(request.params.tool, 'mesh_post');
        posts++;
        client.respond(request.id, { success: true, contentItems: [] });
      }
    });
    for (const expected of ['decline', 'accept']) {
      decision = expected;
      const completed = new Promise<any>((resolve) => {
        const finish = (method: string, params: any) => {
          if (method !== 'turn/completed') return;
          client.off('notification', finish);
          resolve(params.turn);
        };
        client.on('notification', finish);
      });
      await startTask(client, {
        cwd: home,
        prompt: 'test-acp-review',
        readOnly: true,
        dynamicTools: [
          {
            type: 'function',
            name: 'mesh_post',
            description: 'Post a message',
            inputSchema: { type: 'object' },
          },
        ],
      });
      const turn = await completed;
      assert.equal(turn.status, expected === 'accept' ? 'completed' : 'failed');
      if (expected === 'decline') assert.match(turn.error.message, /mesh_post/);
      assert.equal(posts, expected === 'accept' ? 1 : 0);
    }
    assert.equal(reviews, 2);
  },
);
