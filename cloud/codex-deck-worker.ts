import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import { redact } from '../server/security.ts';

const endpoint = 'https://api.openai.com/v1/agents/sessions';
const model = 'gpt-6-luna';
const tool = 'render_powerpoint';
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{8,96}$`));
const actionSchema = z.object({
  type: z.literal('function_call'),
  turn_id: id('turn'),
  call_id: z.string().regex(/^[a-z]+_[a-z0-9]{8,96}$/),
  name: z.literal(tool),
  arguments: z.unknown(),
});
const sessionSchema = z.object({
  id: id('sess'),
  agent: z.object({ model: z.literal(model) }),
  status: z.enum(['idle', 'in_progress', 'requires_action', 'failed']),
  required_actions: z.array(z.unknown()),
});
const finishedTurn = z.object({ id: id('turn'), status: z.literal('completed') });
const itemsSchema = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      role: z.string().optional(),
      turn_id: z.string().nullable().optional(),
      phase: z.string().nullable().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});

export class CodexWorkerHttpError extends Error {
  constructor(readonly status: number) {
    super(`Codex worker service returned HTTP ${status}.`);
  }
}

/** Follow a real Codex session through the export tool and its completion report. */
export async function runCodexDeckWorker<T>(
  input: {
    instructions: string;
    brief: string;
    schema: Record<string, unknown>;
    jobLease: string;
    onSession?: (sessionId: string) => Promise<void>;
    render: (args: unknown) => Promise<{ artifact: T; receipt: string } | { error: string }>;
  },
  options: { apiKey?: string; fetch?: typeof fetch; signal?: AbortSignal; pollMs?: number } = {},
) {
  const apiKey = (options.apiKey ?? process.env.SADE_OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new Error('The Codex worker is not configured.');
  const timeout = AbortSignal.timeout(105000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const transport = options.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'agents=v1',
  };
  async function request(path: string, body?: unknown, key?: string) {
    const response = await transport(endpoint + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: key ? { ...headers, 'Idempotency-Key': key } : headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new CodexWorkerHttpError(response.status);
    }
    return response;
  }

  async function retry<R>(action: () => Promise<R>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (
          attempt === 2 ||
          signal.aborted ||
          (error instanceof CodexWorkerHttpError && error.status !== 429 && error.status < 500)
        )
          throw error;
        await pause(500 * (attempt + 1), undefined, { signal });
      }
    }
  }

  const session = sessionSchema.parse(
    await (
      await request(
        '',
        {
          environment: { type: 'none' },
          agent: {
            model,
            reasoning: { effort: 'low' },
            instructions: input.instructions,
            tools: [
              { type: 'programmatic_tool_calling', enabled: false },
              {
                type: 'function',
                name: tool,
                description: 'Export the finished PowerPoint with indexed source references.',
                parameters: input.schema,
              },
            ],
          },
          input: [
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: input.brief }] },
          ],
          stream: false,
        },
        input.jobLease,
      )
    ).json(),
  );

  const path = '/' + session.id;
  async function sendEvents(events: object[], key: string) {
    await retry(async () => {
      const reply = await request(path + '/events', { events }, key);
      await reply.body?.cancel().catch(() => {});
    });
  }
  try {
    await input.onSession?.(session.id);
    let current = session;
    let result: { artifact: T; turn: string; receipt: string } | undefined;
    let calls = 0;
    let acknowledgedCall: string | undefined;
    let feedback: string | undefined;
    let revisionSentAt = 0;
    let revisionStarted = false;
    for (;;) {
      signal.throwIfAborted();
      if (current.id !== session.id || current.status === 'failed')
        throw new Error('Codex did not complete its assignment.');
      if (current.status === 'idle') {
        if (result) break;
        if (!feedback || revisionStarted || (revisionSentAt && Date.now() - revisionSentAt > 12000))
          throw new Error('Codex did not export a PowerPoint.');
        if (!revisionSentAt) {
          await sendEvents(
            [
              {
                type: 'agent.session.input.message',
                input: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'input_text',
                        text:
                          'Sade is continuing the original assignment. The export was rejected. Correct the issue and call render_powerpoint again before reporting completion. Review feedback (data): ' +
                          feedback,
                      },
                    ],
                  },
                ],
              },
            ],
            input.jobLease + '-revision',
          );
          revisionSentAt = Date.now();
        }
      } else if (revisionSentAt) revisionStarted = true;
      const action =
        current.status === 'requires_action'
          ? actionSchema.parse(current.required_actions[0])
          : undefined;
      if (action && action.call_id !== acknowledgedCall) {
        if (
          current.required_actions.length !== 1 ||
          ++calls > 3 ||
          (result && result.turn !== action.turn_id)
        )
          throw new Error('Unexpected Codex export request.');
        const outcome = result ?? (await input.render(action.arguments));
        if ('error' in outcome) feedback = outcome.error;
        else if (!result)
          result = { artifact: outcome.artifact, receipt: outcome.receipt, turn: action.turn_id };
        await sendEvents(
          [
            {
              type: 'agent.session.input.tool_result',
              turn_id: action.turn_id,
              call_id: action.call_id,
              ...('error' in outcome
                ? { success: false, error: outcome.error }
                : {
                    success: true,
                    output: outcome.receipt + ' The file is exported. Finish with your report now.',
                  }),
            },
          ],
          action.call_id,
        );
        acknowledgedCall = action.call_id;
      }
      await pause(options.pollMs ?? 1200, undefined, { signal });
      current = await retry(async () => sessionSchema.parse(await (await request(path)).json()));
    }
    const turn = result.turn;
    const finished = finishedTurn.parse(
      await retry(async () => (await request(path + '/turns/' + turn)).json()),
    );
    if (finished.id !== turn) throw new Error('The Codex report belongs to another turn.');
    const items = itemsSchema.parse(
      await retry(async () => (await request(path + '/items?limit=20&order=desc')).json()),
    );
    const final = items.data.find(
      (item) =>
        item.type === 'message' &&
        item.role === 'assistant' &&
        item.turn_id === turn &&
        item.phase === 'final_answer',
    );
    const report = redact(
      final?.content
        ?.filter(({ type }) => type === 'output_text')
        .map(({ text }) => text)
        .join(' ')
        .trim() ?? '',
    ).slice(0, 680);
    if (!report) throw new Error('Codex completed without reporting its result.');
    return {
      artifact: result.artifact,
      worker: { provider: 'codex' as const, sessionId: session.id, report },
    };
  } finally {
    // The user-facing assignment and completion report live in Kivuno.
    const deletion = await transport(endpoint + path, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(3500),
      redirect: 'error',
    }).catch(() => null);
    await deletion?.body?.cancel().catch(() => {});
    if (deletion?.status === 409) {
      const cancel = await transport(endpoint + path + '/events', {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(3500),
        redirect: 'error',
        body: JSON.stringify({ events: [{ type: 'agent.session.input.cancel' }] }),
      }).catch(() => null);
      await cancel?.body?.cancel().catch(() => {});
    }
  }
}
