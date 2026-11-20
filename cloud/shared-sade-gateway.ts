import { sharedSadeCloudFinishPath, sharedSadeCloudHeader } from '../shared/sade-cloud.ts';
import type { SharedSadeCloudOffer, SharedFinish } from '../server/group-sade.ts';
import { planSharedSadeCloud } from '../server/shared-sade-cloud-planner.ts';
import { completeSharedSadeQwen, SharedSadeQwenError } from './shared-sade-qwen.ts';

export const hostedSadeBudgetMs = 1_400;
let providerBusyUntil = 0;

export function usesHostedSade(body: Buffer) {
  if (!process.env.SADE_QWEN_API_KEY?.trim()) return false;
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
  const code = error instanceof SharedSadeQwenError ? error.code : 'unavailable';
  return {
    kind: 'blocked',
    summary:
      code === 'busy'
        ? 'Dịch vụ lập kế hoạch Qwen đang bận. Hãy gửi yêu cầu mới sau ít phút.'
        : code === 'timeout'
          ? 'Qwen chưa trả kế hoạch trong thời gian cho phép. Hãy gửi yêu cầu mới để thử lại.'
          : code === 'request_too_large'
            ? 'Yêu cầu quá dài để lập kế hoạch nhanh. Hãy rút gọn tin nhắn hoặc nhóm việc.'
            : 'Sade chưa nhận được quyết định hợp lệ từ Qwen. Hãy thử lại với yêu cầu cụ thể.',
  };
}

async function decide(offer: SharedSadeCloudOffer, deadline: number): Promise<SharedFinish> {
  try {
    return await planSharedSadeCloud(offer.delivery, async (input) => {
      // Reserve time for the permission recheck and response. Never retry this request.
      const timeoutMs = Math.min(1_050, deadline - Date.now() - 150);
      if (timeoutMs < 50) throw new SharedSadeQwenError('timeout');
      if (providerBusyUntil > Date.now()) throw new SharedSadeQwenError('busy');
      try {
        return await completeSharedSadeQwen(input, { timeoutMs });
      } catch (error) {
        if (error instanceof SharedSadeQwenError && error.code === 'busy')
          providerBusyUntil = Date.now() + 2_000;
        throw error;
      }
    });
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
) {
  const { sadePlanner: offer, ...body } = (await upstream.json()) as {
    sadePlanner?: SharedSadeCloudOffer;
    sadeGroup?: unknown;
  };
  if (!offer) return body;
  const decision = await decide(offer, deadline);
  const result =
    Date.now() >= deadline && decision.kind !== 'blocked'
      ? plannerFailure(new SharedSadeQwenError('timeout'))
      : decision;
  const headers = new Headers({
    authorization: runnerHeaders.get('authorization') || '',
    origin: runnerHeaders.get('origin') || '',
    'content-type': 'application/json',
    'x-relay-gateway': runnerHeaders.get('x-relay-gateway') || '',
    [sharedSadeCloudHeader]: '1',
  });
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
  }
  delete body.sadeGroup;
  return body;
}
