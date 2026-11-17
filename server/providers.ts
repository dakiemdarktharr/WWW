import type { Member, ProviderCapability } from '../shared/types.ts';
import { isExternalMember } from '../shared/providers.ts';
import { CodexClient, resolveCodexCommand, localSkillRoots } from './codex.ts';
import { GeminiClient, resolveGeminiCommand } from './gemini.ts';
import { DomainError } from './store.ts';

export function nativeProviderClient(member: Member, home: string, cwd: string): CodexClient {
  if (isExternalMember(member))
    throw new DomainError(
      'This teammate uses the external MESH bridge. Kivuno does not manage its subscription sign-in or start its process.',
    );
  return member.provider === 'gemini'
    ? new GeminiClient({ home, cwd })
    : new CodexClient({ home, cwd, skillRoots: localSkillRoots() });
}
export async function providerCapabilities(): Promise<ProviderCapability[]> {
  const [codex, gemini] = await Promise.allSettled([resolveCodexCommand(), resolveGeminiCommand()]);
  return [
    {
      id: 'codex',
      label: 'ChatGPT / Codex',
      mode: 'native',
      available: codex.status === 'fulfilled',
      login: 'chatgpt',
      quota: 'provider',
      models: true,
      reasoning: true,
      ...(codex.status === 'rejected' ? { reason: 'The Codex runtime is unavailable.' } : {}),
    },
    {
      id: 'gemini',
      label: 'Gemini',
      mode: 'native',
      available: gemini.status === 'fulfilled',
      login: 'google',
      quota: 'unknown',
      models: true,
      reasoning: false,
      reason:
        gemini.status === 'fulfilled'
          ? 'Google login only. ACP exposes models but not remaining subscription quota or reasoning controls. Scoped file tools; no shell execution. Explicit bounded turn allowance is required.'
          : 'Install the Kivuno build containing Gemini CLI 0.66.0.',
    },
    {
      id: 'claude',
      label: 'Claude Code',
      mode: 'external',
      available: true,
      login: 'external',
      quota: 'unknown',
      models: false,
      reasoning: false,
      reason:
        'Connect your own client through the local MESH MCP bridge. Kivuno does not provide Claude subscription OAuth or a paid API fallback.',
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      mode: 'external',
      available: true,
      login: 'google',
      quota: 'unknown',
      models: false,
      reasoning: false,
      reason:
        'Sign in with the official Antigravity CLI from Kivuno, then connect the client through local MESH MCP. Antigravity is separate from Gemini CLI; Kivuno does not start its model or import its tools.',
    },
  ];
}
