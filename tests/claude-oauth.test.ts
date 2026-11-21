import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import { DesktopIdentity } from '../server/desktop-auth.ts';
import { DomainError, Store } from '../server/store.ts';
import { registerClaudeWeb } from '../server/claude-web.ts';
import { claudeMcpPath, claudeWebControlPath } from '../shared/claude-web.ts';

test('Claude OAuth binds public clients, owner consent, project, PKCE, and token lifetime', async (t) => {
  const origin = 'https://kivuno.test',
    callback = 'https://claude.ai/api/mcp/auth_callback',
    published = 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    prefix = '/api/claude/oauth/';
  const app = Fastify(),
    store = new Store(':memory:'),
    identity = new DesktopIdentity(store, origin);
  let owner: string | undefined = 'Alice';
  registerClaudeWeb(app, store, identity, { origin, ownerId: () => owner });
  app.setErrorHandler((e, _req, reply) =>
    reply.code(e instanceof DomainError ? e.status : 400).send({ error: 'unavailable' }),
  );
  t.after(async () => {
    await app.close();
    store.close();
  });
  function desktop(ownerId: string) {
    const verifier = randomBytes(32).toString('hex');
    const consent = identity.authorize(
      createHash('sha256').update(verifier).digest('base64url'),
      'Demo desktop',
      'test',
    );
    identity.approve(consent.userCode, { id: ownerId, name: ownerId });
    return identity.token(consent.deviceCode, verifier)!.accessToken;
  }
  const alice = desktop('Alice'),
    bob = desktop('Bob');
  const enroll = async (token: string, projectName: string) => {
    const bearer = 'kwc_' + randomBytes(32).toString('base64url'),
      connectionId = randomUUID(),
      projectId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: claudeWebControlPath,
      headers: { authorization: 'Bearer ' + token },
      payload: {
        action: 'enroll',
        connectionId,
        projectId,
        memberId: randomUUID(),
        projectName,
        profileName: 'Claude',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        tokenHash: createHash('sha256').update(bearer).digest('hex'),
      },
    });
    assert.equal(response.statusCode, 200);
    return { connectionId, projectId, bearer };
  };
  const a = await enroll(alice, 'First project'),
    b = await enroll(bob, 'Other project');
  const register = (redirect: string) =>
    app.inject({
      method: 'POST',
      url: prefix + 'register',
      payload: { redirect_uris: [redirect], token_endpoint_auth_method: 'none' },
    });
  assert.equal((await register('https://example.test/callback')).statusCode, 400);
  const registered = await register(callback);
  assert.equal(registered.statusCode, 201);
  const id = registered.json().client_id;
  const verifier = randomBytes(48).toString('base64url');
  const authFields = {
    response_type: 'code',
    client_id: id,
    redirect_uri: callback,
    resource: origin + claudeMcpPath,
    scope: 'mesh.read',
    state: randomUUID(),
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  const start = (fields: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: prefix + 'authorize?' + new URLSearchParams({ ...authFields, ...fields }),
    });
  for (const fields of [
    { client_id: 'unknown' },
    { resource: origin + '/another' },
    { code_challenge_method: 'plain' },
    { redirect_uri: callback + '?other=1' },
    { scope: 'mesh.write' },
  ] as Record<string, string>[])
    assert.equal((await start(fields)).statusCode, 400);
  const request = async (clientId = id) => {
    const res = await start({ client_id: clientId });
    assert.equal(res.statusCode, 302);
    const url = new URL(res.headers.location!);
    assert.equal(url.origin + url.pathname, origin + '/claude/connect');
    return url.searchParams.get('request')!;
  };
  const inspect = (r: string) =>
    app.inject({ method: 'GET', url: prefix + 'consent?request=' + r });
  const decide = (r: string, connectionId?: string) =>
    app.inject({
      method: 'POST',
      url: prefix + 'consent',
      payload: connectionId
        ? { request: r, decision: 'allow', connectionId }
        : { request: r, decision: 'deny' },
    });
  const r = await request();
  owner = undefined;
  assert.equal((await inspect(r)).statusCode, 401);
  owner = 'Alice';
  const list = (await inspect(r)).json();
  assert.deepEqual(
    list.grants.map((g: any) => g.connectionId),
    [a.connectionId],
  );
  assert.equal(list.grants[0].projectName, 'First project');
  assert.ok(!JSON.stringify(list).includes(a.bearer));
  owner = 'Bob';
  assert.equal((await inspect(r)).statusCode, 404);
  assert.equal((await decide(r, b.connectionId)).statusCode, 400);
  owner = 'Alice';
  assert.equal((await decide(r, b.connectionId)).statusCode, 400);
  const approved = await decide(r, a.connectionId);
  const redirect = new URL(approved.json().redirectUrl),
    code = redirect.searchParams.get('code')!;
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get('iss'), origin);
  assert.equal(redirect.searchParams.get('state'), authFields.state);
  assert.equal((await decide(r, a.connectionId)).statusCode, 400);
  const exchange = (c: string, overrides: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: prefix + 'token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: id,
        resource: origin + claudeMcpPath,
        redirect_uri: callback,
        code: c,
        code_verifier: verifier,
        ...overrides,
      }).toString(),
    });
  for (const fields of [
    { code_verifier: 'x'.repeat(64) },
    { client_id: published },
    { resource: origin },
    { redirect_uri: callback + '/' },
  ] as Record<string, string>[])
    assert.equal((await exchange(code, fields)).statusCode, 400);
  const tokenResponse = await exchange(code),
    token = tokenResponse.json().access_token;
  assert.equal(tokenResponse.statusCode, 200);
  assert.ok(/^kwo_[A-Za-z0-9_-]{43}$/.test(token));
  assert.ok(tokenResponse.json().expires_in <= 600);
  assert.equal(tokenResponse.json().refresh_token, undefined);
  const initialize = (raw: string) =>
    app.inject({
      method: 'POST',
      url: claudeMcpPath,
      headers: { authorization: 'Bearer ' + raw },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      },
    });
  assert.equal((await initialize(token)).statusCode, 200);
  assert.ok(!JSON.stringify(store.all('claudeOAuthAccess')).includes(token));
  assert.ok(!JSON.stringify(store.all('claudeOAuthCode')).includes(code));
  assert.equal((await exchange(code)).json().error, 'invalid_grant');
  assert.equal((await initialize(token)).statusCode, 401);
  assert.equal((await initialize(a.bearer)).statusCode, 200);
  const rejected = await request(published);
  await inspect(rejected);
  const deny = new URL((await decide(rejected)).json().redirectUrl);
  assert.equal(deny.searchParams.get('error'), 'access_denied');
  assert.equal(deny.searchParams.has('code'), false);
  const p = await request(published);
  await inspect(p);
  const secondCode = new URL((await decide(p, a.connectionId)).json().redirectUrl).searchParams.get(
    'code',
  )!;
  const second = (await exchange(secondCode, { client_id: published })).json().access_token;
  assert.equal((await initialize(second)).statusCode, 200);
  await app.inject({
    method: 'POST',
    url: claudeWebControlPath,
    headers: { authorization: 'Bearer ' + alice },
    payload: { action: 'revoke', connectionId: a.connectionId },
  });
  assert.equal((await initialize(a.bearer)).statusCode, 401);
  assert.equal((await initialize(second)).statusCode, 401);
});
