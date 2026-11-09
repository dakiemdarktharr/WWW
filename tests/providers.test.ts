import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GeminiClient, geminiEnvironment } from '../server/gemini.ts';
import { readAccount, readModels, startTask } from '../server/codex.ts';
import { nativeProviderClient } from '../server/providers.ts';
import { providerFileTool } from '../server/provider-files.ts';
import { Store } from '../server/store.ts';
import { QuotaManager } from '../server/quota.ts';
import { chooseModel } from '../server/autonomy.ts';
import type { CodexSession } from '../shared/types.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-provider-'));
  const home = path.join(root, 'profile'),
    cwd = path.join(root, 'project');
  await mkdir(path.join(home, '.gemini'), { recursive: true });
  await mkdir(cwd);
  await writeFile(path.join(home, '.gemini', 'oauth_creds.json'), '{}'); // Fake peer only; never passed to the real CLI.
  const client = new GeminiClient({
    home,
    cwd,
    command: path.resolve('tests/fixtures/gemini-peer.mjs'),
  });
  t.after(async () => {
    await client.stop();
    const actual = await realpath(root),
      temp = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), temp);
    assert.ok(path.basename(actual).startsWith('kivuno-provider-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { root, home, cwd, client };
}

test('Gemini environment isolates profiles and drops all API, Vertex and arbitrary application credentials', () => {
  const environment = geminiEnvironment('C:/isolated/profile', {
    PATH: 'safe',
    GEMINI_API_KEY: 'private',
    GOOGLE_API_KEY: 'private',
    GOOGLE_APPLICATION_CREDENTIALS: 'private',
    GOOGLE_CLOUD_PROJECT: 'paid-project',
    ANTHROPIC_API_KEY: 'private',
    OPENAI_API_KEY: 'private',
    SECRET: 'private',
    HOME: 'C:/personal',
    NODE_OPTIONS: '--require=untrusted',
  });
  assert.equal(environment.GEMINI_CLI_HOME, 'C:/isolated/profile');
  assert.equal(environment.HOME, 'C:/isolated/profile');
  assert.equal(environment.GEMINI_API_KEY, '');
  assert.equal(environment.GOOGLE_API_KEY, '');
  assert.equal(environment.GOOGLE_CLOUD_PROJECT, '');
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.SECRET, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.GEMINI_CLI_NO_RELAUNCH, '1');
  assert.equal(environment.NO_BROWSER, '1');
  assert.equal(environment.GEMINI_FORCE_FILE_STORAGE, 'true');
  assert.equal(environment.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE, '');
});

test('Gemini restarts do not request login or launch a browser; only explicit sign-in enables the browser', async (t) => {
  const f = await fixture(t);
  await unlink(path.join(f.home, '.gemini', 'oauth_creds.json'));
  await f.client.start();
  assert.equal(await readAccount(f.client), null);
  await f.client.stop();
  await f.client.start();
  assert.equal(await readAccount(f.client), null);
  const calls = () =>
    readFile(path.join(f.home, 'peer-calls.jsonl'), 'utf8').then((data) =>
      data
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
  assert.deepEqual(
    (await calls()).map((entry) => entry.method),
    ['initialize', 'initialize'],
  );
  assert.ok((await calls()).every((entry) => entry.noBrowser === '1'));
  const loggedIn = new Promise<void>((resolve) =>
    f.client.on('notification', (method, params) => {
      if (method === 'account/login/completed' && params.success) resolve();
    }),
  );
  let profileExits = 0;
  f.client.on('exit', () => profileExits++);
  const login = await f.client.request('account/login/start');
  assert.equal(login.type, 'geminiGoogle');
  await loggedIn;
  assert.equal(
    profileExits,
    0,
    'internal login transport restart must preserve the Workspace client and sign-in lock',
  );
  assert.equal((await calls()).filter((entry) => entry.method === 'authenticate').length, 1);
  assert.equal((await calls()).find((entry) => entry.method === 'authenticate')?.noBrowser, '');
  await f.client.stop();
  await f.client.start();
  assert.equal(await readAccount(f.client), null);
  assert.equal((await calls()).at(-1)?.noBrowser, '1');
  assert.equal((await calls()).filter((entry) => entry.method === 'session/prompt').length, 0);
});

test('Gemini sign-in recovers from newly saved OAuth credentials when the ACP response stalls', async (t) => {
  const f = await fixture(t);
  const credentials = path.join(f.home, '.gemini', 'oauth_creds.json');
  await unlink(credentials);
  await writeFile(path.join(f.home, '.gemini', 'fixture-hang-first-auth'), '');
  const completed = new Promise<void>((resolve) =>
    f.client.on('notification', (method, params) => {
      if (method === 'account/login/completed' && params.success) resolve();
    }),
  );
  let profileExits = 0;
  f.client.on('exit', () => profileExits++);
  const login = await f.client.request('account/login/start');
  assert.equal(login.type, 'geminiGoogle');

  let account;
  for (let attempt = 0; attempt < 10 && !account; attempt++) {
    account = await readAccount(f.client);
    if (!account) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(account?.type, 'gemini-google');
  await completed;
  assert.equal(profileExits, 0, 'credential recovery keeps the owning Workspace client alive');
  const calls = (await readFile(path.join(f.home, 'peer-calls.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map((entry) => entry.method),
    ['initialize', 'authenticate', 'initialize', 'authenticate'],
  );
  assert.equal(calls[1].noBrowser, '');
  assert.equal(calls[3].noBrowser, '1', 'cached verification must not launch another browser');
});

test('official ACP wire contract translates real process streams and model selection without inventing reasoning', async (t) => {
  const f = await fixture(t);
  await f.client.start();
  assert.equal((await readAccount(f.client))?.type, 'gemini-google');
  const catalog = await readModels(f.client);
  assert.equal(catalog[0].model, 'gemini-controlled');
  assert.deepEqual(catalog[0].supportedReasoningEfforts, []);
  assert.equal(
    chooseModel(catalog, { kind: 'code', title: 'Build', description: '' }).reasoningEffort,
    undefined,
  );
  const notifications: string[] = [];
  const completed = new Promise<any>((resolve) =>
    f.client.on('notification', (method, params) => {
      notifications.push(method);
      if (method === 'turn/completed') resolve(params);
    }),
  );
  const ids = await startTask(f.client, {
    cwd: f.cwd,
    prompt: 'Controlled prompt',
    model: 'gemini-controlled',
    readOnly: true,
  });
  assert.equal((await completed).turn.status, 'completed');
  assert.ok(ids.threadId && ids.turnId);
  assert.ok(notifications.includes('item/agentMessage/delta'));
  await assert.rejects(
    startTask(f.client, {
      cwd: f.cwd,
      prompt: 'Never sent',
      model: 'gemini-controlled',
      reasoningEffort: 'high',
      readOnly: true,
    }),
    /does not support/,
  );
  await assert.rejects(f.client.request('turn/steer', { threadId: ids.threadId }), /cannot steer/);
  const resumed = await f.client.request('thread/resume', {
    threadId: ids.threadId,
    cwd: f.cwd,
    dynamicTools: [],
    model: 'gemini-controlled',
  });
  assert.equal(resumed.thread.id, ids.threadId);
  assert.equal(resumed.toolPolicy.kind, 'scoped-mcp');
  assert.equal(resumed.sandbox, undefined, 'tool policy must not pretend to be an OS sandbox');
});

test('Gemini scoped MCP write requires a human decision and a current owned scope', async (t) => {
  const f = await fixture(t);
  let approvals = 0,
    writes = 0;
  f.client.on('request', (request) => {
    if (request.method === 'item/fileChange/requestApproval') {
      approvals++;
      f.client.respond(request.id, { decision: 'accept' });
    } else {
      void providerFileTool(
        request.params.tool,
        request.params.arguments,
        { cwd: f.cwd, readOnly: false, scopes: ['src'] },
        () => {},
      ).then(
        (result) => {
          writes++;
          f.client.respond(request.id, {
            success: true,
            contentItems: [{ text: JSON.stringify(result) }],
          });
        },
        (error) => f.client.rejectRequest(request.id, error.message),
      );
    }
  });
  const completed = new Promise<any>((resolve) =>
    f.client.on('notification', (method, params) => {
      if (method === 'turn/completed') resolve(params);
    }),
  );
  await startTask(f.client, {
    cwd: f.cwd,
    prompt: 'CONTROLLED_WRITE',
    readOnly: false,
    scopes: ['src'],
  });
  assert.equal((await completed).turn.status, 'completed');
  assert.equal(approvals, 1);
  assert.equal(writes, 1);
  assert.equal(await readFile(path.join(f.cwd, 'src/result.txt'), 'utf8'), 'Controlled output');
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'outside.txt', content: 'no' },
      { cwd: f.cwd, readOnly: false, scopes: ['src'] },
      () => {},
    ),
    /outside.*scopes/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src/blocked.txt', content: 'no' },
      { cwd: f.cwd, readOnly: true, scopes: ['src'] },
      () => {},
    ),
    /read-only/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_read_file',
      { path: '../secret' },
      { cwd: f.cwd, readOnly: true, scopes: ['.'] },
      () => {},
    ),
    /scope|relative|outside/i,
  );
  for (const privatePath of [
    '.codex/config.toml',
    '.gemini/oauth_creds.json',
    '.claude/.credentials.json',
    '.mcp.json',
    '.claude.json',
    '.agents/mcp_config.json',
    '.antigravity/credentials.json',
    'oauth_creds.json',
    'google_accounts.json',
    '.credentials.json',
    '.aws/config',
    'nested/.ssh/id_rsa',
  ])
    await assert.rejects(
      providerFileTool(
        'workspace_read_file',
        { path: privatePath },
        { cwd: f.cwd, readOnly: true, scopes: ['.'] },
        () => {},
      ),
      /Private files/,
    );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src/stale.txt', content: 'no' },
      { cwd: f.cwd, readOnly: false, scopes: ['src'] },
      () => {
        throw new Error('Lease lost');
      },
    ),
    /Lease lost/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_read_file',
      { path: 'src' },
      { cwd: f.cwd, readOnly: true, scopes: ['.'] },
      () => {},
    ),
    /regular files/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src', content: 'no' },
      { cwd: f.cwd, readOnly: false, scopes: ['.'] },
      () => {},
    ),
    /regular files/,
  );
  for (const device of ['CON', 'src/NUL.txt', 'PRN', 'COM1', 'LPT9.log'])
    await assert.rejects(
      providerFileTool(
        'workspace_read_file',
        { path: device },
        { cwd: f.cwd, readOnly: true, scopes: ['.'] },
        () => {},
      ),
      /Device paths/,
    );
  await assert.rejects(
    providerFileTool(
      'workspace_read_file',
      { path: '.gemini./oauth_creds.json' },
      { cwd: f.cwd, readOnly: true, scopes: ['.'] },
      () => {},
    ),
    /Ambiguous/,
  );
});

test('unknown Gemini quota stays unknown, cannot run automatically, and consumes explicit bounded grants atomically', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const member = store.addMember({ name: 'Gemini', role: 'engineer', provider: 'gemini' });
  const projectId = randomUUID();
  store.put('project', { id: projectId, memberIds: [member.id] });
  const quota = new QuotaManager({
    store,
    closing: false,
    client: async () => {
      throw new Error('No network');
    },
    log: () => {},
  });
  assert.equal(quota.current(member.id).status, 'unknown');
  assert.throws(() => quota.assertCanRun(member.id, projectId), /bounded/);
  const grant = quota.grantTurns(member.id, {
    projectId,
    maxTurns: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    acknowledgeUnknownQuota: true,
  });
  assert.equal(quota.assertCanRun(member.id, projectId).status, 'unknown');
  const session = store.put('session', {
    id: randomUUID(),
    memberId: member.id,
    projectId,
    status: 'starting',
  } as CodexSession);
  quota.consumeTurn(member.id, projectId, session.id);
  assert.equal(quota.assertCanRun(member.id, projectId, session.id).status, 'unknown');
  assert.throws(() => quota.assertCanRun(member.id, projectId), /bounded/);
  assert.throws(() => quota.consumeTurn(member.id, projectId, randomUUID()), /exhausted/);
  quota.completeTurn(session.id);
  assert.throws(() => quota.assertCanRun(member.id, projectId, session.id), /bounded/);
  assert.equal(store.get<any>('providerTurnGrant', grant.id).usedTurns, 1);
  assert.equal(quota.current(member.id).windows.length, 0);
  const next = quota.grantTurns(member.id, {
    projectId,
    maxTurns: 2,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    acknowledgeUnknownQuota: true,
  });
  quota.consumeTurn(member.id, projectId, session.id);
  for (let step = 0; step < 4; step++) quota.assertCanRun(member.id, projectId, session.id);
  assert.equal(
    store.get<any>('providerTurnGrant', next.id).usedTurns,
    1,
    'tool steps check the active allowance without consuming extra human prompts',
  );
  quota.completeTurn(session.id);
  quota.consumeTurn(member.id, projectId, session.id);
  assert.equal(
    store.get<any>('providerTurnGrant', next.id).usedTurns,
    2,
    'resume consumes a second prompt',
  );
  quota.grantTurns(member.id, {
    projectId,
    maxTurns: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    acknowledgeUnknownQuota: true,
  });
  quota.revokeTurns(next.id);
  assert.throws(
    () => quota.assertCanRun(member.id, projectId, session.id),
    /bounded/,
    'another unused allowance must not silently replace a revoked active one',
  );
  assert.throws(
    () => nativeProviderClient({ ...member, provider: 'claude' }, 'C:/unused', 'C:/unused'),
    /external MESH/,
  );
  assert.throws(
    () => nativeProviderClient({ ...member, provider: 'antigravity' }, 'C:/unused', 'C:/unused'),
    /external MESH/,
  );
});
