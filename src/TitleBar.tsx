import { useEffect, useState } from 'react';
import { Copy, Download, Loader2, Minus, RefreshCw, Square, X } from 'lucide-react';
import type { DesktopUpdateStatus, DesktopWindowState } from './desktop';
import './TitleBar.css';

export default function DesktopTitleBar({
  update,
  downloading,
  onUpdate,
}: {
  update: DesktopUpdateStatus | null;
  downloading: boolean;
  onUpdate: () => void;
}) {
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = document.querySelector('.desktop-frame');
    frame?.classList.toggle('is-fullscreen', state.fullscreen);
    setRevealed(false);
    if (state.fullscreen && document.activeElement?.closest('.desktop-titlebar'))
      (document.activeElement as HTMLElement).blur();
    return () => frame?.classList.remove('is-fullscreen');
  }, [state.fullscreen]);
  useEffect(() => {
    if (!state.fullscreen) return;
    let timer: ReturnType<typeof setTimeout>;
    const reveal = (event: PointerEvent) => {
      if (event.clientY <= 6) {
        clearTimeout(timer);
        setRevealed(true);
      } else if (event.clientY > 40) {
        clearTimeout(timer);
        timer = setTimeout(() => setRevealed(false), 350);
      } else clearTimeout(timer);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'F10') {
        event.preventDefault();
        setRevealed(true);
        document.querySelector<HTMLButtonElement>('.desktop-titlebar button')?.focus();
      }
      if (event.key === 'Escape') {
        setRevealed(false);
        if (document.activeElement?.closest('.desktop-titlebar'))
          (document.activeElement as HTMLElement).blur();
      }
    };
    window.addEventListener('pointermove', reveal);
    window.addEventListener('keydown', keyboard);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', reveal);
      window.removeEventListener('keydown', keyboard);
    };
  }, [state.fullscreen]);
  useEffect(() => {
    const desktop = window.relayDesktop;
    if (!desktop) return;
    void desktop
      .getWindowState()
      .then(setState)
      .catch(() => {});
    const unsubscribe = desktop.onWindowState(setState);
    const fullscreen = (event: KeyboardEvent) => {
      if (event.key === 'F11' && !event.repeat) {
        event.preventDefault();
        void desktop
          .controlWindow('fullscreen')
          .then(setState)
          .catch(() => {});
      }
    };
    // Native before-input-event consumes real F11 first. This also covers
    // renderer-delivered keyboard events (including accessibility/CDP input).
    window.addEventListener('keydown', fullscreen);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', fullscreen);
    };
  }, []);
  const control = (action: 'minimize' | 'maximize' | 'close') => {
    void window.relayDesktop
      ?.controlWindow(action)
      .then(setState)
      .catch(() => {});
  };
  if (!window.relayDesktop) return null;
  const inAppUpdate = window.relayDesktop.platform === 'darwin';
  return (
    <header
      className={`desktop-titlebar${state.fullscreen ? ' fullscreen' : ''}${revealed ? ' revealed' : ''}`}
      aria-label="Điều khiển cửa sổ"
      onFocus={() => setRevealed(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setRevealed(false);
      }}
    >
      <div className="desktop-titlebar-drag" onDoubleClick={() => control('maximize')}>
        <img src="/kivuno.svg" alt="" />
        <span>Kivuno</span>
      </div>
      <div className="desktop-titlebar-actions">
        {update?.hasUpdate && update.downloadAvailable && (
          <button
            className={`desktop-update-button${update.required ? ' required' : ''}`}
            aria-label={`Cập nhật Kivuno phiên bản ${update.latestVersion}`}
            title={`${inAppUpdate ? 'Cập nhật trong ứng dụng' : 'Tải bản cập nhật'} v${update.latestVersion}`}
            disabled={downloading}
            onClick={onUpdate}
          >
            {downloading ? (
              <Loader2 className="spin" size={14} />
            ) : inAppUpdate ? (
              <RefreshCw size={14} />
            ) : (
              <Download size={14} />
            )}
            <span>v{update.latestVersion}</span>
          </button>
        )}
        <div className="desktop-titlebar-controls">
          <button aria-label="Thu nhỏ" onClick={() => control('minimize')}>
            <Minus size={15} />
          </button>
          <button
            aria-label={state.maximized || state.fullscreen ? 'Khôi phục cửa sổ' : 'Phóng to'}
            onClick={() => control('maximize')}
          >
            {state.maximized || state.fullscreen ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="desktop-titlebar-close"
            aria-label="Ẩn xuống khay hệ thống"
            onClick={() => control('close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
