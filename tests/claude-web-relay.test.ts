import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const createRelay = createRequire(import.meta.url)('../desktop/claude-web.cjs');

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
