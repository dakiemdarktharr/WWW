import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import gateway from '../api/gateway.ts';

test('public gateway never forwards private drain or immutable deployment requests to shared cloud state', async () => {
  const previous = process.env.RELAY_PUBLIC_ORIGIN;
  process.env.RELAY_PUBLIC_ORIGIN = 'https://relay.example';
  try {
    for (const [url, host] of [
      ['/api/cloud/prepare-upgrade', 'relay.example'],
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
        authorized: async () => true,
        handler: async () => new Response(null, { status: 404 }),
        close() {},
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
