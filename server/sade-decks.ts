import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isSadeDeckRequest, sadeDeckMaxBytes, type SadeDeckView } from '../shared/sade-deck.ts';
import { redact } from './security.ts';
import { DomainError, type Store } from './store.ts';

const command = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    id: z.uuid(),
    prompt: z.string().trim().min(8).max(3000),
  }),
  z.strictObject({ action: z.enum(['read', 'download']), id: z.uuid() }),
  z.strictObject({ action: z.literal('list') }),
]);
const source = z.strictObject({ title: z.string().trim().min(1).max(180), url: z.url().max(1500) });
const completion = z.strictObject({
  id: z.uuid(),
  lease: z.uuid(),
  result: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('ready'),
      title: z.string().trim().min(1).max(140),
      sources: z.array(source).min(2).max(12),
      data: z.base64().max(Math.ceil(sadeDeckMaxBytes / 3) * 4),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      worker: z.strictObject({
        provider: z.literal('codex'),
        sessionId: z.string().regex(/^sess_[a-z0-9]{8,96}$/),
        report: z.string().trim().min(1).max(680),
      }),
    }),
    z.strictObject({ status: z.literal('authoring') }),
    z.strictObject({ status: z.literal('retry') }),
  ]),
});
export type SadeDeckResult = z.infer<typeof completion>['result'];

type Deck = SadeDeckView & {
  ownerId: string;
  attempts: number;
  lease?: string;
  availableAt: number;
};
type DeckFile = { id: string; data: string; sha256: string };
const kind = 'sadeDeck';
const fileKind = 'sadeDeckFile';
const ownerColumn = "json_extract(data, '$.ownerId')";
const createdColumn = "json_extract(data, '$.createdAt')";
const maximumAttempts = 3;
const leaseDurationMs = 210000;

export class SadeDecks {
  constructor(
    private store: Store,
    private now = Date.now,
  ) {
    store.db.exec(
      `CREATE INDEX IF NOT EXISTS sade_deck_owner_created
        ON records(${ownerColumn}, ${createdColumn} DESC) WHERE kind='sadeDeck'`,
    );
  }

  private view(deck: Deck): SadeDeckView {
    const { id, prompt, state, createdAt, title, filename, sources, error, worker } = deck;
    return { id, prompt, state, createdAt, title, filename, sources, error, worker };
  }

  execute(ownerId: string, input: unknown) {
    const action = command.parse(input);
    return this.store.transaction(() => {
      const now = this.now();
      if (action.action === 'list') {
        return { decks: this.owned(ownerId).map((deck) => this.view(deck)) };
      }
      let deck = this.store.lookup<Deck>(kind, action.id);
      if (deck && deck.ownerId !== ownerId)
        throw new DomainError('PowerPoint request not found.', 404);
      if (action.action === 'start') {
        const prompt = redact(action.prompt);
        if (deck && deck.prompt !== prompt)
          throw new DomainError('This request was already submitted.', 409);
        if (!deck) {
          if (!isSadeDeckRequest(prompt))
            throw new DomainError('Send a request to create a PowerPoint.', 400);
          const recent = this.owned(ownerId).filter(
            (job) => Date.parse(job.createdAt) > now - 3600000,
          );
          const previous = recent.find(
            (job) =>
              job.prompt === prompt &&
              Date.parse(job.createdAt) > now - 600000 &&
              ['research', 'authoring', 'retrying'].includes(job.state),
          );
          if (previous) return this.claim(previous, now);
          if (recent.length >= 6)
            throw new DomainError('This account has reached its hourly PowerPoint limit.', 429);
          deck = this.store.put(kind, {
            id: action.id,
            ownerId,
            prompt,
            createdAt: new Date(now).toISOString(),
            state: 'research',
            attempts: 0,
            availableAt: now,
          } satisfies Deck);
        }
      }
      if (!deck) throw new DomainError('PowerPoint request not found.', 404);
      if (action.action === 'download') {
        if (deck.state !== 'ready')
          throw new DomainError('This file is still being prepared.', 409);
        const file = this.store.lookup<DeckFile>(fileKind, deck.id);
        if (!file || !deck.filename)
          throw new DomainError('This file could not be retrieved.', 503);
        return { filename: deck.filename, data: file.data, sha256: file.sha256 };
      }
      return this.claim(deck, now);
    });
  }

  private owned(ownerId: string) {
    const rows = this.store.db
      .prepare(
        `SELECT data FROM records WHERE kind='sadeDeck' AND ${ownerColumn}=?
       ORDER BY ${createdColumn} DESC LIMIT 16`,
      )
      .all(ownerId) as { data: string }[];
    return rows.map(({ data }) => JSON.parse(data) as Deck);
  }

  private claim(deck: Deck, now: number) {
    if (deck.state === 'ready' || deck.state === 'failed' || now < deck.availableAt)
      return { deck: this.view(deck) };
    if (deck.attempts >= maximumAttempts) return { deck: this.view(this.failed(deck)) };
    const lease = randomUUID();
    const claimed = this.store.put(kind, {
      ...deck,
      lease,
      attempts: deck.attempts + 1,
      availableAt: now + leaseDurationMs,
      state: 'research',
    } satisfies Deck);
    return {
      deck: this.view(claimed),
      work: { id: claimed.id, lease, prompt: claimed.prompt, date: claimed.createdAt },
    };
  }

  private failed(deck: Deck) {
    return this.store.put(kind, {
      ...deck,
      state: 'failed',
      lease: undefined,
      error:
        'Sade could not verify enough source material or finish the presentation after retrying.',
    } satisfies Deck);
  }

  finish(input: unknown) {
    const { id, lease, result } = completion.parse(input);
    return this.store.transaction(() => {
      const current = this.store.lookup<Deck>(kind, id);
      if (!current || current.lease !== lease || !['research', 'authoring'].includes(current.state))
        return { accepted: false };
      if (result.status === 'authoring') {
        this.store.put(kind, { ...current, state: 'authoring' } satisfies Deck);
      } else if (result.status === 'retry') {
        if (current.attempts >= maximumAttempts) this.failed(current);
        else
          this.store.put(kind, {
            ...current,
            lease: undefined,
            state: 'retrying',
            availableAt: this.now() + current.attempts * 2500,
          } satisfies Deck);
      } else {
        const bytes = Buffer.from(result.data, 'base64');
        if (
          bytes.length < 4 ||
          bytes.length > sadeDeckMaxBytes ||
          bytes.readUInt32LE(0) !== 0x04034b50 ||
          createHash('sha256').update(bytes).digest('hex') !== result.sha256 ||
          result.sources.some(({ url }) => !/^https:\/\//i.test(url))
        )
          throw new DomainError('Generated PowerPoint failed integrity verification.', 400);
        this.store.put(fileKind, {
          id,
          data: result.data,
          sha256: result.sha256,
        } satisfies DeckFile);
        this.store.put(kind, {
          ...current,
          lease: undefined,
          state: 'ready',
          title: result.title,
          sources: result.sources,
          worker: result.worker,
          filename: `Sade-${current.id.slice(0, 8)}.pptx`,
        } satisfies Deck);
      }
      return { accepted: true };
    });
  }
}
