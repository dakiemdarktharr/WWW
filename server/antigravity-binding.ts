import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DomainError } from './store.ts';

// agy uses the OS user's keyring across Kivuno workspaces. Only the profile
// path is retained here. The Google credentials stay with the official CLI.
export class AntigravityBinding {
  constructor(private file = path.join(os.homedir(), '.kivuno', 'antigravity-binding.sqlite')) {}

  owns(profile: string) {
    if (!existsSync(this.file)) return false;
    return this.access(profile, 'read');
  }

  claim(profile: string, confirmed?: boolean) {
    if (!confirmed)
      throw new DomainError('Confirm use of the Antigravity account on this computer.', 409);
    if (!this.access(profile, 'claim'))
      throw new DomainError(
        'This computer already has a managed Antigravity connection. Disconnect it in its Kivuno workspace first.',
        409,
      );
  }

  release(profile: string) {
    if (existsSync(this.file)) this.access(profile, 'release');
  }

  private access(profile: string, action: 'claim' | 'release' | 'read') {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.file);
    try {
      db.exec(
        'PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS binding (slot INTEGER PRIMARY KEY CHECK(slot=1), profile TEXT NOT NULL)',
      );
      const owner = path.resolve(profile);
      const key = process.platform === 'win32' ? owner.toLowerCase() : owner;
      if (action === 'claim') db.prepare('INSERT OR IGNORE INTO binding VALUES (1, ?)').run(key);
      if (action === 'release') db.prepare('DELETE FROM binding WHERE profile=?').run(key);
      return Boolean(db.prepare('SELECT 1 FROM binding WHERE profile=?').get(key));
    } finally {
      db.close();
    }
  }
}
