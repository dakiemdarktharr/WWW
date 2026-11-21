import { useEffect, useState } from 'react';
import { Download, Presentation, Send } from 'lucide-react';
import { isSadeDeckRequest, type SadeDeckView } from '../shared/sade-deck';
import './SadeDeckChat.css';

const active = (deck: SadeDeckView) => ['research', 'authoring', 'retrying'].includes(deck.state);
const progress = {
  research: 'Sade đang chuẩn bị tài liệu nguồn…',
  authoring: 'Codex đang soạn và xuất PowerPoint…',
  retrying: 'Sade đang tự thử lại…',
  ready: '',
  failed: '',
};

export function useSadeDeckChat(enabled: boolean) {
  const [prompt, setPrompt] = useState('');
  const [decks, setDecks] = useState<SadeDeckView[]>([]);
  const [pending, setPending] = useState<{ id: string; prompt: string }>();
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [saved, setSaved] = useState<{ id: string; filename: string; path: string }>();
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const upsert = (incoming: SadeDeckView) =>
    setDecks((old) =>
      [incoming, ...old.filter((item) => item.id !== incoming.id)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 16),
    );

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await window.relayDesktop!.sadeDecks<{ decks: SadeDeckView[] }>({
          action: 'list',
        });
        if (live) {
          setDecks((old) =>
            [...new Map([...result.decks, ...old].map((deck) => [deck.id, deck])).values()]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 16),
          );
          setLoaded(true);
        }
      } catch {
        if (live) timer = setTimeout(load, 10000);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !pending) return;
    let live = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const start = async () => {
      try {
        const { deck } = await window.relayDesktop!.sadeDecks<{ deck: SadeDeckView }>({
          action: 'start',
          ...pending,
        });
        if (live) {
          upsert(deck);
          setRetrying(false);
          setPending(undefined);
        }
      } catch (cause) {
        if (!live) return;
        if (++attempt < 5) {
          setRetrying(true);
          timer = setTimeout(start, attempt * 1600);
        } else {
          setError((cause as Error).message);
          setPrompt(pending.prompt);
          setRetrying(false);
          setPending(undefined);
        }
      }
    };
    void start();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, pending]);

  const watching = decks
    .filter(active)
    .map(({ id }) => id)
    .sort()
    .join(',');
  useEffect(() => {
    if (!enabled || !watching) return;
    let live = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await Promise.allSettled(
          watching.split(',').map(async (id) => {
            const { deck } = await window.relayDesktop!.sadeDecks<{ deck: SadeDeckView }>({
              action: 'read',
              id,
            });
            if (live) upsert(deck);
          }),
        );
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, watching]);

  const download = async (id: string) => {
    setDownloading(id);
    setError('');
    try {
      const file = await window.relayDesktop!.sadeDecks<{ filename: string; path: string }>({
        action: 'download',
        id,
      });
      setSaved({ id, ...file });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDownloading('');
    }
  };
  const submit = (message: string) => {
    if (!enabled || pending || !message.trim()) return false;
    if (message.length > 3000 || !isSadeDeckRequest(message)) {
      setError('Hãy nêu chủ đề và yêu cầu Sade tạo một tệp PowerPoint trong tối đa 3.000 ký tự.');
      return false;
    }
    setError('');
    setPending({ id: crypto.randomUUID(), prompt: message.trim() });
    setPrompt('');
    return true;
  };
  return {
    decks,
    pending,
    error,
    downloading,
    saved,
    retrying,
    loaded,
    download,
    submit,
    prompt,
    setPrompt,
  };
}

export default function SadeDeckChat({
  deckChat: {
    decks,
    pending,
    error,
    downloading,
    saved,
    retrying,
    loaded,
    download,
    submit,
    prompt,
    setPrompt,
  },
}: {
  deckChat: ReturnType<typeof useSadeDeckChat>;
}) {
  return (
    <section className="sade-deck-chat" aria-label="Sade PowerPoint">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(prompt);
        }}
      >
        <label htmlFor="sade-deck-message">
          <Presentation size={17} /> Nhắn Sade
        </label>
        <div className="sade-deck-input">
          <input
            id="sade-deck-message"
            value={prompt}
            maxLength={3000}
            placeholder="Tạo tôi một file PowerPoint về…"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            className="button primary compact"
            disabled={Boolean(pending) || !prompt.trim()}
            aria-label="Gửi Sade"
          >
            <Send size={15} />
          </button>
        </div>
      </form>
      <div aria-live="polite" className="sade-deck-results">
        {pending && (
          <p role="status">{retrying ? 'Sade đang kết nối lại…' : 'Sade đang nhận yêu cầu…'}</p>
        )}
        {decks.map((deck) => (
          <article key={deck.id}>
            <strong>{deck.title || deck.prompt}</strong>
            {active(deck) && <p role="status">{progress[deck.state]}</p>}
            {deck.state === 'failed' && <p>Sade chưa hoàn tất tệp sau khi tự thử lại.</p>}
            {deck.worker && (
              <details>
                <summary>Phiên Codex</summary>
                <p>{deck.worker.report}</p>
              </details>
            )}
            {deck.state === 'ready' && (
              <button
                className="button compact"
                disabled={downloading === deck.id}
                onClick={() => void download(deck.id)}
              >
                <Download size={15} /> Tải PowerPoint
              </button>
            )}
            {saved?.id === deck.id && (
              <p role="status" title={saved.path}>
                Đã lưu {saved.filename} vào Tải xuống.
              </p>
            )}
            {deck.sources?.length ? (
              <details>
                <summary>Nguồn sử dụng</summary>
                <ul>
                  {deck.sources.map(({ title, url }) => (
                    <li key={url}>
                      <span>{title}</span>
                      <small>{new URL(url).hostname}</small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!loaded && !pending && !decks.length && <small>Đang tải các bản trình chiếu…</small>}
    </section>
  );
}
