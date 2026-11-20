import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { usePortalLocale } from './PortalLocale';
import './password-recovery.css';

export default function PasswordRecovery({
  reset = false,
  initialEmail = '',
  onBack,
}: {
  reset?: boolean;
  initialEmail?: string;
  onBack?: () => void;
}) {
  const { locale } = usePortalLocale();
  const en = locale === 'en';
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState(() =>
    reset ? new URLSearchParams(window.location.hash.slice(1)).get('token') || '' : '',
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    if (reset) {
      const url = new URL(window.location.href);
      // Fragments never reach HTTP/access logs. Clear before links, analytics or navigation.
      if (url.hash || url.search)
        window.history.replaceState(window.history.state, '', url.pathname);
    }
    const nextLink = () => {
      if (!reset) return;
      const url = new URL(window.location.href);
      const nextToken = new URLSearchParams(url.hash.slice(1)).get('token');
      if (!nextToken) return;
      controller.current?.abort();
      setToken(nextToken);
      setPassword('');
      setConfirm('');
      setBusy(false);
      setDone(false);
      setError('');
      window.history.replaceState(window.history.state, '', url.pathname);
    };
    window.addEventListener('hashchange', nextLink);
    return () => {
      window.removeEventListener('hashchange', nextLink);
      meta.remove();
      controller.current?.abort();
    };
  }, [reset]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (reset && password !== confirm) {
      setError(en ? 'Passwords do not match.' : 'Hai mật khẩu chưa khớp.');
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch(
        `/api/auth/${reset ? 'reset-password' : 'request-password-reset'}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify(
            reset ? { token, newPassword: password } : { email: email.trim().toLowerCase() },
          ),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (abort.signal.aborted) return;
      if (!response.ok) {
        if (result.code === 'RECOVERY_UNAVAILABLE')
          throw new Error(
            en
              ? 'Recovery email is not available yet. Please try again after the sender is configured.'
              : 'Email khôi phục chưa được kích hoạt. Vui lòng thử lại khi địa chỉ gửi đã được cấu hình.',
          );
        if (response.status === 429)
          throw new Error(
            en
              ? 'Too many requests. Please try again in 15 minutes.'
              : 'Bạn đã thử nhiều lần. Vui lòng thử lại sau 15 phút.',
          );
        if (reset && response.status === 400)
          throw new Error(
            en
              ? 'This link is invalid, expired or already used. Request a new link.'
              : 'Liên kết không hợp lệ, đã hết hạn hoặc đã dùng. Hãy yêu cầu liên kết mới.',
          );
        throw new Error(
          en
            ? 'The request could not be completed. Please try again.'
            : 'Chưa hoàn tất yêu cầu. Vui lòng thử lại.',
        );
      }
      setPassword('');
      setConfirm('');
      setToken('');
      setDone(true);
    } catch (cause) {
      if (!abort.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="password-recovery">
      <h2>
        {done
          ? reset
            ? en
              ? 'Password updated.'
              : 'Đã đổi mật khẩu.'
            : en
              ? 'Request received.'
              : 'Đã nhận yêu cầu.'
          : reset
            ? en
              ? 'New password.'
              : 'Mật khẩu mới.'
            : en
              ? 'Forgot password?'
              : 'Quên mật khẩu?'}
      </h2>
      {done ? (
        <div className="recovery-success" role="status">
          <Check size={28} />
          <p>
            {reset
              ? en
                ? 'Sign in again with your new password.'
                : 'Đăng nhập lại bằng mật khẩu mới.'
              : en
                ? 'If the account exists, check your inbox for a recovery link.'
                : 'Nếu tài khoản tồn tại, hãy kiểm tra hộp thư để nhận liên kết khôi phục.'}
          </p>
          <a className="recovery-primary" href="/?login">
            {en ? 'Sign in' : 'Đăng nhập'}
            <ArrowUpRight size={18} />
          </a>
        </div>
      ) : reset && !token ? (
        <div role="alert">
          <p>
            {en
              ? 'Open a recovery link from your email.'
              : 'Hãy mở liên kết khôi phục trong email.'}
          </p>
          <a href="/forgot-password">{en ? 'Request a new link' : 'Yêu cầu liên kết mới'}</a>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {reset ? (
            <>
              <label>
                {en ? 'New password' : 'Mật khẩu mới'}
                <input
                  name="new-password"
                  autoFocus
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={en ? 'At least 12 characters' : 'Tối thiểu 12 ký tự'}
                />
              </label>
              <label>
                {en ? 'Confirm password' : 'Nhập lại mật khẩu'}
                <input
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label>
              Email
              <input
                name="email"
                autoFocus
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="recovery-error" role="alert">
              {error}
            </p>
          )}
          <button className="recovery-primary" disabled={busy} type="submit">
            {busy ? <Loader2 className="spin" size={18} /> : <ArrowUpRight size={18} />}
            {reset
              ? en
                ? 'Save password'
                : 'Lưu mật khẩu'
              : en
                ? 'Send recovery link'
                : 'Gửi liên kết khôi phục'}
          </button>
        </form>
      )}
      {onBack ? (
        <button className="recovery-back" type="button" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} />
          {en ? 'Back to sign in' : 'Quay lại đăng nhập'}
        </button>
      ) : (
        <a className="recovery-back" href="/?login">
          <ArrowLeft size={16} />
          {en ? 'Back to sign in' : 'Quay lại đăng nhập'}
        </a>
      )}
    </div>
  );
}
