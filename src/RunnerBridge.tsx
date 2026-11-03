import { useEffect, useRef, useState } from 'react';
import { Check, ShieldCheck, Unplug, X } from 'lucide-react';
import { bridgeRequest, hostedOrigin } from '../shared/browser-bridge';
import { api } from './api';
import './hosted.css';

type Invitation = { source: Window; origin: string; nonce: string };

/** Runs on loopback only. Consent and all HTTP requests stay on this origin. */
export default function RunnerBridge() {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cleanup = useRef<(() => void) | null>(null);
  const approved = useRef(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        approved.current ||
        event.origin !== hostedOrigin ||
        !window.opener ||
        event.source !== window.opener ||
        event.data?.type !== 'relay:connect' ||
        typeof event.data.nonce !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(event.data.nonce)
      )
        return;
      setInvitation({
        source: event.source as Window,
        origin: event.origin,
        nonce: event.data.nonce,
      });
      (event.source as Window).postMessage(
        { type: 'relay:ready', nonce: event.data.nonce },
        event.origin,
      );
    };
    window.addEventListener('message', listener);
    const stop = () => cleanup.current?.();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('message', listener);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, []);

  function disconnect() {
    cleanup.current?.();
    cleanup.current = null;
    approved.current = false;
    setActive(false);
    setInvitation(null);
  }

  async function approve() {
    if (!invitation || busy || approved.current) return;
    setBusy(true);
    setError('');
    try {
      await api('/state');
      if (invitation.source.closed)
        throw new Error('Tab workspace đã đóng. Kết nối lại từ trang web.');
      approved.current = true;
      const channel = new MessageChannel();
      const port = channel.port1;
      let open = true;
      let lastPong = Date.now();
      let inFlight = 0;
      const events = new EventSource('/api/events', { withCredentials: true });
      events.addEventListener('change', () => {
        if (open) port.postMessage({ type: 'change' });
      });
      const timer = window.setInterval(() => {
        if (invitation.source.closed || Date.now() - lastPong > 45000) disconnect();
        else port.postMessage({ type: 'ping' });
      }, 2000);
      cleanup.current = () => {
        if (!open) return;
        open = false;
        port.postMessage({ type: 'disconnect' });
        port.close();
        events.close();
        clearInterval(timer);
      };
      port.onmessage = async ({ data }) => {
        if (!open) return;
        if (data?.type === 'disconnect') {
          disconnect();
          return;
        }
        if (data?.type === 'pong') {
          lastPong = Date.now();
          return;
        }
        const parsed = bridgeRequest.safeParse(data);
        if (!parsed.success) return;
        const request = parsed.data;
        if (JSON.stringify(request).length > 128 * 1024 || inFlight >= 64) {
          port.postMessage({
            type: 'response',
            id: request.id,
            error: 'Yêu cầu vượt giới hạn của runner.',
          });
          return;
        }
        inFlight++;
        try {
          const result = await api(request.path, request.body, request.method);
          if (open) port.postMessage({ type: 'response', id: request.id, data: result });
        } catch (error) {
          if (open)
            port.postMessage({ type: 'response', id: request.id, error: (error as Error).message });
        } finally {
          inFlight--;
        }
      };
      invitation.source.postMessage(
        { type: 'relay:connected', nonce: invitation.nonce },
        invitation.origin,
        [channel.port2],
      );
      setActive(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="runner-approval">
      <img src="/relay.svg" alt="RELAY" width="36" height="36" />
      <h1>{active ? 'Runner đã kết nối' : 'Cho phép kết nối workspace?'}</h1>
      <div className="panel runner-consent">
        <ShieldCheck size={26} />
        <strong>{invitation?.origin || hostedOrigin}</strong>
        <p>
          {active
            ? 'Giữ cửa sổ này mở và quay lại tab web để dùng MESH, Sessions và Team.'
            : 'Trang web sẽ có quyền đọc workspace, gửi prompt Codex, sửa file và thao tác Git qua runner này. Tài khoản đăng nhập vẫn được lưu trên máy.'}
        </p>
        <p>
          Quyền chỉ tồn tại khi kết nối còn mở. Ngắt kết nối không dừng các task Codex đang chạy.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="runner-buttons">
          {active ? (
            <button className="button" onClick={disconnect}>
              <Unplug size={16} /> Ngắt kết nối
            </button>
          ) : invitation ? (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  invitation.source.postMessage(
                    { type: 'relay:rejected', nonce: invitation.nonce },
                    invitation.origin,
                  );
                  disconnect();
                  window.close();
                }}
              >
                <X size={16} /> Từ chối
              </button>
              <button className="button primary" disabled={busy} onClick={() => void approve()}>
                <Check size={16} /> {busy ? 'Đang kiểm tra…' : 'Cho phép kết nối'}
              </button>
            </>
          ) : (
            <p role="status">
              Mở trang web chính thức, bấm Kết nối runner rồi xác nhận trong cửa sổ được mở từ trang
              đó.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
