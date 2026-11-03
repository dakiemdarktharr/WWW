import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from '../server/store.ts';
import { DesktopIdentity } from '../server/desktop-auth.ts';

const verifier = () => randomBytes(32).toString('base64url');
const challenge = (proof: string) => createHash('sha256').update(proof).digest('base64url');
test('desktop browser consent is bound to PKCE, consumed once, persisted and revoked independently of browser login', () => {
  const store = new Store(':memory:');
  const identity = new DesktopIdentity(store, 'https://relay.example');
  try {
    const proof = verifier();
    const grant = identity.authorize(challenge(proof), 'Windows computer', 'test-ip');
    assert.equal(identity.token(grant.deviceCode, proof), null);
    assert.throws(() => identity.token(grant.deviceCode, verifier()), /proof/);
    identity.approve(grant.userCode);
    const token = identity.token(grant.deviceCode, proof)!;
    assert.equal(token.owner.id, 'workspace-owner');
    assert.throws(() => identity.token(grant.deviceCode, proof), /already used/);
    assert.ok(!JSON.stringify(store.all('desktopDevice')).includes(token.accessToken));
    const restarted = new DesktopIdentity(store, 'https://relay.example');
    const device = restarted.authenticate(`Bearer ${token.accessToken}`);
    assert.equal(device.id, token.deviceId);
    restarted.revoke(device);
    assert.throws(() => identity.authenticate(`Bearer ${token.accessToken}`), /revoked/);
  } finally {
    identity.close();
    store.close();
  }
});
test('desktop consent expires and never grants consent by polling; enrollment is rate bounded', () => {
  const store = new Store(':memory:');
  const identity = new DesktopIdentity(store, 'https://relay.example');
  try {
    const proof = verifier();
    const grant = identity.authorize(challenge(proof), 'Desktop', 'ip');
    const pending: any = store.all('desktopGrant')[0];
    store.put('desktopGrant', { ...pending, expires: Date.now() - 1, approved: true });
    assert.throws(() => identity.token(grant.deviceCode, proof), /expired/);
    for (let i = 0; i < 5; i++) identity.authorize(challenge(verifier()), 'Desktop', 'ip');
    assert.throws(() => identity.authorize(challenge(verifier()), 'Desktop', 'ip'), /Too many/);
  } finally {
    identity.close();
    store.close();
  }
});
test('outbound desktop bridge authenticates each connection, isolates hosts and never redelivers a dispatched request', async () => {
  const store = new Store(':memory:');
  const identity = new DesktopIdentity(store, 'https://relay.example');
  try {
    const proof = verifier();
    const grant = identity.authorize(challenge(proof), 'Desktop', 'ip');
    identity.approve(grant.userCode);
    const token = identity.token(grant.deviceCode, proof)!;
    const device = identity.authenticate(`Bearer ${token.accessToken}`);
    const bridgeKey = verifier();
    const poll = identity.poll(device, bridgeKey, []);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.throws(
      () => identity.exchange(device.id, verifier(), `Bearer ${verifier()}`, {}),
      /unavailable/,
    );
    assert.throws(
      () =>
        identity.exchange(device.id, bridgeKey, `Bearer ${verifier()}`, {
          value: 'x'.repeat(3_800_001),
        }),
      /packet exceeds/,
    );
    const requestBody = { epoch: 'test', ready: true, events: [] };
    const response = identity.exchange(device.id, bridgeKey, `Bearer ${verifier()}`, requestBody);
    const dispatch = await poll;
    assert.equal(dispatch.requests.length, 1);
    assert.deepEqual(dispatch.requests[0].body, requestBody);
    // A new request lets the next poll complete immediately after acknowledging the prior one.
    const next = identity.exchange(device.id, bridgeKey, `Bearer ${verifier()}`, { ready: false });
    const acknowledged = await identity.poll(
      identity.authenticate(`Bearer ${token.accessToken}`),
      bridgeKey,
      [{ id: dispatch.requests[0].id, status: 200, body: { epoch: 'coordinator', commands: [] } }],
    );
    assert.deepEqual(acknowledged.ack, [dispatch.requests[0].id]);
    assert.equal(acknowledged.requests.length, 1);
    assert.notEqual(acknowledged.requests[0].id, dispatch.requests[0].id);
    assert.equal((await response).status, 200);
    identity.revoke(identity.authenticate(`Bearer ${token.accessToken}`));
    assert.equal((await next).status, 503);
  } finally {
    identity.close();
    store.close();
  }
});
