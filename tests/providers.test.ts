import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeProviderClient } from '../server/providers.ts';
import { providerFileTool } from '../server/provider-files.ts';
import { Store } from '../server/store.ts';
import { QuotaManager } from '../server/quota.ts';
import type { CodexSession } from '../shared/types.ts';

test('scoped provider file tools enforce project boundaries and active leases', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'kivuno-provider-'));
  await mkdir(path.join(cwd, 'src'));
  t.after(async () => {
    const actual = await realpath(cwd);
    assert.equal(path.dirname(actual), await realpath(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('kivuno-provider-'));
    await rm(actual, { recursive: true, force: true });
  });
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'outside.txt', content: 'no' },
      { cwd, readOnly: false, scopes: ['src'] },
      () => {},
    ),
    /outside.*scopes/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src/blocked.txt', content: 'no' },
      { cwd, readOnly: true, scopes: ['src'] },
      () => {},
    ),
    /read-only/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_read_file',
      { path: '../secret' },
      { cwd, readOnly: true, scopes: ['.'] },
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
        { cwd, readOnly: true, scopes: ['.'] },
        () => {},
      ),
      /Private files/,
    );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src/stale.txt', content: 'no' },
      { cwd, readOnly: false, scopes: ['src'] },
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
      { cwd, readOnly: true, scopes: ['.'] },
      () => {},
    ),
    /regular files/,
  );
  await assert.rejects(
    providerFileTool(
      'workspace_write_file',
      { path: 'src', content: 'no' },
      { cwd, readOnly: false, scopes: ['.'] },
      () => {},
    ),
    /regular files/,
  );
  for (const device of ['CON', 'src/NUL.txt', 'PRN', 'COM1', 'LPT9.log'])
    await assert.rejects(
      providerFileTool(
        'workspace_read_file',
        { path: device },
        { cwd, readOnly: true, scopes: ['.'] },
        () => {},
      ),
      /Device paths/,
    );
  await assert.rejects(
    providerFileTool(
      'workspace_read_file',
      { path: '.gemini./oauth_creds.json' },
      { cwd, readOnly: true, scopes: ['.'] },
      () => {},
    ),
    /Ambiguous/,
  );
});

test('unknown provider quota stays unknown, cannot run automatically, and consumes explicit bounded grants atomically', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const profile = store.addMember({ name: 'Vega', role: 'engineer', provider: 'antigravity' });
  const member = store.updateMember(profile.id, { managedRuntime: true });
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
    () => nativeProviderClient({ ...member, provider: 'gemini' }, 'C:/unused', 'C:/unused'),
    /retired/,
  );
  assert.throws(
    () =>
      nativeProviderClient(
        { ...member, provider: 'claude', managedRuntime: false },
        'C:/unused',
        'C:/unused',
      ),
    /external MESH/,
  );
  assert.throws(
    () => nativeProviderClient({ ...member, managedRuntime: false }, 'C:/unused', 'C:/unused'),
    /external MESH/,
  );
});
