import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  X,
} from 'lucide-react';
import { api, resetApiSession } from './api';
import './portal-auth.css';

interface PortalAuthProps {
  mode: 'login' | 'signup';
  activationCode: string;
  onClose: () => void;
}
interface AuthUser {
  id: string;
  name: string;
  email: string;
}
interface DesktopRequest {
  name: string;
  expiresAt: string;
  code: string;
}
const ownerEmail = 'owner@relay.invalid';
const codePattern = /^[A-F0-9]{5}-[A-F0-9]{5}$/;
const formatCode = (value: string) => {
  const raw = value
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .slice(0, 10);
  return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
};
const isUser = (value: unknown): value is AuthUser =>
  !!value &&
  typeof value === 'object' &&
  ['id', 'name', 'email'].every(
    (key) => typeof (value as Record<string, unknown>)[key] === 'string',
  );

export default function PortalAuth({ mode, activationCode, onClose }: PortalAuthProps) {
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  const [flow, setFlow] = useState(mode);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [details, setDetails] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(formatCode(activationCode));
  const [device, setDevice] = useState<DesktopRequest | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const panel = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const spring = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 300, damping: 29 };

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = [...document.body.children]
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay.current,
      )
      .map((element) => ({
        element,
        inert: element.inert,
        hidden: element.getAttribute('aria-hidden'),
      }));
    for (const { element } of siblings) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
        ) || []),
      ].filter((element) => element.getClientRects().length > 0);
    panel.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const trap = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target))
        (focusable()[0] || panel.current)?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keyboard);
    document.addEventListener('focusin', trap);
    fetch('/api/auth/get-session', { credentials: 'same-origin', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Authentication unavailable');
        const result = await response.json();
        if (alive.current && !abort.signal.aborted)
          setUser(isUser(result?.user) ? result.user : null);
      })
      .catch(() => {
        if (alive.current && !abort.signal.aborted)
          setError('Dịch vụ đăng nhập chưa sẵn sàng. Hãy thử lại.');
      })
      .finally(() => {
        if (alive.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      alive.current = false;
      abort.abort();
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('focusin', trap);
      document.body.style.overflow = overflow;
      for (const { element, inert, hidden } of siblings) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setFlow(mode);
    setLegacy(false);
    setDetails(false);
    setPassword('');
    setError('');
  }, [mode]);

  useEffect(() => {
    if (!user || !codePattern.test(code) || approved) return;
    let current = true;
    setDevice(null);
    setLookingUp(true);
    setError('');
    const timer = setTimeout(() => {
      api<Omit<DesktopRequest, 'code'>>(`/desktop/request?code=${encodeURIComponent(code)}`)
        .then((request) => {
          if (alive.current && current) setDevice({ ...request, code });
        })
        .catch((cause) => {
          if (alive.current && current) setError((cause as Error).message);
        })
        .finally(() => {
          if (alive.current && current) setLookingUp(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [user, code, approved]);

  useEffect(() => {
    if (!device) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [device]);

  function switchFlow(next: 'login' | 'signup') {
    setFlow(next);
    setDetails(false);
    setPassword('');
    setError('');
    if (legacy) setEmail('');
    setLegacy(false);
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!details) {
      setDetails(true);
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const signup = flow === 'signup' && !legacy;
      const response = await fetch(`/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.current?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: legacy ? ownerEmail : email.trim().toLowerCase(),
          password,
          ...(signup ? { name: name.trim() } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429)
          throw new Error('Bạn đã thử nhiều lần. Vui lòng đợi một phút.');
        if (response.status === 401) throw new Error('Email hoặc mật khẩu không đúng.');
        if (signup && /already|exist/i.test(`${result.code || ''} ${result.message || ''}`))
          throw new Error('Email này đã có tài khoản. Chọn Đăng nhập để tiếp tục.');
        throw new Error(
          signup
            ? 'Chưa tạo được tài khoản. Kiểm tra thông tin và thử lại.'
            : 'Chưa đăng nhập được. Hãy thử lại.',
        );
      }
      if (!isUser(result.user))
        throw new Error('Chưa xác nhận được phiên đăng nhập. Hãy đăng nhập lại.');
      resetApiSession();
      if (alive.current) {
        setPassword('');
        setUser(result.user);
        setError('');
      }
    } catch (cause) {
      if (alive.current && !controller.current?.signal.aborted) setError((cause as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !device || device.code !== code || Date.parse(device.expiresAt) <= Date.now())
      return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ approved: boolean }>('/desktop/approve', { userCode: code });
      if (!result.approved) throw new Error('Chưa xác nhận được thiết bị. Hãy thử lại.');
      if (alive.current) setApproved(true);
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.current?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Chưa đăng xuất được. Hãy thử lại.');
      resetApiSession();
      if (alive.current) {
        setUser(null);
        setDevice(null);
        setApproved(false);
        setPassword('');
        setDetails(false);
        setLegacy(false);
        setFlow('login');
        if (email === ownerEmail) setEmail('');
      }
    } catch (cause) {
      if (alive.current && !controller.current?.signal.aborted) setError((cause as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const expired =
    !!device &&
    (!Number.isFinite(Date.parse(device.expiresAt)) || Date.parse(device.expiresAt) <= now);
  const title = loading
    ? 'Kivuno'
    : user
      ? approved
        ? 'Đã kết nối'
        : 'Kết nối desktop'
      : legacy
        ? 'Chủ workspace cũ'
        : flow === 'signup'
          ? 'Tạo tài khoản'
          : 'Đăng nhập';
  const phase = loading ? 'loading' : user ? (approved ? 'approved' : 'activation') : 'credentials';

  return createPortal(
    <MotionConfig reducedMotion="user">
      <motion.div
        className="ka-overlay"
        ref={overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.2 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.section
          className={`ka-panel ${user ? 'ka-connected' : ''}`}
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          layout
          initial={{ opacity: 0, y: reducedMotion ? 0 : 22, scale: reducedMotion ? 1 : 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={spring}
        >
          {user && (
            <motion.div
              className="ka-card-under"
              aria-hidden="true"
              initial={{ rotate: 0, y: 0 }}
              animate={{ rotate: reducedMotion ? 0 : -3, y: -10 }}
              transition={spring}
            />
          )}
          <div className="ka-surface">
            <header className="ka-header">
              <img src="/kivuno.svg" alt="" width="34" height="34" />
              <motion.button
                className="ka-icon"
                type="button"
                onClick={onClose}
                aria-label="Đóng đăng nhập"
                whileHover={reducedMotion ? undefined : { scale: 1.08 }}
                whileTap={reducedMotion ? undefined : { scale: 0.92 }}
              >
                <X size={19} />
              </motion.button>
            </header>
            <motion.h2 id={titleId} layout>
              {title}
            </motion.h2>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={phase}
                className="ka-content"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -10 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
              >
                {loading ? (
                  <div className="ka-loading" role="status">
                    <Loader2 className="spin" size={22} />
                    Đang kết nối
                  </div>
                ) : user ? (
                  approved ? (
                    <div className="ka-success">
                      <span className="ka-success-icon">
                        <CheckCheck size={32} />
                      </span>
                      <p>Quay lại Kivuno để bắt đầu làm việc.</p>
                      <motion.button
                        className="ka-primary"
                        onClick={onClose}
                        whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                      >
                        Xong
                      </motion.button>
                    </div>
                  ) : (
                    <form className="ka-form" onSubmit={(event) => void approve(event)}>
                      <div className="ka-account">
                        <span className="ka-account-avatar">
                          {user.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>{user.email === ownerEmail ? 'Chủ workspace cũ' : user.name}</span>
                      </div>
                      <label className="ka-field">
                        Mã từ app desktop
                        <input
                          className="ka-code"
                          value={code}
                          maxLength={11}
                          autoComplete="off"
                          spellCheck={false}
                          autoCapitalize="characters"
                          placeholder="XXXXX-XXXXX"
                          required
                          disabled={busy}
                          pattern="[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}"
                          autoFocus
                          onChange={(event) => {
                            setCode(formatCode(event.target.value));
                            setDevice(null);
                            setLookingUp(false);
                            setError('');
                          }}
                        />
                      </label>
                      {lookingUp && (
                        <p className="ka-note" role="status">
                          <Loader2 className="spin" size={15} />
                          Đang tìm thiết bị
                        </p>
                      )}
                      {device ? (
                        <div className="ka-device">
                          <Monitor size={19} />
                          <strong>{device.name}</strong>
                        </div>
                      ) : (
                        !lookingUp && (
                          <p className="ka-note">Nhập mã đang hiển thị trong app Kivuno.</p>
                        )
                      )}
                      {device && (
                        <p className="ka-note">
                          Chỉ xác nhận khi mã khớp với app trên máy của bạn.
                        </p>
                      )}
                      {expired && (
                        <p className="ka-error" role="alert">
                          Mã đã hết hạn. Tạo mã mới trong app.
                        </p>
                      )}
                      <motion.button
                        className="ka-primary"
                        type="submit"
                        disabled={busy || lookingUp || !device || device.code !== code || expired}
                        whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                        whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                      >
                        {busy ? <Loader2 className="spin" size={17} /> : <CheckCheck size={18} />}
                        Xác nhận kết nối
                      </motion.button>
                    </form>
                  )
                ) : (
                  <form className="ka-form" onSubmit={(event) => void authenticate(event)}>
                    {legacy ? (
                      <div className="ka-legacy">
                        <KeyRound size={18} />
                        Tài khoản workspace hiện tại
                      </div>
                    ) : (
                      <>
                        {flow === 'signup' && (
                          <label className="ka-field">
                            Tên của bạn
                            <input
                              name="name"
                              autoComplete="name"
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              minLength={2}
                              maxLength={80}
                              required
                              disabled={busy}
                              autoFocus
                            />
                          </label>
                        )}
                        <label className="ka-field">
                          Email
                          <input
                            name="email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            maxLength={254}
                            required
                            disabled={busy}
                            autoFocus={flow === 'login'}
                          />
                        </label>
                      </>
                    )}
                    <AnimatePresence initial={false}>
                      {details && (
                        <motion.div
                          className="ka-password-wrap"
                          key="password"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={spring}
                        >
                          <label className="ka-field">
                            {legacy ? 'Mật khẩu chủ workspace' : 'Mật khẩu'}
                            <input
                              name="password"
                              type="password"
                              autoComplete={flow === 'signup' ? 'new-password' : 'current-password'}
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              minLength={flow === 'signup' ? 12 : undefined}
                              maxLength={128}
                              required
                              disabled={busy}
                              autoFocus
                            />
                          </label>
                          {flow === 'signup' && <p className="ka-note">Tối thiểu 12 ký tự.</p>}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <motion.button
                      className="ka-primary"
                      type="submit"
                      disabled={busy}
                      whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                      whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                    >
                      {busy ? <Loader2 className="spin" size={17} /> : null}
                      {!details ? 'Tiếp tục' : flow === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập'}
                      {!busy && <ArrowRight size={17} />}
                    </motion.button>
                    {details && (
                      <button
                        className="ka-text ka-back"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDetails(false);
                          setPassword('');
                          setError('');
                          if (legacy) {
                            setLegacy(false);
                            setEmail('');
                          }
                        }}
                      >
                        <ArrowLeft size={14} />
                        Đổi email
                      </button>
                    )}
                  </form>
                )}
              </motion.div>
            </AnimatePresence>
            {error && (
              <p className="ka-error" role="alert">
                {error}
              </p>
            )}
            {!loading && (
              <footer className="ka-footer">
                {user ? (
                  <button
                    className="ka-text"
                    disabled={busy}
                    type="button"
                    onClick={() => void signOut()}
                  >
                    <LogOut size={15} />
                    Đăng xuất
                  </button>
                ) : (
                  <>
                    <button
                      className="ka-text"
                      disabled={busy}
                      type="button"
                      onClick={() => switchFlow(flow === 'login' ? 'signup' : 'login')}
                    >
                      {flow === 'login' ? 'Tạo tài khoản' : 'Đã có tài khoản? Đăng nhập'}
                    </button>
                    {!legacy && (
                      <button
                        className="ka-text ka-owner"
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          setLegacy(true);
                          setFlow('login');
                          setDetails(true);
                          setEmail(ownerEmail);
                          setPassword('');
                          setError('');
                        }}
                      >
                        Chủ workspace cũ
                      </button>
                    )}
                  </>
                )}
              </footer>
            )}
          </div>
        </motion.section>
      </motion.div>
    </MotionConfig>,
    document.body,
  );
}
