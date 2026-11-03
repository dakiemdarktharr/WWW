import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';

const cookies = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : [value || ''])
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');

test('public accounts get isolated desktop identities without access to legacy workspace or other browser CSRF sessions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-signup-'));
  const origin = 'https://relay.example';
  const gatewaySecret = randomBytes(32).toString('hex');
  const password = randomBytes(24).toString('hex');
  const store = new Store(path.join(directory, 'workspace.db'));
  const workspace = new Workspace(store, directory, directory);
  const identity = await createCloudIdentity({
    directory,
    origin,
    secret: randomBytes(32).toString('hex'),
    bootstrapPassword: password,
  });
  const app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth: identity } });
  const request = (
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        origin,
        'x-relay-gateway': gatewaySecret,
        'content-type': 'application/json',
        ...extra,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  try {
    assert.equal(
      (
        await request('POST', '/api/auth/sign-up/email', {
          name: 'Alice',
          email: 'alice@example.com',
          password: 'too-short',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request('POST', '/api/auth/sign-up/email', {
          name: 'Alice',
          email: 'alice@example.com',
          password,
          role: 'owner',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request('POST', '/api/auth/sign-up/email', {
          name: 'Reserved',
          email: 'owner@relay.invalid',
          password,
        })
      ).statusCode,
      400,
    );
    const alice = await request('POST', '/api/auth/sign-up/email', {
      name: 'Alice',
      email: 'alice@example.com',
      password,
    });
    const bob = await request('POST', '/api/auth/sign-up/email', {
      name: 'Bob',
      email: 'bob@example.com',
      password,
    });
    assert.equal(alice.statusCode, 200);
    assert.equal(bob.statusCode, 200);
    assert.equal(alice.json().user.emailVerified, false);
    const aliceAuth = cookies(alice.headers['set-cookie']);
    const bobAuth = cookies(bob.headers['set-cookie']);
    assert.ok(aliceAuth && bobAuth);
    const aSession = await request('GET', '/api/session', undefined, { cookie: aliceAuth });
    const bSession = await request('GET', '/api/session', undefined, { cookie: bobAuth });
    assert.equal(aSession.statusCode, 200);
    assert.equal(bSession.statusCode, 200);
    const aliceHeaders = {
      cookie: `${aliceAuth}; ${cookies(aSession.headers['set-cookie'])}`,
      'x-relay-token': aSession.json().token,
    };
    const bobHeaders = {
      cookie: `${bobAuth}; ${cookies(bSession.headers['set-cookie'])}`,
      'x-relay-token': bSession.json().token,
    };
    for (const route of ['/api/state', '/api/events', '/api/aegis/status'])
      assert.equal((await request('GET', route, undefined, aliceHeaders)).statusCode, 401, route);
    for (const route of ['/api/projects', '/api/members', '/api/runners'])
      assert.equal((await request('POST', route, {}, aliceHeaders)).statusCode, 401, route);
    assert.equal(
      (await request('POST', '/api/auth/update-user', { name: 'Owner' }, aliceHeaders)).statusCode,
      404,
    );

    const proof = randomBytes(32).toString('base64url');
    const grant = (
      await request('POST', '/api/desktop/authorize', {
        challenge: createHash('sha256').update(proof).digest('base64url'),
        name: 'Alice computer',
      })
    ).json();
    assert.equal(
      (await request('GET', `/api/desktop/request?code=${grant.userCode}`)).statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/api/desktop/approve',
          { userCode: grant.userCode },
          {
            cookie: `${aliceAuth}; ${cookies(bSession.headers['set-cookie'])}`,
            'x-relay-token': bSession.json().token,
          },
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/api/desktop/approve',
          { userCode: grant.userCode, owner: 'workspace-owner' },
          aliceHeaders,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (await request('POST', '/api/desktop/approve', { userCode: grant.userCode }, aliceHeaders))
        .statusCode,
      200,
    );
    assert.equal(
      (await request('GET', `/api/desktop/request?code=${grant.userCode}`, undefined, bobHeaders))
        .statusCode,
      403,
    );
    assert.equal(
      (await request('POST', '/api/desktop/approve', { userCode: grant.userCode }, bobHeaders))
        .statusCode,
      403,
    );
    const token = (
      await request('POST', '/api/desktop/token', { deviceCode: grant.deviceCode, verifier: proof })
    ).json();
    assert.equal(token.owner.id, alice.json().user.id);
    assert.notEqual(token.owner.id, 'workspace-owner');
    assert.equal(token.owner.name, 'Alice');
    const me = await request('GET', '/api/desktop/me', undefined, {
      authorization: `Bearer ${token.accessToken}`,
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json().owner, token.owner);

    const legacy = await request('POST', '/api/auth/sign-in/email', {
      email: 'owner@relay.invalid',
      password,
    });
    assert.equal(legacy.statusCode, 200);
    const legacyAuth = cookies(legacy.headers['set-cookie']);
    const legacySession = await request('GET', '/api/session', undefined, { cookie: legacyAuth });
    const legacyHeaders = {
      cookie: `${legacyAuth}; ${cookies(legacySession.headers['set-cookie'])}`,
      'x-relay-token': legacySession.json().token,
    };
    assert.equal((await request('GET', '/api/state', undefined, legacyHeaders)).statusCode, 200);
    assert.equal((await identity.currentUser({ cookie: legacyAuth }))?.id, 'workspace-owner');
    assert.equal(await identity.authorized({ cookie: aliceAuth }), false);
  } finally {
    await app.close();
    store.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('kivuno-signup-'));
    await rm(directory, { recursive: true, force: true });
  }
});
