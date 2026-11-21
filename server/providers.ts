import type { Member, ProviderCapability } from '../shared/types.ts';
import { isExternalMember } from '../shared/providers.ts';
import { CodexClient, resolveCodexCommand, localSkillRoots } from './codex.ts';
import { DomainError } from './store.ts';
import { AntigravityClient } from './antigravity.ts';
import { resolveManagedCommand } from './managed-process.ts';

export function nativeProviderClient(member: Member, home: string, cwd: string): CodexClient {
  if (member.provider === 'gemini')
    throw new DomainError(
      'Standalone Gemini CLI profiles are retired. Connect Antigravity to use Gemini models.',
      410,
    );
  if (isExternalMember(member))
    throw new DomainError(
      'This teammate uses the external MESH bridge. Kivuno does not manage its subscription sign-in or start its process.',
    );
  if (member.provider === 'antigravity') return new AntigravityClient({ home, cwd });
  return new CodexClient({ home, cwd, skillRoots: localSkillRoots() });
}
export async function providerCapabilities(): Promise<ProviderCapability[]> {
  const [codex, antigravity] = await Promise.allSettled([
    resolveCodexCommand(),
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
      id: 'claude',
      label: 'Claude',
      mode: 'external',
      available: true,
      login: 'external',
      quota: 'unknown',
      models: false,
      reasoning: false,
      reason:
        'Connect Claude Desktop or Claude Code to a project through local MCP. Start work and choose models in your Claude client.',
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
