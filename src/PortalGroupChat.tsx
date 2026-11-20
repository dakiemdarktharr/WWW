import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  GitBranch,
  Laptop,
  MessageCircle,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { usePortalLocale } from './PortalLocale';
import './portal-group-chat.css';

type Actor = 'you' | 'sade' | 'ari' | 'nova' | 'sol';
type ChatMessage = {
  id: string;
  actor: Actor;
  vi: string;
  en: string;
  attachment?: 'plan' | 'checkpoint' | 'review';
};

const participants: { id: Actor; name: string; role: string }[] = [
  { id: 'sade', name: 'Sade', role: 'Coordinator' },
  { id: 'ari', name: 'Ari', role: 'Codex' },
  { id: 'nova', name: 'Nova', role: 'Claude' },
  { id: 'sol', name: 'Sol', role: 'Gemini' },
];

const conversation: ChatMessage[] = [
  {
    id: 'goal',
    actor: 'you',
    vi: 'Cả đội ơi, làm một trợ lý nghiên cứu cho UniHack nhé. Mình muốn có bản chạy thử hôm nay.',
    en: 'Team, let’s build a research assistant for UniHack. I’d love a working prototype today.',
  },
  {
    id: 'plan',
    actor: 'sade',
    vi: 'Mình chia việc nhé: @Ari làm API, @Nova làm giao diện, @Sol đọc tiêu chí. Mỗi phần sẽ có người kiểm tra độc lập.',
    en: 'Here’s the plan: @Ari takes the API, @Nova builds the interface, @Sol reads the brief. Each part gets an independent review.',
    attachment: 'plan',
  },
  {
    id: 'api',
    actor: 'ari',
    vi: '@Nova API tìm kiếm đã sẵn sàng trên máy của mình. Mình gửi schema để bạn nối giao diện.',
    en: '@Nova the search API is ready on my machine. Sharing the schema so you can connect the interface.',
  },
  {
    id: 'research',
    actor: 'sol',
    vi: 'Đã đưa tiêu chí và nguồn vào ngữ cảnh chung. Kết quả tìm kiếm cần dẫn nguồn ngay dưới mỗi câu trả lời.',
    en: 'The criteria and sources are in our shared context. Search results need a source below each answer.',
  },
  {
    id: 'ui',
    actor: 'nova',
    vi: 'Mình đã nối UI với API và thêm dẫn nguồn. @Ari mình cũng thấy một trường hợp chưa kiểm tra quyền truy cập.',
    en: 'The UI is connected and citations are in. @Ari I also found a case missing an access check.',
  },
  {
    id: 'handoff',
    actor: 'ari',
    vi: 'Mình đã sửa và bổ sung test. Usage đang gần mức dừng — gửi checkpoint, phần còn lại và kết quả test để bàn giao.',
    en: 'Fixed and covered with a test. I’m nearing my usage limit — handing over the checkpoint, remaining work, and test results.',
    attachment: 'checkpoint',
  },
  {
    id: 'transfer',
    actor: 'sade',
    vi: '@Nova tiếp quản từ checkpoint trên máy đồng đội. @Sol kiểm tra lại bản mới; kết quả review cũ không áp dụng cho thay đổi này.',
    en: '@Nova can continue from the checkpoint on a teammate’s machine. @Sol, review the new revision; the earlier review doesn’t cover this change.',
  },
  {
    id: 'ready',
    actor: 'sol',
    vi: 'Đã kiểm tra lại quyền truy cập và dẫn nguồn. Bản thay đổi sẵn sàng để bạn xem và quyết định.',
    en: 'Access checks and citations have been reviewed again. The changes are ready for you to inspect and decide.',
    attachment: 'review',
  },
];

/** A local, scripted product illustration. It never sends a prompt or approves real work. */
export default function PortalGroupChat() {
  const { locale } = usePortalLocale();
  const reduced = useReducedMotion();
  const copy = (vi: string, en: string) => (locale === 'vi' ? vi : en);
  const [messages, setMessages] = useState<ChatMessage[]>([conversation[0]]);
  const [progress, setProgress] = useState(1);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [draft, setDraft] = useState('');
  const [approved, setApproved] = useState(false);
  const [following, setFollowing] = useState(true);
  const [announcement, setAnnouncement] = useState({ vi: '', en: '' });
  const section = useRef<HTMLElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const transcriptContent = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const messageId = useRef(0);
  const reducedWasApplied = useRef(false);
  const finished = progress >= conversation.length;
  const playing = !paused && !reduced;

  function follow(value: boolean) {
    followingRef.current = value;
    setFollowing(value);
  }

  function scrollToLatest() {
    const element = transcript.current;
    if (!followingRef.current || !element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 1)
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
  }

  useEffect(() => {
    const changed = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    });
    if (section.current) observer.observe(section.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!reduced) {
      reducedWasApplied.current = false;
      return;
    }
    if (reducedWasApplied.current) return;
    reducedWasApplied.current = true;
    setMessages((current) => [
      ...conversation,
      ...current.filter((item) => /^(local|reply|approved)-/.test(item.id)).slice(-8),
    ]);
    setProgress(conversation.length);
    setPaused(true);
  }, [reduced]);

  useEffect(() => {
    if (!playing || !visible || !pageVisible || !following) return;
    const timer = window.setTimeout(
      () => {
        if (finished) {
          // Keep the conversation moving without resetting the scroll position.
          // Bound the transcript so an open tab cannot accumulate an infinite DOM.
          const nextCycle = cycle + 1;
          setCycle(nextCycle);
          setMessages((current) => [
            ...current.slice(-15),
            { ...conversation[0], id: `goal-${nextCycle}` },
          ]);
          setProgress(1);
          setApproved(false);
        } else {
          setMessages((current) => [
            ...current.slice(-15),
            { ...conversation[progress], id: `${conversation[progress].id}-${cycle}` },
          ]);
          setProgress((current) => current + 1);
        }
      },
      finished ? 4200 : 2400,
    );
    return () => window.clearTimeout(timer);
  }, [progress, playing, visible, pageVisible, following, finished, cycle]);

  useEffect(() => {
    scrollToLatest();
  }, [messages, following, locale]);

  useEffect(() => {
    const observer = new ResizeObserver(scrollToLatest);
    if (transcriptContent.current) observer.observe(transcriptContent.current);
    return () => observer.disconnect();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const id = ++messageId.current;
    setPaused(true);
    follow(true);
    setMessages((current) => [
      ...current.slice(-14),
      { id: `local-${id}`, actor: 'you', vi: text, en: text },
      {
        id: `reply-${id}`,
        actor: 'sade',
        vi: 'Đã nhận lời nhắn trong bản mô phỏng. Nhấn phát để cả đội tiếp tục nhé.',
        en: 'Your message is in the demo. Press play to keep the team moving.',
      },
    ]);
    setDraft('');
    setAnnouncement({ vi: 'Đã gửi tin nhắn mô phỏng.', en: 'Demo message sent.' });
  }

  function approve() {
    if (approved) return;
    setApproved(true);
    setPaused(true);
    follow(true);
    setMessages((current) => [
      ...current.slice(-15),
      {
        id: `approved-${cycle}`,
        actor: 'you',
        vi: 'Mình đã duyệt bản thay đổi trong mô phỏng. Cảm ơn cả đội!',
        en: 'I’ve approved the changes in this demo. Thanks, team!',
      },
    ]);
    setAnnouncement({
      vi: 'Đã duyệt bản mô phỏng. Không có thay đổi nào được áp dụng vào dự án thật.',
      en: 'Demo approved. No real project changes were applied.',
    });
  }

  return (
    <section className="kg-section" id="workflow" ref={section} aria-labelledby="workflow-title">
      <div className="kg-section-heading">
        <div>
          <h2 id="workflow-title">
            {copy('Từ ý tưởng đến cùng làm.', 'From an idea to working together.')}
          </h2>
        </div>
      </div>

      <div className="kg-window">
        <aside
          className="kg-sidebar"
          aria-label={copy('Đồng đội trong mô phỏng', 'Demo teammates')}
        >
          <div className="kg-brand">
            <img src="/kivuno.svg" alt="" />
            <span>
              Kivuno<span>WORKSPACE</span>
            </span>
          </div>
          <div className="kg-project">
            <span className="kg-project-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Aurora</strong>
              <span>{copy('Trợ lý nghiên cứu', 'Research assistant')}</span>
            </div>
          </div>
          <div className="kg-channel">
            <MessageCircle size={16} />
            <strong>Chat</strong>
            <span>5</span>
          </div>
          <p className="kg-sidebar-label">{copy('CÙNG DỰ ÁN', 'IN THIS PROJECT')}</p>
          <div className="kg-people">
            {participants.map((person) => (
              <div className="kg-person" key={person.id}>
                <span className={`kg-avatar ${person.id}`}>
                  {person.id === 'sade' ? <Sparkles size={17} /> : person.name[0]}
                  <i />
                </span>
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.role}</small>
                </span>
                <span className="kg-person-dot" />
              </div>
            ))}
          </div>
          <div className="kg-machine">
            <Laptop size={17} />
            <div>
              <strong>{copy('2 máy kết nối', '2 connected machines')}</strong>
            </div>
          </div>
        </aside>

        <div className="kg-conversation">
          <div className="kg-header">
            <div>
              <strong>
                Aurora <span>/ Chat</span>
              </strong>
              <span className="kg-demo-label">
                <i />
                {copy('Mô phỏng tương tác', 'Interactive demo')}
              </span>
            </div>
            <div className="kg-controls">
              {!reduced && (
                <button
                  type="button"
                  onClick={() => setPaused((value) => !value)}
                  aria-label={
                    paused
                      ? copy('Tiếp tục mô phỏng', 'Resume demo')
                      : copy('Tạm dừng mô phỏng', 'Pause demo')
                  }
                  title={paused ? copy('Tiếp tục', 'Resume') : copy('Tạm dừng', 'Pause')}
                >
                  {paused ? <Play size={16} /> : <Pause size={16} />}
                </button>
              )}
            </div>
          </div>

          <div className="kg-transcript-wrap">
            <div
              className="kg-transcript"
              ref={transcript}
              role="log"
              aria-live="off"
              aria-label={copy('Cuộc trò chuyện mô phỏng', 'Demo conversation')}
              tabIndex={0}
              onScroll={(event) => {
                const element = event.currentTarget;
                follow(element.scrollHeight - element.scrollTop - element.clientHeight < 65);
              }}
            >
              <div className="kg-transcript-content" ref={transcriptContent}>
                <div className="kg-day">
                  {copy('HÔM NAY · MỘT MỤC TIÊU CHUNG', 'TODAY · ONE SHARED GOAL')}
                </div>
                {messages.map((message, index) => {
                  const actor = participants.find((person) => person.id === message.actor);
                  const name = actor?.name || copy('Bạn', 'You');
                  return (
                    <motion.article
                      className={`kg-message ${message.actor}`}
                      key={message.id}
                      data-demo-message={message.id}
                      initial={reduced ? false : { opacity: 0, y: 22, scale: 0.88 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 350, damping: 24, mass: 0.8 }}
                    >
                      <span className={`kg-avatar ${message.actor}`}>
                        {message.actor === 'sade' ? <Sparkles size={16} /> : name[0]}
                      </span>
                      <div className="kg-message-body">
                        <div className="kg-message-meta">
                          <strong>{name}</strong>
                          {actor && <span>{actor.role}</span>}
                          <time>{`${String(Math.floor((581 + index) / 60) % 24).padStart(2, '0')}:${String((581 + index) % 60).padStart(2, '0')}`}</time>
                        </div>
                        <p>
                          {message[locale]
                            .split(/(@[\p{L}\w]+)/u)
                            .map((part, i) =>
                              part.startsWith('@') ? <mark key={i}>{part}</mark> : part,
                            )}
                        </p>
                        {message.attachment === 'plan' && (
                          <div className="kg-plan">
                            <span>
                              <i className="ari" />
                              API · Ari
                            </span>
                            <span>
                              <i className="nova" />
                              UI · Nova
                            </span>
                            <span>
                              <i className="sol" />
                              Research · Sol
                            </span>
                          </div>
                        )}
                        {message.attachment === 'checkpoint' && (
                          <div className="kg-checkpoint">
                            <GitBranch size={17} />
                            <span>
                              <strong>auth-checkpoint</strong>
                              <small>
                                {copy(
                                  'Context + tests + bước tiếp theo',
                                  'Context + tests + next steps',
                                )}
                              </small>
                            </span>
                            <Check size={16} />
                          </div>
                        )}
                        {message.attachment === 'review' && (
                          <div className="kg-review">
                            <div>
                              <ShieldCheck size={18} />
                              <span>
                                <strong>
                                  {copy('Review độc lập hoàn tất', 'Independent review complete')}
                                </strong>
                                <small>
                                  {copy(
                                    'API · Quyền truy cập · Dẫn nguồn',
                                    'API · Access checks · Citations',
                                  )}
                                </small>
                              </span>
                            </div>
                            <button type="button" onClick={approve} disabled={approved}>
                              {approved ? <CheckCheck size={15} /> : <Check size={15} />}
                              {approved
                                ? copy('Đã duyệt bản demo', 'Demo approved')
                                : copy('Duyệt bản demo', 'Approve demo')}
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </div>
            {!following && (
              <button type="button" className="kg-latest" onClick={() => follow(true)}>
                <ArrowDown size={14} />
                {copy('Tin mới nhất', 'Latest messages')}
              </button>
            )}
          </div>

          <div className="kg-typing" aria-hidden="true">
            {playing && !finished ? (
              <>
                <span className="kg-typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {participants.find((person) => person.id === conversation[progress]?.actor)?.name}{' '}
                {copy('đang soạn tin', 'is typing')}
              </>
            ) : (
              <>
                <span className="kg-status-dot" />
                {approved
                  ? copy(
                      'Bạn quyết định. Cả đội tiếp tục.',
                      'Your decision. The team moves forward.',
                    )
                  : finished
                    ? copy('Cả đội đang chờ bạn duyệt.', 'The team is waiting for your review.')
                    : copy('Mô phỏng đang tạm dừng.', 'Demo paused.')}
              </>
            )}
          </div>
          <form className="kg-composer" onSubmit={submit}>
            <label className="kg-sr-only" htmlFor="demo-message">
              {copy('Tin nhắn mô phỏng', 'Demo message')}
            </label>
            <input
              id="demo-message"
              value={draft}
              maxLength={500}
              autoComplete="off"
              placeholder={copy('Thử nhắn cho cả đội…', 'Try messaging the team…')}
              onChange={(event) => {
                setDraft(event.target.value);
                setPaused(true);
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label={copy('Gửi tin nhắn mô phỏng', 'Send demo message')}
            >
              <ArrowUp size={19} />
            </button>
          </form>
          <span className="kg-sr-only" role="status">
            {announcement[locale]}
          </span>
        </div>
      </div>
    </section>
  );
}
