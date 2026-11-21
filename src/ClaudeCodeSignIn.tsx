import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { openExternal, type ClaudeCodeStatus } from './desktop';

export default function ClaudeCodeSignIn() {
  const [status, setStatus] = useState<ClaudeCodeStatus>();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.relayDesktop?.claudeClient) return;
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const value = await window.relayDesktop!.claudeClient('status');
        if (active) {
          setStatus(value);
          setError('');
          if (value.signedIn) setWaiting(false);
        }
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, waiting ? 3500 : 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [waiting]);

  async function launch(action: 'login' | 'code') {
    setBusy(true);
    setError('');
    try {
      if (!window.relayDesktop?.claudeClient)
        throw new Error('Update Kivuno desktop to open Claude Code.');
      await window.relayDesktop.claudeClient(action);
      if (action === 'login') setWaiting(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form claude-account-step">
      {status?.signedIn ? (
        <>
          <strong role="status">
            <Check size={16} /> Claude Code signed in
          </strong>
          <p>
            {status.email || 'Signed in on this computer'}
            {status.plan ? ` · ${status.plan}` : ''}
          </p>
          <p>
            This is the account used by the official Claude Code app on this computer. Share a
            project below when you are ready to use it with Kivuno.
          </p>
          <button className="button primary" disabled={busy} onClick={() => void launch('code')}>
            <ArrowUpRight size={16} /> Open Claude Code
          </button>
        </>
      ) : (
        <>
          <p>
            Sign in through the official Claude Code app using your browser. Kivuno installs it if
            needed and checks when sign-in finishes.
          </p>
          <p>
            A Claude plan with Code access is required. For Claude Free, choose browser or Desktop
            above.
          </p>
          <button
            className="button primary"
            disabled={busy || waiting}
            onClick={() => void launch('login')}
          >
            {busy || waiting ? <Loader2 size={16} className="spin" /> : <ArrowUpRight size={16} />}
            {busy
              ? 'Preparing Claude Code…'
              : waiting
                ? 'Waiting for Claude sign-in…'
                : 'Sign in to Claude Code'}
          </button>
          {waiting && (
            <>
              <p>
                Finish the Anthropic sign-in opened by Claude Code, then return here. If your plan
                does not include Code, use browser or Desktop.
              </p>
              <button className="text-button" onClick={() => setWaiting(false)}>
                Sign-in closed? Try again
              </button>
            </>
          )}
        </>
      )}
      <button
        className="text-button"
        onClick={() =>
          void openExternal('https://claude.ai/settings/usage').catch((cause) =>
            setError(cause.message),
          )
        }
      >
        View usage in Claude
      </button>
      <small>
        Claude shows detailed usage for supported paid plans. Free has no usage dashboard. Kivuno
        does not receive remaining quota.
      </small>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
