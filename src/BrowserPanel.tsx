import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe2, Loader2, Pause, RefreshCw, Send, X } from 'lucide-react';
import { api } from './api';
import type { BrowserPage, BrowserState } from './desktop';
import type { BrowserExchange } from '../server/browser';
import './BrowserPanel.css';

const emptyState: BrowserState = {
  active: false,
  projectId: '',
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: '',
};

export default function BrowserPanel({
  projectId,
  sessionId,
  onClose,
}: {
  projectId: string;
  sessionId?: string;
  onClose?: () => void;
}) {
  const browser = window.relayDesktop?.browser;
  const viewport = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>(emptyState);
  const [url, setUrl] = useState('');
  const [exchange, setExchange] = useState<BrowserExchange | null>(null);
  const [review, setReview] = useState<BrowserPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState('');

  useEffect(() => {
    setReview(null);
    setShared('');
    setExchange(null);
    setUrl('');
    if (!browser) return;
    let active = true;
    const update = (next: BrowserState) => {
      if (active) {
        setState(next);
        if (next.url) setUrl(next.url);
      }
    };
    void browser
      .state()
      .then(update)
      .catch(() => {});
    const unsubscribe = browser.onState(update);
    return () => {
      active = false;
      unsubscribe();
      void browser.close().catch(() => {});
    };
  }, [browser, projectId, sessionId]);

  useEffect(() => {
    if (!sessionId || !browser) return;
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const next = await api<BrowserExchange>(
          `/projects/${encodeURIComponent(projectId)}/browser?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (active) setExchange(next);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [browser, projectId, sessionId]);

  useEffect(() => {
    const element = viewport.current;
    if (!browser || !element || !state.active) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        void browser
          .bounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
          .catch(() => {});
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
    };
  }, [browser, state.active, review]);

  // Native views sit above DOM. Hide the page while app dialogs or review controls
  // are open so they cannot be obscured by an unrelated interactive website.
  useEffect(() => {
    if (!browser || !state.active) return;
    let previous: boolean | undefined;
    const updateVisibility = () => {
      const hidden =
        Boolean(review) ||
        document.hidden ||
        Boolean(document.querySelector('[aria-modal="true"],dialog[open]'));
      if (hidden !== previous) {
        previous = hidden;
        void browser.review(hidden).catch(() => {});
      }
    };
    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'open'],
    });
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [browser, state.active, review]);

  async function open(value: string) {
    if (!browser || !viewport.current) return;
    setError('');
    setShared('');
    setReview(null);
    const bounds = viewport.current.getBoundingClientRect();
    try {
      await browser.review(false);
      setState(
        await browser.open({
          projectId,
          url: /^https?:\/\//i.test(value) ? value : `https://${value}`,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function inspect() {
    if (!browser) return;
    setError('');
    setBusy(true);
    try {
      const page = await browser.snapshot();
      if (page.projectId !== projectId) throw new Error('Hãy mở website trong dự án này.');
      await browser.review(true);
      setReview(page);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!review || !sessionId || !browser) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ continuation?: 'sent' | 'paused'; reason?: string }>(
        `/projects/${encodeURIComponent(projectId)}/browser/share`,
        {
          sessionId,
          url: review.url,
          title: review.title,
          text: review.text,
          reviewed: true,
        },
      );
      setReview(null);
      setShared(
        result.continuation === 'sent'
          ? 'Đã chia sẻ · Codex đang tiếp tục'
          : `Đã chia sẻ. ${result.reason || 'Tiếp tục session để Codex đọc trang.'}`,
      );
      await browser.review(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!browser)
    return (
      <section className="project-browser">
        <div className="project-browser-empty">
          <Globe2 size={28} />
          <strong>Mở trong Kivuno desktop</strong>
        </div>
      </section>
    );
  return (
    <section className="project-browser" aria-label="Browser của dự án">
      <div className="project-browser-heading">
        <strong>
          <Globe2 size={16} /> Browser
        </strong>
        <div>
          {state.active && (
            <button
              className="icon-button"
              aria-label="Tạm đóng browser để giảm RAM"
              onClick={() =>
                void browser
                  .close()
                  .then(setState)
                  .catch((cause) => setError(cause.message))
              }
            >
              <Pause size={15} />
            </button>
          )}
          {onClose && (
            <button className="icon-button" aria-label="Đóng browser" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {exchange?.request && !review && (
        <div className="project-browser-request">
          <span>{exchange.request.purpose || 'Codex cần bạn xem website này.'}</span>
          <button className="button" onClick={() => void open(exchange.request!.url)}>
            Mở trang được yêu cầu
          </button>
        </div>
      )}
      <form
        className="project-browser-navigation"
        onSubmit={(event) => {
          event.preventDefault();
          void open(url);
        }}
      >
        <button
          type="button"
          aria-label="Quay lại"
          disabled={!state.canGoBack}
          onClick={() => void browser.navigate('back')}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          aria-label="Đi tới"
          disabled={!state.canGoForward}
          onClick={() => void browser.navigate('forward')}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          aria-label="Tải lại trang"
          disabled={!state.active}
          onClick={() => void browser.navigate('reload')}
        >
          <RefreshCw size={15} className={state.loading ? 'spin' : ''} />
        </button>
        <input
          aria-label="Địa chỉ website"
          placeholder="https://…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit" disabled={!url.trim()} aria-label="Mở website">
          <ArrowRight size={15} />
        </button>
      </form>
      {(error || state.error) && (
        <p className="project-browser-error" role="alert">
          {error || state.error}
        </p>
      )}
      <div className="project-browser-viewport" ref={viewport}>
        {review ? (
          <div className="project-browser-review">
            <strong>Nội dung sẽ gửi cho Codex</strong>
            <span>{review.url}</span>
            <textarea
              aria-label="Xem lại nội dung chia sẻ"
              value={review.text}
              onChange={(event) => setReview({ ...review, text: event.target.value })}
              maxLength={20000}
            />
            <div>
              <button
                className="button"
                onClick={() => {
                  setReview(null);
                  void browser.review(false);
                }}
              >
                Quay lại
              </button>
              <button
                className="button primary"
                onClick={() => void share()}
                disabled={busy || !review.text.trim()}
                aria-busy={busy}
              >
                {busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                {busy ? 'Đang chia sẻ…' : 'Chia sẻ & tiếp tục'}
              </button>
            </div>
          </div>
        ) : (
          !state.active && (
            <div className="project-browser-empty">
              <Globe2 size={30} />
              <strong>Chưa mở trang</strong>
            </div>
          )
        )}
      </div>
      {!review && (
        <div className="project-browser-footer">
          {(shared || !sessionId) && (
            <span role="status">{shared || 'Chọn một session để chia sẻ'}</span>
          )}
          <button
            className="button"
            disabled={!state.active || !sessionId || busy}
            onClick={() => void inspect()}
          >
            {busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />} Chia sẻ trang
          </button>
        </div>
      )}
    </section>
  );
}
