import { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import App from './App';
import { resetApiSession } from './api';
import type { DesktopStatus } from './desktop';
import DesktopTitleBar from './TitleBar';
import './portal.css';

export default function DesktopGate() {
  return (
    <div className="desktop-frame">
      <DesktopTitleBar />
      <div className="desktop-frame-content">
        <DesktopWorkspace />
      </div>
    </div>
  );
}

function DesktopWorkspace() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      clearTimeout(timer);
      let delay = 5000;
      try {
        const next = await window.relayDesktop!.getStatus();
        delay = next.signedIn ? 10000 : 2000;
        if (current)
          setStatus((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
      } catch (cause) {
        if (current) setError((cause as Error).message);
      } finally {
        if (current) timer = setTimeout(refresh, delay);
      }
    };
    void refresh();
    const logout = async () => {
      try {
        await window.relayDesktop!.signOut();
        resetApiSession();
        await refresh();
      } catch (cause) {
        setError((cause as Error).message);
      }
    };
    window.addEventListener('relay-sign-out', logout);
    return () => {
      current = false;
      clearTimeout(timer);
      window.removeEventListener('relay-sign-out', logout);
    };
  }, []);

  if (status?.signedIn && status.runtime === 'ready') return <App />;

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.relayDesktop!.beginSignIn());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pending = status?.pending && Date.parse(status.pending.expiresAt) > Date.now();
  return (
    <main className="desktop-welcome">
      <div className="portal-brand">
        <img src="/kivuno.svg" alt="Kivuno" />
      </div>
      <div className="desktop-welcome-body">
        <h1>Kivuno</h1>
        {status?.signedIn ? (
          <p className="portal-status" role="status">
            <Loader2 className="spin" size={18} />
            Đang mở workspace…
          </p>
        ) : pending ? (
          <div className="desktop-activation">
            <ShieldCheck size={24} />
            <p>Xác nhận mã này trên web</p>
            <strong className="activation-code">{status.pending!.userCode}</strong>
            <button
              className="button"
              onClick={() =>
                void window
                  .relayDesktop!.openExternal(status.pending!.verificationUri)
                  .catch((cause) => setError(cause.message))
              }
            >
              Mở trang đăng nhập <ArrowUpRight size={15} />
            </button>
            <span className="portal-muted" role="status">
              App sẽ tự nhận kết nối sau khi bạn xác nhận.
            </span>
          </div>
        ) : (
          <button
            className="button primary desktop-signin"
            disabled={busy || !status}
            onClick={() => void signIn()}
          >
            {busy || !status ? <Loader2 className="spin" size={18} /> : <ArrowUpRight size={18} />}
            Đăng nhập trên web
          </button>
        )}
        {(error || status?.error) && (
          <p className="error-text" role="alert">
            {error || status?.error}
          </p>
        )}
        {status?.runtime === 'stopped' && (
          <p className="portal-muted">
            <RefreshCw size={14} /> Runtime đã dừng. Đóng Kivuno rồi mở lại để khôi phục.
          </p>
        )}
      </div>
      <footer>
        Kivuno {window.relayDesktop?.version} ·{' '}
        {window.relayDesktop?.platform === 'linux' ? 'Linux' : 'Windows'}
      </footer>
    </main>
  );
}
