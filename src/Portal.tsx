import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Cpu,
  GitBranch,
  Loader2,
  LogOut,
  MessageSquare,
  Monitor,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, resetApiSession } from './api';
import './portal.css';

interface Release {
  version: string;
  available: boolean;
  url?: string;
  sha256?: string;
  size?: number;
  platform: 'win32-x64';
  signed: boolean;
}
interface DeviceRequest {
  name: string;
  expiresAt: string;
}
const activationCode = new URLSearchParams(location.search).get('activate') || '';
const formatCode = (value: string) => {
  const raw = value
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .slice(0, 10);
  return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
};

export default function Portal() {
  const [release, setRelease] = useState<Release | null>(null);
  const [releaseError, setReleaseError] = useState('');
  const [loginOpen, setLoginOpen] = useState(
    !!activationCode || new URLSearchParams(location.search).has('login'),
  );
  const [auth, setAuth] = useState<'unchecked' | 'loading' | 'signedOut' | 'signedIn'>('unchecked');
  const [userCode, setUserCode] = useState(formatCode(activationCode));
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!loginOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button,input')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
      if (event.key !== 'Tab') return;
      const elements = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href]',
        ) || []),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, [loginOpen]);

  useEffect(() => {
    document.title = 'RELAY · Đội Codex trên máy của bạn';
    let current = true;
    fetch('/api/desktop/release', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Chưa đọc được bản tải xuống.');
        const result = (await response.json()) as Release;
        if (result.url) {
          const url = new URL(result.url, location.origin);
          if (
            !['https:', 'http:'].includes(url.protocol) ||
            (url.protocol === 'http:' && url.origin !== location.origin)
          )
            throw new Error('Địa chỉ tải xuống không hợp lệ.');
        }
        if (current) setRelease(result);
      })
      .catch((cause) => {
        if (current) setReleaseError(cause.message);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!loginOpen) return;
    let current = true;
    setAuth('loading');
    fetch('/api/auth/get-session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Dịch vụ đăng nhập đang khởi động hoặc tạm hết hạn mức. Thử lại sau.');
        const value = await response.json();
        if (current) setAuth(value?.user ? 'signedIn' : 'signedOut');
      })
      .catch((cause) => {
        if (current) {
          setAuth('signedOut');
          setError(cause.message);
        }
      });
    return () => {
      current = false;
    };
  }, [loginOpen]);

  // Lookup is informational only. Connecting a desktop always needs an explicit click.
  useEffect(() => {
    if (auth !== 'signedIn' || !/^[A-F0-9]{5}-[A-F0-9]{5}$/.test(userCode) || approved) return;
    let current = true;
    setRequest(null);
    const timer = setTimeout(() => {
      api<DeviceRequest>(`/desktop/request?code=${encodeURIComponent(userCode)}`)
        .then((value) => {
          if (current) {
            setRequest(value);
            setError('');
          }
        })
        .catch((cause) => {
          if (current) setError(cause.message);
        });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [auth, userCode, approved]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@relay.invalid',
          password: String(new FormData(form).get('password') || ''),
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Mật khẩu không đúng.'
            : 'Chưa đăng nhập được. Thử lại khi dịch vụ sẵn sàng.',
        );
      form.reset();
      resetApiSession();
      setAuth('signedIn');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    setBusy(true);
    setError('');
    try {
      await api('/desktop/approve', { userCode });
      setApproved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Chưa đăng xuất được. Hãy thử lại.');
      resetApiSession();
      setAuth('signedOut');
      setRequest(null);
      setApproved(false);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const download = release?.available && release.url;
  return (
    <div className="portal">
      <header className="portal-header">
        <a className="portal-brand" href="/" aria-label="RELAY home">
          <img src="/relay.svg" alt="" />
          relay<span>.</span>
        </a>
        <nav aria-label="Website navigation">
          <a href="#download">Tải app</a>
          <button
            className="button"
            onClick={() => {
              setLoginOpen(true);
              setError('');
            }}
          >
            Đăng nhập <ArrowUpRight size={14} />
          </button>
        </nav>
      </header>
      <main>
        <section className="portal-hero">
          <h1>
            Một nơi cho
            <br />
            cả đội Codex.
          </h1>
          <p>Giao việc, theo dõi và bàn giao giữa các Codex thật trên máy của bạn.</p>
          <div className="portal-hero-actions">
            {download ? (
              <a className="button primary" href={download}>
                <ArrowDownToLine size={18} /> Tải RELAY cho Windows
              </a>
            ) : (
              <a className="button primary" href="#download">
                <Monitor size={18} /> RELAY cho Windows
              </a>
            )}
            <button className="portal-text-button" onClick={() => setLoginOpen(true)}>
              Kết nối app <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
        <section className="portal-workflow" aria-label="Cách RELAY làm việc">
          <div className="portal-workflow-start">
            <span>Bạn giao mục tiêu</span>
            <span className="workflow-line" />
          </div>
          <div className="portal-workflow-room">
            <MessageSquare size={24} />
            <strong>MESH</strong>
            <span>Chia việc · Chia sẻ · Bàn giao</span>
          </div>
          <div
            className="portal-workflow-agents"
            aria-label="Nhiều tài khoản trên một hoặc nhiều máy"
          >
            {['Code', 'Research', 'Review', 'Design'].map((label) => (
              <div key={label}>
                <Cpu size={20} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="portal-workflow-end">
            <GitBranch size={16} />
            Checkpoint
            <ShieldCheck size={16} />
            AEGIS
          </div>
        </section>
        <section className="portal-capabilities" aria-label="Các chức năng RELAY">
          <article>
            <Monitor size={22} />
            <h2>Workspace trên desktop</h2>
            <p>Sessions, task, diff và demo trong cùng một app.</p>
          </article>
          <article>
            <Cpu size={22} />
            <h2>Máy bạn, máy đồng đội</h2>
            <p>Chọn nơi chạy và giới hạn tài nguyên cho từng máy.</p>
          </article>
          <article>
            <ShieldCheck size={22} />
            <h2>Bàn giao có bằng chứng</h2>
            <p>Giữ checkpoint, kiểm soát quyền và xác minh với Avalanche Fuji.</p>
          </article>
        </section>
        <section className="portal-download" id="download" aria-labelledby="download-heading">
          <div>
            <h2 id="download-heading">Mang cả đội về desktop.</h2>
            <p>Windows 10/11 · x64{release?.version ? ` · ${release.version}` : ''}</p>
          </div>
          <div className="portal-download-action">
            {download ? (
              <a className="button primary" href={download}>
                <ArrowDownToLine size={18} /> Tải app
              </a>
            ) : (
              <span className="portal-status" role="status">
                {releaseError ||
                  (release ? 'Bản cài đặt chưa được phát hành.' : 'Đang kiểm tra bản tải xuống…')}
              </span>
            )}
            {release?.size ? (
              <span className="portal-muted">{(release.size / 1024 / 1024).toFixed(1)} MB</span>
            ) : null}
          </div>
          {download && (
            <details className="portal-release-details">
              <summary>Thông tin bản cài đặt</summary>
              {!release.signed && (
                <p>
                  Bản thử nghiệm chưa có chữ ký nhà phát hành. Windows có thể yêu cầu bạn xác nhận
                  trước khi chạy.
                </p>
              )}
              {release.sha256 && (
                <div className="portal-checksum">
                  <span>SHA-256</span>
                  <code>{release.sha256}</code>
                  <button
                    className="icon-button"
                    aria-label="Copy checksum"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(release.sha256!)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setReleaseError(
                            'Không sao chép được. Bạn có thể chọn mã SHA-256 để sao chép thủ công.',
                          ),
                        )
                    }
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              )}
            </details>
          )}
          {releaseError && download && (
            <p role="alert" className="error-text">
              {releaseError}
            </p>
          )}
        </section>
      </main>
      <footer className="portal-footer">
        <span>NoSleepClub RELAY</span>
        <span>Web để kết nối. Desktop để làm việc.</span>
      </footer>
      {loginOpen && (
        <div className="portal-dialog-backdrop">
          <section
            ref={dialog}
            className="portal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="portal-login-title"
          >
            <div className="portal-dialog-heading">
              <h2 id="portal-login-title">{approved ? 'Đã kết nối' : 'Đăng nhập RELAY'}</h2>
              <button
                className="icon-button"
                aria-label="Đóng đăng nhập"
                onClick={() => setLoginOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            {auth === 'loading' || auth === 'unchecked' ? (
              <p className="portal-status" role="status">
                <Loader2 size={18} className="spin" />
                Đang kết nối…
              </p>
            ) : auth === 'signedOut' ? (
              <form onSubmit={login} className="portal-login-form">
                <label>
                  Mật khẩu chủ workspace
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                    autoFocus
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={16} />}Đăng
                  nhập
                </button>
              </form>
            ) : approved ? (
              <div className="portal-approved">
                <CheckCheck size={32} />
                <p>Quay lại app RELAY để bắt đầu làm việc.</p>
              </div>
            ) : (
              <div className="portal-device-form">
                <label>
                  Mã từ app desktop
                  <input
                    aria-label="Mã từ app desktop"
                    value={userCode}
                    onChange={(event) => setUserCode(formatCode(event.target.value))}
                    placeholder="XXXXX-XXXXX"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                {request && (
                  <div className="portal-device-request">
                    <Monitor size={20} />
                    <strong>{request.name}</strong>
                    <span>Hết hạn {new Date(request.expiresAt).toLocaleTimeString('vi-VN')}</span>
                  </div>
                )}
                <p className="portal-muted">
                  Chỉ xác nhận khi mã này trùng với mã trong app bạn vừa mở.
                </p>
                <button
                  className="button primary"
                  disabled={!request || busy || Date.parse(request.expiresAt) <= Date.now()}
                  onClick={() => void approve()}
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}Kết nối
                  desktop này
                </button>
              </div>
            )}
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            {auth === 'signedIn' && (
              <button className="portal-text-button" disabled={busy} onClick={() => void signOut()}>
                <LogOut size={14} />
                Đăng xuất web
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
