import { useEffect, useState } from 'react';
import { Eye, Monitor } from 'lucide-react';
import { api, ApiError, resetApiSession } from './api';
import PortalAuth from './PortalAuth';
import { PortalLanguage, PortalLocaleProvider, usePortalLocale } from './PortalLocale';
import { PortalThemeProvider, PortalThemeToggle } from './PortalTheme';
import './billing.css';
import './ClaudeConsent.css';

interface Consent {
  requestRemainingMs?: number;
  recommendedConnectionId?: string;
  account: { name: string };
  scope: string;
  grants: {
    connectionId: string;
    kind?: 'account' | 'project';
    projectId?: string;
    memberId: string;
    projectName?: string;
    memberName?: string;
    deviceName: string;
    expiresAt: string;
  }[];
}
const requestId = new URLSearchParams(location.search).get('request') || '';
const validRequest = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
  requestId,
);

function ConsentForm() {
  const { locale } = usePortalLocale();
  const vi = locale === 'vi';
  const [data, setData] = useState<Consent | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [login, setLogin] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [unavailable, setUnavailable] = useState(false);
  const expired = unavailable || (deadline !== null && now >= deadline);
  const remainingSeconds = deadline === null ? 0 : Math.ceil(Math.max(0, deadline - now) / 1000);
  useEffect(() => {
    if (deadline === null) return;
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [deadline]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected('');
    setError('');
    setSignedOut(false);
    setDeadline(null);
    setUnavailable(false);
    if (!validRequest) return;
    const signedOut = () => {
      resetApiSession();
      setData(null);
      setSelected('');
      setError('');
      setSignedOut(true);
    };
    window.addEventListener('relay-auth-expired', signedOut);
    async function inspect() {
      const result = await fetch('/api/auth/get-session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!result.ok)
        throw new Error(vi ? 'Dịch vụ đăng nhập chưa phản hồi.' : 'Kivuno sign-in is unavailable.');
      const session = await result.json();
      if (controller.signal.aborted) return;
      if (!session?.user) {
        signedOut();
        return;
      }
      const consent = await api<Consent>(
        '/claude/oauth/consent?request=' + encodeURIComponent(requestId),
      );
      if (controller.signal.aborted) return;
      if (
        typeof consent.scope !== 'string' ||
        !consent.scope
          .split(' ')
          .every((scope) => ['connector.connect', 'mesh.read'].includes(scope)) ||
        !Array.isArray(consent.grants) ||
        !consent.account?.name
      )
        throw new Error(vi ? 'Yêu cầu cấp quyền không hợp lệ.' : 'The access request is invalid.');
      setData(consent);
      if (
        typeof consent.requestRemainingMs === 'number' &&
        Number.isFinite(consent.requestRemainingMs)
      ) {
        setDeadline(Date.now() + Math.max(0, consent.requestRemainingMs));
        setNow(Date.now());
      }
      const recommended = consent.grants.find(
        (g) => g.connectionId === consent.recommendedConnectionId,
      );
      if (recommended) setSelected(recommended.connectionId);
      else if (consent.grants.length === 1) setSelected(consent.grants[0].connectionId);
    }
    void inspect().catch((cause) => {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiError && cause.code === 'CLAUDE_CONSENT_UNAVAILABLE')
          setUnavailable(true);
        else setError((cause as Error).message);
      }
    });
    return () => {
      controller.abort();
      window.removeEventListener('relay-auth-expired', signedOut);
    };
  }, [reload, vi]);

  async function decide(allow: boolean) {
    if (
      busy ||
      !data ||
      expired ||
      (deadline !== null && Date.now() >= deadline) ||
      (allow && !selected)
    )
      return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ redirectUrl: string }>('/claude/oauth/consent', {
        request: requestId,
        decision: allow ? 'allow' : 'deny',
        ...(allow ? { connectionId: selected } : {}),
      });
      const callback = new URL(result.redirectUrl);
      if (
        callback.origin !== 'https://claude.ai' ||
        callback.pathname !== '/api/mcp/auth_callback' ||
        callback.username ||
        callback.password ||
        callback.hash
      )
        throw new Error(
          vi ? 'Địa chỉ quay về Claude không hợp lệ.' : 'The Claude callback address is invalid.',
        );
      location.replace(callback.href);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CLAUDE_CONSENT_UNAVAILABLE')
        setUnavailable(true);
      else setError((cause as Error).message);
      setBusy(false);
    }
  }
  const selectedGrant = data?.grants.find((grant) => grant.connectionId === selected);
  const accountLink = selectedGrant?.kind === 'account';
  return (
    <main className="billing-page claude-consent">
      <header className="billing-header">
        <a className="billing-brand" href="/">
          <img src="/kivuno.svg" width="30" height="30" alt="" />
          Kivuno
        </a>
        <div className="billing-header-actions">
          <PortalLanguage />
          <PortalThemeToggle />
        </div>
      </header>
      <section className="billing-panel claude-consent-panel" aria-labelledby="consent-heading">
        <h1 id="consent-heading">
          {vi ? 'Kết nối Claude với Kivuno' : 'Connect Claude to Kivuno'}
        </h1>
        {!validRequest ? (
          <p role="alert">
            {vi
              ? 'Mở Connect (Connecter) từ trang Connectors của Claude để bắt đầu.'
              : 'Choose Connect in Claude’s Connectors settings to start a new request.'}
          </p>
        ) : signedOut ? (
          <>
            <p>
              {vi
                ? 'Đăng nhập bằng tài khoản Kivuno đang dùng trong Kivuno Desktop.'
                : 'Sign in with the Kivuno account you use in Kivuno Desktop.'}
            </p>
            <button className="billing-primary" onClick={() => setLogin(true)}>
              {vi ? 'Đăng nhập Kivuno' : 'Sign in to Kivuno'}
            </button>
          </>
        ) : expired ? (
          <div role="alert">
            <p>
              {vi
                ? 'Lời mời xác nhận đã hết hạn hoặc không còn hiệu lực.'
                : 'This confirmation request expired or is no longer available.'}
            </p>
            <p>
              {vi
                ? 'Quay lại Claude, mở Kivuno và bấm Kết nối để tạo lời mời mới. Liên kết tài khoản có thời hạn riêng.'
                : 'Return to Claude, open Kivuno and choose Connect to create a new request. The account link has a separate expiry.'}
            </p>
            <a className="billing-primary" href="https://claude.ai/plugins/yours?filter=connectors">
              {vi ? 'Quay lại Claude' : 'Return to Claude'}
            </a>
          </div>
        ) : data ? (
          <>
            {deadline !== null && (
              <p>
                {vi ? 'Xác nhận lời mời trong' : 'Confirm this request within'}{' '}
                {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
                {vi
                  ? '. Hết giờ, bạn cần bấm Kết nối lại trong Claude.'
                  : '. After this, start a new connection in Claude.'}
              </p>
            )}
            <p>
              {vi ? 'Tài khoản Kivuno' : 'Kivuno account'} · <strong>{data.account.name}</strong>
            </p>
            <div className="claude-consent-permission">
              <Eye size={18} aria-hidden="true" />
              <p>
                {accountLink
                  ? vi
                    ? 'Liên kết Claude với hồ sơ đã chọn. Chỉ khi bạn cấp quyền riêng trong Group team thì Claude mới đọc được tin nhắn dự án.'
                    : 'Link Claude to the selected profile. Project messages stay private until you share a project from Group team.'
                  : !selectedGrant
                    ? vi
                      ? 'Chọn hồ sơ để liên kết hoặc chọn một dự án đã có quyền chia sẻ.'
                      : 'Choose a profile to link or a previously shared project.'
                    : vi
                      ? 'Claude được đọc tên project và tin nhắn đã chia sẻ trong nhóm dự án bạn chọn.'
                      : 'Claude can read the project name and messages shared in the selected project group.'}
              </p>
            </div>
            {data.grants.length ? (
              <fieldset disabled={busy}>
                <legend>{vi ? 'Chọn kết nối' : 'Choose a connection'}</legend>
                {data.grants.map((grant) => (
                  <label className="claude-consent-choice" key={grant.connectionId}>
                    <input
                      type="radio"
                      name="connection"
                      checked={selected === grant.connectionId}
                      onChange={() => setSelected(grant.connectionId)}
                    />
                    <span>
                      <strong>
                        {grant.kind === 'account'
                          ? grant.memberName || grant.memberId
                          : grant.projectName || grant.projectId}
                      </strong>
                      <span>
                        <Monitor size={14} aria-hidden="true" /> {grant.deviceName} ·{' '}
                        {grant.kind === 'account'
                          ? vi
                            ? 'Liên kết tài khoản'
                            : 'Account link'
                          : grant.memberName || grant.memberId}
                      </span>
                      {grant.connectionId === data.recommendedConnectionId && (
                        <small>
                          {vi ? 'Vừa yêu cầu kết nối từ Kivuno' : 'Just requested from Kivuno'}
                        </small>
                      )}
                      <small>
                        {vi ? 'Liên kết có hiệu lực đến' : 'Link valid until'}{' '}
                        <time dateTime={grant.expiresAt}>
                          {new Date(grant.expiresAt).toLocaleString(vi ? 'vi-VN' : 'en-US', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </time>
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <p>
                  {vi
                    ? 'Trong Kivuno Desktop, mở Team → Add account → Claude → Connect Claude in browser. Quay lại đây và làm mới danh sách.'
                    : 'In Kivuno Desktop, open Team → Add account → Claude → Connect Claude in browser. Return here and refresh the list.'}
                </p>
                <button
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() => setReload((n) => n + 1)}
                >
                  {vi ? 'Làm mới danh sách' : 'Refresh connections'}
                </button>
              </>
            )}
            <div className="claude-consent-actions">
              <button
                className="billing-secondary"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                {vi ? 'Từ chối' : 'Decline'}
              </button>
              <button
                className="billing-primary"
                disabled={busy || !selected}
                onClick={() => void decide(true)}
              >
                {accountLink
                  ? vi
                    ? 'Liên kết tài khoản'
                    : 'Link account'
                  : vi
                    ? 'Cho phép chỉ đọc'
                    : 'Allow read-only access'}
              </button>
            </div>
          </>
        ) : !error ? (
          <p role="status">{vi ? 'Đang kiểm tra yêu cầu…' : 'Checking the access request…'}</p>
        ) : null}
        {error && !signedOut && (
          <div role="alert">
            <p>{error}</p>
            <p>
              {vi
                ? 'Nếu yêu cầu đã hết hạn, quay lại Claude và bấm Connect (Connecter) lần nữa.'
                : 'If this request expired, return to Claude and choose Connect again.'}
            </p>
          </div>
        )}
        <a className="billing-back" href="/claude/guide" target="_blank" rel="noreferrer">
          {vi ? 'Hướng dẫn kết nối Claude' : 'Claude connector guide'}
        </a>
        <a className="billing-back" href="/claude/privacy" target="_blank" rel="noreferrer">
          {vi ? 'Quyền riêng tư của connector' : 'Connector privacy notice'}
        </a>
      </section>
      {login && (
        <PortalAuth
          mode="login"
          activationCode=""
          onClose={() => setLogin(false)}
          onSignedIn={() => {
            setLogin(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </main>
  );
}

export default function ClaudeConsent() {
  return (
    <PortalLocaleProvider>
      <PortalThemeProvider>
        <ConsentForm />
      </PortalThemeProvider>
    </PortalLocaleProvider>
  );
}
