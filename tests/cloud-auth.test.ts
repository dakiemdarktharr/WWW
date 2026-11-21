import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';

test('cloud gateway retains legacy owner access, blocks reserved signup/foreign origins and preserves identity across restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'relay-cloud-auth-'));
  const origin = 'https://relay.example';
  const password = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const gatewaySecret = randomBytes(32).toString('hex');
  const store = new Store(path.join(dir, 'workspace.db'));
  const workspace = new Workspace(store, dir, dir);
  let identity = await createCloudIdentity({
    directory: dir,
    origin,
    secret,
    bootstrapPassword: password,
  });
  let app = await buildApp(workspace, { cloud: { origin, gatewaySecret, auth: identity } });
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
        host: 'private-worker.vercel.run',
        origin,
        'x-relay-gateway': gatewaySecret,
        'content-type': 'application/json',
        ...extra,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const cookies = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value : [value || ''])
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
  try {
    const machine = workspace.runners.add('Machine auth test', 'computer');
    const machineBody = {
      epoch: workspace.runners.epoch,
      ready: true,
      busy: false,
      version: 'test',
      events: [],
    };
    assert.equal((await request('POST', '/api/runner/exchange', machineBody)).statusCode, 401);
    assert.equal(
      (
        await request('POST', '/api/runner/exchange', machineBody, {
          authorization: `Bearer ${machine.token}`,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await request('GET', '/api/state', undefined, { authorization: `Bearer ${machine.token}` }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await request('POST', '/api/runner/exchange', machineBody, {
          authorization: `Bearer ${machine.token}`,
          origin: 'https://foreign.example',
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await request('GET', '/api/state', undefined, { 'x-relay-gateway': '' })).statusCode,
      403,
    );
    assert.equal((await request('GET', '/api/state')).statusCode, 401);
    assert.equal((await request('GET', '/api/session')).statusCode, 401);
    assert.equal((await request('GET', '/api/auth/get-session')).json(), null);
    assert.equal(
      (
        await request('POST', '/api/auth/sign-up/email', {
          email: 'attacker@relay.invalid',
          password,
          name: 'Attacker',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/api/auth/sign-in/email',
          { email: 'owner@relay.invalid', password },
          { origin: 'https://attacker.example' },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request('POST', '/api/auth/sign-in/email', {
          email: 'owner@relay.invalid',
          password: 'incorrect-password-xxxxxxxxx',
        })
      ).statusCode,
      401,
    );
    const login = await request('POST', '/api/auth/sign-in/email', {
      email: 'owner@relay.invalid',
      password,
    });
    assert.equal(login.statusCode, 200);
    const ownerCookie = cookies(login.headers['set-cookie']);
    assert.match(String(login.headers['set-cookie']), /Secure/);
    const bootstrap = await request('GET', '/api/session', undefined, { cookie: ownerCookie });
    assert.equal(bootstrap.statusCode, 200);
    const cookie = `${ownerCookie}; ${cookies(bootstrap.headers['set-cookie'])}`;
    assert.equal((await request('GET', '/api/state', undefined, { cookie })).statusCode, 200);
    assert.equal(
      (
        await request(
          'POST',
          '/api/members',
          { name: 'Cloud profile', role: 'engineer' },
          { cookie },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/api/members',
          { name: 'Cloud profile', role: 'engineer' },
          { cookie, 'x-relay-token': bootstrap.json().token },
        )
      ).statusCode,
      200,
    );
    assert.equal(store.members()[0].name, 'Cloud profile');
    const providers = (await request('GET', '/api/providers', undefined, { cookie })).json();
    assert.equal(
      providers.some((entry: any) => entry.id === 'gemini'),
      false,
    );
    for (const [url, body] of [
      ['/api/accounts/connect', { provider: 'gemini' }],
      ['/api/members', { provider: 'gemini', name: 'Retired', role: 'researcher' }],
    ] as const) {
      assert.equal(
        (await request('POST', url, body, { cookie, 'x-relay-token': bootstrap.json().token }))
          .statusCode,
        400,
      );
    }
    for (const provider of ['claude', 'antigravity']) {
      assert.equal(providers.find((entry: any) => entry.id === provider).available, false);
      assert.equal(
        (
          await request(
            'POST',
            '/api/accounts/connect',
            { provider },
            { cookie, 'x-relay-token': bootstrap.json().token },
          )
        ).statusCode,
        409,
      );
    }
    const gemini = store.addMember({
      name: 'Desktop Gemini',
      provider: 'gemini',
      role: 'researcher',
    });
    assert.equal(
      (
        await request(
          'POST',
          `/api/members/${gemini.id}/login`,
          { method: 'browser' },
          { cookie, 'x-relay-token': bootstrap.json().token },
        )
      ).statusCode,
      409,
    );
    assert.equal(workspace.clients.size, 0);
    await app.close();
    identity = await createCloudIdentity({
      directory: dir,
      origin,
      secret,
      bootstrapPassword: randomBytes(24).toString('hex'),
    });
    app = await buildApp(new Workspace(store, dir, dir), {
      cloud: { origin, gatewaySecret, auth: identity },
    });
    assert.equal(
      (await request('GET', '/api/auth/get-session', undefined, { cookie: ownerCookie })).json()
        .user.email,
      'owner@relay.invalid',
    );
    const logout = await request('POST', '/api/auth/sign-out', {}, { cookie: ownerCookie });
    assert.equal(logout.statusCode, 200);
    assert.equal(
      (await request('GET', '/api/auth/get-session', undefined, { cookie: ownerCookie })).json(),
      null,
    );
  } finally {
    await app.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
