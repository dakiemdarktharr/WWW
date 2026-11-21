import { useEffect, useState } from 'react';
import { openExternal, type ClaudeWebAccount, type ClaudeCodeStatus } from './desktop';

export type ClaudeClient = 'web' | 'desktop' | 'code';

export function savedClaudeClient(memberId: string): ClaudeClient {
  try {
    const value = localStorage.getItem('kivuno-claude-client:' + memberId);
    return value === 'desktop' || value === 'code' ? value : 'web';
  } catch {
    return 'web';
  }
}
export function saveClaudeClient(memberId: string, client: ClaudeClient) {
  try {
    localStorage.setItem('kivuno-claude-client:' + memberId, client);
  } catch {
    /* optional preference */
  }
  window.dispatchEvent(new CustomEvent('kivuno-claude-client-changed', { detail: memberId }));
}

export const claudeClients = [
  { value: 'web', label: 'Claude in browser · Free or paid' },
  { value: 'desktop', label: 'Claude Desktop · Free or paid' },
  { value: 'code', label: 'Claude Code · eligible paid plan' },
];
export const claudeConnectorsUrl = 'https://claude.ai/customize/connectors/yours';
export function useClaudeCodeAccount(memberId?: string) {
  const [account, setAccount] = useState<ClaudeCodeStatus>();
  useEffect(() => {
    setAccount(undefined);
    if (!memberId || !window.relayDesktop?.claudeClient) return;
    let alive = true,
      revision = 0;
    const refresh = async () => {
      const request = ++revision;
      if (savedClaudeClient(memberId) !== 'code') {
        setAccount(undefined);
        return;
      }
      if (document.hidden) return;
      try {
        const value = await window.relayDesktop!.claudeClient('status');
        if (alive && request === revision) setAccount(value);
      } catch {
        if (alive && request === revision) setAccount(undefined);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('kivuno-claude-client-changed', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('kivuno-claude-client-changed', refresh);
    };
  }, [memberId]);
  return account;
}
const accountEvent = 'kivuno-claude-account-changed';
export function refreshClaudeAccount(memberId: string) {
  inFlight.delete(memberId);
  window.dispatchEvent(new CustomEvent(accountEvent, { detail: memberId }));
}
export async function beginClaudeAccount(memberId: string) {
  if (!window.relayDesktop?.beginClaudeWebAccount)
    throw new Error('Open the current Kivuno desktop app to connect Claude.');
  const account = await window.relayDesktop.beginClaudeWebAccount({ memberId });
  refreshClaudeAccount(memberId);
  if (account.status !== 'connected') await openExternal(claudeConnectorsUrl);
  return account;
}

const inFlight = new Map<string, Promise<ClaudeWebAccount>>();
function accountStatus(memberId: string) {
  const existing = inFlight.get(memberId);
  if (existing) return existing;
  const pending = window.relayDesktop!.claudeWebAccountStatus({ memberId }).finally(() => {
    if (inFlight.get(memberId) === pending) inFlight.delete(memberId);
  });
  inFlight.set(memberId, pending);
  return pending;
}
export function useClaudeAccount(memberId: string | undefined, watchPending = false) {
  const [account, setAccount] = useState<ClaudeWebAccount>();
  const [error, setError] = useState('');
  useEffect(() => {
    setAccount(undefined);
    setError('');
    if (!memberId || !window.relayDesktop?.claudeWebAccountStatus) return;
    const currentId = memberId;
    const started = Date.now();
    let alive = true,
      revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const requested = ++revision;
      clearTimeout(timer);
      if (document.hidden) return;
      try {
        const value = await accountStatus(currentId);
        if (!alive || requested !== revision) return;
        setAccount(value);
        setError('');
        if (value.status === 'pending')
          timer = setTimeout(refresh, watchPending && Date.now() - started < 120000 ? 3500 : 60000);
        else if (value.status === 'connected' && value.expiresAt)
          timer = setTimeout(refresh, Math.max(1000, Date.parse(value.expiresAt) - Date.now()));
      } catch (cause) {
        if (!alive || requested !== revision) return;
        setAccount(undefined);
        setError((cause as Error).message);
      }
    }
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === currentId) {
        void refresh();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(accountEvent, changed);
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(accountEvent, changed);
    };
  }, [memberId, watchPending]);
  return { account, error };
}
