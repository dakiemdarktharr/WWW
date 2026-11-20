const MODEL = 'qwen3.7-flash-2026-07-15';
const DEFAULT_HOST = 'dashscope-intl.aliyuncs.com';
const WORKSPACE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ap-southeast-1\.maas\.aliyuncs\.com$/;
const DEFAULT_TIMEOUT_MS = 1050;
const MAX_REQUEST_BYTES = 40 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;

const errors = {
  unconfigured: 'The Qwen planner is not configured.',
  request_too_large: 'The Qwen planner request exceeds its input limit.',
  timeout: 'The Qwen planner did not reply before the deadline.',
  cancelled: 'The Qwen planner request was cancelled.',
  busy: 'The Qwen planner is busy.',
  unavailable: 'The Qwen planner is unavailable.',
  invalid_response: 'The Qwen planner did not return a complete decision.',
};

export class SharedSadeQwenError extends Error {
  readonly code: keyof typeof errors;

  constructor(code: keyof typeof errors) {
    super(errors[code]);
    this.code = code;
    this.name = 'SharedSadeQwenError';
  }
}

export interface SharedSadeQwenInput {
  messages: readonly { role: 'system' | 'user'; content: string }[];
  schema: object;
}

export interface SharedSadeQwenOptions {
  apiKey?: string;
  workspaceHost?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function encodeRequest(input: SharedSadeQwenInput) {
  // Send model input and schema only. Credentials stay in the transport header.
  const body = JSON.stringify({
    model: MODEL,
    messages: input.messages.map(({ role, content }) => ({ role, content })),
    enable_thinking: false,
    temperature: 0,
    max_completion_tokens: 32,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'shared_sade_decision', strict: true, schema: input.schema },
    },
  });
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES)
    throw new SharedSadeQwenError('request_too_large');
  return body;
}

async function readDecision(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) {
    // Errors may contain arbitrary upstream text. Discard the body without forwarding it.
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeQwenError(
      response.status === 429 || response.status === 503 ? 'busy' : 'unavailable',
    );
  }
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeQwenError('invalid_response');
  }
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new SharedSadeQwenError('invalid_response');
      text += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    const reply = JSON.parse(text + decoder.decode());
    const choice = reply?.choices?.[0];
    if (
      !Array.isArray(reply?.choices) ||
      reply.choices.length !== 1 ||
      choice?.finish_reason !== 'stop' ||
      choice.message?.role !== 'assistant' ||
      typeof choice.message.content !== 'string' ||
      choice.message.tool_calls != null
    )
      throw new SharedSadeQwenError('invalid_response');
    const decision: unknown = JSON.parse(choice.message.content);
    if (decision === null || typeof decision !== 'object' || Array.isArray(decision))
      throw new SharedSadeQwenError('invalid_response');
    return decision;
  } catch {
    cancel();
    throw new SharedSadeQwenError('invalid_response');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function completeSharedSadeQwen(
  input: SharedSadeQwenInput,
  options: SharedSadeQwenOptions = {},
): Promise<unknown> {
  const apiKey = (options.apiKey ?? process.env.SADE_QWEN_API_KEY)?.trim();
  const workspaceHost = (options.workspaceHost ?? process.env.SADE_QWEN_WORKSPACE_HOST)?.trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !apiKey ||
    (workspaceHost && !WORKSPACE_HOST.test(workspaceHost)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_TIMEOUT_MS
  )
    throw new SharedSadeQwenError('unconfigured');
  if (options.signal?.aborted) throw new SharedSadeQwenError('cancelled');

  const body = encodeRequest(input);
  const controller = new AbortController();
  const cancel = () => controller.abort(new SharedSadeQwenError('cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new SharedSadeQwenError('timeout')), timeoutMs);
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    const request = (async () => {
      const response = await (options.fetch ?? fetch)(
        `https://${workspaceHost || DEFAULT_HOST}/compatible-mode/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'x-dashscope-wait-timeout': '0',
          },
          signal: controller.signal,
          redirect: 'error',
          body,
        },
      );
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw controller.signal.reason;
      }
      return readDecision(response, controller.signal);
    })();
    return await Promise.race([stopped, request]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof SharedSadeQwenError) throw error;
    throw new SharedSadeQwenError('unavailable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
