import { sharedSadeCloudFinishPath, sharedSadeCloudHeader } from '../shared/sade-cloud.ts';
import type { SharedSadeCloudOffer, SharedFinish } from '../server/group-sade.ts';
import {
  planSharedSadeCloud,
  type SharedSadeCloudInput,
} from '../server/shared-sade-cloud-planner.ts';
import {
  compileSharedSadeResponsesPlan,
  sharedSadeResponsesRequest,
} from '../server/shared-sade-responses-plan.ts';
import {
  completeSharedSadeDecisions,
  SharedSadeDecisionsError,
  sharedSadeDecisionsMaxMs,
} from './shared-sade-decisions.ts';
import {
  completeSharedSadeResponses,
  SharedSadeResponsesError,
  sharedSadeResponsesMaxMs,
} from './shared-sade-responses.ts';

function plannerMode() {
  const route = process.env.SADE_OPENAI_API_ROUTE;
  return route === 'responses-standard-medium' || route === 'hybrid' ? route : 'decisions';
}

export function hostedSadeBudgetMs() {
  return plannerMode() === 'decisions' ? 2_100 : 4_550;
}

const providerBusyUntil = { decisions: 0, responses: 0 };

export function usesHostedSade(body: Buffer) {
  try {
    const command = JSON.parse(body.toString('utf8'));
    return (
      (command?.action === 'message' && Boolean(command.sade)) ||
      command?.action === 'sade-answer' ||
      command?.action === 'sade-grant'
    );
  } catch {
    return false;
  }
}

function plannerFailure(error: unknown): SharedFinish {
  const code =
    error instanceof SharedSadeDecisionsError || error instanceof SharedSadeResponsesError
      ? error.code
      : 'unavailable';
  return {
    kind: 'blocked',
    summary:
      code === 'busy'
        ? 'Dịch vụ lập kế hoạch Sade đang bận. Hãy gửi yêu cầu mới sau ít phút.'
        : code === 'timeout'
          ? 'Dịch vụ lập kế hoạch chưa phản hồi trong thời gian cho phép. Hãy gửi yêu cầu mới để thử lại.'
          : code === 'request_too_large'
            ? 'Yêu cầu quá dài để lập kế hoạch nhanh. Hãy rút gọn tin nhắn hoặc nhóm việc.'
            : code === 'unconfigured'
              ? 'Dịch vụ lập kế hoạch Sade chưa được cấu hình trên Kivuno.'
              : 'Sade chưa nhận được quyết định hợp lệ từ dịch vụ lập kế hoạch. Hãy thử lại với yêu cầu cụ thể.',
  };
}

export type HostedSadeTiming = { groundingMs?: number; providerMs?: number; receiptMs?: number };

function responsesWithChoices(
  delivery: SharedSadeCloudOffer['delivery'],
  incumbent: SharedSadeCloudInput,
) {
  const request = sharedSadeResponsesRequest(delivery);
  if (!incumbent.questions?.length) return request;
  const schema = request.responseSchema;
  const questions = incumbent.questions;
  const properties = schema.properties as Record<string, unknown>;
  const required = schema.required as string[];
  return {
    messages: [
      ...request.messages,
      {
        role: 'user' as const,
        content: JSON.stringify({
          verifiedChoices: questions,
          selectionRule:
            'For each choice question, select the exact matching answer by value. An available no_match means the provided choices miss the active request.',
        }),
      },
    ],
    responseSchema: {
      ...schema,
      properties: {
        ...properties,
        selections: {
          type: 'object',
          properties: Object.fromEntries(
            questions.map(({ name, choices }) => [
              name,
              {
                type: 'string',
                enum: choices.map(({ value }) => value),
              },
            ]),
          ),
          required: questions.map(({ name }) => name),
          additionalProperties: false,
        },
      },
      required: [...required, 'selections'],
    },
  };
}

async function decide(
  offer: SharedSadeCloudOffer,
  deadline: number,
  timing: HostedSadeTiming,
): Promise<SharedFinish> {
  const planStarted = performance.now();
  const mode = plannerMode();
  let proposal: unknown;
  try {
    const grounded = await planSharedSadeCloud(offer.delivery, async (input) => {
      const provider =
        mode === 'responses-standard-medium' ||
        (mode === 'hybrid' && !input.hasVerifiedRule && !input.questions?.length)
          ? 'responses'
          : 'decisions';
      const request =
        provider === 'responses' ? responsesWithChoices(offer.delivery, input) : undefined;
      timing.groundingMs = Math.round(performance.now() - planStarted);
      // Reserve time for the permission recheck and response. Never retry this request.
      const cap = provider === 'responses' ? sharedSadeResponsesMaxMs : sharedSadeDecisionsMaxMs;
      const timeoutMs = Math.min(cap, deadline - Date.now() - 180);
      if (timeoutMs < 50) throw new SharedSadeDecisionsError('timeout');
      if (providerBusyUntil[provider] > Date.now()) throw new SharedSadeDecisionsError('busy');
      const started = performance.now();
      try {
        if (!request) return await completeSharedSadeDecisions(input, { timeoutMs });
        proposal = await completeSharedSadeResponses(request, { timeoutMs });
        if (!proposal || typeof proposal !== 'object') return proposal;
        const result = proposal as { decision?: unknown; selections?: unknown };
        return {
          decision: result.decision,
          ...(input.questions?.length ? { selections: result.selections } : {}),
        };
      } catch (error) {
        if (
          (error instanceof SharedSadeDecisionsError ||
            error instanceof SharedSadeResponsesError) &&
          error.code === 'busy'
        )
          providerBusyUntil[provider] = Date.now() + 2_000;
        throw error;
      } finally {
        timing.providerMs = Math.round(performance.now() - started);
      }
    });
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return grounded;
    const { selections: _choices, ...structured } = proposal as Record<string, unknown>;
    return compileSharedSadeResponsesPlan(offer.delivery, structured, grounded) ?? grounded;
  } catch (error) {
    return plannerFailure(error);
  }
}

/** The internal offer is consumed by the gateway and never sent to a desktop. */
export async function settleHostedSade(
  upstream: Response,
  runnerOrigin: string,
  runnerHeaders: Headers,
  deadline: number,
  timing: HostedSadeTiming = {},
) {
  const { sadePlanner: offer, ...body } = (await upstream.json()) as {
    sadePlanner?: SharedSadeCloudOffer;
    sadeGroup?: unknown;
  };
  if (!offer) return body;
  const decision = await decide(offer, deadline, timing);
  const result =
    Date.now() >= deadline && decision.kind !== 'blocked'
      ? plannerFailure(new SharedSadeDecisionsError('timeout'))
      : decision;
  const headers = new Headers({
    authorization: runnerHeaders.get('authorization') || '',
    origin: runnerHeaders.get('origin') || '',
    'content-type': 'application/json',
    'x-relay-gateway': runnerHeaders.get('x-relay-gateway') || '',
    [sharedSadeCloudHeader]: '1',
  });
  const started = performance.now();
  try {
    const receipt = await fetch(`${runnerOrigin}${sharedSadeCloudFinishPath}`, {
      method: 'POST',
      headers,
      redirect: 'error',
      body: JSON.stringify({
        groupId: offer.delivery.groupId,
        runId: offer.runId,
        jobId: offer.delivery.id,
        claimId: offer.claimId,
        result,
      }),
      signal: AbortSignal.timeout(Math.max(150, deadline - Date.now())),
    });
    if (receipt.ok) return { ...body, sadeGroup: await receipt.json() };
    void receipt.body?.cancel().catch(() => {});
  } catch {
    // A lost response may already have committed. The desktop can read the group.
  } finally {
    timing.receiptMs = Math.round(performance.now() - started);
  }
  delete body.sadeGroup;
  return body;
}
