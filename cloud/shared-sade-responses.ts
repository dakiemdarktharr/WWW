import { z } from 'zod';

const endpoint = 'https://api.openai.com/v1/responses';
const model = 'gpt-6-luna';
const maxRequestBytes = 64 * 1024;
const maxResponseBytes = 64 * 1024;
const defaultOutputTokens = 2_048;
export const sharedSadeResponsesMaxMs = 4_150;
export const sharedSadeProjectResponsesMaxMs = 17_500;

const errors = {
  unconfigured: 'The Responses planner is not configured.',
  request_too_large: 'The Responses planner request exceeds its input limit.',
  timeout: 'The Responses planner did not reply before the deadline.',
  cancelled: 'The Responses planner request was cancelled.',
  busy: 'The Responses planner is busy.',
  unavailable: 'The Responses planner is unavailable.',
  incomplete: 'The Responses planner did not finish its proposal.',
  refused: 'The Responses planner did not provide a proposal.',
  invalid_response: 'The Responses planner did not return valid JSON.',
};

export class SharedSadeResponsesError extends Error {
  constructor(readonly code: keyof typeof errors) {
    super(errors[code]);
    this.name = 'SharedSadeResponsesError';
  }
}

export interface SharedSadeResponsesInput {
  messages: readonly { role: 'system' | 'user'; content: string }[];
  responseSchema: Record<string, unknown>;
  catalogueJpeg?: string;
}

export interface SharedSadeResponsesUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
}

export interface SharedSadeResponsesOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium';
  background?: boolean;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onUsage?: (usage: SharedSadeResponsesUsage) => void;
}

const tokenCount = z.int().nonnegative();
const usageSchema = z.object({
  input_tokens: tokenCount,
  input_tokens_details: z
    .object({ cached_tokens: tokenCount.optional(), cache_write_tokens: tokenCount.optional() })
    .nullish(),
  output_tokens: tokenCount,
  output_tokens_details: z.object({ reasoning_tokens: tokenCount.optional() }).nullish(),
  total_tokens: tokenCount,
});
const envelope = z.object({
  model: z.literal(model),
  status: z.enum(['completed', 'failed', 'in_progress', 'cancelled', 'queued', 'incomplete']),
  error: z.unknown(),
  incomplete_details: z.unknown(),
  output: z.unknown(),
  usage: z.unknown(),
});
const assistantMessage = z.object({
  type: z.literal('message'),
  role: z.literal('assistant'),
  status: z.literal('completed').optional(),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('output_text'), text: z.string() }),
      z.object({ type: z.literal('refusal') }),
    ]),
  ),
});
const outputSchema = z.array(
  z.union([z.object({ type: z.literal('reasoning') }), assistantMessage]),
);

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeResponsesError(
      response.status === 429 || response.status === 503 ? 'busy' : 'unavailable',
    );
  }
  if (!response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeResponsesError('invalid_response');
  }

  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    signal.throwIfAborted();
    let bytes = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return JSON.parse(text + decoder.decode());
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) throw new SharedSadeResponsesError('invalid_response');
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    cancel();
    throw new SharedSadeResponsesError('invalid_response');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function parseResponse(body: unknown, onUsage: SharedSadeResponsesOptions['onUsage']): unknown {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) throw new SharedSadeResponsesError('invalid_response');
  const reply = parsed.data;
  const usage = usageSchema.safeParse(reply.usage);
  if (usage.success) {
    const data = usage.data;
    onUsage?.({
      inputTokens: data.input_tokens,
      outputTokens: data.output_tokens,
      cachedInputTokens: data.input_tokens_details?.cached_tokens,
      cacheWriteInputTokens: data.input_tokens_details?.cache_write_tokens,
      reasoningTokens: data.output_tokens_details?.reasoning_tokens,
      totalTokens: data.total_tokens,
    });
  }
  if (reply.error != null || reply.status === 'failed')
    throw new SharedSadeResponsesError('unavailable');
  if (reply.status !== 'completed' || reply.incomplete_details != null)
    throw new SharedSadeResponsesError('incomplete');

  const output = outputSchema.safeParse(reply.output);
  if (!output.success) throw new SharedSadeResponsesError('invalid_response');
  const messages = output.data.filter((item) => item.type === 'message');
  if (messages.some((message) => message.content.some((part) => part.type === 'refusal')))
    throw new SharedSadeResponsesError('refused');
  if (messages.length !== 1) throw new SharedSadeResponsesError('invalid_response');

  const text = messages[0].content
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new SharedSadeResponsesError('invalid_response');
  }
}

export async function completeSharedSadeResponses(
  input: SharedSadeResponsesInput,
  options: SharedSadeResponsesOptions = {},
): Promise<unknown> {
  const apiKey = (options.apiKey ?? process.env.SADE_OPENAI_API_KEY)?.trim();
  const timeoutMs = options.timeoutMs ?? sharedSadeResponsesMaxMs;
  const maxTimeoutMs = options.background
    ? sharedSadeProjectResponsesMaxMs
    : sharedSadeResponsesMaxMs;
  const maxOutputTokens = options.maxOutputTokens ?? defaultOutputTokens;
  if (
    !apiKey ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > maxTimeoutMs ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 16 ||
    maxOutputTokens > 128_000
  )
    throw new SharedSadeResponsesError('unconfigured');
  if (options.signal?.aborted) throw new SharedSadeResponsesError('cancelled');

  const body = JSON.stringify({
    model,
    input: input.messages.map(({ role, content }, index) => ({
      type: 'message',
      role,
      content:
        role === 'user' && index === input.messages.length - 1 && input.catalogueJpeg
          ? [
              { type: 'input_text', text: content },
              {
                type: 'input_image',
                image_url: 'data:image/jpeg;base64,' + input.catalogueJpeg,
                detail: 'high',
              },
            ]
          : content,
    })),
    reasoning: { effort: options.reasoningEffort ?? 'medium' },
    service_tier: 'default',
    stream: false,
    store: false,
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: 'sade_proposal',
        strict: true,
        schema: input.responseSchema,
      },
    },
  });
  if (
    Buffer.byteLength(body, 'utf8') >
    (input.catalogueJpeg ? maxRequestBytes + 350_000 : maxRequestBytes)
  )
    throw new SharedSadeResponsesError('request_too_large');

  const controller = new AbortController();
  const cancel = () => controller.abort(new SharedSadeResponsesError('cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new SharedSadeResponsesError('timeout')),
    timeoutMs,
  );
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    const request = (async () => {
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw controller.signal.reason;
      }
      return parseResponse(await readResponse(response, controller.signal), options.onUsage);
    })();
    return await Promise.race([request, stopped]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof SharedSadeResponsesError) throw error;
    throw new SharedSadeResponsesError('unavailable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
