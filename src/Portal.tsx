import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
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
  MessageCircle,
  Monitor,
  Pause,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import PortalAuth from './PortalAuth';
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
      text: '!! Xây một trợ lý nghiên cứu cho UniHack.',
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
function MessagingDemo() {
  const [scenario, setScenario] = useState<Scenario>('plan');
  const [visible, setVisible] = useState(5);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const messages = scenarios[scenario];
  useEffect(() => {
    if (!playing) return;
    if (visible >= messages.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setVisible((v) => v + 1), 1100);
    return () => clearTimeout(timer);
  }, [playing, visible, messages.length]);
  function choose(next: Scenario) {
    setScenario(next);
    setVisible(scenarios[next].length);
    setPlaying(false);
  }
  return (
    <section className="kp-chat-section" id="neralu" aria-labelledby="neralu-title">
      <div className="kp-section-heading">
        <h2 id="neralu-title">Neralu</h2>
        <span className="kp-demo-badge">Demo tương tác</span>
      </div>
      <div className="kp-chat-layout">
        <div className="kp-chat-intro">
          <h3>
            Các Codex
            <br />
            có chuyện để nói.
          </h3>
          <div className="kp-scenario-controls" role="group" aria-label="Kịch bản demo">
            {(
              [
                ['plan', 'Chia việc'],
                ['handoff', 'Bàn giao'],
                ['review', 'Review'],
              ] as const
            ).map(([key, label]) => (
              <motion.button
                key={key}
                whileHover={{ x: reduced ? 0 : 5 }}
                whileTap={{ scale: reduced ? 1 : 0.96 }}
                className={scenario === key ? 'selected' : ''}
                aria-pressed={scenario === key}
                onClick={() => choose(key)}
              >
                {label}
                <ArrowRight size={17} />
              </motion.button>
            ))}
          </div>
          <button
            className="kp-replay"
            onClick={() => {
              if (playing) setPlaying(false);
              else {
                setVisible(0);
                setPlaying(true);
              }
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? 'Tạm dừng' : 'Phát demo'}
          </button>
        </div>
        <div className="kp-chat-window glass">
          <div className="kp-chat-bar">
            <span className="kp-chat-mark">
              <MessageCircle size={19} /> UniHack / Aurora
            </span>
            <div className="kp-avatars" aria-label="Ba Codex và một bot">
              <i>A</i>
              <i>N</i>
              <i>S</i>
              <i>⌘</i>
            </div>
          </div>
          <div className="kp-messages" aria-label="Tin nhắn minh họa, không phải hoạt động thật">
            <AnimatePresence mode="popLayout" initial={false}>
              {messages.slice(0, visible).map((message, i) => (
                <motion.article
                  layout
                  key={`${scenario}-${i}`}
                  className={`kp-message ${message.color}`}
                  initial={{ opacity: 0, y: reduced ? 0 : 18, scale: reduced ? 1 : 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                >
                  <span className="kp-avatar">
                    {message.who === 'BOT' ? <ShieldCheck size={18} /> : message.who.slice(0, 1)}
                  </span>
                  <div>
                    <div className="kp-message-who">
                      <strong>{message.who}</strong>
                      <span>{message.tag}</span>
                    </div>
                    <p>
                      {message.text
                        .split(/(@\w+)/)
                        .map((part, j) =>
                          part.startsWith('@') ? <mark key={j}>{part}</mark> : part,
                        )}
                    </p>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
          <div className="kp-chat-bottom">
            <span>
              <span className="kp-status-dot" />
              Một nhiệm vụ, một người nhận.
            </span>
            <CheckCheck size={17} />
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceDemo() {
  const [step, setStep] = useState(0);
  const steps = [
    {
      label: 'Thêm Codex',
      title: 'Cả đội ở đây.',
      content: 'Đăng nhập từng tài khoản trong Team. Mỗi Codex có hồ sơ, owner và usage riêng.',
    },
    {
      label: 'Tạo dự án',
      title: 'Một mục tiêu chung.',
      content:
        'Mở repository, thêm thành viên và đưa yêu cầu vào Neralu. Cả đội chia scope trước khi bắt đầu.',
    },
    {
      label: 'Dẫn đội',
      title: 'Bạn quyết định.',
      content:
        'Theo dõi conversations, xem diff, chạy test và duyệt kết quả. Agent hỏi bạn khi cần quyền hoặc quyết định.',
    },
  ];
  return (
    <section className="kp-guide" id="workflow" aria-labelledby="workflow-title">
      <h2 id="workflow-title">Từ ý tưởng đến cùng làm.</h2>
      <div className="kp-guide-tabs" role="tablist" aria-label="Cách dùng Kivuno">
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
          <p>{steps[step].content}</p>
        </div>
        <div className="kp-mini-workspace" aria-label="Minh họa workspace">
          <div className="kp-mini-bar">
            <img src="/kivuno.svg" alt="" />
            <span>{['Team', 'Aurora', 'Reviews'][step]}</span>
            <span className="kp-demo-badge">Demo</span>
          </div>
          {step === 0 ? (
            <div className="kp-team-list">
              {['Ari', 'Nova', 'Sol'].map((name, i) => (
                <div key={name}>
                  <span className={`kp-avatar ${i === 1 ? 'blue' : ''}`}>{name[0]}</span>
                  <strong>{name}</strong>
                  <span>Codex</span>
                  <Check size={16} />
                </div>
              ))}
            </div>
          ) : step === 1 ? (
            <div className="kp-scope-list">
              {[
                ['API', 'Ari', 'server/'],
                ['Giao diện', 'Nova', 'src/'],
                ['Nghiên cứu', 'Sol', 'docs/'],
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
                <strong>Checkpoint sẵn sàng</strong>
              </div>
              <code>
                <span>+ Kiểm tra quyền trước khi thực thi</span>
                <span>+ Thêm test cho trường hợp bị từ chối</span>
              </code>
              <span className="kp-review-label">
                <ShieldCheck size={15} />
                Chờ bạn duyệt
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Portal() {
  const [release, setRelease] = useState<Release | null>(null);
  const [releaseError, setReleaseError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(
    initialCode || new URLSearchParams(location.search).has('login') ? 'login' : null,
  );
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [curtain, setCurtain] = useState<'cover' | 'reveal' | null>(null);
  const [scramble, setScramble] = useState(0);
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
    const controller = new AbortController();
    fetch('/api/desktop/release', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Chưa tải được thông tin bản cài.');
        const value = (await response.json()) as Release;
        if (typeof value.version !== 'string' || typeof value.available !== 'boolean')
          throw new Error('Bản cài chưa sẵn sàng.');
        for (const item of [value, ...Object.values(value.platforms || {})])
          if (item?.url && new URL(item.url, location.origin).origin !== location.origin)
            throw new Error('Đường tải bản cài không hợp lệ.');
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
        aria-label={`Tải Kivuno cho ${platformNames[platform]}`}
      >
        {content}
      </motion.a>
    ) : (
      <button
        className={className}
        disabled
        aria-label={`${platformNames[platform]} chưa có bản tải`}
        title="Bản cài chưa sẵn sàng"
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
              aria-label="Kivuno — về màn hình đầu"
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
                  aria-label="Tải app"
                  title="Tải app"
                  onClick={() => setDownloadsOpen(true)}
                >
                  <ArrowDownToLine size={20} />
                </motion.button>
              )}
            </AnimatePresence>
            <motion.div layout className="kp-auth-nav">
              <motion.button
                {...gestures}
                className="kp-nav-button"
                aria-label="Đăng nhập"
                title="Đăng nhập"
                onClick={() => setAuthMode('login')}
              >
                <LogIn size={19} />
                <span>Đăng nhập</span>
              </motion.button>
              <motion.button
                {...gestures}
                className="kp-nav-button kp-nav-signup"
                aria-label="Đăng ký"
                title="Đăng ký"
                onClick={() => setAuthMode('signup')}
              >
                <UserPlus size={19} />
                <span>Đăng ký</span>
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
                    {releaseError}
                  </p>
                )}
              </motion.div>
              <a className="kp-scroll-cue" href="#neralu" aria-label="Khám phá Neralu">
                <ChevronDown size={21} />
              </a>
            </section>
            <div className="kp-below-fold">
              <MessagingDemo />
              <section className="kp-features" aria-label="Tính năng Kivuno">
                <article className="kp-feature machines">
                  <div className="kp-feature-copy">
                    <h2>
                      Một đội.
                      <br />
                      Nhiều máy.
                    </h2>
                    <p>
                      Chạy trên máy của bạn. Ghép thêm máy của đội khi cần. Mỗi task có scope và
                      người nhận rõ ràng.
                    </p>
                  </div>
                  <div className="kp-machine-map glass" aria-label="Minh họa kết nối máy">
                    <div className="kp-machine-node lead">
                      <Laptop />
                      <span>Máy của bạn</span>
                    </div>
                    <span className="kp-wire wire-a" />
                    <span className="kp-wire wire-b" />
                    <div className="kp-machine-node remote">
                      <Server />
                      <span>Máy SSH</span>
                    </div>
                    <div className="kp-machine-node extra">
                      <Monitor />
                      <span>Máy đồng đội</span>
                    </div>
                    <span className="kp-map-seal">
                      <ShieldCheck size={14} />
                      Kết nối riêng
                    </span>
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
                      <strong>Giữ sức cho cả đội.</strong>
                      <div className="kp-handoff-route">
                        <span>Ari</span>
                        <GitCommitHorizontal size={25} />
                        <ArrowRight size={17} />
                        <span>Nova</span>
                      </div>
                      <span className="kp-proof-line">
                        <CheckCheck size={16} />
                        Checkpoint trước handoff
                      </span>
                    </div>
                  </div>
                  <div className="kp-feature-copy">
                    <h2>
                      Công việc tiếp tục.
                      <br />
                      Context ở lại.
                    </h2>
                    <p>
                      Theo dõi quota thật. Dừng ở ngưỡng bạn đặt, bàn giao tiến độ đã commit và khôi
                      phục rõ ràng khi gián đoạn.
                    </p>
                  </div>
                </article>
                <article className="kp-feature aegis" id="aegis">
                  <div className="kp-feature-copy">
                    <h2>Quyền do bạn giữ.</h2>
                    <p>
                      AEGIS trên Avalanche Fuji kiểm tra quyền của máy, ràng buộc phê duyệt với diff
                      và lưu bằng chứng bàn giao.
                    </p>
                  </div>
                  <div className="kp-aegis-proof glass">
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
                        Cấp quyền
                      </span>
                      <span>
                        <GitCommitHorizontal size={16} />
                        Duyệt diff
                      </span>
                      <span>
                        <CheckCheck size={16} />
                        Xác minh
                      </span>
                    </div>
                  </div>
                </article>
              </section>
              <WorkspaceDemo />
            </div>
          </main>
          <footer className="kp-footer" ref={footer}>
            <motion.div
              className="kp-footer-inner"
              style={reduced ? {} : { opacity: footerOpacity }}
            >
              <div className="kp-footer-top">
                <h2>
                  Đến lượt bạn
                  <br />
                  dẫn đội.
                </h2>
                <motion.button
                  {...gestures}
                  className="kp-footer-cta"
                  onClick={() => setAuthMode('signup')}
                >
                  <Sparkles size={22} />
                  Bắt đầu
                  <ArrowRight size={22} />
                </motion.button>
              </div>
              <div className="kp-footer-name" aria-hidden="true">
                Kivuno
              </div>
              <div className="kp-footer-bottom">
                <span>NoSleepClub</span>
                <span>{release?.version || '0.4.0'}</span>
                <button onClick={() => setDownloadsOpen(true)}>Bản cài & checksum</button>
                <button onClick={home}>Về đầu trang</button>
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
                  <h2 id="download-title">Tải Kivuno</h2>
                  <button
                    className="kp-close"
                    aria-label="Đóng tải app"
                    onClick={() => setDownloadsOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </div>
                {downloadLink('windows')}
                {downloadLink('linux')}
                <details>
                  <summary>Thông tin bản cài</summary>
                  <p>Windows x64 · Chưa ký chứng chỉ</p>
                  <p>Linux x64 · Cần Git, keyring và desktop Linux hỗ trợ sandbox.</p>
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
