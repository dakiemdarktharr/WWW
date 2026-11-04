import { useEffect, useState } from 'react';
import { Maximize, Minimize, Minus, Square, X } from 'lucide-react';
import type { DesktopWindowState } from './desktop';
import './TitleBar.css';

export default function DesktopTitleBar() {
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  useEffect(() => {
    const desktop = window.relayDesktop;
    if (!desktop) return;
    void desktop
      .getWindowState()
      .then(setState)
      .catch(() => {});
    return desktop.onWindowState(setState);
  }, []);
  const control = (action: 'minimize' | 'maximize' | 'fullscreen' | 'close') => {
    void window.relayDesktop
      ?.controlWindow(action)
      .then(setState)
      .catch(() => {});
  };
  if (!window.relayDesktop) return null;
  return (
    <header className="desktop-titlebar" aria-label="Điều khiển cửa sổ">
      <div className="desktop-titlebar-drag" onDoubleClick={() => control('maximize')}>
        <img src="/kivuno.svg" alt="" />
        <span>Kivuno</span>
      </div>
      <div className="desktop-titlebar-controls">
        <button
          aria-label={state.fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          onClick={() => control('fullscreen')}
        >
          {state.fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
        <button aria-label="Thu nhỏ" onClick={() => control('minimize')}>
          <Minus size={15} />
        </button>
        <button
          aria-label={state.maximized || state.fullscreen ? 'Khôi phục cửa sổ' : 'Phóng to'}
          onClick={() => control('maximize')}
        >
          <Square size={12} />
        </button>
        <button
          className="desktop-titlebar-close"
          aria-label="Ẩn xuống khay hệ thống"
          onClick={() => control('close')}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
