import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cloudRuntimeEnvironment } from '../cloud/runner.ts';
import { settleHostedSade, usesHostedSade } from '../cloud/shared-sade-gateway.ts';
import type { SharedSadeCloudOffer } from '../server/group-sade.ts';
import { sharedSadeCloudFinishPath } from '../shared/sade-cloud.ts';

const gatewayKey = 'fixture-decisions-key';
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
  const key = process.env.SADE_OPENAI_API_KEY;
  process.env.SADE_OPENAI_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_OPENAI_API_KEY;
    else process.env.SADE_OPENAI_API_KEY = key;
  });
  assert.equal(usesHostedSade(Buffer.from('{"action":"message"}')), false);
  assert.equal(usesHostedSade(Buffer.from('{"action":"sade-poll"}')), false);
  assert.equal(
    usesHostedSade(Buffer.from('{"action":"message","sade":{"projectKey":"key"}}')),
    true,
  );
  assert.equal(usesHostedSade(Buffer.from('{"action":"sade-answer"}')), true);
  assert.equal(Object.hasOwn(cloudRuntimeEnvironment(process.env), 'SADE_OPENAI_API_KEY'), false);
});

test('hosted gateway keeps the Decisions credential and private offer off the desktop response', async (t) => {
  const key = process.env.SADE_OPENAI_API_KEY;
  process.env.SADE_OPENAI_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_OPENAI_API_KEY;
    else process.env.SADE_OPENAI_API_KEY = key;
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
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    assert.equal(sent.get('authorization'), `Bearer ${gatewayKey}`);
    for (const privateValue of [gatewayKey, token, runnerAuth, offer.claimId, grantId, groupId])
      assert.ok(!body.includes(privateValue));
    const request = JSON.parse(body);
    assert.equal(request.model, 'gpt-6-luna');
    assert.equal(request.questions[0].name, 'sade_decision');
    return Response.json({
      model: 'gpt-6-luna',
      answers: [
        {
          type: 'choice',
          name: 'sade_decision',
          choice: 'plan',
          confidence: 0.99,
          probabilities: [
            { value: 'plan', probability: 1 },
            { value: 'question', probability: 0 },
            { value: 'no-work', probability: 0 },
          ],
        },
      ],
      usage: { input_tokens: 225, output_tokens: 0, total_tokens: 225 },
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

test('a missing key keeps Ask Sade on the hosted route and records a blocked decision', async (t) => {
  const key = process.env.SADE_OPENAI_API_KEY;
  delete process.env.SADE_OPENAI_API_KEY;
  t.after(() => {
    if (key !== undefined) process.env.SADE_OPENAI_API_KEY = key;
  });
  assert.equal(usesHostedSade(Buffer.from('{"action":"message","sade":{}}')), true);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, runner + sharedSadeCloudFinishPath);
    const result = JSON.parse(String(init.body)).result;
    assert.equal(result.kind, 'blocked');
    assert.match(result.summary, /chưa được cấu hình/);
    return Response.json({ group: { id: groupId }, sadeRuns: [{ state: 'blocked' }] });
  });
  const result = await settleHostedSade(admitted(), runner, headers, Date.now() + 2_100);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(result.sadeGroup, {
    group: { id: groupId },
    sadeRuns: [{ state: 'blocked' }],
  });
});

test('an exhausted gateway deadline records a safe blocked decision without invoking OpenAI', async (t) => {
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

test('hybrid sends one provider request and cannot commit an unbound Responses task', async (t) => {
  const key = process.env.SADE_OPENAI_API_KEY;
  const mode = process.env.SADE_OPENAI_API_ROUTE;
  process.env.SADE_OPENAI_API_KEY = gatewayKey;
  process.env.SADE_OPENAI_API_ROUTE = 'hybrid';
  t.after(() => {
    if (key === undefined) delete process.env.SADE_OPENAI_API_KEY;
    else process.env.SADE_OPENAI_API_KEY = key;
    if (mode === undefined) delete process.env.SADE_OPENAI_API_ROUTE;
    else process.env.SADE_OPENAI_API_ROUTE = mode;
  });
  const endpoints: string[] = [];
  const receipts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url === runner + sharedSadeCloudFinishPath) {
      receipts.push(body.result.kind);
      return Response.json({ sadeRuns: [] });
    }
    assert.ok(!String(init.body).includes(gatewayKey));
    endpoints.push(new URL(url).pathname);
    if (url.endsWith('/decisions'))
      return Response.json({
        model: 'gpt-6-luna',
        answers: [{ type: 'choice', name: 'sade_decision', choice: 'plan' }],
      });
    assert.equal(body.service_tier, 'default');
    assert.deepEqual(body.reasoning, { mode: 'standard', effort: 'medium' });
    assert.equal(body.text.format.strict, true);
    return Response.json({
      model: 'gpt-6-luna',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                decision: 'plan',
                clarification: 'none',
                tasks: [
                  {
                    action: 'edit',
                    files: ['src/wider-scope.ts'],
                    grantId: 'unknown',
                    evidence: [1],
                    dependsOn: [],
                    gate: 'none',
                    verifyAfter: null,
                    platform: 'any',
                    pairedMachine: null,
                    quota: 'none',
                    fallbackGrantId: null,
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  });
  await settleHostedSade(admitted(), runner, headers, Date.now() + 4_550);
  const { readAssignment: _assignment, ...delivery } = offer.delivery;
  await settleHostedSade(
    Response.json({
      sadePlanner: {
        ...offer,
        delivery: { ...delivery, request: 'Nhờ teammate giúp khi có chỗ này cần xử lý.' },
      },
    }),
    runner,
    headers,
    Date.now() + 4_550,
  );
  assert.deepEqual(endpoints, ['/v1/decisions', '/v1/responses']);
  assert.equal(receipts[0], 'plan');
  assert.notEqual(receipts[1], 'plan');
});

test('provider overload fails closed and the next request avoids the upstream queue', async (t) => {
  const key = process.env.SADE_OPENAI_API_KEY;
  process.env.SADE_OPENAI_API_KEY = gatewayKey;
  t.after(() => {
    if (key === undefined) delete process.env.SADE_OPENAI_API_KEY;
    else process.env.SADE_OPENAI_API_KEY = key;
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
