import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { claudeMcpPath, claudeWebBearer, claudeWebControlPath } from '../shared/claude-web.ts';
import { DesktopIdentity, type DesktopDevice } from './desktop-auth.ts';
import { Store, DomainError } from './store.ts';
import {
  claudeOAuthAccess,
  claudeOAuthConnection,
  claudeOAuthGrant,
  registerClaudeOAuth,
  type ClaudeOAuthOptions,
} from './claude-oauth.ts';

const uuid = z.string().uuid();
const resultSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.literal('text'),
            text: z
              .string()
              .max(65536)
              .refine((text) => Buffer.byteLength(text) <= 65536),
          })
          .strict(),
      )
      .length(1),
    isError: z.boolean().optional(),
  })
  .strict();
type Result = z.infer<typeof resultSchema>;
const failure = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true });
const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('enroll-account'),
      connectionId: uuid,
      memberId: uuid,
      profileName: z.string().trim().min(1).max(100).optional(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('account-status'),
      memberId: uuid.optional(),
      connectionId: uuid.optional(),
    })
    .strict()
    .refine((q) => !!q.memberId || !!q.connectionId),
  z
    .object({
      action: z.literal('enroll'),
      connectionId: uuid,
      projectId: uuid,
      accountConnectionId: uuid.optional(),
      memberId: uuid,
      tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      projectName: z.string().trim().min(1).max(100).optional(),
      profileName: z.string().trim().min(1).max(100).optional(),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z.object({ action: z.literal('poll') }).strict(),
  z
    .object({
      action: z.literal('complete'),
      connectionId: uuid,
      jobId: uuid,
      result: resultSchema,
    })
    .strict(),
  z.object({ action: z.literal('revoke'), connectionId: uuid }).strict(),
  z
    .object({
      action: z.literal('reuse-account'),
      connectionId: uuid,
      memberId: uuid,
      profileName: z.string().trim().min(1).max(100),
      revision: z.number().int().nonnegative(),
      confirmed: z.literal(true),
    })
    .strict(),
]);
const requestId = z.union([z.string().min(1).max(128), z.number().int().safe()]);
const messageSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: requestId.optional(),
    method: z.string().max(128),
    params: z.unknown().optional(),
  })
  .strict();
const readArguments = z.object({ after: z.number().int().min(0).safe().optional() }).strict();
const readTool = z
  .object({
    name: z.literal('mesh_read'),
    arguments: readArguments.optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const publishedTool = {
  name: 'mesh_read',
  title: 'Read shared project messages',
  description:
    'Read the project name and a page of messages from the Kivuno group explicitly shared with this connection. The optional after cursor requests messages after that sequence number.',
  inputSchema: {
    type: 'object',
    properties: { after: { type: 'integer', minimum: 0 } },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
export interface ClaudeWebGrant {
  id: string;
  connectionId: string;
  projectId?: string;
  kind?: 'account';
  accountGrantId?: string;
  requestedAt?: number;
  bindingRevision?: number;
  verifiedAt?: string;
  verifiedCredential?: string;
  latestCredential?: string;
  refreshFamily?: string;
  latestRefresh?: string;
  memberId: string;
  ownerId: string;
  deviceId: string;
  expiresAt: number;
  revoked?: boolean;
  projectName?: string;
  profileName?: string;
}
type Grant = ClaudeWebGrant;
interface Session {
  grantId: string;
  credentialId: string;
  expiresAt: number;
  version: string;
}
interface Job {
  id: string;
  sessionId: string;
  requestId: string | number;
  grantId: string;
  after?: number;
  waiters: number;
  promise?: Promise<Result>;
  finish?: (result: Result) => void;
  timer: ReturnType<typeof setTimeout>;
  resultHash?: string;
  expiresAt: number;
}

export function registerClaudeWeb(
  app: FastifyInstance,
  store: Store,
  identity: DesktopIdentity,
  oauth?: ClaudeOAuthOptions,
) {
  const sessions = new Map<string, Session>();
  const jobs = new Map<string, Job>();
  function settle(job: Job, result: Result) {
    if (job.resultHash) return;
    clearTimeout(job.timer);
    job.resultHash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    job.expiresAt = Date.now() + 30000;
    job.finish!(result);
    // A retry after completion must read through the desktop's current membership checks.
    // Keep only the completion receipt, never a cached copy of the private project data.
    delete job.promise;
    delete job.finish;
  }
  function queueRead(
    grantId: string,
    sessionId: string,
    requestId: string | number,
    after?: number,
  ) {
    const id = randomUUID();
    let finish!: (result: Result) => void;
    const promise = new Promise<Result>((resolve) => {
      finish = resolve;
    });
    const job: Job = {
      id,
      grantId,
      sessionId,
      requestId,
      after,
      waiters: 0,
      promise,
      finish,
      timer: setTimeout(
        () =>
          settle(
            job,
            failure('Kivuno Desktop did not respond. Open the connected workspace and try again.'),
          ),
        12000,
      ),
      expiresAt: Date.now() + 12000,
    };
    jobs.set(id, job);
    return job;
  }
  function closeSession(id: string) {
    sessions.delete(id);
    for (const [key, job] of jobs)
      if (job.sessionId === id) {
        settle(job, failure('The connector session closed.'));
        jobs.delete(key);
      }
  }
  function cleanup() {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now) closeSession(id);
    for (const [id, job] of jobs) if (job.resultHash && job.expiresAt <= now) jobs.delete(id);
  }
  const cleanupTimer = setInterval(cleanup, 30000);
  cleanupTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    for (const id of sessions.keys()) closeSession(id);
  });

  function valid(grant: Grant | undefined): grant is Grant {
    if (!grant || grant.revoked || grant.expiresAt <= Date.now()) return false;
    if (grant.accountGrantId) {
      const parent = store.lookup<Grant>('claudeWebGrant', grant.accountGrantId);
      if (
        !parent ||
        parent.kind !== 'account' ||
        parent.revoked ||
        parent.expiresAt <= Date.now() ||
        parent.deviceId !== grant.deviceId ||
        parent.ownerId !== grant.ownerId ||
        parent.memberId !== grant.memberId
      )
        return false;
    }
    const device = store.lookup<DesktopDevice>('desktopDevice', grant.deviceId);
    return (
      !!device &&
      !device.revoked &&
      Date.parse(device.expiresAt) > Date.now() &&
      identity.publicDevice(device).owner.id === grant.ownerId
    );
  }
  function authenticate(header?: string) {
    const token = typeof header === 'string' ? claudeWebBearer.exec(header)?.[1] : undefined;
    let grant;
    if (token?.startsWith('kwc_'))
      grant = store.lookup<Grant>(
        'claudeWebGrant',
        createHash('sha256').update(token).digest('hex'),
      );
    else if (token && oauth) grant = claudeOAuthGrant(store, token, oauth.origin + claudeMcpPath);
    if (
      !valid(grant) ||
      (token?.startsWith('kwc_') && (grant.kind === 'account' || grant.accountGrantId))
    )
      throw new DomainError('The Claude connector credential has expired or is invalid.', 401);
    return grant;
  }
  const accountStatus = (account?: Grant) => {
    if (!valid(account)) return { status: 'disconnected' as const, canShare: false };
    const access =
      account.verifiedCredential && oauth
        ? claudeOAuthConnection(store, account, oauth.origin + claudeMcpPath)
        : undefined;
    const connected = access && access.grantId === account.id && access.ownerId === account.ownerId;
    const credential =
      account.latestCredential && oauth
        ? claudeOAuthAccess(store, account.latestCredential, oauth.origin + claudeMcpPath)
        : undefined;
    const authorized =
      !!connected ||
      !!(credential && credential.grantId === account.id && credential.ownerId === account.ownerId);
    return {
      status: connected ? ('connected' as const) : ('pending' as const),
      authorized,
      connectionId: account.connectionId,
      expiresAt: new Date(
        connected && !account.latestRefresh
          ? Math.min(account.expiresAt, access.expiresAt)
          : account.expiresAt,
      ).toISOString(),
      ...(connected
        ? {
            verifiedAt: account.verifiedAt,
            canShare: access.scope.split(' ').includes('mesh.read'),
          }
        : {}),
    };
  };
  if (oauth) registerClaudeOAuth(app, store, oauth, valid);
  app.post(claudeWebControlPath, { bodyLimit: 450000 }, async (request) => {
    const device = identity.authenticate(request.headers.authorization);
    const owner = identity.publicDevice(device).owner;
    const input = command.parse(request.body);
    const deviceAccounts = () =>
      store
        .all<Grant>('claudeWebGrant')
        .filter(
          (g) =>
            g.kind === 'account' && g.deviceId === device.id && g.ownerId === owner.id && valid(g),
        );
    const reusable = (memberId?: string) =>
      store
        .all<Grant>('claudeWebGrant')
        .filter(
          (g) =>
            g.kind === 'account' &&
            g.ownerId === owner.id &&
            valid(g) &&
            !(g.deviceId === device.id && g.memberId === memberId) &&
            accountStatus(g).status === 'connected',
        )
        .map((g) => ({
          connectionId: g.connectionId,
          profileName: g.profileName || 'Claude',
          revision: g.bindingRevision || 0,
          expiresAt: new Date(g.expiresAt).toISOString(),
        }));
    if (input.action === 'account-status')
      return {
        ...accountStatus(
          deviceAccounts().find(
            (g) =>
              (!input.memberId || g.memberId === input.memberId) &&
              (!input.connectionId || g.connectionId === input.connectionId),
          ),
        ),
        reusable: reusable(input.memberId),
      };
    if (input.action === 'reuse-account') {
      const invalidated = new Set<string>();
      const result = store.transaction(() => {
        const source = store
          .all<Grant>('claudeWebGrant')
          .find(
            (g) =>
              g.kind === 'account' &&
              g.ownerId === owner.id &&
              g.connectionId === input.connectionId,
          );
        if (!valid(source) || accountStatus(source).status !== 'connected')
          throw new DomainError(
            'This Claude connection is no longer available. Check connections again.',
            409,
          );
        if ((source.bindingRevision || 0) !== input.revision)
          throw new DomainError('This Claude connection changed. Check connections again.', 409);
        if (source.deviceId === device.id && source.memberId === input.memberId)
          return accountStatus(source);
        const target = deviceAccounts().find((g) => g.memberId === input.memberId);
        if (target && accountStatus(target).status === 'connected')
          throw new DomainError(
            'This profile is already connected. Disconnect it before replacing its connection.',
            409,
          );
        // Move only the verified account link, never project consent. Preserve
        // the token family and original expiry so Claude need not sign in again.
        for (const grant of store.all<Grant>('claudeWebGrant')) {
          if (
            grant.id === target?.id ||
            grant.accountGrantId === source.id ||
            (target && grant.accountGrantId === target.id)
          ) {
            store.put('claudeWebGrant', { ...grant, revoked: true });
            invalidated.add(grant.id);
          }
        }
        const moved = store.put<Grant>('claudeWebGrant', {
          ...source,
          deviceId: device.id,
          memberId: input.memberId,
          profileName: input.profileName,
          requestedAt: Date.now(),
          bindingRevision: (source.bindingRevision || 0) + 1,
        });
        return accountStatus(moved);
      });
      for (const [id, session] of sessions) if (invalidated.has(session.grantId)) closeSession(id);
      for (const job of jobs.values())
        if (invalidated.has(job.grantId))
          settle(job, failure('Project access was revoked when the Claude connection moved.'));
      return result;
    }
    if (input.action === 'enroll-account')
      return store.transaction(() => {
        const existing = deviceAccounts().find((g) => g.memberId === input.memberId);
        if (existing) {
          const requested = store.put<Grant>('claudeWebGrant', {
            ...existing,
            requestedAt: Date.now(),
            profileName: input.profileName,
          });
          return {
            enrolled: true,
            ...accountStatus(requested),
            reusable: reusable(input.memberId),
          };
        }
        const now = Date.now(),
          expiry = Date.parse(input.expiresAt);
        if (expiry <= now || expiry > now + 30 * 86400000)
          throw new DomainError('Choose an expiry within thirty days.', 400);
        const rows = store.all<Grant>('claudeWebGrant');
        for (const grant of rows)
          if (grant.expiresAt <= now) store.remove('claudeWebGrant', grant.id);
        const active = rows.filter((g) => g.expiresAt > now);
        if (active.some((g) => g.deviceId === device.id && g.connectionId === input.connectionId))
          throw new DomainError('This connector ID is already registered.', 409);
        if (active.length >= 1024 || active.filter((g) => g.ownerId === owner.id).length >= 32)
          throw new DomainError('Connector enrollment limit reached.', 429);
        const account = store.put<Grant>('claudeWebGrant', {
          id: 'account:' + randomUUID(),
          kind: 'account',
          requestedAt: now,
          deviceId: device.id,
          ownerId: owner.id,
          connectionId: input.connectionId,
          memberId: input.memberId,
          profileName: input.profileName,
          expiresAt: expiry,
        });
        return { enrolled: true, ...accountStatus(account), reusable: reusable(input.memberId) };
      });
    if (input.action === 'enroll') {
      const expiry = Date.parse(input.expiresAt);
      if (expiry <= Date.now() || expiry > Date.now() + 8 * 3600000)
        throw new DomainError('Choose an expiry within the next eight hours.', 400);
      return store.transaction(() => {
        const account = input.accountConnectionId
          ? deviceAccounts().find(
              (g) => g.connectionId === input.accountConnectionId && g.memberId === input.memberId,
            )
          : undefined;
        if (input.accountConnectionId && !accountStatus(account).canShare)
          throw new DomainError(
            'Verify this Claude connector with project sharing enabled first.',
            403,
          );
        const grants = store.all<Grant>('claudeWebGrant');
        const active = grants.filter((grant) => grant.expiresAt > Date.now());
        for (const grant of grants)
          if (grant.expiresAt <= Date.now()) store.remove('claudeWebGrant', grant.id);
        const previous = active.find(
          (grant) =>
            grant.id === input.tokenHash ||
            (grant.deviceId === device.id && grant.connectionId === input.connectionId),
        );
        if (previous) {
          if (
            previous.revoked ||
            previous.id !== input.tokenHash ||
            previous.connectionId !== input.connectionId ||
            previous.deviceId !== device.id ||
            previous.ownerId !== owner.id ||
            previous.projectId !== input.projectId ||
            previous.memberId !== input.memberId ||
            previous.accountGrantId !== account?.id ||
            previous.expiresAt !== expiry
          )
            throw new DomainError(
              'The connector enrollment conflicts with an existing grant.',
              409,
            );
        } else {
          if (account && active.some((g) => g.accountGrantId === account.id && valid(g)))
            throw new DomainError('Revoke the current shared project before sharing another.', 409);
          if (
            active.length >= 1024 ||
            active.filter((grant) => grant.ownerId === owner.id).length >= 32
          )
            throw new DomainError('The connector enrollment limit has been reached.', 429);
          store.put<Grant>('claudeWebGrant', {
            id: input.tokenHash,
            connectionId: input.connectionId,
            projectId: input.projectId,
            memberId: input.memberId,
            projectName: input.projectName,
            profileName: input.profileName,
            accountGrantId: account?.id,
            ownerId: owner.id,
            deviceId: device.id,
            expiresAt: expiry,
          });
        }
        return { enrolled: true };
      });
    }
    if (input.action === 'revoke') {
      const grant = store
        .all<Grant>('claudeWebGrant')
        .find(
          (grant) =>
            grant.deviceId === device.id &&
            grant.ownerId === owner.id &&
            grant.connectionId === input.connectionId,
        );
      if (grant) {
        store.put('claudeWebGrant', { ...grant, revoked: true });
        for (const [id, session] of sessions) if (session.grantId === grant.id) closeSession(id);
      }
      return { revoked: true };
    }
    if (input.action === 'poll') {
      const available = [];
      for (const job of jobs.values()) {
        if (job.resultHash) continue;
        const grant = store.lookup<Grant>('claudeWebGrant', job.grantId);
        if (valid(grant) && grant.deviceId === device.id && grant.ownerId === owner.id)
          available.push({
            jobId: job.id,
            connectionId: grant.connectionId,
            projectId: grant.projectId,
            memberId: grant.memberId,
            after: job.after,
          });
        if (available.length >= 4) break;
      }
      return { jobs: available };
    }
    const job = jobs.get(input.jobId);
    const grant = job && store.lookup<Grant>('claudeWebGrant', job.grantId);
    if (
      !job ||
      !valid(grant) ||
      grant.deviceId !== device.id ||
      grant.ownerId !== owner.id ||
      grant.connectionId !== input.connectionId
    )
      throw new DomainError('This read is unavailable.', 404);
    if (
      job.resultHash &&
      job.resultHash !== createHash('sha256').update(JSON.stringify(input.result)).digest('hex')
    )
      throw new DomainError('The read has already settled.', 409);
    settle(job, input.result);
    return { completed: true };
  });

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: claudeMcpPath,
    bodyLimit: 16384,
    handler: async (request, reply) => {
      cleanup();
      const grant = authenticate(request.headers.authorization);
      const credentialId = createHash('sha256')
        .update(request.headers.authorization!)
        .digest('hex');
      if (request.method === 'GET') return reply.header('allow', 'POST, DELETE').code(405).send();
      const sessionId = request.headers['mcp-session-id'];
      const session = typeof sessionId === 'string' && sessions.get(sessionId);
      const message = request.method === 'POST' ? messageSchema.safeParse(request.body) : undefined;
      const parsed = message?.success ? message.data : undefined;
      if (message && !parsed)
        return reply
          .code(400)
          .send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      const response = (result: unknown) => ({ jsonrpc: '2.0', id: parsed?.id, result });
      const error = (code: number, message: string) => ({
        jsonrpc: '2.0',
        id: parsed?.id ?? null,
        error: { code, message },
      });
      if (parsed?.method === 'initialize') {
        if (sessionId !== undefined || parsed.id === undefined)
          return reply.code(400).send(error(-32600, 'Invalid initialization'));
        const params = z.object({ protocolVersion: z.string().max(32) }).safeParse(parsed.params);
        if (!params.success) return error(-32602, 'Missing protocol version');
        if (
          sessions.size >= 256 ||
          [...sessions.values()].filter((s) => s.grantId === grant.id).length >= 8
        )
          return reply.code(429).send(error(-32000, 'Connector session limit reached'));
        const version = versions.includes(params.data.protocolVersion)
          ? params.data.protocolVersion
          : versions[0];
        const id = randomUUID();
        if (grant.kind === 'account') {
          const raw = request.headers.authorization!.slice(7);
          store.put<Grant>('claudeWebGrant', {
            ...grant,
            verifiedAt: new Date().toISOString(),
            verifiedCredential: createHash('sha256').update(raw).digest('hex'),
          });
        }
        sessions.set(id, {
          grantId: grant.id,
          credentialId,
          version,
          expiresAt: Math.min(grant.expiresAt, Date.now() + 600000),
        });
        reply.header('mcp-session-id', id);
        return response({
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: {
            name: grant.kind === 'account' ? 'kivuno-account' : 'kivuno-project',
            version: '1.0.0',
          },
        });
      }
      if (!sessionId)
        return reply.code(400).send(error(-32000, 'Initialize a connector session first'));
      if (
        typeof sessionId !== 'string' ||
        !session ||
        session.grantId !== grant.id ||
        session.credentialId !== credentialId
      )
        return reply.code(404).send(error(-32000, 'Connector session unavailable'));
      const version = request.headers['mcp-protocol-version'];
      if (version !== undefined && version !== session.version)
        return reply.code(400).send(error(-32600, 'Protocol version mismatch'));
      session.expiresAt = Math.min(grant.expiresAt, Date.now() + 600000);
      if (!parsed) {
        closeSession(sessionId);
        return reply.code(204).send();
      }
      if (parsed.id === undefined) {
        if (!parsed.method.startsWith('notifications/'))
          return reply.code(400).send(error(-32600, 'Request ID required'));
        return reply.code(202).send();
      }
      if (parsed.method === 'ping') return response({});
      const readGrant =
        grant.kind === 'account'
          ? oauth &&
            claudeOAuthGrant(
              store,
              request.headers.authorization!.slice(7),
              oauth.origin + claudeMcpPath,
              true,
            )
            ? store
                .all<Grant>('claudeWebGrant')
                .find((g) => g.accountGrantId === grant.id && valid(g))
            : undefined
          : grant;
      if (parsed.method === 'tools/list')
        return response({ tools: readGrant ? [publishedTool] : [] });
      if (parsed.method !== 'tools/call') return error(-32601, 'Method not found');
      if (!readGrant) return error(-32602, 'This connection has no shared project tools.');
      const call = readTool.safeParse(parsed.params);
      if (!call.success)
        return error(-32602, 'Only mesh_read with an optional message cursor is available');
      const after = call.data.arguments?.after;
      const retries = [...jobs.values()].filter(
        (job) => job.sessionId === sessionId && job.requestId === parsed.id,
      );
      if (retries.some((job) => job.after !== after || job.grantId !== readGrant.id))
        return error(-32600, 'Request ID was reused with different arguments');
      const existing = retries.find((job) => !job.resultHash);
      if (existing && existing.waiters >= 3)
        return reply.code(429).send(error(-32000, 'The read is already pending'));
      if (
        !existing &&
        (jobs.size >= 256 ||
          [...jobs.values()].filter((job) => !job.resultHash && job.grantId === readGrant.id)
            .length >= 4)
      )
        return reply.code(429).send(error(-32000, 'The read queue is full'));
      const job = existing || queueRead(readGrant.id, sessionId, parsed.id, after);
      job.waiters++;
      const result = await job.promise!;
      job.waiters--;
      authenticate(request.headers.authorization);
      if (!valid(store.lookup<Grant>('claudeWebGrant', readGrant.id)))
        return error(-32000, 'Project sharing was revoked.');
      if (!sessions.has(sessionId))
        return reply.code(404).send(error(-32000, 'Connector session unavailable'));
      return response(result);
    },
  });
}
