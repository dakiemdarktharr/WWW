import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cloudRuntimeEnvironment } from '../cloud/runner.ts';
import { settleHostedSade, usesHostedSade } from '../cloud/shared-sade-gateway.ts';
import type { SharedSadeCloudOffer } from '../server/group-sade.ts';
import { sharedSadeCloudFinishPath } from '../shared/sade-cloud.ts';

const gatewayKey = 'fixture-qwen-key';
const token = 'fixture-desktop-token';
const runnerAuth = 'fixture-runner-auth';
const runner = 'https://isolated-runner.example';
const headers = new Headers({
  authorization: `Bearer ${token}`,
  origin: 'https://groups.example',
  'x-relay-gateway': runnerAuth,
});
const grantId = randomUUID();
const groupId = randomUUID();
const offer: SharedSadeCloudOffer = {
  runId: randomUUID(),
  claimId: randomUUID(),
  delivery: {
    id: randomUUID(),
    groupId,
    grantId,
    projectKey: 'a'.repeat(64),
    phase: 'plan',
    request: 'Nhờ Mây đọc đúng tệp src/app.ts, đừng sửa.',
    readAssignment: { grantId, scope: 'src/app.ts' },
    team: [
      {
        id: grantId,
        name: 'Mây',
        owner: 'An',
        provider: 'codex',
        role: 'researcher',
        ownedByRequester: true,
        allowWrites: false,
        platform: 'win32',
      },
    ],
    prerequisites: [],
  },
};
const admitted = () =>
  Response.json({ id: offer.runId, sadePlanner: offer, sadeGroup: { stale: true } });

test('only hosted Ask Sade mutations use the gateway key and runner config never receives it', (t) => {
  const key = process.env.SADE_QWEN_API_KEY;
  process.env.SADE_QWEN_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_QWEN_API_KEY;
    else process.env.SADE_QWEN_API_KEY = key;
  });
  assert.equal(usesHostedSade(Buffer.from('{"action":"message"}')), false);
  assert.equal(usesHostedSade(Buffer.from('{"action":"sade-poll"}')), false);
  assert.equal(
    usesHostedSade(Buffer.from('{"action":"message","sade":{"projectKey":"key"}}')),
    true,
  );
  assert.equal(usesHostedSade(Buffer.from('{"action":"sade-answer"}')), true);
  assert.equal(Object.hasOwn(cloudRuntimeEnvironment(process.env), 'SADE_QWEN_API_KEY'), false);
});

test('hosted gateway keeps the Qwen credential and private offer off the desktop response', async (t) => {
  const key = process.env.SADE_QWEN_API_KEY;
  process.env.SADE_QWEN_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_QWEN_API_KEY;
    else process.env.SADE_QWEN_API_KEY = key;
  });
  let providerCalls = 0;
  let commits = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const sent = new Headers(init.headers);
    const body = String(init.body);
    if (url === runner + sharedSadeCloudFinishPath) {
      commits++;
      assert.equal(sent.get('authorization'), `Bearer ${token}`);
      assert.equal(sent.get('x-relay-gateway'), runnerAuth);
      assert.ok(!body.includes(gatewayKey));
      const receipt = JSON.parse(body);
      assert.equal(receipt.claimId, offer.claimId);
      assert.equal(receipt.result.kind, 'plan');
      assert.deepEqual(receipt.result.plan.tasks[0].scope, ['src/app.ts']);
      assert.equal(receipt.result.plan.tasks[0].preferredMemberId, grantId);
      return Response.json({ group: { id: groupId }, sadeRuns: [{ state: 'running' }] });
    }
    providerCalls++;
    assert.equal(new URL(url).hostname, 'dashscope-intl.aliyuncs.com');
    assert.equal(sent.get('authorization'), `Bearer ${gatewayKey}`);
    for (const privateValue of [gatewayKey, token, runnerAuth, offer.claimId, grantId, groupId])
      assert.ok(!body.includes(privateValue));
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"decision":"plan"}' },
        },
      ],
    });
  });
  const result = await settleHostedSade(admitted(), runner, headers, Date.now() + 1_400);
  assert.equal(providerCalls, 1);
  assert.equal(commits, 1);
  assert.deepEqual(result, {
    id: offer.runId,
    sadeGroup: { group: { id: groupId }, sadeRuns: [{ state: 'running' }] },
  });
});

test('an exhausted gateway deadline records a safe blocked decision without invoking Qwen', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, runner + sharedSadeCloudFinishPath);
    assert.equal(JSON.parse(String(init.body)).result.kind, 'blocked');
    return Response.json({ group: { id: groupId }, sadeRuns: [{ state: 'blocked' }] });
  });
  const result = await settleHostedSade(admitted(), runner, headers, Date.now() - 10);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(result.sadeGroup, {
    group: { id: groupId },
    sadeRuns: [{ state: 'blocked' }],
  });
});

test('provider overload fails closed and the next request avoids the upstream queue', async (t) => {
  const key = process.env.SADE_QWEN_API_KEY;
  process.env.SADE_QWEN_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_QWEN_API_KEY;
    else process.env.SADE_QWEN_API_KEY = key;
  });
  let providerCalls = 0;
  let commits = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url !== runner + sharedSadeCloudFinishPath) {
      providerCalls++;
      return new Response('untrusted upstream error details', { status: 429 });
    }
    commits++;
    const result = JSON.parse(String(init.body)).result;
    assert.equal(result.kind, 'blocked');
    assert.match(result.summary, /đang bận/);
    assert.ok(!result.summary.includes('untrusted upstream'));
    return Response.json({ group: { id: groupId }, sadeRuns: [{ state: 'blocked' }] });
  });
  await settleHostedSade(admitted(), runner, headers, Date.now() + 1_400);
  await settleHostedSade(admitted(), runner, headers, Date.now() + 1_400);
  assert.equal(providerCalls, 1);
  assert.equal(commits, 2);
});
