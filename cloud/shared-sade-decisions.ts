import { z } from 'zod';
import type { SharedSadeChoiceQuestion } from '../shared/sade-cloud.ts';
import type { SharedSadeCloudInput } from '../server/shared-sade-cloud-planner.ts';

const endpoint = 'https://api.openai.com/v1/decisions';
const model = 'gpt-6-luna';
const questionName = 'sade_decision';
const labels = ['plan', 'question', 'no-work'] as const;
const labelDescriptions = {
  plan: 'Current scoped assignments can be scheduled. Keep dependencies and requester checkpoints as conditions on the affected tasks.',
  question:
    'A missing scope, teammate, device or authorization needs an answer before scheduling the requested work, or the sender asks to resolve it before assigning anything.',
  'no-work':
    'Informational, hypothetical, cancelled, or on hold with no question or other action for Sade now.',
} as const;
const maxRequestBytes = 40 * 1024;
const maxResponseBytes = 32 * 1024;
const maxAdditionalQuestions = 24;
export const sharedSadeDecisionsMaxMs = 1_750;

const errors = {
  unconfigured: 'The Decisions planner is not configured.',
  request_too_large: 'The Decisions planner request exceeds its input limit.',
  timeout: 'The Decisions planner did not reply before the deadline.',
  cancelled: 'The Decisions planner request was cancelled.',
  busy: 'The Decisions planner is busy.',
  unavailable: 'The Decisions planner is unavailable.',
  invalid_response: 'The Decisions planner did not return a complete decision.',
};

export class SharedSadeDecisionsError extends Error {
  readonly code: keyof typeof errors;

  constructor(code: keyof typeof errors) {
    super(errors[code]);
    this.code = code;
    this.name = 'SharedSadeDecisionsError';
  }
}

interface SharedSadeDecisionsOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const responseSchema = z.object({
  model: z.literal(model),
  status: z.literal('completed').optional(),
  error: z.null().optional(),
  incomplete_details: z.null().optional(),
  answers: z
    .array(
      z.object({
        name: z.string(),
        type: z.literal('choice'),
        choice: z.string(),
      }),
    )
    .min(1)
    .max(1 + maxAdditionalQuestions),
});

const routingQuestion: SharedSadeChoiceQuestion = {
  name: questionName,
  instructions:
    'Classify the current assignment using the supplied Kivuno project facts. Match each action to its requested teammate and owner. Use plan when a first step can be assigned now and a later step needs the requester to choose a style before editing. Record that choice as a checkpoint for the later step. A matching scoped read option establishes feasibility. Use question when a specific missing fact blocks scheduling the requested work. Use no-work for a completed-work report shared for visibility with no new assignment.',
  choices: labels.map((value) => ({ value, description: labelDescriptions[value] })),
};

function encodeRequest({ messages, questions = [] }: SharedSadeCloudInput) {
  const chosen = [routingQuestion, ...questions];
  if (
    questions.length > maxAdditionalQuestions ||
    new Set(chosen.map(({ name }) => name)).size !== chosen.length ||
    chosen.some(
      ({ name, choices }) =>
        !/^[a-z][a-z0-9_]{0,47}$/.test(name) ||
        choices.length < 2 ||
        new Set(choices.map(({ value }) => value)).size !== choices.length,
    )
  )
    throw new SharedSadeDecisionsError('invalid_response');
  const body = JSON.stringify({
    model,
    input: messages.map(({ role, content }) => ({ type: 'message', role, content })),
    questions: chosen.map((question) => ({ type: 'choice', ...question })),
  });
  if (Buffer.byteLength(body, 'utf8') > maxRequestBytes)
    throw new SharedSadeDecisionsError('request_too_large');
  return { body, chosen };
}

async function readDecision(
  response: Response,
  signal: AbortSignal,
  questions: SharedSadeChoiceQuestion[],
) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeDecisionsError(
      response.status === 429 || response.status === 503 ? 'busy' : 'unavailable',
    );
  }
  if (!response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {});
    throw new SharedSadeDecisionsError('invalid_response');
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
      if (bytes > maxResponseBytes) throw new SharedSadeDecisionsError('invalid_response');
      text += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    const reply = responseSchema.parse(JSON.parse(text + decoder.decode()));
    const byName = new Map(reply.answers.map(({ name, choice }) => [name, choice]));
    if (
      byName.size !== questions.length ||
      reply.answers.length !== questions.length ||
      questions.some(
        ({ name, choices }) => !choices.some(({ value }) => value === byName.get(name)),
      )
    )
      throw new SharedSadeDecisionsError('invalid_response');
    const decision = z.enum(labels).parse(byName.get(questionName));
    byName.delete(questionName);
    return { decision, ...(byName.size ? { selections: Object.fromEntries(byName) } : {}) };
  } catch {
    cancel();
    throw new SharedSadeDecisionsError('invalid_response');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function completeSharedSadeDecisions(
  input: SharedSadeCloudInput,
  options: SharedSadeDecisionsOptions = {},
) {
  const apiKey = (options.apiKey ?? process.env.SADE_OPENAI_API_KEY)?.trim();
  const timeoutMs = options.timeoutMs ?? sharedSadeDecisionsMaxMs;
  if (
    !apiKey ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > sharedSadeDecisionsMaxMs
  )
    throw new SharedSadeDecisionsError('unconfigured');
  if (options.signal?.aborted) throw new SharedSadeDecisionsError('cancelled');

  const { body, chosen } = encodeRequest(input);
  const controller = new AbortController();
  const cancel = () => controller.abort(new SharedSadeDecisionsError('cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new SharedSadeDecisionsError('timeout')),
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
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
        redirect: 'error',
        body,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw controller.signal.reason;
      }
      return readDecision(response, controller.signal, chosen);
    })();
    return await Promise.race([stopped, request]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof SharedSadeDecisionsError) throw error;
    throw new SharedSadeDecisionsError('unavailable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
