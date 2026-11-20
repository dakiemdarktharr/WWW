import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createCloudIdentity } from '../server/cloud-auth.ts';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import {
  accountMailSender,
  type AccountMail,
  type AccountMailSender,
} from '../server/account-mail.ts';
import { passwordChangedEmail, resetEmail } from '../server/reset-email.ts';

const origin = 'https://kivuno.example';
const password = 'Original-password-29!';
const newPassword = 'Replacement-password-79!';
const cookie = (response: { headers: Record<string, unknown> }) => {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((value) => String(value).split(';')[0])
    .join('; ');
};
async function fixture(sendMail?: AccountMailSender) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-recovery-'));
  const gatewaySecret = randomBytes(32).toString('hex');
  const identity = await createCloudIdentity({
    directory,
    origin,
    secret: randomBytes(32).toString('hex'),
    bootstrapPassword: randomBytes(24).toString('hex'),
    sendMail,
  });
  const store = new Store(path.join(directory, 'workspace.db'));
  const app = await buildApp(new Workspace(store, directory, directory), {
    cloud: { origin, gatewaySecret, auth: identity },
  });
  const request = (
    route: string,
    body: unknown = {},
    headers: Record<string, string> = {},
    method: 'GET' | 'POST' = 'POST',
  ) =>
    app.inject({
      method,
      url: route,
      headers: {
        origin,
        'x-relay-gateway': gatewaySecret,
        'x-relay-client-ip': '192.0.2.11',
        'content-type': 'application/json',
        ...headers,
      },
      ...(method === 'POST' ? { payload: JSON.stringify(body) } : {}),
    });
  return {
    directory,
    identity,
    store,
    app,
    request,
    async close() {
      await app.close();
      store.close();
      assert.equal(path.dirname(directory), os.tmpdir());
      assert.match(path.basename(directory), /^kivuno-recovery-/);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('reset token is hashed, 15-minute, single-use, race-safe and revokes browser sessions and desktop access', async () => {
  const mails: AccountMail[] = [];
  const f = await fixture(async (mail) => {
    mails.push(mail);
  });
  const db = new DatabaseSync(path.join(f.directory, 'identity.db'));
  try {
    const signup = await f.request('/api/auth/sign-up/email', {
      name: 'Alice',
      email: 'alice@example.com',
      password,
    });
    assert.equal(signup.statusCode, 200);
    const oldCookie = cookie(signup),
      userId = signup.json().user.id;
    const bearer = randomBytes(32).toString('base64url');
    f.store.put('desktopDevice', {
      id: 'device',
      name: 'Desktop',
      tokenHash: createHash('sha256').update(bearer).digest('hex'),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      revoked: false,
      owner: { id: userId, name: 'Alice' },
    });
    f.store.put('desktopGrant', {
      id: 'approved-grant',
      owner: { id: userId, name: 'Alice' },
      approved: true,
    });
    assert.equal(
      (await f.request('/api/desktop/me', {}, { authorization: `Bearer ${bearer}` }, 'GET'))
        .statusCode,
      200,
    );
    const known = await f.request('/api/auth/request-password-reset', {
      email: 'alice@example.com',
    });
    const unknown = await f.request('/api/auth/request-password-reset', {
      email: 'missing@example.com',
    });
    assert.equal(known.statusCode, 202);
    assert.equal(unknown.statusCode, 202);
    assert.deepEqual(known.json(), unknown.json());
    await f.identity.flushMail();
    assert.equal(mails.length, 1);
    const url = mails[0].text.match(/https:\/\/\S+\/reset-password#token=\S+/)![0];
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
    assert.ok(token.length >= 24);
    assert.equal(new URL(url).search, '');
    const rows = db.prepare('SELECT identifier, value, expiresAt FROM verification').all();
    assert.equal(rows.length, 1);
    assert.ok(!String(rows[0].identifier).includes(token));
    const expiresAt =
      typeof rows[0].expiresAt === 'number'
        ? rows[0].expiresAt
        : Date.parse(String(rows[0].expiresAt));
    assert.ok(expiresAt > Date.now() + 14 * 60_000);
    assert.ok(expiresAt <= Date.now() + 15 * 60_000);
    assert.notEqual(
      db.prepare('SELECT password FROM account WHERE userId=?').get(userId)!.password,
      password,
    );
    assert.equal(
      (await f.request(`/api/auth/reset-password/${token}`, {}, {}, 'GET')).statusCode,
      404,
    );
    assert.equal(
      (await f.request('/api/auth/reset-password', { token, newPassword: 'tiny' })).statusCode,
      400,
    );
    const resets = await Promise.all([
      f.request('/api/auth/reset-password', { token, newPassword }),
      f.request('/api/auth/reset-password', { token, newPassword: 'Competing-password-88!' }),
    ]);
    assert.deepEqual(resets.map((response) => response.statusCode).sort(), [200, 400]);
    assert.ok(!resets.find((response) => response.statusCode === 200)!.headers['set-cookie']);
    assert.equal(
      (await f.request('/api/auth/reset-password', { token, newPassword })).statusCode,
      400,
    );
    assert.equal(
      (await f.request('/api/auth/get-session', {}, { cookie: oldCookie }, 'GET')).json(),
      null,
    );
    assert.equal(
      (await f.request('/api/desktop/me', {}, { authorization: `Bearer ${bearer}` }, 'GET'))
        .statusCode,
      401,
    );
    assert.equal(f.store.all('desktopGrant').length, 0);
    assert.equal(
      (await f.request('/api/auth/sign-in/email', { email: 'alice@example.com', password }))
        .statusCode,
      401,
    );
    const winningPassword = resets[0].statusCode === 200 ? newPassword : 'Competing-password-88!';
    assert.equal(
      (
        await f.request('/api/auth/sign-in/email', {
          email: 'alice@example.com',
          password: winningPassword,
        })
      ).statusCode,
      200,
    );
    await f.identity.flushMail();
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /cập nhật/);
    assert.ok(!mails[1].text.includes(winningPassword));
  } finally {
    db.close();
    await f.close();
  }
});

test('recovery rejects foreign origin, redirect injection, expired token and abusive email requests', async () => {
  const mails: AccountMail[] = [];
  const f = await fixture(async (mail) => {
    mails.push(mail);
  });
  const db = new DatabaseSync(path.join(f.directory, 'identity.db'));
  try {
    await f.request('/api/auth/sign-up/email', {
      name: 'Alice',
      email: 'alice@example.com',
      password,
    });
    assert.equal(
      (
        await f.request(
          '/api/auth/request-password-reset',
          { email: 'alice@example.com' },
          { origin: 'https://evil.example' },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.request('/api/auth/request-password-reset', {
          email: 'alice@example.com',
          redirectTo: 'https://evil.example',
        })
      ).statusCode,
      400,
    );
    await f.request('/api/auth/request-password-reset', { email: 'alice@example.com' });
    await f.identity.flushMail();
    const token = mails[0].text.match(/#token=([a-zA-Z0-9_-]+)/)![1];
    db.prepare('UPDATE verification SET expiresAt=?').run(Date.now() - 1000);
    assert.equal(
      (await f.request('/api/auth/reset-password', { token, newPassword })).statusCode,
      400,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await f.request(
            '/api/auth/request-password-reset',
            { email: 'unknown@example.com' },
            { 'x-relay-client-ip': `192.0.2.${30 + i}` },
          )
        ).statusCode,
        202,
      );
    assert.equal(
      (
        await f.request(
          '/api/auth/request-password-reset',
          { email: 'UNKNOWN@example.com' },
          { 'x-relay-client-ip': '192.0.2.99' },
        )
      ).statusCode,
      429,
    );
  } finally {
    db.close();
    await f.close();
  }
});

test('missing sender returns explicit unavailability for every account; provider failure leaks no account or secrets', async () => {
  const unavailable = await fixture();
  try {
    for (const email of ['owner@relay.invalid', 'absent@example.com']) {
      const result = await unavailable.request('/api/auth/request-password-reset', { email });
      assert.equal(result.statusCode, 503);
      assert.equal(result.json().code, 'RECOVERY_UNAVAILABLE');
    }
  } finally {
    await unavailable.close();
  }
  const failing = await fixture(async () => {
    throw new Error('provider-secret-must-not-leak');
  });
  try {
    await failing.request('/api/auth/sign-up/email', {
      name: 'Alice',
      email: 'alice@example.com',
      password,
    });
    const a = await failing.request('/api/auth/request-password-reset', {
      email: 'alice@example.com',
    });
    const b = await failing.request('/api/auth/request-password-reset', {
      email: 'missing@example.com',
    });
    assert.equal(a.statusCode, 202);
    assert.deepEqual(a.json(), b.json());
    assert.ok(!a.body.includes('provider-secret'));
    assert.equal((await failing.identity.flushMail()).failures, 1);
  } finally {
    await failing.close();
  }
});

test('Mongo identity rejects insecure configuration without opening SQLite fallback; mail configuration and banner are safe', async () => {
  for (const uri of [
    'mongodb://user:secret@localhost/test',
    'mongodb+srv://user:secret@host/test?tls=false',
    'mongodb+srv://user:secret@host/test?tlsAllowInvalidCertificates=true',
  ]) {
    await assert.rejects(
      createCloudIdentity({
        directory: '/does-not-exist',
        origin,
        secret: 'x'.repeat(40),
        bootstrapPassword: 'y'.repeat(30),
        mongodbUri: uri,
      }),
      /verified TLS/,
    );
  }
  assert.equal(accountMailSender({}), undefined);
  assert.throws(() => accountMailSender({ RELAY_RESEND_API_KEY: 'secret' }), /verified/);
  assert.throws(
    () => resetEmail('https://evil.example/reset-password#token=test', origin),
    /verified HTTPS/,
  );
  assert.throws(() => resetEmail('http://kivuno.example/reset-password', origin), /verified HTTPS/);
  const email = resetEmail(`${origin}/reset-password#token=a&x=%3Cscript%3E`, origin);
  assert.match(email.html, /#d0ff4a/);
  assert.match(email.html, /#a77bfa/);
  assert.ok(!email.html.includes('<script'));
  assert.match(email.html, /&amp;/);
  assert.ok(!/src=/.test(email.html));
  assert.ok(!passwordChangedEmail(origin).html.includes('token='));
});
