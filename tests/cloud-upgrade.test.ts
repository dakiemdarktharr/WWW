import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { prepareCloudUpgrade } from '../cloud/runner.ts';

// This is the exact serialized function sent to the Linux sandbox. It must not
// depend on module globals or transpiler helpers absent in the remote process.
const guard: typeof prepareCloudUpgrade = runInNewContext(`(${prepareCloudUpgrade.toString()})`);

function fixture(version = '0.3.0', revision = 'old') {
  const calls: string[] = [];
  const hooks = {
    async health() {
      calls.push('health');
      return { version, revision };
    },
    coordinator() {
      calls.push('coordinator');
      return 123;
    },
    async drain() {
      calls.push('drain');
      return true;
    },
    legacyBusy() {
      calls.push('legacyBusy');
      return false;
    },
    async stop(pid: number) {
      assert.equal(pid, 123);
      calls.push('stop');
    },
  };
  return { hooks, calls };
}

test('serialized upgrade guard rechecks revision before stopping a concurrent winner', async () => {
  const { hooks, calls } = fixture('0.3.0', 'desired');
  assert.equal(await guard('desired', hooks), false);
  assert.deepEqual(calls, ['health']);
});

test('current coordinator must drain before SIGTERM; failed drain leaves it alive', async () => {
  const { hooks, calls } = fixture();
  assert.equal(await guard('desired', hooks), true);
  assert.deepEqual(calls, ['health', 'coordinator', 'drain', 'stop']);
  calls.length = 0;
  hooks.drain = async () => {
    calls.push('drain');
    return false;
  };
  await assert.rejects(guard('desired', hooks), /did not drain safely/);
  assert.deepEqual(calls, ['health', 'coordinator', 'drain']);
});

test('only explicit 0.2 compatibility uses persisted busy guard', async () => {
  const { hooks, calls } = fixture('0.2.9');
  hooks.legacyBusy = () => {
    calls.push('legacyBusy');
    return true;
  };
  await assert.rejects(guard('desired', hooks), /Finish or pause/);
  assert.deepEqual(calls, ['health', 'coordinator', 'legacyBusy']);
  calls.length = 0;
  hooks.legacyBusy = () => {
    calls.push('legacyBusy');
    return false;
  };
  assert.equal(await guard('desired', hooks), true);
  assert.deepEqual(calls, ['health', 'coordinator', 'legacyBusy', 'stop']);
  for (const version of ['0.3.0', '1.0.0', 'unknown']) {
    const current = fixture(version);
    current.hooks.drain = async () => false;
    await assert.rejects(guard('desired', current.hooks), /did not drain safely/);
    assert.equal(current.calls.includes('legacyBusy'), false);
    assert.equal(current.calls.includes('stop'), false);
  }
});

test('unresponsive or unidentified coordinator is never killed', async () => {
  const { hooks, calls } = fixture();
  await assert.rejects(guard('desired', { ...hooks, health: async () => null }), /unresponsive/);
  assert.equal(calls.includes('stop'), false);
  await assert.rejects(
    guard('desired', { ...hooks, coordinator: () => null }),
    /identity is unknown/,
  );
  assert.equal(
    await guard('desired', { ...hooks, health: async () => null, coordinator: () => null }),
    true,
  );
});
