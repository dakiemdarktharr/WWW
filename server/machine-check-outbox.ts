import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RunnerEvent } from './runners.ts';

export const checkRecoveryProtocol = 'check-recovery-v1';

/** The runner's exclusive process lock owns this mailbox across exchange epochs. */
export class MachineCheckOutbox {
  private db: DatabaseSync;
  constructor(directory: string, runnerId: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, `check-outbox-${runnerId}.db`));
    this.db.exec(`CREATE TABLE IF NOT EXISTS receipts
      (id TEXT PRIMARY KEY, event TEXT NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS receipt_delivery ON receipts(state);
      UPDATE receipts SET state='ready' WHERE state='running'`);
  }
  claim(event: RunnerEvent) {
    // A crash between spawn and saving the signature has an unknowable outcome.
    // Keep an explicit interruption for that case. Never start the command again.
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO receipts VALUES (?, ?, 'running')")
        .run(
          event.id,
          JSON.stringify({ ...event, error: 'The runner stopped before saving a signed result.' }),
        ).changes === 1
    );
  }
  finish(event: RunnerEvent) {
    const result = event.result;
    const saved = result
      ? { ...event, result: { evidence: result.evidence, proof: result.proof } }
      : event;
    this.db
      .prepare("UPDATE receipts SET event=?, state='ready' WHERE id=? AND state='running'")
      .run(JSON.stringify(saved), event.id);
  }
  batch(): RunnerEvent[] {
    return this.db
      .prepare("SELECT event FROM receipts WHERE state='ready' ORDER BY rowid LIMIT 40")
      .all()
      .map((row) => JSON.parse(String(row.event)));
  }
  acknowledge(ids: string[]) {
    // Keep only the id after acknowledgement, including for commands rejected before spawn.
    const acknowledge = this.db.prepare(
      "UPDATE receipts SET state='acknowledged', event='' WHERE id=? AND state='ready'",
    );
    for (const id of ids) acknowledge.run(id);
  }
  close() {
    this.db.close();
  }
}
