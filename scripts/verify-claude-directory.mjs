// Public, read-only readiness probe: no account, credential, OAuth exchange, or model call.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packet = JSON.parse(
  await readFile(new URL('docs/claude-directory/listing.json', root), 'utf8'),
);
const { listing, connection } = packet;
assert.ok(listing.name.length > 0 && listing.name.length <= 100);
assert.ok(listing.shortDescription.length > 0 && listing.shortDescription.length <= 200);
assert.ok(listing.description.length > 0 && listing.description.length <= 2000);
assert.equal(connection.urlMode, 'universal');
assert.equal(connection.clientSecretRequired, false);
assert.equal(new URL(connection.serverUrl).origin, 'https://kivuno.vercel.app');
const icon = await readFile(new URL(listing.iconPath, root));
assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(icon.readUInt32BE(16), 512);
assert.equal(icon.readUInt32BE(20), 512);

async function getMetadata(url) {
  assert.equal(new URL(url).origin, 'https://kivuno.vercel.app');
  const started = performance.now();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, new URL(url).pathname);
  return { document: await response.json(), elapsedMs: Math.round(performance.now() - started) };
}
const [resource, issuer] = await Promise.all([
  getMetadata(connection.resourceMetadataUrl),
  getMetadata(connection.issuerMetadataUrl),
]);
assert.equal(resource.document.resource, connection.serverUrl);
assert.deepEqual(resource.document.authorization_servers, ['https://kivuno.vercel.app']);
assert.equal(issuer.document.issuer, 'https://kivuno.vercel.app');
assert.equal(issuer.document.authorization_endpoint, connection.authorizationEndpoint);
assert.equal(issuer.document.token_endpoint, connection.tokenEndpoint);
assert.equal(issuer.document.registration_endpoint, connection.registrationEndpoint);
assert.equal(issuer.document.client_id_metadata_document_supported, true);
assert.ok(issuer.document.token_endpoint_auth_methods_supported.includes('none'));
assert.ok(issuer.document.code_challenge_methods_supported.includes('S256'));
for (const grant of ['authorization_code', 'refresh_token'])
  assert.ok(issuer.document.grant_types_supported.includes(grant));
for (const scope of connection.scopes)
  assert.ok(resource.document.scopes_supported.includes(scope));

const unauthenticated = await fetch(connection.serverUrl, {
  method: 'POST',
  redirect: 'error',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'public-readiness', method: 'tools/list' }),
  signal: AbortSignal.timeout(10000),
});
assert.equal(unauthenticated.status, 401);
assert.ok(
  unauthenticated.headers
    .get('www-authenticate')
    ?.includes(`resource_metadata="${connection.resourceMetadataUrl}"`),
);
await unauthenticated.body?.cancel();

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      technicalProbe: 'passed',
      icon: '512x512 PNG',
      discoveryLatencyMs: { resource: resource.elapsedMs, issuer: issuer.elapsedMs },
      unauthenticatedStatus: 401,
      oauth: 'CIMD, S256 PKCE, authorization_code and refresh_token',
      authenticatedToolCallTested: false,
      submissionReady: false,
      outstanding: Object.entries(packet.submissionChecks)
        .filter(([, done]) => !done)
        .map(([check]) => check),
    },
    null,
    2,
  ),
);
