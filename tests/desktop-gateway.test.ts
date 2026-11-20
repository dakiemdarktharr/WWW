import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import gateway, { gatewayTarget } from '../api/gateway.ts';

test('Vercel rewrite metadata never reaches strict desktop lookup and bridge query schemas', () => {
  for (const [route, query] of [
    ['desktop/request', 'code=ABCDE-12345'],
    ['desktop/bridge/exchange', `host=${randomUUID()}`],
  ]) {
    for (const incoming of [
      `/api/gateway?relay_path=${route}&path=${route}&${query}`,
      `/api/${route}?path=${route}&${query}`,
      `/api/${route}?${query}`,
    ]) {
      const target = gatewayTarget(incoming);
      assert.equal(target.pathname + target.search, `/api/${route}?${query}`);
    }
  }
  // Genuine unknown application parameters must still reach strict validation.
  const unknown = gatewayTarget(
    '/api/gateway?relay_path=desktop/request&path=desktop/request&code=ABCDE-12345&unexpected=1',
  );
  assert.equal(unknown.searchParams.get('unexpected'), '1');
  assert.equal(gatewayTarget('/api/desktop/request?path=wrong').searchParams.get('path'), 'wrong');
});

test('public gateway never forwards private coordinator routes or immutable deployment requests', async () => {
  const previous = process.env.RELAY_PUBLIC_ORIGIN;
  process.env.RELAY_PUBLIC_ORIGIN = 'https://relay.example';
  try {
    for (const [url, host] of [
      ['/api/cloud/prepare-upgrade', 'relay.example'],
      ['/api/cloud/shared-sade/finish', 'relay.example'],
      ['/api/gateway?relay_path=cloud/shared-sade/finish', 'relay.example'],
      ['/api/auth/get-session', 'old-deployment.vercel.app'],
      ['/api/auth/get-session', 'preview.vercel.app'],
    ]) {
      let status = 0,
        body = '';
      const response: any = {
        setHeader() {},
        writeHead(code: number) {
          status = code;
          return this;
        },
        end(value: string) {
          body = value;
        },
      };
      await gateway({ url, method: 'GET', headers: { host } } as any, response);
      assert.equal(status, 403);
      assert.ok(body.includes('private') || body.includes('canonical'));
    }
  } finally {
    if (previous === undefined) delete process.env.RELAY_PUBLIC_ORIGIN;
    else process.env.RELAY_PUBLIC_ORIGIN = previous;
  }
});

test('private cloud drain refuses merge/checkpoint work, then fences new requests and closes services', async () => {
  const store = new Store(':memory:');
  const workspace = new Workspace(store, process.cwd(), process.cwd());
  const origin = 'https://relay.example',
    gatewaySecret = 'a'.repeat(64);
  const app = await buildApp(workspace, {
    cloud: {
      origin,
      gatewaySecret,
      auth: {
        findUser: async () => null,
        authorized: async () => true,
        currentUser: async () => ({
          id: 'workspace-owner',
          name: 'Workspace owner',
          email: 'owner@relay.invalid',
        }),
        handler: async () => new Response(null, { status: 404 }),
        onPasswordReset() {},
        flushMail: async () => ({ failures: 0 }),
        async close() {},
      },
    },
  });
  const drain = (secret = gatewaySecret) =>
    app.inject({
      method: 'POST',
      url: '/api/cloud/prepare-upgrade',
      headers: { origin, 'x-relay-gateway': secret, 'content-type': 'application/json' },
      payload: '{}',
    });
  try {
    assert.equal((await drain('untrusted')).statusCode, 403);
    workspace.mergeBusy.add('review');
    assert.equal((await drain()).statusCode, 409);
    assert.equal(workspace.closing, false);
    workspace.mergeBusy.clear();
    const id = randomUUID();
    store.put('handoff', { id, status: 'checkpointing' });
    assert.equal((await drain()).statusCode, 409);
    store.remove('handoff', id);
    const result = await drain();
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().ready, true);
    assert.equal(workspace.closing, true);
    const after = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin, 'x-relay-gateway': gatewaySecret, 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.equal(after.statusCode, 503);
  } finally {
    await app.close();
    store.close();
  }
});
