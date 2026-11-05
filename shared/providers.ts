import type { Member, ProviderId } from './types.ts';

export const isExternalProvider = (provider?: ProviderId) =>
  provider === 'claude' || provider === 'antigravity';

export const isExternalMember = (member: Pick<Member, 'provider' | 'integration'>) =>
  member.integration === 'external' || isExternalProvider(member.provider);
