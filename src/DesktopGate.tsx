import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import App from './App';
import { resetApiSession } from './api';
import type { DesktopStatus, DesktopUpdateStatus } from './desktop';
import DesktopTitleBar from './TitleBar';
import './portal.css';
import ConnectionProgress from './ConnectionProgress';

export default function DesktopGate() {
  const [update, setUpdate] = useState<DesktopUpdateStatus | null>(null);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const updateDownloadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let current = true;
    const check = async () => {
      try {
        const next = await window.relayDesktop!.checkForUpdates();
        if (current) setUpdate(next);
      } catch {
        // Update checks are best-effort; keep the last successful result.
      }
    };
    void check();
    const timer = window.setInterval(check, 30 * 60 * 1000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (update?.required) updateDownloadButton.current?.focus();
  }, [update?.required]);
  const downloadUpdate = async () => {
    setDownloadingUpdate(true);
    setUpdateError('');
    try {
      await window.relayDesktop!.downloadUpdate();
    } catch (cause) {
      setUpdateError((cause as Error).message || 'Không thể tải bản cập nhật. Hãy thử lại.');
    } finally {
      setDownloadingUpdate(false);
    }
  };
  return (
    <div className="desktop-frame">
      <DesktopTitleBar
        update={update}
        downloading={downloadingUpdate}
        onDownload={() => void downloadUpdate()}
      />
      <div className="desktop-frame-content">
        <div className="desktop-workspace-layer" inert={Boolean(update?.required)}>
          <DesktopWorkspace />
        </div>
        {update?.required && (
          <div className="desktop-update-backdrop">
            <section
              className="desktop-update-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="desktop-update-title"
              aria-describedby="desktop-update-description"
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault();
                  updateDownloadButton.current?.focus();
                }
              }}
            >
              <span className="desktop-update-icon">
                <Download size={22} />
              </span>
              <h2 id="desktop-update-title">Cần cập nhật Kivuno để tiếp tục</h2>
              <p id="desktop-update-description">
                Đã có {update.newerReleaseCount} phiên bản mới hơn. Hãy tải và cài đặt phiên bản mới
                nhất, sau đó mở lại Kivuno.
              </p>
              <span className="desktop-update-version">v{update.latestVersion}</span>
              <button
                ref={updateDownloadButton}
                className="desktop-update-download"
                disabled={downloadingUpdate}
                onClick={() => void downloadUpdate()}
              >
                {downloadingUpdate ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <Download size={17} />
                )}
                {downloadingUpdate ? 'Đang mở bộ cài…' : 'Tải và cập nhật'}
              </button>
              {updateError && (
                <p className="desktop-update-error" role="alert">
                  {updateError}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
      {updateError && !update?.required && (
        <div className="desktop-update-error-toast" role="alert">
          {updateError}
        </div>
      )}
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
