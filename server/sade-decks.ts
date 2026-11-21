import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  isSadeDeckRequest,
  sadeDeckMaxBytes,
  sadeDeckProviders,
  type SadeDeckProvider,
  type SadeDeckView,
} from '../shared/sade-deck.ts';
import { redact } from './security.ts';
import { renderSadePowerPoint } from './shared-sade-project-render.ts';
import { DomainError, type Store } from './store.ts';

const localProvider = z.literal('claude-code');
const claudeSession = z.uuid();
const report = z.string().trim().min(1).max(680);
const localResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('authored'),
    sessionId: claudeSession,
    report,
    outline: z.unknown(),
  }),
  z.strictObject({ status: z.enum(['unavailable', 'failed']) }),
]);
const command = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    id: z.uuid(),
    prompt: z.string().trim().min(8).max(3000),
    localAuthor: localProvider.optional(),
  }),
  z.strictObject({ action: z.enum(['read', 'download']), id: z.uuid() }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({ action: z.literal('worker-poll'), runnerId: z.uuid() }),
  z.strictObject({
    action: z.literal('worker-result'),
    id: z.uuid(),
    taskId: z.uuid(),
    runnerId: z.uuid(),
    result: localResult,
  }),
]);
const source = z.strictObject({ title: z.string().trim().min(1).max(180), url: z.url().max(1500) });
const worker = z.discriminatedUnion('provider', [
  z.strictObject({
    provider: z.literal('codex'),
    sessionId: z.string().regex(/^sess_[a-z0-9]{8,96}$/),
    report,
  }),
  z.strictObject({ provider: localProvider, sessionId: claudeSession, report }),
]);
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
      worker,
    }),
    z.strictObject({ status: z.literal('authoring') }),
    z.strictObject({ status: z.literal('retry') }),
  ]),
});
export type SadeDeckResult = z.infer<typeof completion>['result'];

const authorInput = z.strictObject({
  instructions: z.string().min(1).max(3000),
  brief: z.string().min(1).max(14000),
  schema: z.string().min(1).max(6000),
});
const workerRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('assign'),
    id: z.uuid(),
    lease: z.uuid(),
    taskId: z.uuid(),
    input: authorInput,
  }),
  z.strictObject({
    action: z.literal('result'),
    id: z.uuid(),
    lease: z.uuid(),
    taskId: z.uuid(),
  }),
]);
type LocalTask = {
  id: string;
  input: z.infer<typeof authorInput>;
  expiresAt: number;
  runnerId?: string;
  result?: z.infer<typeof localResult>;
};

const renderRequest = z.strictObject({
  id: z.uuid(),
  lease: z.uuid(),
  presentation: z.strictObject({
    title: z.string().min(1).max(130),
    slides: z
      .array(
        z.strictObject({
          title: z.string().min(1).max(130),
          bullets: z.array(z.string().min(1).max(400)).min(1).max(5),
          bulletLinks: z
            .array(z.url({ protocol: /^https$/ }).max(1500))
            .max(5)
            .optional(),
        }),
      )
      .min(1)
      .max(16),
  }),
});

type Deck = SadeDeckView & {
  ownerId: string;
  authoringDeviceId?: string;
  localAuthor?: z.infer<typeof localProvider>;
  attempts: number;
  lease?: string;
  availableAt: number;
  assignmentIds?: string[];
  tried?: SadeDeckProvider[];
  localTask?: LocalTask;
};
type DeckFile = { id: string; data: string; sha256: string };
const kind = 'sadeDeck';
const fileKind = 'sadeDeckFile';
const ownerColumn = "json_extract(data, '$.ownerId')";
const createdColumn = "json_extract(data, '$.createdAt')";
const maximumAttempts = 3;
const leaseDurationMs = 275000;
const localTaskDurationMs = 64000;

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
    const { id, prompt, state, createdAt, title, filename, sources, error, worker, assignments } =
      deck;
    return { id, prompt, state, createdAt, title, filename, sources, error, worker, assignments };
  }

  execute(ownerId: string, input: unknown, deviceId?: string) {
    const action = command.parse(input);
    return this.store.transaction(() => {
      const now = this.now();
      if (action.action === 'list') {
        return { decks: this.owned(ownerId).map((deck) => this.view(deck)) };
      }
      if (action.action === 'worker-poll') {
        const active = this.owned(ownerId).filter(
          (deck) =>
            ['research', 'retrying', 'authoring'].includes(deck.state) &&
            deviceId &&
            deck.authoringDeviceId === deviceId &&
            deck.localAuthor,
        );
        const offered = active.find(
          ({ localTask, availableAt }) =>
            localTask &&
            !localTask.result &&
            localTask.expiresAt > now &&
            availableAt > now &&
            (!localTask.runnerId || localTask.runnerId === action.runnerId),
        );
        if (!offered?.localTask) return { active: active.length > 0 };
        const task = offered.localTask;
        if (!task.runnerId)
          this.store.put(kind, { ...offered, localTask: { ...task, runnerId: action.runnerId } });
        return {
          active: true,
          assignment: {
            id: offered.id,
            taskId: task.id,
            deadlineMs: task.expiresAt - now,
            input: task.input,
          },
        };
      }
      let deck = this.store.lookup<Deck>(kind, action.id);
      if (deck && deck.ownerId !== ownerId)
        throw new DomainError('PowerPoint request not found.', 404);
      if (action.action === 'worker-result') {
        if (!deck || !deviceId || deck.authoringDeviceId !== deviceId)
          throw new DomainError('PowerPoint request not found.', 404);
        const task = deck.localTask;
        if (
          deck.state !== 'authoring' ||
          task?.id !== action.taskId ||
          task.runnerId !== action.runnerId ||
          task.expiresAt <= now ||
          deck.availableAt <= now
        )
          return { accepted: false };
        if (!task.result)
          this.store.put(kind, { ...deck, localTask: { ...task, result: action.result } });
        return { accepted: true };
      }
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
            authoringDeviceId: deviceId,
            localAuthor: deviceId ? action.localAuthor : undefined,
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

  runWorker(input: unknown) {
    const request = workerRequest.parse(input);
    return this.store.transaction(() => {
      const deck = this.store.lookup<Deck>(kind, request.id);
      const now = this.now();
      if (
        deck?.lease !== request.lease ||
        now >= deck.availableAt ||
        !['research', 'authoring'].includes(deck.state)
      ) {
        throw new DomainError('This PowerPoint job lease expired.', 409);
      }
      if (request.action === 'result') {
        const task = deck.localTask;
        if (task?.id !== request.taskId) return { status: 'unavailable' };
        return task.result ?? { status: task.expiresAt > now ? 'waiting' : 'unavailable' };
      }
      const tried = deck.tried ?? [];
      const existing = deck.assignmentIds?.indexOf(request.taskId) ?? -1;
      if (existing >= 0) return { provider: tried[existing] };
      const history = this.owned(deck.ownerId).filter((other) => other.id !== deck.id);
      const capacity = (provider: SadeDeckProvider) =>
        history.filter(
          (other) =>
            other.state === 'authoring' &&
            other.availableAt > now &&
            other.assignments?.at(-1)?.provider === provider &&
            (provider !== deck.localAuthor ||
              (other.authoringDeviceId === deck.authoringDeviceId &&
                (other.localTask?.expiresAt ?? 0) > now)),
        ).length;
      const lastAssigned = (provider: SadeDeckProvider) =>
        Math.max(
          0,
          ...history.flatMap((other) =>
            (other.assignments ?? [])
              .filter((assignment) => assignment.provider === provider)
              .map((assignment) => assignment.assignedAt),
          ),
        );
      const provider = [...sadeDeckProviders]
        .filter(
          (candidate) =>
            !tried.includes(candidate) &&
            (candidate === 'codex' ||
              (candidate === deck.localAuthor && capacity(candidate) === 0)),
        )
        .sort(
          (a, b) =>
            capacity(a) - capacity(b) ||
            lastAssigned(a) - lastAssigned(b) ||
            Number(b === deck.localAuthor) - Number(a === deck.localAuthor),
        )[0];
      if (!provider) return { provider: null };
      // On an idle tie, prefer the signed-in local subscription over metered generation.
      const localTask =
        provider === deck.localAuthor
          ? { id: request.taskId, input: request.input, expiresAt: now + localTaskDurationMs }
          : undefined;
      this.store.put(kind, {
        ...deck,
        state: 'authoring',
        assignments: [...(deck.assignments ?? []), { provider, assignedAt: now }],
        assignmentIds: [...(deck.assignmentIds ?? []), request.taskId],
        tried: [...tried, provider],
        localTask,
      } satisfies Deck);
      return { provider };
    });
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
      localTask: undefined,
      assignmentIds: undefined,
      tried: undefined,
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
      localTask: undefined,
      error:
        'Sade could not verify enough source material or finish the presentation after retrying.',
    } satisfies Deck);
  }

  async render(input: unknown) {
    const { id, lease, presentation } = renderRequest.parse(input);
    const current = this.store.lookup<Deck>(kind, id);
    if (
      current?.lease !== lease ||
      current.state !== 'authoring' ||
      this.now() >= current.availableAt
    )
      throw new DomainError(
        'This export does not belong to the active PowerPoint assignment.',
        409,
      );
    const bytes = await renderSadePowerPoint(presentation);
    if (bytes.length > sadeDeckMaxBytes)
      throw new DomainError('The PowerPoint exceeds its delivery limit.', 413);
    return {
      data: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  finish(input: unknown) {
    const { id, lease, result } = completion.parse(input);
    return this.store.transaction(() => {
      const current = this.store.lookup<Deck>(kind, id);
      if (
        !current ||
        current.lease !== lease ||
        this.now() >= current.availableAt ||
        !['research', 'authoring'].includes(current.state)
      )
        return { accepted: false };
      if (result.status === 'authoring') {
        this.store.put(kind, { ...current, state: 'authoring' } satisfies Deck);
      } else if (result.status === 'retry') {
        if (current.attempts >= maximumAttempts) this.failed(current);
        else
          this.store.put(kind, {
            ...current,
            lease: undefined,
            localTask: undefined,
            state: 'retrying',
            availableAt: this.now() + current.attempts * 2500,
          } satisfies Deck);
      } else {
        const assigned = current.tried?.at(-1);
        const localResult = current.localTask?.result;
        if (
          (assigned && assigned !== result.worker.provider) ||
          (result.worker.provider === 'claude-code' &&
            (localResult?.status !== 'authored' ||
              localResult.sessionId !== result.worker.sessionId))
        ) {
          return { accepted: false };
        }
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
          localTask: undefined,
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
