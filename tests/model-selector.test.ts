import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { CodexModel, Member, Project } from '../shared/types.ts';
import { buildApp } from '../server/app.ts';
import { Workspace } from '../server/service.ts';
import { Store } from '../server/store.ts';

const model = (
  id: string,
  name: string,
  displayName: string,
  isDefault = false,
  efforts: string[] = [],
): CodexModel => ({
  id,
  model: name,
  displayName,
  isDefault,
  defaultReasoningEffort: efforts[0] || '',
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
    reasoningEffort,
    description: '',
  })),
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kivuno-model-selector-'));
  const store = new Store(path.join(dir, 'workspace.db'));
  const workspace = new Workspace(store, dir, dir);
  const atlas = store.updateMember(store.addMember({ name: 'Atlas', role: 'engineer' }).id, {
    status: 'ready',
    account: { type: 'chatgpt', email: 'atlas@example.test' },
  });
  const gemini = store.updateMember(
    store.addMember({ name: 'Gemini', role: 'researcher', provider: 'gemini' }).id,
    { status: 'ready', account: { type: 'gemini-google', email: 'gemini@example.test' } },
  );
  const external = store.updateMember(
    store.addMember({ name: 'Claude', role: 'reviewer', provider: 'claude' }).id,
    { status: 'ready', account: { type: 'claude', email: 'claude@example.test' } },
  );
  const outside = store.updateMember(store.addMember({ name: 'Outside', role: 'engineer' }).id, {
    status: 'ready',
    account: { type: 'chatgpt', email: 'outside@example.test' },
  });
  const project = store.put('project', {
    id: randomUUID(),
    name: 'Model picker',
    path: dir,
    goal: '',
    memberIds: [atlas.id, gemini.id, external.id],
    chatConfig: { reasoningEffort: 'high', skills: ['writing'] },
    createdAt: new Date().toISOString(),
  } satisfies Project);
  const catalogs = new Map<string, CodexModel[]>([
    [
      atlas.id,
      [
        model('default-id', 'default-model', 'Default model', true, ['medium', 'high']),
        model('shared-id', 'shared-model', 'Shared model', false, ['high']),
      ],
    ],
    [
      gemini.id,
      [
        model('shared-gemini-id', 'shared-model', 'Gemini shared model'),
        model('gemini-id', 'gemini-model', 'Gemini model'),
      ],
    ],
    [outside.id, [model('outside-id', 'outside-model', 'Outside model')]],
  ]);
  const clientReads: string[] = [];
  workspace.client = async (memberId) => {
    clientReads.push(memberId);
    const member = store.get<Member>('member', memberId);
    const accountType = member.provider === 'gemini' ? 'gemini-google' : 'chatgpt';
    const available = catalogs.get(memberId) || [];
    return {
      provider: member.provider || 'codex',
      start: async () => {},
      request: async (method: string) => {
        if (method === 'account/read')
          return { account: { type: accountType, email: member.account?.email } };
        if (method === 'model/list') return { data: available, nextCursor: null };
        throw new Error(`Unexpected test provider call: ${method}`);
      },
    } as any;
  };
  const app = await buildApp(workspace, { port: 4319 });
  const bootstrap = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host: '127.0.0.1:4319' },
  });
  const cookie = String(bootstrap.headers['set-cookie']).split(';')[0];
  const token = bootstrap.json().token;
  const request = (method: string, url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: {
        host: '127.0.0.1:4319',
        cookie,
        'x-relay-token': token,
        'content-type': 'application/json',
      },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
  return {
    app,
    store,
    workspace,
    project,
    atlas,
    gemini,
    external,
    outside,
    clientReads,
    request,
    close: async () => {
      await app.close();
      await workspace.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('project model selector lists unique models from its native roster accounts only', async (t) => {
  const f = await fixture();
  t.after(f.close);

  const response = await f.request('GET', `/api/projects/${f.project.id}/models`);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().map((entry: CodexModel) => entry.model),
    ['default-model', 'gemini-model', 'shared-model'],
  );
  assert.equal(new Set(response.json().map((entry: CodexModel) => entry.model)).size, 3);
  assert.equal(f.clientReads.includes(f.atlas.id), true);
  assert.equal(f.clientReads.includes(f.gemini.id), true);
  assert.equal(f.clientReads.includes(f.external.id), false);
  assert.equal(f.clientReads.includes(f.outside.id), false);
});

test('project model selection validates, persists, clears incompatible reasoning, and restores auto', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const url = `/api/projects/${f.project.id}/chat-config`;

  const selected = await f.request('PATCH', url, { model: 'default-model' });
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(selected.json().chatConfig, {
    model: 'default-model',
    reasoningEffort: 'high',
    skills: ['writing'],
  });

  const invalid = await f.request('PATCH', url, { model: 'not-in-catalog' });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(f.store.get<Project>('project', f.project.id).chatConfig, {
    model: 'default-model',
    reasoningEffort: 'high',
    skills: ['writing'],
  });

  const incompatible = await f.request('PATCH', url, { model: 'gemini-model' });
  assert.equal(incompatible.statusCode, 200);
  assert.deepEqual(incompatible.json().chatConfig, {
    model: 'gemini-model',
    skills: ['writing'],
  });

  const automatic = await f.request('PATCH', url, { model: null });
  assert.equal(automatic.statusCode, 200);
  assert.deepEqual(automatic.json().chatConfig, { skills: ['writing'] });
});

test('project model catalog stays usable when every connected provider is offline', async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.workspace.client = async () => {
    throw new Error('Provider is offline.');
  };

  const response = await f.request('GET', `/api/projects/${f.project.id}/models`);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);
});
