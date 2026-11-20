import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { Store } from '../server/store.ts';
const exec = promisify(execFile);

test('offline account reset inventories first, refuses live coordinator and count mismatch, backs up and preserves workspace', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-reset-test-'));
  const backups = path.join(directory, 'backups');
  await mkdir(backups);
  const identity = await createCloudIdentity({
    directory,
    origin: 'https://kivuno.example',
    secret: 's'.repeat(40),
    bootstrapPassword: 'p'.repeat(30),
  });
  const response = await identity.handler(
    new Request('https://kivuno.example/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: 'https://kivuno.example', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'alice-password-123',
      }),
    }),
  );
  assert.equal(response.status, 200);
  await identity.close();
  const store = new Store(path.join(directory, 'workspace.db'));
  store.put('desktopDevice', { id: 'old-device', tokenHash: 'old-token' });
  store.put('desktopGrant', { id: 'old-grant' });
  store.put('sharedSadeGrant', { id: 'old-sade' });
  store.put('test-project', { id: 'keep-project', name: 'Preserve project' });
  store.close();
  const run = (extra: string[] = []) =>
    exec(
      process.execPath,
      [
        '--import',
        'tsx',
        path.resolve('scripts/reset-legacy-accounts.ts'),
        '--data-dir',
        directory,
        ...extra,
      ],
      { cwd: process.cwd() },
    );
  try {
    const initial = JSON.parse((await run()).stdout);
    assert.equal(initial.dryRun, true);
    assert.equal(initial.publicAccounts, 1);
    assert.equal(initial.desktopDevices, 1);
    await writeFile(path.join(directory, 'coordinator.lock'), String(process.pid));
    await assert.rejects(
      run(['--apply', '--expect-public-users', '1', '--backup-dir', backups]),
      /Stop the coordinator/,
    );
    await rm(path.join(directory, 'coordinator.lock'));
    await assert.rejects(
      run(['--apply', '--expect-public-users', '0', '--backup-dir', backups]),
      /exact.*count/,
    );
    const result = JSON.parse(
      (await run(['--apply', '--expect-public-users', '1', '--backup-dir', backups])).stdout,
    );
    assert.equal(result.applied, true);
    assert.equal(result.keepsPrivateBootstrap, true);
    assert.equal((await readdir(backups)).length, 1);
    const db = new DatabaseSync(path.join(directory, 'identity.db'));
    assert.deepEqual(
      db
        .prepare('SELECT email FROM user')
        .all()
        .map((row) => row.email),
      ['owner@relay.invalid'],
    );
    assert.equal(db.prepare('SELECT count(*) AS count FROM session').get()!.count, 0);
    db.close();
    const workspace = new Store(path.join(directory, 'workspace.db'));
    for (const kind of ['desktopDevice', 'desktopGrant', 'sharedSadeGrant'])
      assert.equal(workspace.all(kind).length, 0);
    assert.equal(workspace.all('test-project').length, 1);
    workspace.close();
    const archived = new DatabaseSync(path.join(result.backupDirectory, 'identity.db'));
    assert.equal(archived.prepare('SELECT count(*) AS count FROM user').get()!.count, 2);
    archived.close();
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.match(path.basename(directory), /^kivuno-reset-test-/);
    await rm(directory, { recursive: true, force: true });
  }
});
