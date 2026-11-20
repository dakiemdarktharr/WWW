import type { Member, ProviderId } from './types.ts';

export const providerLabels: Record<ProviderId, string> = {
  codex: 'Codex',
  gemini: 'Gemini',
  claude: 'Claude',
  antigravity: 'Antigravity',
};

export const isExternalProvider = (provider?: ProviderId) =>
  provider === 'claude' || provider === 'antigravity';

export const isExternalMember = (
  member?: Pick<Member, 'provider' | 'integration' | 'managedRuntime'>,
) =>
  !member ||
  member.integration === 'external' ||
  (isExternalProvider(member.provider) && !member.managedRuntime);

export const usesScopedTools = (provider?: ProviderId) => !!provider && provider !== 'codex';
