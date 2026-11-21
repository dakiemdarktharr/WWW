import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const createRelay = createRequire(import.meta.url)('../desktop/claude-web.cjs');

test('account setup verifies a local profile without creating a project connection or polling for work', async () => {
  const memberId = randomUUID(),
    connectionId = randomUUID(),
    future = new Date(Date.now() + 60_000).toISOString();
  let verified = false,
    revoked = false;
  const calls: string[] = [];
  const relay = createRelay({
    origin: 'https://example.test',
    current: () => true,
    local: async (input: any) => {
      assert.deepEqual(input, { action: 'account-profile', memberId });
      return { profileName: 'Claude' };
    },
    cloud: async (input: any) => {
      calls.push(input.action);
      assert.ok(!input.projectId && !input.tokenHash);
      if (input.action === 'revoke') {
        revoked = true;
        return { revoked: true };
      }
      if (input.action === 'enroll-account') assert.equal(input.profileName, 'Claude');
      return revoked
        ? { status: 'disconnected' }
        : {
            status: verified ? 'connected' : 'pending',
            connectionId,
            expiresAt: future,
            verifiedAt: verified ? new Date().toISOString() : undefined,
          };
    },
    pause: () => {
      throw new Error('no background work expected');
    },
  });
  const pending = await relay.beginAccount({ memberId });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.headerValue, undefined);
  verified = true;
  assert.equal((await relay.accountStatus({ memberId })).status, 'connected');
  await relay.revoke(connectionId);
  assert.equal((await relay.accountStatus({ memberId })).status, 'disconnected');
  assert.deepEqual(calls, ['enroll-account', 'account-status', 'revoke', 'account-status']);
  relay.stop();
});

test('reusing an account validates the local profile and confirms status without sharing projects', async () => {
  const memberId = randomUUID(),
    connectionId = randomUUID();
  const input = { memberId, connectionId, revision: 2, confirmed: true };
  const calls: string[] = [];
  let current = true,
    validProfile = true,
    switchDuringLookup = false;
  const relay = createRelay({
    origin: 'https://example.test',
    current: () => current,
    local: async (value: any) => {
      assert.deepEqual(value, { action: 'account-profile', memberId });
      if (!validProfile) throw new Error('Not a local Claude profile.');
      if (switchDuringLookup) current = false;
      return { profileName: 'Verified local name' };
    },
    cloud: async (value: any) => {
      calls.push(value.action);
      if (value.action === 'reuse-account') {
        assert.deepEqual(value, {
          action: 'reuse-account',
          ...input,
          profileName: 'Verified local name',
        });
        return { status: 'connected' };
      }
      assert.deepEqual(value, { action: 'account-status', memberId });
      // A successful mutation alone must never be treated as verified status.
      return { status: 'disconnected', reusable: [null, { connectionId: 'invalid' }] };
    },
    pause: () => {
      throw new Error('Account transfer must not poll project work.');
    },
  });
  await assert.rejects(relay.reuseAccount({ ...input, confirmed: false }), /confirm/);
  validProfile = false;
  await assert.rejects(relay.reuseAccount(input), /local Claude profile/);
  validProfile = true;
  switchDuringLookup = true;
  await assert.rejects(relay.reuseAccount(input), /workspace changed/);
  assert.deepEqual(calls, []);
  current = true;
  switchDuringLookup = false;
  const status = await relay.reuseAccount({ ...input, profileName: 'untrusted renderer name' });
  assert.equal(status.status, 'disconnected');
  assert.deepEqual(status.reusable, []);
  assert.deepEqual(calls, ['reuse-account', 'account-status']);
  relay.stop();
});

test('desktop polls only for an enrolled grant and fences a replay after membership changes', async () => {
  const connectionId = randomUUID(),
    projectId = randomUUID(),
    memberId = randomUUID();
  const job = { connectionId, projectId, memberId, jobId: randomUUID() };
  let reads = 0,
    checks = 0,
    polls = 0,
    uploaded = 0;
  let result: { isError?: boolean; content: { text: string }[] } | undefined;
  let wake: (() => void) | undefined;
  const cloud = async (input: any) => {
    if (input.action === 'enroll') return { enrolled: true };
    if (input.action === 'poll') {
      polls++;
      return { jobs: [{ ...job, projectId: randomUUID() }, job] };
    }
    if (input.action === 'complete') {
      if (!uploaded++) throw new TypeError('fixture dropped confirmation');
      result = input.result;
      return { completed: true };
    }
    return { revoked: true };
  };
  const relay = createRelay({
    origin: 'https://example.test',
    current: () => true,
    cloud,
    local: async (input: any) => {
      if (input.action === 'create')
        return {
          id: connectionId,
          memberId,
          projectId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      if (input.action === 'check') return { active: ++checks === 1 };
      if (input.action === 'read') {
        reads++;
        return { content: [{ type: 'text', text: 'private project message' }] };
      }
      return { revoked: true };
    },
    pause: () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      }),
  });
  assert.equal(polls, 0);
  await relay.enroll({ projectId, memberId, durationMinutes: 1 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(polls, 1);
  wake?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(result?.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /private project message/);
  await relay.revoke(connectionId);
  wake?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(polls, 2, 'polling stops when the last local grant is revoked');
  relay.stop();
});
