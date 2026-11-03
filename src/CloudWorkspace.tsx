import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, LogIn, RefreshCw } from 'lucide-react';
import App from './App';
import { resetApiSession } from './api';
import './hosted.css';

export default function CloudWorkspace() {
  const [status, setStatus] = useState<'loading' | 'login' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function check() {
    setError('');
    setStatus('loading');
    try {
      const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
      if (!response.ok)
        throw new Error('Cloud workspace chưa sẵn sàng hoặc đã hết hạn mức miễn phí.');
      const data = await response.json();
      setStatus(data?.user ? 'ready' : 'login');
    } catch (error) {
      setError((error as Error).message);
      setStatus('login');
    }
  }
  useEffect(() => {
    void check();
    const expired = () => {
      resetApiSession();
      setStatus('login');
      setError('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.');
    };
    const logout = async () => {
      try {
        const response = await fetch('/api/auth/sign-out', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) throw new Error('Chưa đăng xuất được. Thử lại khi cloud sẵn sàng.');
        resetApiSession();
        setStatus('login');
        setError('');
      } catch (error) {
        setError((error as Error).message);
      }
    };
    window.addEventListener('relay-auth-expired', expired);
    window.addEventListener('relay-sign-out', logout);
    return () => {
      window.removeEventListener('relay-auth-expired', expired);
      window.removeEventListener('relay-sign-out', logout);
    };
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    try {
      const password = String(new FormData(form).get('password') || '');
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@relay.invalid', password }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Mật khẩu không đúng.'
            : 'Chưa đăng nhập được. Cloud có thể đang khởi động hoặc đã hết hạn mức miễn phí.',
        );
      form.reset();
      resetApiSession();
      setStatus('ready');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (status === 'ready')
    return (
      <>
        <App cloud />
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </>
    );
  return (
    <main className="runner-approval cloud-login">
      <img src="/kivuno.svg" width="36" height="36" alt="Kivuno" />
      <h1>NoSleepClub Kivuno</h1>
      {status === 'loading' ? (
        <div className="panel runner-consent" role="status">
          <Loader2 className="spin" size={24} />
          <p>Đang mở cloud workspace… Lần mở sau khi tạm ngủ có thể mất một lúc.</p>
        </div>
      ) : (
        <form className="panel runner-consent" onSubmit={login}>
          <h2>Đăng nhập workspace</h2>
          <label className="form">
            Mật khẩu chủ workspace
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="runner-buttons">
            <button className="button" type="button" disabled={busy} onClick={() => void check()}>
              <RefreshCw size={15} /> Thử lại
            </button>
            <button className="button primary" disabled={busy}>
              <LogIn size={16} /> {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </div>
          <p>Codex chạy trên cloud. Không cần localhost hoặc giữ popup.</p>
        </form>
      )}
    </main>
  );
}
