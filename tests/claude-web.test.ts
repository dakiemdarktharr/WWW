import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { DesktopIdentity } from '../server/desktop-auth.ts';
import { DomainError, Store } from '../server/store.ts';
import { registerClaudeWeb } from '../server/claude-web.ts';
import { claudeMcpPath, claudeWebControlPath } from '../shared/claude-web.ts';

test('Claude web reads use one device and project, preserve retry results and stop on revocation', async (t) => {
  const app = Fastify(),
    store = new Store(':memory:'),
    identity = new DesktopIdentity(store, 'https://kivuno.test');
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error instanceof DomainError ? error.status : 400).send({ error: 'unavailable' }),
  );
  registerClaudeWeb(app, store, identity);
  t.after(async () => {
    await app.close();
    store.close();
  });
  function device(ownerId: string) {
    const secret = randomBytes(32).toString('hex');
    const grant = identity.authorize(
      createHash('sha256').update(secret).digest('base64url'),
      'Desktop',
      'test',
    );
    identity.approve(grant.userCode, { id: ownerId, name: ownerId });
    return 'Bearer ' + identity.token(grant.deviceCode, secret)!.accessToken;
  }
  const desktop = device('Alice'),
    second = device('Alice'),
    stranger = device('Bob');
  const control = (authorization: string, payload: object) =>
    app.inject({ method: 'POST', url: claudeWebControlPath, headers: { authorization }, payload });
  const token = 'kwc_' + randomBytes(32).toString('base64url'),
    authorization = 'Bearer ' + token;
  const enrollment = {
    action: 'enroll',
    connectionId: randomUUID(),
    memberId: randomUUID(),
    projectId: randomUUID(),
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  };
  assert.equal((await control(desktop, enrollment)).statusCode, 200);
  assert.equal((await control(desktop, enrollment)).statusCode, 200);
  assert.equal((await control(second, enrollment)).statusCode, 409);
  assert.equal(
    (await control(desktop, { ...enrollment, projectId: randomUUID() })).statusCode,
    409,
  );
  assert.equal((await control(authorization, { action: 'poll' })).statusCode, 401);
  assert.equal(JSON.stringify(store.all('claudeWebGrant')).includes(token), false);
  const rpc = (payload: object, session?: string, credential = authorization) =>
    app.inject({
      method: 'POST',
      url: claudeMcpPath,
      headers: { authorization: credential, ...(session ? { 'mcp-session-id': session } : {}) },
      payload: { jsonrpc: '2.0', ...payload },
    });
  const init = { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
  assert.equal((await rpc(init, undefined, desktop)).statusCode, 401);
  const opening = await rpc(init);
  assert.equal(opening.json().result.protocolVersion, '2025-11-25');
  const session = String(opening.headers['mcp-session-id']);
  assert.equal((await rpc({ method: 'notifications/initialized' }, session)).statusCode, 202);
  assert.deepEqual(
    (await rpc({ id: 2, method: 'tools/list' }, session))
      .json()
      .result.tools.map((tool: { name: string }) => tool.name),
    ['mesh_read'],
  );
  const published = (await rpc({ id: 'catalog', method: 'tools/list' }, session)).json().result
    .tools[0];
  assert.equal(published.title, 'Read shared project messages');
  assert.deepEqual(published.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(
    (
      await rpc(
        {
          id: 3,
          method: 'tools/call',
          params: { name: 'mesh_read', arguments: { projectId: randomUUID() } },
        },
        session,
      )
    ).json().error.code,
    -32602,
  );
  assert.equal(
    (
      await rpc(
        {
          id: 3,
          method: 'tools/call',
          params: { name: 'mesh_post', arguments: { content: 'example' } },
        },
        session,
      )
    ).json().error.code,
    -32602,
  );
  const read = {
    id: 'read',
    method: 'tools/call',
    params: { name: 'mesh_read', arguments: { after: 3 } },
  };
  const response = rpc(read, session).then((result) => result);
  const poll = async () => {
    for (let i = 0; i < 30; i++) {
      const job = (await control(desktop, { action: 'poll' })).json().jobs[0];
      if (job) return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Desktop did not receive the read');
  };
  const job = await poll();
  const retry = rpc(read, session).then((result) => result);
  assert.deepEqual(
    { ...job, jobId: 'id' },
    {
      jobId: 'id',
      connectionId: enrollment.connectionId,
      projectId: enrollment.projectId,
      memberId: enrollment.memberId,
      after: 3,
    },
  );
  assert.deepEqual((await control(second, { action: 'poll' })).json().jobs, []);
  assert.deepEqual((await control(stranger, { action: 'poll' })).json().jobs, []);
  const discussion = { sequence: 5, kind: 'handoff', content: 'Review keyboard navigation.' };
  const completion = {
    action: 'complete',
    connectionId: enrollment.connectionId,
    jobId: job.jobId,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            project: { name: 'Selected project', path: '/private/project' },
            messages: [
              { sequence: 4, kind: 'system', content: 'Group profile introduction' },
              { ...discussion, authorId: 'private-profile' },
              { sequence: 6, kind: 'system', content: 'Group working agreement' },
            ],
            nextAfter: 6,
          }),
        },
      ],
    },
  };
  const visiblePage = {
    project: { name: 'Selected project' },
    messages: [discussion],
    nextAfter: 6,
  };
  assert.equal((await control(stranger, completion)).statusCode, 404);
  assert.equal((await control(desktop, completion)).statusCode, 200);
  assert.equal((await control(desktop, completion)).statusCode, 200);
  assert.deepEqual(JSON.parse((await response).json().result.content[0].text), visiblePage);
  assert.deepEqual(JSON.parse((await retry).json().result.content[0].text), visiblePage);
  assert.deepEqual((await control(desktop, { action: 'poll' })).json().jobs, []);
  const repeatedRead = rpc(read, session).then((result) => result);
  const repeatedJob = await poll();
  assert.notEqual(repeatedJob.jobId, job.jobId);
  const staleMembership = {
    content: [{ type: 'text', text: 'Project membership changed' }],
    isError: true,
  };
  await control(desktop, { ...completion, jobId: repeatedJob.jobId, result: staleMembership });
  assert.deepEqual((await repeatedRead).json().result, staleMembership);
  const pending = rpc({ ...read, id: 'other' }, session).then((result) => result);
  await poll();
  await control(desktop, { action: 'revoke', connectionId: enrollment.connectionId });
  assert.equal((await pending).statusCode, 401);
  assert.equal((await rpc(init)).statusCode, 401);
  assert.equal((await control(desktop, enrollment)).statusCode, 409);

  const replacement = 'kwc_' + randomBytes(32).toString('base64url');
  assert.equal(
    (
      await control(desktop, {
        ...enrollment,
        connectionId: randomUUID(),
        tokenHash: createHash('sha256').update(replacement).digest('hex'),
      })
    ).statusCode,
    200,
  );
  assert.equal((await rpc(init, undefined, 'Bearer ' + replacement)).statusCode, 200);
  identity.revoke(identity.authenticate(desktop));
  assert.equal((await rpc(init, undefined, 'Bearer ' + replacement)).statusCode, 401);
});
