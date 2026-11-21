import type { Member, ProviderCapability } from '../shared/types.ts';
import { isExternalMember } from '../shared/providers.ts';
import { CodexClient, resolveCodexCommand, localSkillRoots } from './codex.ts';
import { GeminiClient, resolveGeminiCommand } from './gemini.ts';
import { DomainError } from './store.ts';
import { ClaudeClient } from './claude.ts';
import { AntigravityClient } from './antigravity.ts';
import { resolveManagedCommand } from './managed-process.ts';

export function nativeProviderClient(member: Member, home: string, cwd: string): CodexClient {
  if (isExternalMember(member))
    throw new DomainError(
      'This teammate uses the external MESH bridge. Kivuno does not manage its subscription sign-in or start its process.',
    );
  if (member.provider === 'claude') return new ClaudeClient({ home, cwd });
  if (member.provider === 'antigravity') return new AntigravityClient({ home, cwd });
  return member.provider === 'gemini'
    ? new GeminiClient({ home, cwd })
    : new CodexClient({ home, cwd, skillRoots: localSkillRoots() });
}
export async function providerCapabilities(): Promise<ProviderCapability[]> {
  const [codex, gemini, claude, antigravity] = await Promise.allSettled([
    resolveCodexCommand(),
    resolveGeminiCommand(),
    resolveManagedCommand('claude'),
    resolveManagedCommand('antigravity'),
  ]);
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
      managed: { available: claude.status === 'fulfilled', models: true, reasoning: true },
      label: 'Claude Code',
      mode: 'external',
      available: true,
      login: 'external',
      quota: 'unknown',
      models: false,
      reasoning: false,
      reason:
        'Enable Sade to run the official Claude CLI with a separate subscription sign-in, scoped tools and bounded prompts, or keep an external MESH connection. Models and effort come from the installed CLI. No paid API fallback.',
    },
    {
      id: 'antigravity',
      managed: { available: antigravity.status === 'fulfilled', models: true, reasoning: true },
      label: 'Antigravity',
      mode: 'external',
      available: true,
      login: 'google',
      quota: 'unknown',
      models: false,
      reasoning: false,
      reason:
        'Confirm the Antigravity account on this computer to let Sade use the official CLI through ACP, or keep an external MESH connection. Models and thinking levels must be advertised by the CLI. No API-key or credit fallback.',
    },
  ];
}
