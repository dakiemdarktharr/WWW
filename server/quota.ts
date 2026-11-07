import { isExternalMember } from '../shared/providers.ts';
import { randomUUID } from 'node:crypto';
import type {
  AccountQuota,
  CodexSession,
  HumanRequest,
  Member,
  QuotaGrant,
  QuotaWindow,
  RoomMessage,
  ProviderTurnGrant,
} from '../shared/types.ts';
import { readRateLimits, type CodexClient } from './codex.ts';
import { Store, DomainError } from './store.ts';
import { groupMembers } from './groups.ts';
import { redact } from './security.ts';

const MAX_AGE = 120_000;
const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
function mergeAvailable(previous: any, update: any): any {
  const result = { ...object(previous) };
  for (const [key, value] of Object.entries(object(update))) {
    if (value === null || value === undefined) continue;
    result[key] =
      typeof value === 'object' && !Array.isArray(value)
        ? mergeAvailable(result[key], value)
        : value;
  }
  return result;
}
export function normalizeQuota(
  memberId: string,
  raw: unknown,
  observedAt = new Date().toISOString(),
): AccountQuota {
  const data = object(raw);
  const buckets = new Map<string, any>();
  for (const [id, bucket] of Object.entries(object(data.rateLimitsByLimitId)))
    buckets.set(id, bucket);
  const primary = object(data.rateLimits);
  if (Object.keys(primary).length) buckets.set(primary.limitId || 'default', primary);
  const windows: QuotaWindow[] = [];
  let hardBlocked = data.ordinaryUsageAllowed === false;
  for (const [id, bucket] of buckets) {
    const limit = object(bucket);
    if (limit.spendControlReached === true) hardBlocked = true;
    for (const slot of ['primary', 'secondary']) {
      const value = object(limit[slot]);
      if (
        typeof value.usedPercent !== 'number' ||
        !Number.isFinite(value.usedPercent) ||
        value.usedPercent < 0 ||
        value.usedPercent > 100
      )
        continue;
      const minutes =
        typeof value.windowDurationMins === 'number' &&
        Number.isFinite(value.windowDurationMins) &&
        value.windowDurationMins > 0
          ? value.windowDurationMins
          : null;
      windows.push({
        id: `${id}:${slot}`,
        label: `${String(limit.limitName || id).slice(0, 80)} · ${minutes ? (minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : `${Math.round((minutes / 60) * 10) / 10}h`) : slot}`,
        usedPercent: value.usedPercent,
        remainingPercent: 100 - value.usedPercent,
        windowMinutes: minutes,
        resetsAt:
          typeof value.resetsAt === 'number' &&
          Number.isFinite(value.resetsAt) &&
          value.resetsAt >= 0 &&
          value.resetsAt <= 8_640_000_000_000
            ? value.resetsAt
            : null,
      });
    }
  }
  return {
    id: memberId,
    memberId,
    windows,
    observedAt,
    source: 'provider',
    ordinaryUsageAllowed:
      typeof data.ordinaryUsageAllowed === 'boolean' ? data.ordinaryUsageAllowed : null,
    status: hardBlocked
      ? 'blocked'
      : !windows.length
        ? 'unknown'
        : windows.some((window) => window.remainingPercent <= 50)
          ? 'reserve'
          : 'available',
    error: null,
  };
}
interface Host {
  store: Store;
  closing: boolean;
  client(memberId: string): Promise<CodexClient>;
  log(
    text: string,
    taskId?: string | null,
    memberId?: string | null,
    type?: string,
    projectId?: string | null,
  ): unknown;
  sessions?: { interrupt(id: string, reason?: string): Promise<CodexSession> };
  handoffs?: { automatic(sessionId: string): Promise<unknown> };
}
export class QuotaManager {
  private refreshing = new Map<string, Promise<AccountQuota>>();
  private enforcing = false;
  private waiters: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  constructor(private host: Host) {}
  private get store() {
    return this.host.store;
  }
  snapshot(): AccountQuota[] {
    return this.store.members().map((member) => this.current(member.id));
  }
  current(memberId: string): AccountQuota {
    const quota = this.store
      .all<AccountQuota>('quota')
      .find((entry) => entry.memberId === memberId);
    if (!quota)
      return {
        id: memberId,
        memberId,
        windows: [],
        observedAt: '',
        source: 'provider',
        ordinaryUsageAllowed: null,
        status: 'unknown',
        error: 'Refresh account usage before starting.',
      };
    return {
      ...quota,
      status:
        !Number.isFinite(Date.parse(quota.observedAt)) ||
        Date.now() - Date.parse(quota.observedAt) > MAX_AGE
          ? 'stale'
          : quota.status,
    };
  }
  ingest(memberId: string, raw: unknown, partial = false): AccountQuota {
    this.store.get<Member>('member', memberId);
    const previous = this.store
      .all<{ id: string; raw: any; observedAt: string }>('quotaSource')
      .find((entry) => entry.id === memberId);
    const incoming = object(raw);
    const wrapped = ['rateLimits', 'rateLimitsByLimitId', 'ordinaryUsageAllowed'].some((key) =>
      Object.hasOwn(incoming, key),
    )
      ? incoming
      : { rateLimits: incoming };
    const data = partial ? mergeAvailable(previous?.raw, wrapped) : { ...wrapped };
    if (partial && object(wrapped.rateLimits).limitId) {
      const id = wrapped.rateLimits.limitId;
      const oldAlias = object(previous?.raw?.rateLimits);
      const oldBuckets = object(previous?.raw?.rateLimitsByLimitId);
      const base = oldBuckets[id] || (oldAlias.limitId === id ? oldAlias : {});
      const updated = mergeAvailable(base, wrapped.rateLimits);
      data.rateLimitsByLimitId = {
        ...object(data.rateLimitsByLimitId),
        ...(oldAlias.limitId ? { [oldAlias.limitId]: oldAlias } : {}),
        [id]: updated,
      };
      data.rateLimits = updated;
    }
    if (previous?.raw?.ordinaryUsageAllowed === false && data.ordinaryUsageAllowed == null)
      data.ordinaryUsageAllowed = false;
    const observedAt = partial ? previous?.observedAt || '' : new Date().toISOString();
    this.store.put('quotaSource', { id: memberId, raw: data, observedAt });
    const quota = normalizeQuota(memberId, data, observedAt);
    if (!observedAt) quota.status = 'unknown';
    this.store.put('quota', quota);
    return quota;
  }
  async refresh(memberId: string): Promise<AccountQuota> {
    const existing = this.refreshing.get(memberId);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        return this.ingest(memberId, await readRateLimits(await this.host.client(memberId)));
      } catch (error) {
        const reason = redact((error as Error).message);
        const quota = {
          ...this.current(memberId),
          status: 'unknown' as const,
          error: /authentication required|not authenticated|sign.?in|not logged.?in/i.test(reason)
            ? `Sign in to this account in Team, then refresh usage. ${reason}`
            : reason,
        };
        this.store.put('quota', quota);
        return quota;
      }
    })();
    this.refreshing.set(memberId, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshing.delete(memberId);
    }
  }
  assertCanRun(memberId: string, projectId: string, sessionId?: string) {
    const quota = this.current(memberId);
    const member = this.store.get<Member>('member', memberId);
    if (member.provider === 'gemini' && quota.status === 'unknown') {
      const grants = this.store
        .all<ProviderTurnGrant>('providerTurnGrant')
        .filter(
          (grant) =>
            grant.memberId === memberId &&
            grant.projectId === projectId &&
            !grant.revokedAt &&
            Date.parse(grant.expiresAt) > Date.now(),
        );
      const active = sessionId
        ? this.store
            .all<any>('providerTurnReservation')
            .find(
              (entry) =>
                entry.id === sessionId &&
                entry.memberId === memberId &&
                entry.projectId === projectId,
            )
        : null;
      const inProgress =
        active &&
        this.store
          .sessions()
          .some(
            (session) =>
              session.id === sessionId && ['starting', 'running'].includes(session.status),
          );
      if (
        inProgress
          ? grants.some((grant) => grant.id === active.grantId)
          : grants.some((grant) => grant.usedTurns < grant.maxTurns)
      )
        return quota;
      throw new DomainError(
        'Gemini does not report remaining subscription quota. Grant a bounded number of Google-login prompts for this project before continuing.',
      );
    }
    if (['unknown', 'stale', 'blocked'].includes(quota.status))
      throw new DomainError(
        quota.error || `Account usage is ${quota.status}. Refresh usage before continuing.`,
      );
    const grant = this.store
      .all<QuotaGrant>('quotaGrant')
      .filter(
        (entry) =>
          entry.memberId === memberId &&
          entry.projectId === projectId &&
          !entry.revokedAt &&
          Date.parse(entry.expiresAt) > Date.now(),
      )
      .sort((a, b) => a.floor - b.floor)[0];
    const floor = grant?.floor ?? 50;
    if (quota.windows.some((window) => window.remainingPercent <= floor))
      throw new DomainError(
        `Account reserve reached (${floor}% remaining floor). Handoff or request permission in MESH.`,
      );
    return quota;
  }
  grantTurns(
    memberId: string,
    input: {
      projectId: string;
      maxTurns: number;
      expiresAt: string;
      acknowledgeUnknownQuota: true;
    },
  ) {
    const member = this.store.get<Member>('member', memberId);
    if (
      member.provider !== 'gemini' ||
      !groupMembers(this.store, input.projectId).some((entry) => entry.id === memberId)
    )
      throw new DomainError('Choose a Gemini teammate in this project.');
    if (
      input.acknowledgeUnknownQuota !== true ||
      !Number.isInteger(input.maxTurns) ||
      input.maxTurns < 1 ||
      input.maxTurns > 10 ||
      Date.parse(input.expiresAt) <= Date.now() ||
      Date.parse(input.expiresAt) > Date.now() + 2 * 3600_000 ||
      !Number.isFinite(Date.parse(input.expiresAt))
    )
      throw new DomainError(
        'Allow 1–10 prompts for at most two hours and acknowledge unknown quota.',
        400,
      );
    return this.store.put('providerTurnGrant', {
      id: randomUUID(),
      memberId,
      projectId: input.projectId,
      maxTurns: input.maxTurns,
      usedTurns: 0,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    } satisfies ProviderTurnGrant);
  }
  revokeTurns(id: string) {
    return this.store.put('providerTurnGrant', {
      ...this.store.get<ProviderTurnGrant>('providerTurnGrant', id),
      revokedAt: new Date().toISOString(),
    });
  }
  consumeTurn(memberId: string, projectId: string, sessionId: string) {
    if (this.store.get<Member>('member', memberId).provider !== 'gemini') return;
    this.store.transaction(() => {
      const grant = this.store
        .all<ProviderTurnGrant>('providerTurnGrant')
        .find(
          (entry) =>
            entry.memberId === memberId &&
            entry.projectId === projectId &&
            !entry.revokedAt &&
            Date.parse(entry.expiresAt) > Date.now() &&
            entry.usedTurns < entry.maxTurns,
        );
      if (!grant)
        throw new DomainError(
          'This Gemini prompt allowance is exhausted or expired. Ask the human for a new allowance.',
        );
      this.store.put('providerTurnGrant', { ...grant, usedTurns: grant.usedTurns + 1 });
      this.store.put('providerTurnReservation', {
        id: sessionId,
        memberId,
        projectId,
        grantId: grant.id,
      });
    });
  }
  completeTurn(sessionId: string) {
    if (this.store.all<any>('providerTurnReservation').some((entry) => entry.id === sessionId))
      this.store.remove('providerTurnReservation', sessionId);
  }
  grant(memberId: string, input: { projectId: string; floor: number; expiresAt: string }) {
    this.store.get<Member>('member', memberId);
    this.store.get('project', input.projectId);
    if (!groupMembers(this.store, input.projectId).some((member) => member.id === memberId))
      throw new DomainError('Choose a teammate in this project.');
    if (
      !Number.isInteger(input.floor) ||
      input.floor < 0 ||
      input.floor >= 50 ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.now() ||
      Date.parse(input.expiresAt) > Date.now() + 7 * 86400000
    )
      throw new DomainError(
        'Grant a reserve floor from 0–49% for a future time within seven days.',
      );
    const grant = this.store.put('quotaGrant', {
      id: randomUUID(),
      memberId,
      ...input,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    } satisfies QuotaGrant);
    this.host.log(
      `Human allowed reserve usage down to ${input.floor}% until ${input.expiresAt}.`,
      null,
      memberId,
      'quota',
      input.projectId,
    );
    for (const request of this.store.all<HumanRequest>('humanRequest'))
      if (
        request.projectId === input.projectId &&
        request.kind === 'quota' &&
        request.status === 'open'
      )
        this.store.put('humanRequest', {
          ...request,
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
        });
    return grant;
  }
  revoke(id: string) {
    const grant = this.store.get<QuotaGrant>('quotaGrant', id);
    const revoked = this.store.put('quotaGrant', { ...grant, revokedAt: new Date().toISOString() });
    void this.enforce();
    return revoked;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 30_000);
    this.timer.unref();
  }
  async poll() {
    if (this.host.closing) return;
    const active = this.store
      .sessions()
      .filter((session) => !session.external && ['running', 'starting'].includes(session.status));
    const waiting =
      this.store.sessions().some((session) => session.pausedFor === 'quota') ||
      this.store
        .all<RoomMessage>('message')
        .some((message) => message.authorId === null && message.requestStatus === 'open');
    const members =
      active.length || waiting
        ? this.store.members().filter((member) => member.account && !isExternalMember(member))
        : [];
    await Promise.allSettled(members.map((member) => this.refresh(member.id)));
    await this.enforce();
  }
  async enforce() {
    if (this.enforcing || this.host.closing) return;
    this.enforcing = true;
    try {
      for (const session of this.store
        .sessions()
        .filter((entry) => !entry.external && ['running', 'starting'].includes(entry.status))) {
        if (this.host.closing) break;
        try {
          this.assertCanRun(session.memberId, session.projectId, session.id);
        } catch {
          try {
            await this.host.sessions?.interrupt(
              session.id,
              'Account quota policy paused this session.',
            );
            this.store.updateSession(session.id, { pausedFor: 'quota' });
            if (!this.host.closing) await this.host.handoffs?.automatic(session.id);
          } catch (error) {
            this.host.log(redact(error), session.taskId, session.memberId, 'error');
          }
        }
      }
      for (const project of this.store.projects()) {
        if (this.host.closing) break;
        const roster = groupMembers(this.store, project.id).filter((member) => member.account);
        if (!roster.length) continue;
        const allUnavailable = roster.every((member) => {
          try {
            this.assertCanRun(member.id, project.id);
            return false;
          } catch {
            return true;
          }
        });
        const waitingSession = this.store
          .sessions()
          .some(
            (session) =>
              session.projectId === project.id && !['stopped', 'review'].includes(session.status),
          );
        const waitingMessage = this.store
          .all<RoomMessage>('message')
          .some(
            (message) =>
              message.projectId === project.id &&
              message.authorId === null &&
              message.kind === 'message' &&
              message.requestStatus === 'open',
          );
        if (!allUnavailable || (!waitingSession && !waitingMessage)) continue;
        if (
          this.store
            .all<HumanRequest>('humanRequest')
            .some(
              (request) =>
                request.projectId === project.id &&
                request.kind === 'quota' &&
                request.status === 'open',
            )
        )
          continue;
        const content = roster
          .map((member) => {
            const quota = this.current(member.id);
            return `${member.name}: ${quota.status}; ${quota.windows.map((window) => `${window.label}: ${window.remainingPercent}% remaining${window.resetsAt ? `, reset ${new Date(window.resetsAt * 1000).toISOString()}` : ''}`).join('; ') || 'usage unknown'}`;
          })
          .join('\n');
        this.store.put('humanRequest', {
          id: randomUUID(),
          projectId: project.id,
          kind: 'quota',
          title: 'Team usage needs your decision',
          content,
          status: 'open',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        } satisfies HumanRequest);
        this.store.message({
          projectId: project.id,
          taskId: null,
          authorId: null,
          kind: 'system',
          content: `Team usage needs your decision. Grant reserve usage to a specific account or wait for verified recovery.\n${content}`,
        });
      }
    } finally {
      this.enforcing = false;
      for (const resolve of this.waiters.splice(0)) resolve();
    }
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled(this.refreshing.values());
    if (this.enforcing) await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
