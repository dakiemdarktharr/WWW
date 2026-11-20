/** Offline, scoped reset for the old SQLite identities when cutting over to MongoDB.
 * Dry-run by default. Stops short of projects, chat history, billing and provider profiles.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const allowed = new Set(['--data-dir', '--backup-dir', '--expect-public-users', '--apply']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error('Unknown reset argument.');
  if (args[i] !== '--apply') {
    if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing reset argument value.');
  }
}
const source = value('--data-dir');
if (!source || !path.isAbsolute(source))
  throw new Error('Provide an absolute --data-dir for the Kivuno coordinator.');
const directory = path.resolve(source);
const identityPath = path.join(directory, 'identity.db'),
  workspacePath = path.join(directory, 'workspace.db');
if (!existsSync(identityPath) || !existsSync(workspacePath))
  throw new Error('The exact identity.db and workspace.db must both exist.');
if (args.includes('--apply')) {
  const lock = path.join(directory, 'coordinator.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error('Coordinator lock is invalid. Resolve it before resetting accounts.');
    let running = false;
    try {
      process.kill(pid, 0);
      running = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (running) throw new Error('Stop the coordinator safely before applying the account reset.');
  }
}
const db = new DatabaseSync(identityPath),
  workspace = new DatabaseSync(workspacePath);
try {
  const owner = db.prepare('SELECT id FROM user WHERE email=?').get('owner@relay.invalid');
  if (!owner)
    throw new Error('The private bootstrap identity is missing; refusing to infer reset scope.');
  const count = Number(
    db.prepare('SELECT count(*) AS count FROM user WHERE id<>?').get(owner.id)!.count,
  );
  const report = {
    publicAccounts: count,
    browserSessions: Number(db.prepare('SELECT count(*) AS count FROM session').get()!.count),
    desktopDevices: Number(
      workspace.prepare("SELECT count(*) AS count FROM records WHERE kind='desktopDevice'").get()!
        .count,
    ),
    desktopGrants: Number(
      workspace.prepare("SELECT count(*) AS count FROM records WHERE kind='desktopGrant'").get()!
        .count,
    ),
    keepsPrivateBootstrap: true,
  };
  if (!args.includes('--apply')) console.log(JSON.stringify({ dryRun: true, ...report }));
  else {
    const expected = value('--expect-public-users'),
      backupRoot = value('--backup-dir');
    if (!expected || !/^\d+$/.test(expected) || Number(expected) !== count)
      throw new Error('Re-run the inventory and pass its exact --expect-public-users count.');
    if (!backupRoot || !path.isAbsolute(backupRoot))
      throw new Error('Apply requires an absolute private --backup-dir.');
    const backupDirectory = path.join(
      path.resolve(backupRoot),
      `identity-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    );
    if (path.resolve(backupDirectory) === directory)
      throw new Error('Backups must be separate from active coordinator data.');
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await backup(db, path.join(backupDirectory, 'identity.db'));
    await backup(workspace, path.join(backupDirectory, 'workspace.db'));
    for (const file of ['identity.db', 'workspace.db'])
      await chmod(path.join(backupDirectory, file), 0o600);
    workspace.close();
    db.prepare('ATTACH DATABASE ? AS workspace_reset').run(workspacePath);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM session; DELETE FROM verification; DELETE FROM rateLimit;');
      db.prepare('DELETE FROM account WHERE userId<>?').run(owner.id);
      db.prepare('DELETE FROM user WHERE id<>?').run(owner.id);
      db.exec(
        "DELETE FROM workspace_reset.records WHERE kind IN ('desktopDevice','desktopGrant','sharedSadeGrant')",
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({ applied: true, ...report, backupDirectory }));
  }
} finally {
  db.close();
  if (workspace.isOpen) workspace.close();
}
