import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeSharedSadeResponses,
  SharedSadeResponsesError,
  sharedSadeResponsesMaxMs,
  type SharedSadeResponsesInput,
  type SharedSadeResponsesUsage,
} from '../cloud/shared-sade-responses.ts';

const input: SharedSadeResponsesInput = {
  messages: [
    { role: 'system', content: 'Classify the active shared-group request.' },
    { role: 'user', content: 'Nhờ Astra đọc tệp này rồi báo kết quả.' },
  ],
  responseSchema: {
    type: 'object',
    properties: { decision: { type: 'string', enum: ['plan', 'question', 'no-work'] } },
    required: ['decision'],
    additionalProperties: false,
  },
};
const config = { apiKey: 'fixture-responses-only' };
const message = (text: string) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const usage = {
  input_tokens: 70,
  input_tokens_details: { cached_tokens: 25, cache_write_tokens: 15 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 12 },
  total_tokens: 90,
};
const reply = (details: Record<string, unknown> = {}) =>
  Response.json({
    model: 'gpt-6-luna',
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [{ type: 'reasoning', summary: [] }, message('{"decision":"plan"}')],
    usage,
    ...details,
  });

test('Luna Responses sends one standard-medium, schema-constrained request and reports token usage', async () => {
  let calls = 0;
  const observations: SharedSadeResponsesUsage[] = [];
  const result = await completeSharedSadeResponses(input, {
    ...config,
    maxOutputTokens: 3_072,
    onUsage: (value) => observations.push(value),
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${config.apiKey}`);
      const body = String(init?.body);
      assert.ok(!body.includes(config.apiKey));
      assert.deepEqual(JSON.parse(body), {
        model: 'gpt-6-luna',
        input: input.messages.map((item) => ({ type: 'message', ...item })),
        reasoning: { effort: 'medium' },
        service_tier: 'default',
        stream: false,
        store: false,
        max_output_tokens: 3_072,
        text: {
          format: {
            type: 'json_schema',
            name: 'sade_proposal',
            strict: true,
            schema: input.responseSchema,
          },
        },
      });
      return reply();
    },
  });
  assert.deepEqual(result, { decision: 'plan' });
  assert.equal(calls, 1);
  assert.deepEqual(observations, [
    {
      inputTokens: 70,
      cachedInputTokens: 25,
      cacheWriteInputTokens: 15,
      outputTokens: 20,
      reasoningTokens: 12,
      totalTokens: 90,
    },
  ]);
});

test('incomplete responses and refusals report usage without accepting a partial proposal', async () => {
  const observations: SharedSadeResponsesUsage[] = [];
  const variants = [
    [
      reply({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
      'incomplete',
    ],
    [
      reply({
        output: [{ ...message(''), content: [{ type: 'refusal', refusal: 'provider detail' }] }],
      }),
      'refused',
    ],
  ] as const;
  for (const [response, code] of variants) {
    await assert.rejects(
      completeSharedSadeResponses(input, {
        ...config,
        fetch: async () => response,
        onUsage: (value) => observations.push(value),
      }),
      (error: Error) => {
        assert.ok(error instanceof SharedSadeResponsesError);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /provider detail|max_output_tokens/);
        return true;
      },
    );
  }
  assert.deepEqual(
    observations.map(({ reasoningTokens }) => reasoningTokens),
    [12, 12],
  );
});

test('only a complete structured assistant message supplies a proposal', async () => {
  const variants = [
    reply({ model: 'different-model' }),
    reply({ output: [message('{')] }),
    reply({ output: [message('{"one":1}'), message('{"two":2}')] }),
    reply({ output: [{ type: 'function_call', name: 'something_else' }] }),
    new Response('{'),
    new Response('x'.repeat(64 * 1024 + 1)),
  ];
  for (const response of variants)
    await assert.rejects(
      completeSharedSadeResponses(input, { ...config, fetch: async () => response }),
      {
        code: 'invalid_response',
      },
    );
});

test('Responses rejects a missing key, excluded deadline or oversized input before sending', async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls++;
    return reply();
  };
  await assert.rejects(completeSharedSadeResponses(input, { apiKey: '', fetch }), {
    code: 'unconfigured',
  });
  await assert.rejects(
    completeSharedSadeResponses(input, {
      ...config,
      timeoutMs: sharedSadeResponsesMaxMs + 1,
      fetch,
    }),
    { code: 'unconfigured' },
  );
  await assert.rejects(
    completeSharedSadeResponses(
      { ...input, messages: [{ role: 'user', content: 'ế'.repeat(22 * 1024) }] },
      { ...config, fetch },
    ),
    { code: 'request_too_large' },
  );
  assert.equal(calls, 0);
});

test('Responses sanitizes failures and aborts channels within the configured deadline', async () => {
  for (const [status, code] of [
    [429, 'busy'],
    [503, 'busy'],
    [401, 'unavailable'],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      completeSharedSadeResponses(input, {
        ...config,
        fetch: async () => {
          calls++;
          return new Response('provider error detail', { status });
        },
      }),
      (error: Error) => {
        assert.ok(error instanceof SharedSadeResponsesError);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /provider error detail/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }

  let cancelled = false;
  await assert.rejects(
    completeSharedSadeResponses(input, {
      ...config,
      timeoutMs: 15,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel: () => {
              cancelled = true;
            },
          }),
        ),
    }),
    { code: 'timeout' },
  );
  assert.equal(cancelled, true);

  const controller = new AbortController();
  await assert.rejects(
    completeSharedSadeResponses(input, {
      ...config,
      signal: controller.signal,
      fetch: () => {
        controller.abort('private cancellation detail');
        return new Promise(() => {});
      },
    }),
    { code: 'cancelled', message: 'The Responses planner request was cancelled.' },
  );
});
