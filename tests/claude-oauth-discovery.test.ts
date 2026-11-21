import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import gateway from '../api/gateway.ts';

test('Claude can discover Kivuno OAuth from an unauthenticated MCP request through the public rewrites', async (t) => {
  const origin = 'https://kivuno.example';
  const host = new URL(origin).host;
  const original = process.env.RELAY_PUBLIC_ORIGIN;
  process.env.RELAY_PUBLIC_ORIGIN = origin;
  t.after(() => {
    if (original === undefined) delete process.env.RELAY_PUBLIC_ORIGIN;
    else process.env.RELAY_PUBLIC_ORIGIN = original;
  });
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    rewrites: { source: string; destination: string }[];
  };
  const edge = createServer((request, response) => {
    const path = new URL(request.url!, origin).pathname;
    const exact = config.rewrites.find((rule) => rule.source === path);
    const api = config.rewrites.find((rule) => rule.source === '/api/:path*');
    if (exact) request.url = exact.destination;
    else if (api && path.startsWith('/api/'))
      request.url = api.destination.replace(':path*', path.slice('/api/'.length));
    else {
      response.writeHead(404).end();
      return;
    }
    request.headers.host = host;
    void gateway(request, response);
  });
  edge.listen(0, '127.0.0.1');
  await once(edge, 'listening');
  t.after(() => new Promise<void>((resolve) => edge.close(() => resolve())));
  const local = 'http://127.0.0.1:' + (edge.address() as AddressInfo).port;
  const resource = origin + '/api/claude/mcp';
  const unauthenticated = await fetch(local + '/api/claude/mcp', { method: 'POST' });
  assert.equal(unauthenticated.status, 401);
  const challenge = unauthenticated.headers.get('www-authenticate') || '';
  assert.match(challenge, /^Bearer\s/i);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  assert.equal(metadataUrl, origin + '/.well-known/oauth-protected-resource/api/claude/mcp');
  assert.match(challenge, /scope="connector\.connect mesh\.read"/);

  async function metadata(url: string) {
    const target = new URL(url);
    assert.equal(target.origin, origin);
    const response = await fetch(local + target.pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    return response.json();
  }
  const protectedResource = await metadata(metadataUrl);
  assert.equal(protectedResource.resource, resource);
  assert.deepEqual(protectedResource.authorization_servers, [origin]);
  assert.deepEqual(protectedResource.scopes_supported, ['connector.connect', 'mesh.read']);
  assert.deepEqual(
    await metadata(origin + '/.well-known/oauth-protected-resource'),
    protectedResource,
  );
  const auth = await metadata(
    protectedResource.authorization_servers[0] + '/.well-known/oauth-authorization-server',
  );
  assert.equal(auth.issuer, origin);
  assert.equal(auth.authorization_endpoint, origin + '/api/claude/oauth/authorize');
  assert.equal(auth.token_endpoint, origin + '/api/claude/oauth/token');
  assert.equal(auth.registration_endpoint, origin + '/api/claude/oauth/register');
  assert.deepEqual(auth.code_challenge_methods_supported, ['S256']);
  assert.ok(auth.grant_types_supported.includes('authorization_code'));
  assert.ok(auth.token_endpoint_auth_methods_supported.includes('none'));
  assert.equal(auth.client_id_metadata_document_supported, true);
});
