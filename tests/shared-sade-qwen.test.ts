import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import {
  completeSharedSadeQwen,
  SharedSadeQwenError,
  type SharedSadeQwenInput,
} from '../cloud/shared-sade-qwen.ts';

const input: SharedSadeQwenInput = {
  messages: [
    { role: 'system', content: 'Choose a decision from the supplied schema.' },
    { role: 'user', content: 'Đợi Bình cấp quyền cho Astra.' },
  ],
  schema: {
    type: 'object',
    properties: { decision: { type: 'string', enum: ['wait', 'plan'] } },
    required: ['decision'],
    additionalProperties: false,
  },
};
const config = { apiKey: 'unit-test-dummy-qwen-key', workspaceHost: '' };

function reply(content: string, stop = 'stop') {
  return Response.json({
    choices: [{ message: { role: 'assistant', content }, finish_reason: stop }],
    usage: { completion_tokens: 7 },
  });
}

test('Qwen sends one bounded schema request with a credential only in the HTTPS header', async () => {
  let calls = 0;
  const send: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.ok(init);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${config.apiKey}`);
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    assert.equal(new Headers(init.headers).get('x-dashscope-wait-timeout'), '0');
    const expected = {
      model: 'qwen3.7-flash-2026-07-15',
      messages: input.messages,
      enable_thinking: false,
      temperature: 0,
      max_completion_tokens: 32,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'shared_sade_decision', strict: true, schema: input.schema },
      },
    };
    assert.ok(typeof init.body === 'string');
    assert.deepEqual(JSON.parse(init.body), expected);
    assert.equal(init.body.includes(config.apiKey), false);
    return reply('{"decision":"wait"}');
  };
  assert.deepEqual(await completeSharedSadeQwen(input, { ...config, fetch: send }), {
    decision: 'wait',
  });
  assert.equal(calls, 1);
});

test('Qwen accepts the operator-configured Singapore workspace host', async () => {
  const workspaceHost = 'llm-example.ap-southeast-1.maas.aliyuncs.com';
  await completeSharedSadeQwen(input, {
    ...config,
    workspaceHost,
    fetch: async (url) => {
      assert.equal(url, `https://${workspaceHost}/compatible-mode/v1/chat/completions`);
      return reply('{"decision":"wait"}');
    },
  });
});

test('Qwen skips upstream calls if configuration is unavailable or input exceeds its UTF-8 limit', async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls += 1;
    return reply('{"decision":"wait"}');
  };
  await assert.rejects(completeSharedSadeQwen(input, { ...config, apiKey: '', fetch: send }), {
    code: 'unconfigured',
  });
  await assert.rejects(
    completeSharedSadeQwen(input, { ...config, workspaceHost: 'example.test', fetch: send }),
    { code: 'unconfigured' },
  );
  await assert.rejects(
    completeSharedSadeQwen(
      { ...input, messages: [{ role: 'user', content: 'á'.repeat(21 * 1024) }] },
      { ...config, fetch: send },
    ),
    { code: 'request_too_large' },
  );
  assert.equal(calls, 0);
});

test('Qwen reports overload without retrying or exposing provider response details', async () => {
  for (const status of [429, 503, 401]) {
    let calls = 0;
    const send: typeof fetch = async () => {
      calls += 1;
      return new Response('upstream diagnostics', { status });
    };
    await assert.rejects(
      completeSharedSadeQwen(input, { ...config, fetch: send }),
      (error: unknown) => {
        assert.ok(error instanceof SharedSadeQwenError);
        assert.equal(error.code, status === 401 ? 'unavailable' : 'busy');
        assert.doesNotMatch(error.message, /upstream diagnostics/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    completeSharedSadeQwen(input, {
      ...config,
      fetch: async () => {
        throw new Error('upstream diagnostics');
      },
    }),
    { code: 'unavailable', message: 'The Qwen planner is unavailable.' },
  );
});

test('Qwen rejects incomplete, malformed and oversized provider responses', async () => {
  const responses = [
    reply('{"decision":"wait"}', 'length'),
    reply('{"decision":'),
    reply('null'),
    new Response('x'.repeat(32 * 1024 + 1)),
  ];
  for (const response of responses) {
    await assert.rejects(
      completeSharedSadeQwen(input, { ...config, fetch: async () => response }),
      { code: 'invalid_response' },
    );
  }
});

test('Qwen aborts a queued request by deadline and cancels an eventual late response', async () => {
  let completeFetch!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const result = completeSharedSadeQwen(input, {
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
  let bodyCancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        bodyCancelled = true;
      },
    }),
  );
  completeFetch(response);
  await setImmediate();
  assert.equal(bodyCancelled, true);
});

test('Qwen cancels body reads at deadline and respects caller cancellation', async () => {
  let bodyCancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        bodyCancelled = true;
      },
    }),
  );
  await assert.rejects(
    completeSharedSadeQwen(input, { ...config, timeoutMs: 10, fetch: async () => response }),
    { code: 'timeout' },
  );
  assert.equal(bodyCancelled, true);

  const controller = new AbortController();
  const result = completeSharedSadeQwen(input, {
    ...config,
    signal: controller.signal,
    fetch: () => new Promise(() => {}),
  });
  controller.abort(new Error('caller details'));
  await assert.rejects(result, {
    code: 'cancelled',
    message: 'The Qwen planner request was cancelled.',
  });
});
