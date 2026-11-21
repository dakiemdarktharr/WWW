import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { claudeMcpPath } from '../shared/claude-web.ts';
import {
  claudeAuthorizePath,
  claudeConsentPath,
  claudeRegisterPath,
  claudeTokenPath,
} from '../shared/claude-discovery.ts';
import type { Store } from './store.ts';
import { safeEqual } from './security.ts';
import type { ClaudeWebGrant } from './claude-web.ts';
import type { DesktopDevice } from './desktop-auth.ts';

const callback = 'https://claude.ai/api/mcp/auth_callback';
const publishedClient = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const scope = 'mesh.read';
const supportedScopes = z.enum([
  'connector.connect',
  'mesh.read',
  'connector.connect mesh.read',
  'mesh.read connector.connect',
]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
type Timed = { id: string; expiresAt: number };
type RequestData = Timed & {
  state: string;
  clientId: string;
  resource: string;
  challenge: string;
  redirect: string;
  ownerId?: string;
  scope?: string;
};
type Code = RequestData & { grantId: string; issuedTokenId?: string; issuedRefreshId?: string };
type Token = Timed & {
  grantId: string;
  ownerId: string;
  clientId: string;
  resource: string;
  scope: string;
};
type Refresh = Token & { family: string; accessId: string; used?: boolean };
export function claudeOAuthConnection(store: Store, grant: ClaudeWebGrant, resource: string) {
  if (!grant.verifiedCredential || grant.verifiedCredential !== grant.latestCredential) return;
  const access = store.lookup<Token>('claudeOAuthAccess', grant.verifiedCredential);
  if (
    access &&
    access.grantId === grant.id &&
    access.ownerId === grant.ownerId &&
    access.resource === resource &&
    access.expiresAt > Date.now()
  )
    return access;
  const refresh = grant.latestRefresh
    ? store.lookup<Refresh>('claudeOAuthRefresh', grant.latestRefresh)
    : undefined;
  if (
    refresh &&
    !refresh.used &&
    refresh.expiresAt > Date.now() &&
    refresh.family === grant.refreshFamily &&
    refresh.accessId === grant.verifiedCredential &&
    refresh.grantId === grant.id &&
    refresh.ownerId === grant.ownerId &&
    refresh.resource === resource
  )
    return refresh;
}
export type ClaudeOAuthOptions = {
  origin: string;
  ownerId: (request: FastifyRequest) => string | undefined;
  ownerName?: (request: FastifyRequest) => string | undefined;
};

export function claudeOAuthAccess(store: Store, id: string, resource: string) {
  const access = store.lookup<Token>('claudeOAuthAccess', id);
  if (
    !access ||
    !supportedScopes.safeParse(access.scope).success ||
    access.resource !== resource ||
    access.expiresAt <= Date.now()
  )
    return;
  return access;
}
export function claudeOAuthGrant(store: Store, raw: string, resource: string, requireRead = false) {
  const access = claudeOAuthAccess(store, hash(raw), resource);
  if (!access || (requireRead && !access.scope.split(' ').includes(scope))) return;
  const grant = store.lookup<ClaudeWebGrant>('claudeWebGrant', access.grantId);
  return grant?.ownerId === access.ownerId &&
    (grant.kind !== 'account' || grant.latestCredential === access.id)
    ? grant
    : undefined;
}

export function registerClaudeOAuth(
  app: FastifyInstance,
  store: Store,
  options: ClaudeOAuthOptions,
  valid: (grant: ClaudeWebGrant | undefined) => grant is ClaudeWebGrant,
) {
  const resource = options.origin + claudeMcpPath;
  const knownClient = (id: string) =>
    id === publishedClient ||
    (store.lookup<Timed>('claudeOAuthClient', id)?.expiresAt || 0) > Date.now();
  const available = (kind: string, maximum: number) => {
    const rows = store.all<Timed>(kind);
    let active = 0;
    for (const row of rows) {
      if (row.expiresAt <= Date.now()) store.remove(kind, row.id);
      else active++;
    }
    return active < maximum;
  };
  const minute = new Map<string, { count: number; expires: number }>();
  function limit(endpoint: string, req: FastifyRequest, maximum: number) {
    const now = Date.now();
    for (const [id, row] of minute) if (row.expires <= now) minute.delete(id);
    const key = endpoint + ':' + (req.headers['x-relay-client-ip'] || req.ip);
    const count = minute.get(key) || { count: 0, expires: now + 60_000 };
    if (minute.size >= 2048 && !minute.has(key)) return false;
    minute.set(key, count);
    return ++count.count <= maximum;
  }
  const registration = z.object({
    redirect_uris: z.tuple([z.literal(callback)]),
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z
      .array(z.enum(['authorization_code', 'refresh_token']))
      .max(2)
      .refine((v) => v.includes('authorization_code'))
      .optional(),
    response_types: z.tuple([z.literal('code')]).optional(),
    scope: supportedScopes.optional(),
  });
  const authorization = z.object({
    client_id: z.string().min(1).max(256),
    response_type: z.literal('code'),
    redirect_uri: z.literal(callback),
    state: z.string().min(1).max(1024),
    resource: z.literal(resource),
    scope: supportedScopes.optional(),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal('S256'),
  });
  const tokenInput = z
    .object({
      grant_type: z.literal('authorization_code'),
      code: z.string().regex(/^kcc_[A-Za-z0-9_-]{43}$/),
      redirect_uri: z.literal(callback),
      resource: z.literal(resource),
      client_id: z.string().max(256),
      code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    })
    .strict();
  const refreshInput = z
    .object({
      grant_type: z.literal('refresh_token'),
      refresh_token: z.string().regex(/^kwr_[A-Za-z0-9_-]{43}$/),
      client_id: z.string().min(1).max(256),
      resource: z.literal(resource),
      scope: supportedScopes.optional(),
    })
    .strict();
  const consent = z.discriminatedUnion('decision', [
    z.object({ request: z.string().uuid(), decision: z.literal('deny') }).strict(),
    z
      .object({
        request: z.string().uuid(),
        decision: z.literal('allow'),
        connectionId: z.string().uuid(),
      })
      .strict(),
  ]);
  const ownerGrants = (ownerId: string) =>
    store
      .all<ClaudeWebGrant>('claudeWebGrant')
      .filter((grant) => grant.ownerId === ownerId && valid(grant));
  app.register(async (oauth) => {
    oauth.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        const data = new URLSearchParams(String(body));
        const result = Object.fromEntries(data);
        if (Object.keys(result).length !== data.size) return done(null, {});
        done(null, result);
      },
    );
    oauth.addHook('onRequest', async (_req, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('pragma', 'no-cache')
        .header('referrer-policy', 'no-referrer');
    });
    oauth.post(claudeRegisterPath, { bodyLimit: 8192 }, (req, reply) => {
      if (!limit('register', req, 16))
        return reply.code(429).send({ error: 'temporarily_unavailable' });
      if (
        !req.headers['content-type']?.startsWith('application/json') ||
        !registration.safeParse(req.body).success
      )
        return reply.code(400).send({ error: 'invalid_client_metadata' });
      if (!available('claudeOAuthClient', 2048))
        return reply.code(429).send({ error: 'temporarily_unavailable' });
      const clientId = secret('kcd_');
      store.put<Timed>('claudeOAuthClient', {
        id: clientId,
        expiresAt: Date.now() + 90 * 86400000,
      });
      return reply.code(201).send({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: registration.parse(req.body).scope || 'connector.connect mesh.read',
      });
    });
    oauth.get(claudeAuthorizePath, (req, reply) => {
      if (!limit('authorize', req, 40))
        return reply.code(429).send({ error: 'temporarily_unavailable' });
      const parsed = authorization.safeParse(req.query);
      if (!parsed.success || !knownClient(parsed.data.client_id))
        return reply.code(400).send({
          error: 'invalid_request',
          error_description:
            'Use the Claude public client, its registered callback, and S256 PKCE for this connector.',
        });
      if (!available('claudeOAuthRequest', 512))
        return reply.code(429).send({ error: 'temporarily_unavailable' });
      const q = parsed.data;
      const request = store.put<RequestData>('claudeOAuthRequest', {
        id: randomUUID(),
        expiresAt: Date.now() + 5 * 60_000,
        clientId: q.client_id,
        redirect: q.redirect_uri,
        resource: q.resource,
        state: q.state,
        challenge: q.code_challenge,
        scope: q.scope || scope,
      });
      return reply.redirect(options.origin + '/claude/connect?request=' + request.id, 302);
    });
    function ownedRequest(id: string, owner: string) {
      const row = store.lookup<RequestData>('claudeOAuthRequest', id);
      if (!row || row.expiresAt <= Date.now() || (row.ownerId && row.ownerId !== owner)) return;
      return row;
    }
    oauth.get(claudeConsentPath, (req, reply) => {
      const owner = options.ownerId(req);
      if (!owner) return reply.code(401).send({ error: 'Sign in to Kivuno.' });
      const q = z.object({ request: z.string().uuid() }).strict().safeParse(req.query);
      const row = q.success && ownedRequest(q.data.request, owner);
      if (!row)
        return reply.code(404).send({
          code: 'CLAUDE_CONSENT_UNAVAILABLE',
          error: 'This authorization request expired. Reconnect from Claude.',
        });
      if (!row.ownerId) store.put('claudeOAuthRequest', { ...row, ownerId: owner });
      const grants = ownerGrants(owner)
        .filter(
          (g) =>
            !g.accountGrantId &&
            (g.kind === 'account' || (row.scope || scope).split(' ').includes(scope)),
        )
        .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
      const latest = grants[0];
      // This is a selection hint only: explicit owner consent and all grant
      // checks still apply. Never infer intent from the oldest saved profile.
      const recommendedConnectionId =
        latest?.kind === 'account' &&
        latest.requestedAt &&
        latest.requestedAt <= Date.now() &&
        latest.requestedAt > Date.now() - 600000 &&
        latest.requestedAt !== grants[1]?.requestedAt
          ? latest.connectionId
          : undefined;
      return reply.send({
        requestRemainingMs: row.expiresAt - Date.now(),
        recommendedConnectionId,
        scope: row.scope || scope,
        account: { name: options.ownerName?.(req) || owner },
        grants: grants.map((g) => ({
          kind: g.kind || 'project',
          connectionId: g.connectionId,
          projectId: g.projectId,
          memberId: g.memberId,
          projectName: g.projectName,
          memberName: g.profileName,
          deviceName: store.lookup<DesktopDevice>('desktopDevice', g.deviceId)?.name,
          expiresAt: new Date(g.expiresAt).toISOString(),
        })),
      });
    });
    oauth.post(claudeConsentPath, { bodyLimit: 2048 }, (req, reply) => {
      const who = options.ownerId(req);
      if (!who) return reply.code(401).send({ error: 'Sign in to Kivuno.' });
      const parsed = consent.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Select a connector for this request.' });
      const q = parsed.data;
      const redirectUrl = store.transaction(() => {
        const row = ownedRequest(q.request, who);
        if (!row || row.ownerId !== who) return;
        const redirect = new URL(row.redirect);
        redirect.searchParams.set('state', row.state);
        redirect.searchParams.set('iss', options.origin);
        if (q.decision === 'allow') {
          const grants = ownerGrants(who).filter(
            (g) =>
              g.connectionId === q.connectionId &&
              !g.accountGrantId &&
              (g.kind === 'account' || (row.scope || scope).split(' ').includes(scope)),
          );
          if (grants.length !== 1 || !available('claudeOAuthCode', 1024)) return;
          const code = secret('kcc_');
          store.put<Code>('claudeOAuthCode', {
            ...row,
            id: hash(code),
            expiresAt: Math.min(Date.now() + 60_000, grants[0].expiresAt),
            grantId: grants[0].id,
          });
          redirect.searchParams.set('code', code);
        } else redirect.searchParams.set('error', 'access_denied');
        store.remove('claudeOAuthRequest', row.id);
        return redirect.href;
      });
      return redirectUrl
        ? reply.send({ redirectUrl })
        : reply.code(400).send({
            code: 'CLAUDE_CONSENT_UNAVAILABLE',
            error: 'The request or selected project connector is unavailable.',
          });
    });
    oauth.post(claudeTokenPath, { bodyLimit: 4096 }, (req, reply) => {
      if (!limit('token', req, 100))
        return reply.code(429).send({ error: 'temporarily_unavailable' });
      if (
        !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded') ||
        req.headers.authorization
      )
        return reply.code(400).send({ error: 'invalid_request' });
      if ((req.body as { grant_type?: string })?.grant_type === 'refresh_token') {
        const parsed = refreshInput.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
        const q = parsed.data;
        const response = store.transaction(() => {
          const previous = store.lookup<Refresh>('claudeOAuthRefresh', hash(q.refresh_token));
          if (
            !previous ||
            previous.expiresAt <= Date.now() ||
            previous.clientId !== q.client_id ||
            previous.resource !== q.resource ||
            !knownClient(q.client_id) ||
            (q.scope &&
              q.scope.split(' ').some((value) => !previous.scope.split(' ').includes(value)))
          )
            return;
          const grant = store.lookup<ClaudeWebGrant>('claudeWebGrant', previous.grantId);
          if (
            !valid(grant) ||
            grant.kind !== 'account' ||
            grant.ownerId !== previous.ownerId ||
            grant.refreshFamily !== previous.family
          )
            return;
          if (previous.used) {
            store.put('claudeWebGrant', { ...grant, revoked: true });
            return;
          }
          if (
            grant.latestRefresh !== previous.id ||
            grant.latestCredential !== previous.accessId ||
            !available('claudeOAuthRefresh', 32768)
          )
            return;
          const accessToken = secret('kwo_'),
            refreshToken = secret('kwr_');
          const id = hash(accessToken),
            refreshId = hash(refreshToken);
          const access: Token = {
            id,
            grantId: grant.id,
            ownerId: previous.ownerId,
            clientId: previous.clientId,
            resource,
            scope: q.scope || previous.scope,
            expiresAt: Math.min(grant.expiresAt, Date.now() + 3600000),
          };
          store.put('claudeOAuthAccess', access);
          store.put('claudeOAuthRefresh', { ...previous, used: true });
          store.put<Refresh>('claudeOAuthRefresh', {
            ...access,
            id: refreshId,
            accessId: id,
            family: previous.family,
            expiresAt: Math.min(grant.expiresAt, previous.expiresAt),
          });
          store.put('claudeWebGrant', {
            ...grant,
            latestRefresh: refreshId,
            latestCredential: id,
            verifiedCredential: grant.verifiedCredential === previous.accessId ? id : undefined,
          });
          store.remove('claudeOAuthAccess', previous.accessId);
          return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: Math.floor((access.expiresAt - Date.now()) / 1000),
            scope: access.scope,
          };
        });
        return response ? reply.send(response) : reply.code(400).send({ error: 'invalid_grant' });
      }
      const parsed = tokenInput.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const q = parsed.data;
      const response = store.transaction(() => {
        const code = store.lookup<Code>('claudeOAuthCode', hash(q.code));
        if (
          !code ||
          !code.ownerId ||
          code.expiresAt <= Date.now() ||
          code.clientId !== q.client_id ||
          !knownClient(q.client_id) ||
          code.redirect !== q.redirect_uri ||
          code.resource !== q.resource ||
          !safeEqual(
            createHash('sha256').update(q.code_verifier).digest('base64url'),
            code.challenge,
          )
        )
          return;
        if (code.issuedTokenId) {
          store.remove('claudeOAuthAccess', code.issuedTokenId);
          const linked = store.lookup<ClaudeWebGrant>('claudeWebGrant', code.grantId);
          if (code.issuedRefreshId && linked?.refreshFamily === code.issuedRefreshId)
            store.put('claudeWebGrant', { ...linked, revoked: true });
          return;
        }
        const grant = store.lookup<ClaudeWebGrant>('claudeWebGrant', code.grantId);
        if (
          !valid(grant) ||
          grant.ownerId !== code.ownerId ||
          !available('claudeOAuthAccess', 2048)
        )
          return;
        const token = secret('kwo_'),
          expiresAt = Math.min(grant.expiresAt, Date.now() + 3600000);
        const id = hash(token);
        let refreshToken: string | undefined;
        let refreshId: string | undefined;
        if (grant.kind === 'account') {
          if (!available('claudeOAuthRefresh', 32768)) return;
          refreshToken = secret('kwr_');
          refreshId = hash(refreshToken);
          // Claude does not attest a personal email to our resource server. A new
          // authorization must never inherit the previous connector's project.
          if (grant.latestCredential) {
            store.remove('claudeOAuthAccess', grant.latestCredential);
            for (const project of store.all<ClaudeWebGrant>('claudeWebGrant'))
              if (project.accountGrantId === grant.id && !project.revoked)
                store.put('claudeWebGrant', { ...project, revoked: true });
          }
          store.put('claudeWebGrant', {
            ...grant,
            latestCredential: id,
            refreshFamily: refreshId,
            latestRefresh: refreshId,
            verifiedAt: undefined,
            verifiedCredential: undefined,
          });
        }
        store.put<Token>('claudeOAuthAccess', {
          id,
          expiresAt,
          grantId: grant.id,
          clientId: code.clientId,
          ownerId: code.ownerId,
          resource,
          scope: code.scope || scope,
        });
        if (refreshId)
          store.put<Refresh>('claudeOAuthRefresh', {
            id: refreshId,
            accessId: id,
            family: refreshId,
            expiresAt: grant.expiresAt,
            grantId: grant.id,
            ownerId: code.ownerId,
            clientId: code.clientId,
            resource,
            scope: code.scope || scope,
          });
        store.put<Code>('claudeOAuthCode', {
          ...code,
          issuedTokenId: id,
          issuedRefreshId: refreshId,
        });
        return {
          access_token: token,
          ...(refreshToken ? { refresh_token: refreshToken } : {}),
          token_type: 'Bearer',
          expires_in: Math.floor((expiresAt - Date.now()) / 1000),
          scope: code.scope || scope,
        };
      });
      return response ? reply.send(response) : reply.code(400).send({ error: 'invalid_grant' });
    });
  });
}
