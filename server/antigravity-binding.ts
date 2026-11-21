import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DomainError } from './store.ts';

// agy shares the OS user's keyring. Consent belongs to each Kivuno profile;
// it is not exclusive ownership of the Google account. Credentials stay in agy.
export class AntigravityBinding {
  constructor(private file = path.join(os.homedir(), '.kivuno', 'antigravity-binding.sqlite')) {}

  owns(profile: string) {
    if (!existsSync(this.file)) return false;
    return this.access(profile, 'read');
  }

  claim(profile: string, confirmed?: boolean) {
    if (!confirmed)
      throw new DomainError('Confirm use of the Antigravity account on this computer.', 409);
    this.access(profile, 'claim');
  }

  release(profile: string) {
    if (existsSync(this.file)) this.access(profile, 'release');
  }

  private access(profile: string, action: 'claim' | 'release' | 'read') {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.file);
    try {
      db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
      db.exec('CREATE TABLE IF NOT EXISTS profile_consents (profile TEXT PRIMARY KEY)');
      // Consume the old single-owner row exactly once. Keeping it would restore
      // a revoked consent on the next read. The transaction also handles races.
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='binding'").get()) {
        db.exec(
          'INSERT OR IGNORE INTO profile_consents SELECT profile FROM binding; DROP TABLE binding',
        );
      }
      const owner = path.resolve(profile);
      const key = process.platform === 'win32' ? owner.toLowerCase() : owner;
      if (action === 'claim')
        db.prepare('INSERT OR IGNORE INTO profile_consents VALUES (?)').run(key);
      if (action === 'release') db.prepare('DELETE FROM profile_consents WHERE profile=?').run(key);
      const consent = Boolean(
        db.prepare('SELECT 1 FROM profile_consents WHERE profile=?').get(key),
      );
      db.exec('COMMIT');
      return consent;
    } finally {
      db.close();
    }
  }
}
