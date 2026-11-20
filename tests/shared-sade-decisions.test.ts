import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import {
  completeSharedSadeDecisions,
  SharedSadeDecisionsError,
  sharedSadeDecisionsMaxMs,
} from '../cloud/shared-sade-decisions.ts';

const input = {
  messages: [
    { role: 'system', content: 'Choose the shared group routing decision.' },
    { role: 'user', content: 'Đợi Bình chốt hướng rồi mới chọn người làm UI.' },
  ],
} as const;
const config = { apiKey: 'isolated-decisions-fixture' };
const choice = { name: 'sade_decision', type: 'choice', choice: 'question' };
const reply = (details: Record<string, unknown> = {}) =>
  Response.json({ model: 'gpt-6-luna', answers: [choice], ...details });

test('Luna Decisions sends a single bounded request with separate message roles', async () => {
  let calls = 0;
  const result = await completeSharedSadeDecisions(input, {
    ...config,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/decisions');
      assert.ok(init);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('authorization'), `Bearer ${config.apiKey}`);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(headers.has('x-dashscope-wait-timeout'), false);
      assert.ok(typeof init.body === 'string');
      assert.equal(init.body.includes(config.apiKey), false);
      const request = JSON.parse(init.body);
      assert.deepEqual(Object.keys(request).sort(), ['input', 'model', 'questions']);
      assert.equal(request.model, 'gpt-6-luna');
      assert.deepEqual(
        request.input,
        input.messages.map((message) => ({ type: 'message', ...message })),
      );
      assert.equal(request.questions.length, 1);
      assert.equal(request.questions[0].name, choice.name);
      assert.equal(request.questions[0].type, 'choice');
      assert.deepEqual(
        request.questions[0].choices.map(({ value }: { value: string }) => value),
        ['plan', 'question', 'no-work'],
      );
      return reply({
        answers: [{ ...choice, confidence: 0.92 }],
        usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
      });
    },
  });
  assert.deepEqual(result, { decision: 'question' });
  assert.equal(calls, 1);
});

test('accepts all three scheduler labels and rejects invalid provider responses', async () => {
  for (const value of ['plan', 'question', 'no-work']) {
    assert.deepEqual(
      await completeSharedSadeDecisions(input, {
        ...config,
        fetch: async () => reply({ answers: [{ ...choice, choice: value }] }),
      }),
      { decision: value },
    );
  }

  const responses = [
    reply({ answers: [{ name: choice.name, type: 'refusal' }] }),
    reply({ answers: [{ ...choice, choice: 'dispatch' }] }),
    reply({ answers: [{ ...choice, name: 'other_question' }] }),
    reply({ answers: [choice, choice] }),
    reply({ answers: [] }),
    reply({ model: 'different-model' }),
    reply({ status: 'incomplete' }),
    reply({ incomplete_details: { reason: 'provider details' } }),
    reply({ error: { message: 'provider details' } }),
    new Response('{'),
    new Response('x'.repeat(32 * 1024 + 1)),
  ];
  for (const response of responses) {
    await assert.rejects(
      completeSharedSadeDecisions(input, { ...config, fetch: async () => response }),
      {
        code: 'invalid_response',
        message: 'The Decisions planner did not return a complete decision.',
      },
    );
  }
});

test('binds additional semantic choices by name in the same provider call', async () => {
  const questions = [
    {
      name: 'scope_1_action',
      instructions: 'What action does the sender ask for on the first grounded scope?',
      choices: [{ value: 'read' }, { value: 'review' }, { value: 'none' }],
    },
  ];
  const extra = { type: 'choice', name: questions[0].name, choice: 'read' };
  assert.deepEqual(
    await completeSharedSadeDecisions(
      { ...input, questions },
      {
        ...config,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(body.questions[1], { type: 'choice', ...questions[0] });
          return reply({ answers: [extra, choice] });
        },
      },
    ),
    { decision: 'question', selections: { scope_1_action: 'read' } },
  );
  for (const invalid of [{ ...extra, choice: 'write' }, { ...extra, name: 'other' }, choice])
    await assert.rejects(
      completeSharedSadeDecisions(
        { ...input, questions },
        {
          ...config,
          fetch: async () => reply({ answers: [choice, invalid] }),
        },
      ),
      { code: 'invalid_response' },
    );
});

test('skips the provider if key, deadline or UTF-8 input is invalid', async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return reply();
  };
  await assert.rejects(completeSharedSadeDecisions(input, { apiKey: '', fetch: send }), {
    code: 'unconfigured',
  });
  await assert.rejects(
    completeSharedSadeDecisions(input, {
      ...config,
      timeoutMs: sharedSadeDecisionsMaxMs + 1,
      fetch: send,
    }),
    { code: 'unconfigured' },
  );
  await assert.rejects(
    completeSharedSadeDecisions(
      { messages: [{ role: 'user', content: 'ế'.repeat(14 * 1024) }] },
      { ...config, fetch: send },
    ),
    { code: 'request_too_large' },
  );
  assert.equal(calls, 0);
});

test('provider failures are sanitized and never retried', async () => {
  for (const status of [429, 503, 401]) {
    let calls = 0;
    await assert.rejects(
      completeSharedSadeDecisions(input, {
        ...config,
        fetch: async () => {
          calls++;
          return new Response('provider diagnostics', { status });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof SharedSadeDecisionsError);
        assert.equal(error.code, status === 401 ? 'unavailable' : 'busy');
        assert.doesNotMatch(error.message, /provider diagnostics/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('deadline stops a delayed provider and cancels any late response body', async () => {
  let completeFetch!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const result = completeSharedSadeDecisions(input, {
    ...config,
    timeoutMs: 10,
    fetch: (_url, init) => {
      signal = init?.signal;
      return new Promise((resolve) => {
        completeFetch = resolve;
      });
    },
  });
  await assert.rejects(result, { code: 'timeout' });
  assert.equal(signal?.aborted, true);
  let cancelled = false;
  completeFetch(
    new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
    ),
  );
  await setImmediate();
  assert.equal(cancelled, true);
});

test('caller cancellation stops a stalled body without exposing caller diagnostics', async () => {
  let bodyCancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        bodyCancelled = true;
      },
    }),
  );
  const controller = new AbortController();
  const result = completeSharedSadeDecisions(input, {
    ...config,
    signal: controller.signal,
    fetch: async () => response,
  });
  await setImmediate();
  controller.abort(new Error('caller diagnostics'));
  await assert.rejects(result, {
    code: 'cancelled',
    message: 'The Decisions planner request was cancelled.',
  });
  assert.equal(bodyCancelled, true);
});
