import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Cpu,
  Fingerprint,
  GitCommitHorizontal,
  Laptop,
  LogIn,
  Network,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Monitor,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import PortalAuth from './PortalAuth';
import UpdatePatches from './UpdatePatches';
import { PortalLocaleProvider, PortalLanguage, usePortalLocale } from './PortalLocale';
import './portal.css';

type Platform = 'windows' | 'linux';
interface Download {
  available: boolean;
  url?: string;
  sha256?: string;
  size?: number;
  platform?: string;
  signed?: boolean;
}
interface Release extends Download {
  version: string;
  platforms?: { windows?: Download; linux?: Download; macos?: Download };
}
const platformNames = { windows: 'Windows', linux: 'Linux' };
const initialCode = new URLSearchParams(location.search).get('activate') || '';
const spring = { type: 'spring' as const, stiffness: 420, damping: 30 };

function Scramble({ iteration }: { iteration: number }) {
  const reduced = useReducedMotion();
  const [text, setText] = useState('Kivuno');
  useEffect(() => {
    if (reduced) {
      setText('Kivuno');
      return;
    }
    const target = 'Kivuno',
      letters = 'abcdefghijklmnopqrstuvwxyz';
    let frame = 0,
      start = 0,
      last = 0;
    const tick = (now: number) => {
      start ||= now;
      const progress = Math.min(1, (now - start) / 740);
      if (now - last > 42) {
        last = now;
        setText(
          [...target]
            .map((char, i) =>
              i < Math.floor(progress * 8)
                ? char
                : letters[(Math.floor(now / 42) * 7 + i * 13) % letters.length],
            )
            .join(''),
        );
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setText(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [iteration, reduced]);
  return <span aria-hidden="true">{text}</span>;
}

const scenarios = {
  plan: [
    {
      who: 'Bạn',
      color: 'human',
      text: '/goal Xây một trợ lý nghiên cứu cho UniHack.',
      tag: 'Mục tiêu',
    },
    {
      who: 'Ari',
      color: 'mint',
      text: '@Nova mình nhận backend. Bạn làm giao diện nhé?',
      tag: 'Codex',
    },
    {
      who: 'Nova',
      color: 'blue',
      text: 'Đã nhận UI. @Sol chia sẻ giúp mình tiêu chí chấm điểm.',
      tag: 'Codex',
    },
    {
      who: 'Sol',
      color: 'peach',
      text: 'Đã đọc đề và gửi nguồn vào knowledge của nhóm.',
      tag: 'Codex',
    },
    {
      who: 'Ari',
      color: 'mint',
      text: 'Bạn dẫn đội. Chúng mình biến ý tưởng thành sản phẩm.',
      tag: '@Bạn',
    },
  ],
  handoff: [
    { who: 'Ari', color: 'mint', text: 'Usage còn 49%. Mình đã dừng nhận việc mới.', tag: 'Quota' },
    {
      who: 'Ari',
      color: 'mint',
      text: 'Checkpoint đã push. Bàn giao schema, tests và bước tiếp theo.',
      tag: 'Git',
    },
    {
      who: 'Nova',
      color: 'blue',
      text: '@Ari đã đọc checkpoint. Mình tiếp quản phần API.',
      tag: 'Handoff',
    },
    {
      who: 'Sol',
      color: 'peach',
      text: 'Mình giữ phần research, không nhận trùng scope của Nova.',
      tag: 'Codex',
    },
  ],
  review: [
    {
      who: 'BOT',
      color: 'amber',
      text: 'Phát hiện trong bản demo: route admin thiếu kiểm tra quyền.',
      tag: 'Review demo',
    },
    {
      who: 'Ari',
      color: 'mint',
      text: '@BOT mình phụ trách route này. Đã nhận sửa và bổ sung test.',
      tag: 'Codex',
    },
    {
      who: 'Nova',
      color: 'blue',
      text: '@Ari UI đã sẵn sàng. Mình chờ API để kiểm tra tích hợp.',
      tag: 'Codex',
    },
    {
      who: 'BOT',
      color: 'amber',
      text: 'Kiểm tra lại trước khi đề nghị chủ dự án duyệt merge.',
      tag: '@Bạn',
    },
  ],
};
type Scenario = keyof typeof scenarios;
type DemoMessage = (typeof scenarios)[Scenario][number];
function ScrollMessage({
  message,
  index,
  progress,
  instant,
}: {
  message: DemoMessage;
  index: number;
  progress: MotionValue<number>;
  instant: boolean;
}) {
  const { t } = usePortalLocale();
  const [reaction, setReaction] = useState('');
  const [active, setActive] = useState(instant);
  const start = 0.08 + index * 0.135;
  const opacity = useTransform(progress, [start, start + 0.11], [0, 1]);
  const y = useTransform(progress, [start, start + 0.11], [42, 0]);
  const scale = useTransform(progress, [start, start + 0.11], [0.91, 1]);
  useMotionValueEvent(opacity, 'change', (value) => setActive(value > 0.85));
  return (
    <motion.article
      className={'kp-message ' + message.color}
      data-scroll-message={index}
      style={instant ? { opacity: 1, y: 0, scale: 1 } : { opacity, y, scale }}
    >
      <span className="kp-avatar">
        {message.who === 'BOT' ? <ShieldCheck size={18} /> : t(message.who).slice(0, 1)}
      </span>
      <div>
        <div className="kp-message-who">
          <strong>{t(message.who)}</strong>
          <span>{t(message.tag)}</span>
          <time dateTime={'2026-11-04T09:' + String(30 + index) + ':00+07:00'}>
            09:{30 + index}
          </time>
        </div>
        <p>
          {t(message.text)
            .split(/(@[\p{L}\w]+)/u)
            .map((part, i) => (part.startsWith('@') ? <mark key={i}>{part}</mark> : part))}
        </p>
        {message.color !== 'human' && (
          <div
            className="kp-reactions"
            role="group"
            aria-label={t('Phản hồi demo cho') + ' ' + message.who}
          >
            {[
              { key: 'heart', label: t('Đã hiểu'), Icon: Heart },
              { key: 'up', label: t('Đồng ý'), Icon: ThumbsUp },
              { key: 'down', label: t('Không đồng ý'), Icon: ThumbsDown },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                tabIndex={instant || active ? 0 : -1}
                title={t(label)}
                aria-label={t(label)}
                aria-pressed={reaction === key}
                onClick={() => setReaction(reaction === key ? '' : key)}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.article>
  );
}
function DemoSessions() {
  const { t } = usePortalLocale();
  const [selected, setSelected] = useState(0);
  return (
    <aside
      id="demo-session-graph"
      className="kp-session-preview"
      aria-label={t('Graph session minh họa')}
    >
      <div className="kp-session-preview-title">
        <strong>4 sessions</strong>
        <span>3 Codex</span>
      </div>
      <svg
        viewBox="0 0 240 260"
        role="group"
        aria-label={t('Bốn session nối với cùng dự án; Ari có hai session')}
      >
        <g className="kp-session-edges">
          <path d="M120 125L55 48M120 125L186 62M120 125L56 206M120 125L183 210" />
        </g>
        <circle cx="120" cy="125" r="25" className="kp-session-hub" />
        <text x="120" y="129" textAnchor="middle">
          Aurora
        </text>
        {[
          { x: 55, y: 48, name: 'API', owner: 'Ari' },
          { x: 186, y: 62, name: 'Tests', owner: 'Ari' },
          { x: 56, y: 206, name: 'UI', owner: 'Nova' },
          { x: 183, y: 210, name: 'Research', owner: 'Sol' },
        ].map((node, i) => (
          <g
            key={node.name}
            role="button"
            tabIndex={0}
            aria-label={'Session ' + node.name + ' ' + t('của') + ' ' + node.owner}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelected(i);
              }
            }}
            className={selected === i ? 'is-selected' : ''}
          >
            <rect
              x={node.x - 31}
              y={node.y - 23}
              width={62}
              height={63}
              fill="transparent"
              pointerEvents="all"
            />
            <circle cx={node.x} cy={node.y} r="17" />
            <text x={node.x} y={node.y + 4} textAnchor="middle">
              {node.owner[0]}
            </text>
            <text x={node.x} y={node.y + 34} textAnchor="middle">
              {node.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="kp-session-selected">
        <strong>{['API · Ari', 'Tests · Ari', 'UI · Nova', 'Research · Sol'][selected]}</strong>
        <span>{t([t('Đang làm'), t('Đang kiểm tra'), t('Chờ API'), t('Hoàn tất')][selected])}</span>
      </div>
    </aside>
  );
}
function ScrollStory({ scenario, index }: { scenario: Scenario; index: number }) {
  const { t, locale } = usePortalLocale();
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [overflow, setOverflow] = useState(0);
  const instant = !!reduced;
  const { scrollYProgress } = useScroll({ target: section, offset: ['start 75%', 'end 90%'] });
  const listY = useTransform(scrollYProgress, [0, 0.48, 0.94, 1], [0, 0, -overflow, -overflow]);
  useEffect(() => {
    const measure = () =>
      setOverflow(
        Math.max(0, (list.current?.scrollHeight || 0) - (viewport.current?.clientHeight || 0)),
      );
    const observer = new ResizeObserver(measure);
    if (list.current) observer.observe(list.current);
    if (viewport.current) observer.observe(viewport.current);
    measure();
    return () => observer.disconnect();
  }, [locale, instant, sessionsOpen]);
  const copy = {
    plan: {
      label: t('Chia việc'),
      title: t('Một ý tưởng. Cả đội vào việc.'),
    },
    handoff: {
      label: t('Bàn giao'),
      title: t('Đổi người. Không mất mạch.'),
    },
    review: {
      label: 'Review',
      title: t('Cùng sửa. Bạn duyệt.'),
    },
  }[scenario];
  return (
    <section
      ref={section}
      id={'demo-' + scenario}
      data-story={scenario}
      className={'kp-scroll-story ' + (instant ? 'show-all' : '')}
      aria-labelledby={'story-title-' + scenario}
    >
      <div className="kp-story-sticky">
        <div className="kp-chat-layout">
          <div className="kp-chat-intro">
            <div className="kp-story-kicker">
              <span>0{index + 1}</span>
              <h2 id={'story-title-' + scenario}>{t(copy.label)}</h2>
            </div>
            <h3>{t(copy.title)}</h3>
            {scenario === 'plan' && (
              <button
                className="kp-session-toggle"
                aria-pressed={sessionsOpen}
                aria-controls="demo-session-graph"
                onClick={() => setSessionsOpen(!sessionsOpen)}
              >
                <Network size={16} />
                Sessions
              </button>
            )}
          </div>
          <div className="kp-chat-window glass">
            <div className={'kp-conversation-body ' + (sessionsOpen ? 'with-sessions' : '')}>
              <div className="kp-story-message-viewport" ref={viewport}>
                <motion.div
                  ref={list}
                  className="kp-messages"
                  aria-label={t('Tin nhắn minh họa, không phải hoạt động thật')}
                  style={instant ? { y: 0 } : { y: listY }}
                >
                  {scenarios[scenario].map((message, i) => (
                    <ScrollMessage
                      key={i}
                      message={message}
                      index={i}
                      progress={scrollYProgress}
                      instant={instant}
                    />
                  ))}
                </motion.div>
              </div>
              {sessionsOpen && <DemoSessions />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
function MessagingDemo() {
  const { t } = usePortalLocale();
  return (
    <div className="kp-chat-section" id="neralu">
      <div className="kp-section-heading">
        <h2>{t('Neralu · Chat dự án')}</h2>
      </div>
      {(['plan', 'handoff', 'review'] as Scenario[]).map((scenario, index) => (
        <ScrollStory key={scenario} scenario={scenario} index={index} />
      ))}
    </div>
  );
}

function WorkspaceDemo() {
  const { t } = usePortalLocale();
  const [step, setStep] = useState(0);
  const steps = [
    {
      label: t('Thêm Codex'),
      title: t('Cả đội ở đây.'),
    },
    {
      label: t('Tạo dự án'),
      title: t('Một mục tiêu chung.'),
    },
    {
      label: t('Dẫn đội'),
      title: t('Bạn quyết định.'),
    },
  ];
  return (
    <section className="kp-guide" id="workflow" aria-labelledby="workflow-title">
      <h2 id="workflow-title">{t('Từ ý tưởng đến cùng làm.')}</h2>
      <div className="kp-guide-tabs" role="tablist" aria-label={t('Cách dùng Kivuno')}>
        {steps.map((item, i) => (
          <button
            key={item.label}
            role="tab"
            id={`guide-tab-${i}`}
            aria-selected={step === i}
            aria-controls="guide-panel"
            onClick={() => setStep(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const next = (step + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                setStep(next);
                document.getElementById(`guide-tab-${next}`)?.focus();
              }
            }}
            tabIndex={step === i ? 0 : -1}
          >
            <span>{i + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="kp-guide-panel glass"
        id="guide-panel"
        role="tabpanel"
        aria-labelledby={`guide-tab-${step}`}
      >
        <div className="kp-guide-copy">
          <h3>{steps[step].title}</h3>
        </div>
        <div className="kp-mini-workspace" aria-label={t('Minh họa workspace')}>
          <div className="kp-mini-bar">
            <img src="/kivuno.svg" alt="" />
            <span>{['Team', 'Aurora', 'Reviews'][step]}</span>
          </div>
          {step === 0 ? (
            <div className="kp-team-list">
              {['Ari', 'Nova', 'Sol'].map((name, i) => (
                <div key={name}>
                  <span className={`kp-avatar ${i === 1 ? 'blue' : ''}`}>{name[0]}</span>
                  <strong>{name}</strong>
                  <span>{i === 2 ? 'Offline' : 'Online'}</span>
                  <Check size={16} />
                </div>
              ))}
            </div>
          ) : step === 1 ? (
            <div className="kp-scope-list">
              {[
                ['API', 'Ari', 'server/'],
                [t('Giao diện'), 'Nova', 'src/'],
                [t('Nghiên cứu'), 'Sol', 'docs/'],
              ].map(([task, name, scope]) => (
                <div key={task}>
                  <Cpu size={17} />
                  <strong>{task}</strong>
                  <code>{scope}</code>
                  <span>{name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="kp-review-demo">
              <div>
                <GitCommitHorizontal size={20} />
                <strong>{t('Checkpoint sẵn sàng')}</strong>
              </div>
              <code>
                <span>{t('+ Kiểm tra quyền trước khi thực thi')}</span>
                <span>{t('+ Thêm test cho trường hợp bị từ chối')}</span>
              </code>
              <span className="kp-review-label">
                <ShieldCheck size={15} />
                {t('Chờ bạn duyệt')}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PortalContent() {
  const { t, locale } = usePortalLocale();
  const [release, setRelease] = useState<Release | null>(null);
  const [releaseError, setReleaseError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(
    initialCode || new URLSearchParams(location.search).has('login') ? 'login' : null,
  );
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [curtain, setCurtain] = useState<'cover' | 'reveal' | null>(null);
  const [scramble, setScramble] = useState(0);
  const [footerArtReady, setFooterArtReady] = useState(false);
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const downloadDialog = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 800], [0, -110]);
  const heroOpacity = useTransform(scrollY, [0, 660], [1, 0]);
  const { scrollYProgress: footerProgress } = useScroll({
    target: footer,
    offset: ['start end', 'end end'],
  });
  const footerOpacity = useTransform(footerProgress, [0, 0.75], [0.15, 1]);
  useMotionValueEvent(scrollY, 'change', (value) => setDocked(value > window.innerHeight * 0.48));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    // Observe the footer's flow box: native lazy loading misses its clipped,
    // fixed-position reveal image in Chromium.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setFooterArtReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '700px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/desktop/release', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t('Chưa tải được thông tin bản cài.'));
        const value = (await response.json()) as Release;
        if (typeof value.version !== 'string' || typeof value.available !== 'boolean')
          throw new Error(t('Bản cài chưa sẵn sàng.'));
        for (const item of [value, ...Object.values(value.platforms || {})])
          if (item?.url && new URL(item.url, location.origin).origin !== location.origin)
            throw new Error(t('Đường tải bản cài không hợp lệ.'));
        setRelease(value);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setReleaseError(error.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!downloadsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    downloadDialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDownloadsOpen(false);
      if (event.key !== 'Tab') return;
      const items = [
        ...(downloadDialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],summary',
        ) || []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [downloadsOpen]);
  function home() {
    if (curtain) return;
    const reveal = () => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      setDocked(false);
      setScramble((v) => v + 1);
      document.getElementById('title-screen')?.focus({ preventScroll: true });
    };
    if (reduced) {
      reveal();
      return;
    }
    setCurtain('cover');
    timers.current.push(
      setTimeout(() => {
        reveal();
        setCurtain('reveal');
      }, 530),
    );
    timers.current.push(setTimeout(() => setCurtain(null), 1100));
  }
  const download = (platform: Platform) =>
    release?.platforms?.[platform] || (platform === 'windows' ? release : null);
  const gestures = reduced
    ? {}
    : { whileHover: { scale: 1.045, y: -2 }, whileTap: { scale: 0.94, y: 0 }, transition: spring };
  function downloadLink(platform: Platform, hero = false) {
    const item = download(platform);
    const content = (
      <>
        <span className="kp-os-icon">
          {platform === 'windows' ? (
            <span className="kp-windows-symbol">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <Server size={18} />
          )}
        </span>
        <span>{platformNames[platform]}</span>
        <ArrowDownToLine size={18} />
      </>
    );
    const className = `kp-download-link ${platform === 'windows' ? 'primary' : ''} ${hero ? 'hero-download' : ''}`;
    return item?.available && item.url ? (
      <motion.a
        {...gestures}
        className={className}
        href={item.url}
        aria-label={t('Tải Kivuno cho') + ' ' + platformNames[platform]}
      >
        {content}
      </motion.a>
    ) : (
      <button
        className={className}
        disabled
        aria-label={platformNames[platform] + ' ' + t('chưa có bản tải')}
        title={t('Bản cài chưa sẵn sàng')}
      >
        {content}
      </button>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="kp-portal">
        <div className="kp-page" inert={!!authMode || downloadsOpen}>
          <motion.nav
            layout
            className={`kp-dock ${docked ? 'is-docked glass' : ''}`}
            aria-label="Menu Kivuno"
            transition={reduced ? { duration: 0 } : spring}
          >
            <motion.button
              {...gestures}
              layout
              className="kp-logo"
              aria-label={t('Kivuno — về màn hình đầu')}
              onClick={home}
            >
              <img src="/kivuno.svg" alt="" />
            </motion.button>
            <AnimatePresence initial={false}>
              {docked && (
                <motion.button
                  key="download"
                  {...gestures}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="kp-nav-button"
                  aria-label={t('Tải app')}
                  title={t('Tải app')}
                  onClick={() => setDownloadsOpen(true)}
                >
                  <ArrowDownToLine size={20} />
                </motion.button>
              )}
            </AnimatePresence>
            <motion.div layout className="kp-auth-nav">
              <PortalLanguage />
              <motion.button
                {...gestures}
                className="kp-nav-button"
                aria-label={t('Đăng nhập')}
                title={t('Đăng nhập')}
                onClick={() => setAuthMode('login')}
              >
                <LogIn size={19} />
                <span>{t('Đăng nhập')}</span>
              </motion.button>
              <motion.button
                {...gestures}
                className="kp-nav-button kp-nav-signup"
                aria-label={t('Đăng ký')}
                title={t('Đăng ký')}
                onClick={() => setAuthMode('signup')}
              >
                <UserPlus size={19} />
                <span>{t('Đăng ký')}</span>
              </motion.button>
            </motion.div>
          </motion.nav>
          <main className="kp-content">
            <section className="kp-hero" aria-label="Kivuno">
              <div className="kp-light-field" aria-hidden="true">
                <div className="kp-light kp-light-a" />
                <div className="kp-light kp-light-b" />
                <div className="kp-glass-orbit orbit-a" />
                <div className="kp-glass-orbit orbit-b" />
              </div>
              <motion.div
                className="kp-hero-core"
                style={reduced ? {} : { y: heroY, opacity: heroOpacity }}
              >
                <h1 id="title-screen" aria-label="Kivuno" tabIndex={-1}>
                  <Scramble iteration={scramble} />
                </h1>
                <div className="kp-hero-downloads">
                  {downloadLink('windows', true)}
                  {downloadLink('linux', true)}
                </div>
                {releaseError && (
                  <p className="kp-error" role="status">
                    {t(releaseError)}
                  </p>
                )}
              </motion.div>
              <a className="kp-scroll-cue" href="#neralu" aria-label={t('Khám phá Neralu')}>
                <ChevronDown size={21} />
              </a>
            </section>
            <div className="kp-below-fold">
              <MessagingDemo />
              <section className="kp-features" aria-label={t('Tính năng Kivuno')}>
                <article className="kp-feature machines">
                  <div className="kp-feature-copy">
                    <h2>
                      {t('Một đội.')}
                      <br />
                      {t('Nhiều máy.')}
                    </h2>
                  </div>
                  <div className="kp-machine-map glass" aria-label={t('Minh họa kết nối máy')}>
                    <div className="kp-machine-node lead">
                      <Laptop />
                      <span>{t('Máy của bạn')}</span>
                    </div>
                    <span className="kp-wire wire-a" />
                    <span className="kp-wire wire-b" />
                    <div className="kp-machine-node remote">
                      <Server />
                      <span>{t('Máy SSH')}</span>
                    </div>
                    <div className="kp-machine-node extra">
                      <Monitor />
                      <span>{t('Máy đồng đội')}</span>
                    </div>
                  </div>
                </article>
                <article className="kp-feature handoff">
                  <div className="kp-handoff-visual glass">
                    <div className="kp-handoff-ring">
                      <svg viewBox="0 0 120 120" aria-hidden="true">
                        <circle cx="60" cy="60" r="52" />
                        <circle cx="60" cy="60" r="52" className="progress" />
                      </svg>
                      <span>
                        50<small>%</small>
                      </span>
                    </div>
                    <div>
                      <strong>{t('Giữ sức cho cả đội.')}</strong>
                      <div className="kp-handoff-route">
                        <span>Ari</span>
                        <GitCommitHorizontal size={25} />
                        <ArrowRight size={17} />
                        <span>Nova</span>
                      </div>
                    </div>
                  </div>
                  <div className="kp-feature-copy">
                    <h2>
                      {t('Công việc tiếp tục.')}
                      <br />
                      {t('Context ở lại.')}
                    </h2>
                  </div>
                </article>
                <article className="kp-feature aegis" id="aegis">
                  <div className="kp-feature-copy">
                    <h2>{t('Quyền do bạn giữ.')}</h2>
                  </div>
                  <div
                    className="kp-aegis-proof glass"
                    aria-label={t('AEGIS · Avalanche Fuji testnet tùy chọn')}
                  >
                    <div className="kp-aegis-emblem">
                      <Fingerprint size={52} strokeWidth={1.1} />
                    </div>
                    <div>
                      <strong>AEGIS</strong>
                      <span>Avalanche Fuji</span>
                    </div>
                    <div className="kp-proof-states">
                      <span>
                        <ShieldCheck size={16} />
                        {t('Cấp quyền')}
                      </span>
                      <span>
                        <GitCommitHorizontal size={16} />
                        {t('Duyệt diff')}
                      </span>
                      <span>
                        <CheckCheck size={16} />
                        {t('Xác minh')}
                      </span>
                    </div>
                  </div>
                </article>
              </section>
              <WorkspaceDemo />
              <UpdatePatches />
            </div>
          </main>
          <footer className="kp-footer" ref={footer}>
            <motion.div
              className="kp-footer-inner"
              style={reduced ? {} : { opacity: footerOpacity }}
            >
              {footerArtReady && (
                <img
                  className="kp-hivemind-art"
                  src="/art/kivuno-hivemind.png"
                  alt={t(
                    'Tranh biểu hiện trừu tượng: những nét mint và trắng ngà vừa kết nối vừa tách rời quanh một khoảng trống, gợi nhiều cá thể cùng suy nghĩ.',
                  )}
                  decoding="async"
                  width="1536"
                  height="1024"
                />
              )}
              <div className="kp-footer-top">
                <h2>
                  {t('Đến lượt bạn')}
                  <br />
                  {t('dẫn đội.')}
                </h2>
                <motion.button
                  {...gestures}
                  className="kp-footer-cta"
                  onClick={() => setAuthMode('signup')}
                >
                  <Sparkles size={22} />
                  {t('Bắt đầu')}
                  <ArrowRight size={22} />
                </motion.button>
              </div>
              <div className="kp-footer-bottom">
                <span>Kivuno · NoSleepClub</span>
                <span>{release?.version || '0.8.2'}</span>
                <a href="#updates">Update patches</a>
                <button onClick={() => setDownloadsOpen(true)}>{t('Bản cài & checksum')}</button>
                <button onClick={home}>{t('Về đầu trang')}</button>
              </div>
            </motion.div>
          </footer>
        </div>
        <AnimatePresence>
          {authMode && (
            <PortalAuth
              key="auth"
              mode={authMode}
              activationCode={initialCode}
              onClose={() => setAuthMode(null)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {downloadsOpen && (
            <motion.div
              className="kp-modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(e) => {
                if (e.target === e.currentTarget) setDownloadsOpen(false);
              }}
            >
              <motion.div
                ref={downloadDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="download-title"
                className="kp-download-dialog glass"
                initial={{ y: reduced ? 0 : 20, scale: reduced ? 1 : 0.96 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={spring}
              >
                <div className="kp-dialog-heading">
                  <h2 id="download-title">{t('Tải Kivuno')}</h2>
                  <button
                    className="kp-close"
                    aria-label={t('Đóng tải app')}
                    onClick={() => setDownloadsOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </div>
                {downloadLink('windows')}
                {downloadLink('linux')}
                <details>
                  <summary>{t('Thông tin bản cài')}</summary>
                  <p>{t('Windows x64 · Chưa ký chứng chỉ')}</p>
                  <p>{t('Linux x64 · Cần Git, keyring và desktop Linux hỗ trợ sandbox.')}</p>
                  {(['windows', 'linux'] as Platform[]).map(
                    (platform) =>
                      download(platform)?.sha256 && (
                        <div key={platform}>
                          <strong>{platformNames[platform]}</strong>
                          <code>{download(platform)!.sha256}</code>
                        </div>
                      ),
                  )}
                </details>
                {releaseError && (
                  <p role="alert" className="kp-error">
                    {releaseError}
                  </p>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {curtain && (
          <div className="kp-pixel-curtain" aria-hidden="true">
            {Array.from({ length: 96 }, (_, i) => (
              <motion.i
                key={i}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{
                  opacity: curtain === 'cover' ? 1 : 0,
                  scale: curtain === 'cover' ? 1.03 : 0.92,
                }}
                transition={{
                  duration: 0.16,
                  delay: ((i % 12) + Math.floor(i / 12)) * 0.014,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

export default function Portal() {
  return (
    <PortalLocaleProvider>
      <PortalContent />
    </PortalLocaleProvider>
  );
}
