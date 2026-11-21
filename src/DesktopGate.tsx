import { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Moon, RefreshCw, ShieldCheck, Sun } from 'lucide-react';
import App from './App';
import { resetApiSession } from './api';
import type { DesktopStatus, DesktopUpdateProgress, DesktopUpdateStatus } from './desktop';
import DesktopTitleBar from './TitleBar';
import './portal.css';
import ConnectionProgress from './ConnectionProgress';
import { useWorkspaceTheme } from './WorkspaceTheme';

export default function DesktopGate() {
  const [update, setUpdate] = useState<DesktopUpdateStatus | null>(null);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState('');

  useEffect(() => {
    const desktop = window.relayDesktop!;
    let current = true;
    const check = async () => {
      try {
        const next = await desktop.checkForUpdates();
        if (current) setUpdate(next);
      } catch {
        // Update checks are best-effort. Keep the last successful result.
      }
    };
    const unsubscribe = desktop.onUpdateProgress(setProgress);
    void check();
    const timer = window.setInterval(check, 30 * 60 * 1000);
    return () => {
      current = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const installUpdate = async () => {
    if (!update?.downloadAvailable || progress) return;
    const desktop = window.relayDesktop!;
    setProgress({ phase: 'downloading', percent: 0 });
    setUpdateError('');
    setUpdate({ ...update, lastInstallFailed: false });
    try {
      await desktop.installUpdate(update.latestVersion);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '';
      setUpdateError(message || 'Không thể cập nhật Kivuno. Hãy thử lại.');
      setProgress(null);
      void desktop
        .checkForUpdates()
        .then(setUpdate)
        .catch(() => {});
    }
  };
  const error =
    updateError ||
    (update?.lastInstallFailed ? 'Bản cập nhật trước chưa được cài. Hãy thử lại.' : '');

  return (
    <div className="desktop-frame">
      <DesktopTitleBar update={update} progress={progress} onUpdate={() => void installUpdate()} />
      <div className="desktop-frame-content">
        <DesktopWorkspace />
      </div>
      {error && !progress && (
        <div className="desktop-update-error-toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function DesktopWorkspace() {
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    let revision = 0;
    const unsubscribe = window.relayDesktop!.onStatus((next) => {
      revision++;
      if (current) {
        setStatus(next);
        setError('');
        if (!next.signedIn) {
          resetApiSession();
          sessionStorage.clear();
        }
      }
    });
    const refresh = async () => {
      const requestedAt = revision;
      clearTimeout(timer);
      let delay = 5000;
      try {
        const next = await window.relayDesktop!.getStatus();
        delay = next.signedIn ? 10000 : 2000;
        if (current && requestedAt === revision)
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
        setStatus((previous) =>
          previous ? { ...previous, signedIn: false, pending: undefined } : null,
        );
        resetApiSession();
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
      unsubscribe();
      window.removeEventListener('relay-sign-out', logout);
    };
  }, []);

  if (status?.signedIn && status.runtime === 'ready') return <App key={status.owner?.id} />;

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
      <button
        type="button"
        className="icon-button desktop-welcome-theme"
        aria-label={theme === 'dark' ? 'Dùng giao diện sáng' : 'Dùng giao diện tối'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div className="desktop-welcome-body">
        <h1>Kivuno</h1>
        {status?.signedIn ? (
          <p className="portal-status" role="status">
            <Loader2 className="spin" size={18} />
            Đang mở workspace…
          </p>
        ) : pending ? (
          <div className="desktop-activation">
            <ConnectionProgress
              step={1}
              labels={['Mở trang đăng nhập', 'Xác nhận tài khoản Kivuno', 'Mở workspace riêng']}
            />
            <ShieldCheck size={24} />
            <span>Mã xác nhận</span>
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
            <button
              className="text-button"
              onClick={() =>
                void window
                  .relayDesktop!.cancelSignIn()
                  .then(setStatus)
                  .catch((cause) => setError(cause.message))
              }
            >
              Hủy đăng nhập
            </button>
          </div>
        ) : (
          <button
            className="button primary desktop-signin"
            disabled={busy || !status || status.runtime === 'starting'}
            onClick={() => void signIn()}
          >
            {busy || !status ? <Loader2 className="spin" size={18} /> : <ArrowUpRight size={18} />}
            Đăng nhập Kivuno
          </button>
        )}
        {(error || status?.error) && (
          <p className="error-text" role="alert">
            {error || status?.error}
          </p>
        )}
        {status?.runtime === 'stopped' && (
          <p className="error-text" role="alert">
            <RefreshCw size={14} /> Runtime đã dừng. Đóng Kivuno rồi mở lại để khôi phục.
          </p>
        )}
      </div>
    </main>
  );
}
