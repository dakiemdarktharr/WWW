import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  cloudRuntimeEnvironment,
  cloudRuntimeRevision,
  coordinatorSetting,
  prepareCloudUpgrade,
} from '../cloud/runner.ts';

const payload = 'a'.repeat(64);
const environment = {
  RELAY_AUTH_SECRET: 'auth-secret-for-test-only-'.repeat(3),
  RELAY_GATEWAY_SECRET: 'gateway-secret-for-test-only-'.repeat(3),
  RELAY_OWNER_PASSWORD: 'owner-password-for-test-only',
  RELAY_PUBLIC_ORIGIN: 'https://kivuno.example',
};

test('runtime identity is stable for the same effective configuration and exposes no credentials', () => {
  const revision = cloudRuntimeRevision(payload, environment);
  assert.equal(revision, cloudRuntimeRevision(payload, { ...environment }));
  assert.match(revision, /^[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(revision.split('.')[0], payload);
  for (const secret of Object.values(environment)) assert.ok(!revision.includes(secret));
  assert.equal(
    revision,
    cloudRuntimeRevision(payload, {
      ...environment,
      UNRELATED_SETTING: 'ignored',
      RELAY_MAIL_REPLY_TO: 'inactive@example.test',
      RELAY_MONGODB_DATABASE: 'inactive',
      KIVUNO_FUJI_RPC_URL: 'https://inactive.example',
    }),
  );
  assert.notEqual(revision, cloudRuntimeRevision('b'.repeat(64), environment));
  assert.throws(() => cloudRuntimeRevision(payload, {}), /authentication secret/);
  assert.throws(() => cloudRuntimeRevision('../bad-payload', environment), /verified payload/);
});

test('enabling, changing and removing identity, mail or billing configuration changes the runtime revision', () => {
  const active = {
    ...environment,
    RELAY_MONGODB_URI: 'mongodb+srv://test-user:test-password@atlas.example/test',
    RELAY_MONGODB_DATABASE: 'kivuno_identity',
    RELAY_RESEND_API_KEY: 're_test_key_only',
    RELAY_MAIL_FROM: 'mail@kivuno.example',
    RELAY_MAIL_REPLY_TO: 'support@kivuno.example',
    KIVUNO_FUJI_PAYMENT_CONTRACT: '0x' + '1'.repeat(40),
    KIVUNO_FUJI_USDC_ADDRESS: '0x' + '2'.repeat(40),
    KIVUNO_FUJI_TREASURY_ADDRESS: '0x' + '3'.repeat(40),
    KIVUNO_FUJI_RPC_URL: 'https://rpc.example',
    KIVUNO_BILLING_MODE: 'sponsored-demo',
    KIVUNO_FUJI_RECEIPT_KEY: 'test-only-receipt-key',
  };
  const revision = cloudRuntimeRevision(payload, active);
  assert.notEqual(revision, cloudRuntimeRevision(payload, environment));
  for (const key of Object.keys(active)) {
    assert.notEqual(
      revision,
      cloudRuntimeRevision(payload, {
        ...active,
        [key]: active[key as keyof typeof active] + '-changed',
      }),
      key,
    );
  }
  for (const key of [
    'RELAY_MONGODB_URI',
    'RELAY_RESEND_API_KEY',
    'RELAY_MAIL_FROM',
    'KIVUNO_FUJI_PAYMENT_CONTRACT',
  ]) {
    assert.notEqual(revision, cloudRuntimeRevision(payload, { ...active, [key]: '' }), key);
  }
  const defaults = { ...environment, RELAY_MONGODB_URI: active.RELAY_MONGODB_URI };
  assert.equal(
    cloudRuntimeRevision(payload, defaults),
    cloudRuntimeRevision(payload, { ...defaults, RELAY_MONGODB_DATABASE: 'kivuno_identity' }),
  );
  const forwarded = cloudRuntimeEnvironment(environment);
  for (const key of [
    'RELAY_MONGODB_URI',
    'RELAY_MAIL_FROM',
    'RELAY_RESEND_API_KEY',
    'KIVUNO_FUJI_PAYMENT_CONTRACT',
  ]) {
    assert.equal(forwarded[key as keyof typeof forwarded], '', `clear old inherited ${key}`);
  }
});

test('same build with new configuration drains and restarts, while identical effective configuration keeps the current coordinator', async () => {
  const before = cloudRuntimeRevision(payload, environment);
  const after = cloudRuntimeRevision(payload, {
    ...environment,
    RELAY_MONGODB_URI: 'mongodb+srv://test:password@atlas.example/test',
  });
  const calls: string[] = [];
  const hooks = {
    health: async () => ({ revision: before, version: '0.8.8' }),
    coordinator: () => 123,
    drain: async () => {
      calls.push('drain');
      return true;
    },
    legacyBusy: () => false,
    stop: async () => {
      calls.push('stop');
    },
  };
  assert.equal(await prepareCloudUpgrade(before, hooks), false);
  assert.deepEqual(calls, []);
  assert.equal(await prepareCloudUpgrade(after, hooks), true);
  assert.deepEqual(calls, ['drain', 'stop']);
});

test('serialized environment reader uses the validated current coordinator secret during credential rotation', () => {
  const read: typeof coordinatorSetting = runInNewContext(`(${coordinatorSetting.toString()})`);
  const oldEnvironment =
    'NODE_ENV=production\0RELAY_GATEWAY_SECRET=old=secret\0RELAY_PUBLIC_ORIGIN=https://old.example\0';
  const calls: string[] = [];
  const coordinator = () => {
    calls.push('validate');
    return 123;
  };
  const readEnvironment = (pid: number) => {
    assert.equal(pid, 123);
    calls.push('read');
    return oldEnvironment;
  };
  assert.equal(
    read('RELAY_GATEWAY_SECRET', 'new-secret', coordinator, readEnvironment),
    'old=secret',
  );
  assert.deepEqual(calls, ['validate', 'read']);
  assert.equal(
    read('RELAY_PUBLIC_ORIGIN', 'https://new.example', coordinator, readEnvironment),
    'https://old.example',
  );
  assert.equal(read('MISSING', 'fallback', coordinator, readEnvironment), 'fallback');
  assert.equal(
    read(
      'RELAY_GATEWAY_SECRET',
      'new-secret',
      () => null,
      () => {
        throw new Error('must not read');
      },
    ),
    'new-secret',
  );
  assert.throws(
    () =>
      read(
        'RELAY_GATEWAY_SECRET',
        'new-secret',
        () => {
          throw new Error('Unrecognized coordinator');
        },
        () => {
          throw new Error('must not read');
        },
      ),
    /Unrecognized coordinator/,
  );
});
