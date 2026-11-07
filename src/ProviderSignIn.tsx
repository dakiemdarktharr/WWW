import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { LoginResult, Member } from '../shared/types';
import { api } from './api';
import { openExternal } from './desktop';
import ConnectionProgress from './ConnectionProgress';

function authUrl(result: LoginResult) {
  try {
    const url = new URL(result.authUrl || result.verificationUrl || '');
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['openai.com', 'chatgpt.com'].some(
        (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain),
      )
      ? url.href
      : '';
  } catch {
    return '';
  }
}
export default function ProviderSignIn({
  memberId,
  member,
  result,
  close,
  cancel,
}: {
  memberId: string;
  member?: Member;
  result: LoginResult;
  close: () => void;
  cancel: () => Promise<void>;
}) {
  const [live, setLive] = useState(member);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const opened = useRef(false);
  const google = result.type === 'geminiGoogle';
  const url = authUrl(result);
  useEffect(() => {
    if (member) setLive(member);
  }, [member]);
  useEffect(() => {
    // Browser callbacks are faster on this computer; device-code users must copy
    // the code first. Neither path requires a manual refresh after approval.
    if (!result.userCode && url && !opened.current) {
      opened.current = true;
      void openExternal(url).catch((cause) => setError(cause.message));
    }
  }, [url, result.userCode]);
  useEffect(() => {
    let active = true,
      inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!active || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        const next = await api<Member>(`/members/${memberId}/login/status`);
        if (active) {
          setLive(next);
          setError('');
        }
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(refresh, 1500);
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [memberId]);
  const connected = live?.signIn?.state === 'connected';
  const failed = live?.signIn?.state === 'error' || live?.signIn?.state === 'cancelled';
  return (
    <div className="login-content">
      <ConnectionProgress
        step={connected ? 3 : live?.signIn?.state === 'verifying' ? 2 : 1}
        labels={['Open sign-in', `Confirm on ${google ? 'Google' : 'OpenAI'}`, 'Verify account']}
        error={
          error ||
          live?.signIn?.error ||
          (failed ? 'Sign-in cancelled. Close and try again.' : undefined)
        }
      />
      {connected ? (
        <>
          <strong>
            {live?.account?.email ||
              (google ? 'Google account connected' : 'ChatGPT account connected')}
          </strong>
          <button className="button primary" onClick={close}>
            Done
          </button>
        </>
      ) : (
        <>
          {!failed && result.userCode && (
            <div className="device-code">
              <span>ONE-TIME CODE</span>
              <code>{result.userCode}</code>
              <button
                className="text-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(result.userCode!)
                    .then(() => setCopied(true))
                    .catch(() => setError('Select and copy the code above.'))
                }
              >
                <Copy size={13} />
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>
          )}
          {!failed &&
            (google ? (
              <p>Complete Google sign-in in the browser. This window updates automatically.</p>
            ) : url ? (
              <button
                className="button primary"
                onClick={() => void openExternal(url).catch((cause) => setError(cause.message))}
              >
                Continue to OpenAI <ExternalLink size={15} />
              </button>
            ) : (
              <p role="alert">No valid sign-in URL. Close and try again.</p>
            ))}
          <button
            className="button"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await cancel();
              } finally {
                setCancelling(false);
              }
            }}
          >
            {failed ? 'Close' : cancelling ? 'Cancelling…' : 'Cancel sign-in'}
          </button>
        </>
      )}
    </div>
  );
}
