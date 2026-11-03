import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, BookOpen, X } from 'lucide-react';
import './guide.css';

type Step = { target: string; title: string; text: string };
type Stage =
  'hosted' | 'mesh' | 'sessions' | 'team' | 'workroom' | 'tasks' | 'reviews' | 'settings';
const memory = new Set<string>();
const prefix = 'relay-guide-v2:';
const seen = (key: string) => {
  try {
    return memory.has(key) || sessionStorage.getItem(prefix + key) === 'seen';
  } catch {
    return memory.has(key);
  }
};
const remember = (key: string) => {
  memory.add(key);
  try {
    sessionStorage.setItem(prefix + key, 'seen');
  } catch {
    /* Tab memory still works. */
  }
};
const definitions: Record<Stage, Step[]> = {
  hosted: [
    {
      target: 'setup',
      title: '1. Khởi động runner',
      text: 'Máy này cần Node 24.22.1+, Git và Codex CLI. Sao chép các lệnh, chạy trong terminal và giữ npm start đang hoạt động. Repo private yêu cầu quyền GitHub của bạn.',
    },
    {
      target: 'port',
      title: '2. Chọn cổng',
      text: 'Giữ 4317 nếu dùng cấu hình mặc định. Nếu runner dùng RELAY_PORT khác, nhập đúng cổng đó. Runner cần chạy trên cùng máy đang dùng trình duyệt.',
    },
    {
      target: 'runner-connect',
      title: '3. Kết nối runner',
      text: 'Bấm Kết nối runner, cho phép popup rồi chọn Cho phép kết nối trong cửa sổ local. Giữ cửa sổ đó mở. MESH và Sessions hoạt động ngay trong tab Vercel; tài khoản và worker nằm trên máy.',
    },
  ],
  mesh: [
    {
      target: 'groups',
      title: '1. Chọn nhóm dự án',
      text: 'Mỗi project có group MESH riêng. Chưa có project thì chọn Connect project, nhập đường dẫn tuyệt đối tới Git repository đã có commit đầu tiên.',
    },
    {
      target: 'mesh-input',
      title: '2. Nhắn cho team',
      text: 'Nhập yêu cầu ở đây. Tin người dùng được nhận một lần và mở session chỉ đọc khi có account/quota phù hợp. Dùng !! cho lệnh ưu tiên; muốn sửa code, hãy tạo session ghi file với scope rõ ràng.',
    },
    {
      target: 'mesh-usage',
      title: '3. Theo dõi usage',
      text: 'Bấm vòng tròn Usage để xem hạn mức thật của từng account. Các session dùng chung quota; còn ≤50% thì pause. Unknown nghĩa là chưa đọc được hạn mức, không phải còn đầy.',
    },
    {
      target: 'mesh-needs',
      title: '4. Xử lý Needs you',
      text: 'Chuông tập hợp câu hỏi, blocker và yêu cầu cấp quyền. Đọc nội dung trước khi quyết định; hướng dẫn này không tự trả lời hay cấp quyền.',
    },
    {
      target: 'mesh-handoff',
      title: '5. Bàn giao có xác nhận',
      text: 'Handoffs hiện checkpoint, remote commit và người nhận. Chỉ ACK sau khi đọc summary, test evidence và next steps; nguồn giữ khóa nếu push hoặc dừng worker thất bại.',
    },
  ],
  sessions: [
    {
      target: 'new-session',
      title: '1. Mở session',
      text: 'Chọn New session, account và project. Read-only dùng cho hỏi đáp/research. Workspace write cần scope file/thư mục; mỗi session có task và quyền giữ scope riêng.',
    },
    {
      target: 'session-grid',
      title: '2. Xem phiên Codex thật',
      text: 'Mỗi cửa sổ hiển thị output, lệnh, file và trạng thái. Details có PID/thread/worktree; biểu tượng mở rộng tách cửa sổ riêng. Chưa có session thì tạo sau khi đăng nhập trong Team.',
    },
    {
      target: 'session-input',
      title: '3. Gửi prompt hoặc steer',
      text: 'Nhập prompt để tiếp tục; khi turn đang chạy, Steer bổ sung chỉ dẫn vào turn đó. Một lượt thật dùng usage của account được chọn.',
    },
    {
      target: 'demo',
      title: '4. Mở demo',
      text: 'Nhập URL localhost của ứng dụng dự án rồi mở cửa sổ demo. Bạn cần chạy ứng dụng dự án trước; nút này không tự deploy hoặc mua hosting.',
    },
  ],
  team: [
    {
      target: 'add-account',
      title: '1. Thêm account',
      text: 'Tạo hồ sơ với tên và vai trò. Trong thẻ account, chọn Sign in with ChatGPT hoặc device code, đăng nhập lần lượt và kiểm tra đúng email.',
    },
    {
      target: 'account-card',
      title: '2. Kết nối capabilities',
      text: 'Refresh đọc trạng thái và capabilities thật. Import local skills là thao tác chủ động; plugins/MCP cần cấu hình trong CODEX_HOME riêng, không sao chép credentials giữa tài khoản.',
    },
    {
      target: 'account-controls',
      title: '3. Quota và owner GitHub',
      text: 'Refresh usage trước khi chạy. Owner name/email dùng làm author cho checkpoint; đây là ánh xạ bạn cấu hình, không phải chữ ký GitHub Verified. Quyền dùng dự trữ cần account, project, mức sàn và thời hạn.',
    },
  ],
  workroom: [
    {
      target: 'team-prompt',
      title: '1. Giao yêu cầu cho team',
      text: 'Run team dùng các account đã đăng nhập để đề xuất, tổng hợp workflow và chia task theo effort/dependency. Lượt model thật bắt đầu khi bạn chủ động bấm chạy.',
    },
    {
      target: 'workflow-team',
      title: '2. Theo dõi phân công',
      text: 'Hierarchy hiển thị lead, thành viên và tải công việc. Activity ghi progress/blocker; task chỉ chạy khi dependency và scope cho phép.',
    },
  ],
  tasks: [
    {
      target: 'task-actions',
      title: 'Nhiệm vụ có scope rõ ràng',
      text: 'New task cần nội dung, acceptance và phạm vi file. Dispatch chỉ giao task thủ công đủ điều kiện; các task workflow do coordinator quản lý.',
    },
  ],
  reviews: [
    {
      target: 'review-content',
      title: 'Review trước khi tích hợp',
      text: 'Mở task để xem diff, handoff và test evidence. Accept & integrate ghi vào nhánh project sau kiểm tra; Request revision gửi phản hồi. Hướng dẫn không tự duyệt command hoặc tích hợp code.',
    },
  ],
  settings: [
    {
      target: 'project-settings',
      title: 'Kết nối repository',
      text: 'Add project yêu cầu đường dẫn Git repo trên máy, đã có commit đầu tiên. Giữ nhánh chính sạch trước tích hợp. Nếu có interrupted work, xác nhận worker cũ đã dừng rồi mới Recover.',
    },
  ],
};

function Illustration() {
  const id = useId().replaceAll(':', '');
  return (
    <figure className="usage-illustration">
      <svg
        viewBox="0 0 600 205"
        role="img"
        aria-label="Minh họa: chọn project, nhắn MESH rồi theo dõi session Codex"
      >
        <defs>
          <marker
            id={id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10Z" fill="#dc2626" />
          </marker>
        </defs>
        <rect x="1" y="1" width="598" height="203" rx="16" fill="#f5faef" stroke="#d7e5cb" />
        <rect x="17" y="18" width="122" height="168" rx="9" fill="white" stroke="#dce1d6" />
        <text x="31" y="44" fontSize="14" fontWeight="700" fill="#202a1c">
          RELAY + MESH
        </text>
        {['Project', 'MESH', 'Sessions', 'Team'].map((text, i) => (
          <g key={text}>
            <rect
              x="27"
              y={57 + i * 28}
              width="102"
              height="23"
              rx="5"
              fill={i === 1 ? '#e6f4d9' : '#f4f5f2'}
            />
            <text x="37" y={73 + i * 28} fontSize="12" fill="#30382d">
              {text}
            </text>
          </g>
        ))}
        <rect x="153" y="18" width="428" height="168" rx="9" fill="white" stroke="#dce1d6" />
        <text x="170" y="43" fontSize="13" fontWeight="700" fill="#202a1c">
          Nhóm dự án
        </text>
        <rect x="169" y="56" width="394" height="46" rx="6" fill="#f4f5f2" />
        <text x="181" y="83" fontSize="12" fill="#30382d">
          Prompt → claim → Codex session → handoff
        </text>
        <rect x="169" y="115" width="290" height="49" rx="6" fill="white" stroke="#dce1d6" />
        <text x="181" y="144" fontSize="12" fill="#586052">
          Nhập yêu cầu cho team…
        </text>
        <rect x="471" y="125" width="74" height="31" rx="6" fill="#b8ee86" />
        <text x="508" y="145" textAnchor="middle" fontSize="12" fontWeight="700" fill="#21331a">
          Send
        </text>
        <path
          d="M480 74 Q550 80 518 118"
          stroke="#dc2626"
          fill="none"
          strokeWidth="3"
          markerEnd={`url(#${id})`}
        />
      </svg>
      <figcaption>Minh họa thao tác · không phải phiên Codex đang chạy</figcaption>
    </figure>
  );
}

export default function UsageGuide({ stage, enabled = true }: { stage: Stage; enabled?: boolean }) {
  const mode = stage === 'hosted' ? 'hosted' : 'local';
  const [intro, setIntro] = useState(() => !seen(`${mode}:intro`));
  const [index, setIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const tip = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const targetKey = useRef('');
  const activeStage = useRef(stage);
  const step = index === null ? null : definitions[stage][index];
  const finish = useCallback(() => {
    setIndex(null);
    setPosition(null);
  }, []);
  const begin = useCallback(() => {
    remember(`stage:${stage}`);
    targetKey.current = '';
    setPosition(null);
    setIndex(0);
  }, [stage]);

  useEffect(() => {
    if (activeStage.current !== stage || !enabled) finish();
    activeStage.current = stage;
    if (enabled && !intro && !seen(`stage:${stage}`)) begin();
  }, [stage, enabled, begin, finish]);

  useEffect(() => {
    if (!intro || !enabled) return;
    const modal = dialog.current;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal?.showModal();
    return () => {
      modal?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [intro, enabled]);

  useEffect(() => {
    const open = () => {
      finish();
      setIntro(true);
    };
    window.addEventListener('relay-open-guide', open);
    return () => window.removeEventListener('relay-open-guide', open);
  }, [finish]);

  function dismiss(skip = false) {
    remember(`${mode}:intro`);
    remember(`stage:${stage}`);
    setIntro(false);
    if (skip) finish();
    else begin();
  }

  useEffect(() => {
    if (!enabled || intro || index === null) return;
    let frame = 0;
    const measure = () => {
      const steps = definitions[stage];
      let current = index;
      let target: HTMLElement | null = null;
      while (current < steps.length) {
        target = document.querySelector<HTMLElement>(`[data-usage="${steps[current].target}"]`);
        if (
          target &&
          target.getClientRects().length &&
          getComputedStyle(target).visibility !== 'hidden'
        )
          break;
        current++;
      }
      if (!target || current >= steps.length) {
        finish();
        return;
      }
      if (current !== index) {
        setIndex(current);
        return;
      }
      const identity = `${stage}:${current}`;
      if (targetKey.current !== identity) {
        targetKey.current = identity;
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      const rect = target.getBoundingClientRect();
      setPosition((previous) =>
        previous &&
        ['x', 'y', 'width', 'height'].every(
          (key) => previous[key as keyof DOMRect] === rect[key as keyof DOMRect],
        )
          ? previous
          : rect,
      );
      setViewport((previous) =>
        previous.width === innerWidth && previous.height === innerHeight
          ? previous
          : { width: innerWidth, height: innerHeight },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
        trigger.current?.focus();
      }
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.getElementById('root')!, { childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    const target = document.querySelector(`[data-usage="${definitions[stage][index].target}"]`);
    if (target) resize.observe(target);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('keydown', keyboard);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('keydown', keyboard);
    };
  }, [enabled, intro, index, stage, finish]);

  const narrow = viewport.width <= 760;
  const above = !!position && position.top + position.height / 2 > viewport.height / 2;
  const left = position ? Math.max(12, Math.min(position.left, viewport.width - 356)) : 12;
  const tipHeight = tip.current?.offsetHeight || 220;
  const targetX = position
    ? Math.max(10, Math.min(viewport.width - 10, position.left + position.width / 2))
    : 0;
  const targetY = position
    ? Math.max(6, Math.min(viewport.height - 6, above ? position.top : position.bottom))
    : 0;

  return (
    <>
      <button
        ref={trigger}
        className="usage-guide-trigger"
        onClick={() => {
          finish();
          setIntro(true);
        }}
        aria-label="Hướng dẫn sử dụng"
        title="Hướng dẫn sử dụng"
      >
        <BookOpen size={16} />
        <span>Hướng dẫn</span>
      </button>
      {createPortal(
        <>
          <dialog
            ref={dialog}
            className="usage-modal"
            aria-labelledby="usage-title"
            onCancel={(event) => {
              event.preventDefault();
              dismiss(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLElement>('button,[tabindex="0"]'),
              ];
              const first = controls[0],
                last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <header>
              <div>
                <span>RELAY + MESH</span>
                <h2 id="usage-title">Bắt đầu cùng workspace</h2>
              </div>
              <button onClick={() => dismiss(true)} aria-label="Đóng hướng dẫn">
                <X size={19} />
              </button>
            </header>
            <div
              className="usage-modal-scroll"
              tabIndex={0}
              aria-label="Nội dung hướng dẫn sử dụng"
            >
              <Illustration />
              <section>
                <h3>1. Mở runner trên máy</h3>
                <p>
                  Clone repo WWW, cài dependencies và chạy <code>npm start</code> trên cùng máy đang
                  mở trình duyệt. Trên web, bấm <strong>Kết nối runner</strong> rồi xác nhận trong
                  cửa sổ vừa mở. Giữ terminal và cửa sổ kết nối mở. MESH và Sessions vẫn nằm trên
                  URL Vercel. Khi dùng giao diện local trực tiếp, không cần bước kết nối.
                </p>
              </section>
              <section>
                <h3>2. Kết nối project và Team</h3>
                <p>
                  Trong <strong>Settings → Add project</strong>, chọn Git repository đã có commit.
                  Trong <strong>Team → Add account</strong>, tự đăng nhập từng tài khoản và kiểm tra
                  email. <strong>Refresh usage</strong> để đọc quota thật.
                </p>
              </section>
              <section>
                <h3>3. MESH và Sessions</h3>
                <p>
                  Chọn group dự án và nhắn yêu cầu trong <strong>MESH</strong>. Hệ thống ghi nhận
                  một người nhận việc; tin chat mở hội thoại chỉ đọc. Muốn sửa code, mở{' '}
                  <strong>Sessions → New session</strong>, chọn account, chế độ ghi và scope.
                </p>
                <p>
                  Output, command và file events nằm trong cửa sổ session. <strong>Steer</strong> bổ
                  sung prompt đang chạy; <strong>Pause</strong> dừng worker và giữ khóa,{' '}
                  <strong>Stop</strong> giải phóng khóa sau khi dừng an toàn. <strong>Demo</strong>{' '}
                  mở URL localhost của dự án đã chạy.
                </p>
              </section>
              <section>
                <h3>4. Quota, handoff và recovery</h3>
                <p>
                  Quota dùng chung cho mọi session của account. Khi còn ≤50%, hệ thống pause;{' '}
                  <strong>Needs you</strong> hiện câu hỏi hoặc quyền dùng dự trữ cần bạn quyết định.
                </p>
                <p>
                  Trước code handoff, cấu hình owner GitHub trong Team và origin của repo. Kiểm tra
                  remote SHA, test evidence và next steps trước khi <strong>ACK</strong>. Nếu
                  interrupted, xác nhận PID cũ đã dừng rồi <strong>Recover</strong>;{' '}
                  <strong>Resume</strong> là thao tác riêng.
                </p>
              </section>
              <section className="usage-boundary">
                <h3>Mũi tên chỉ chỗ thao tác</h3>
                <p>
                  Tour giữ các nút thật hoạt động để bạn tự chọn. Nó không gửi prompt, dùng usage,
                  đăng nhập, cấp quyền hay thực hiện handoff. Mỗi màn hình chỉ tự hướng dẫn lần đầu
                  trong tab; bấm Hướng dẫn để xem lại.
                </p>
              </section>
            </div>
            <footer>
              <button className="usage-skip" onClick={() => dismiss(true)}>
                Bỏ qua hướng dẫn
              </button>
              <button className="usage-primary" onClick={() => dismiss(false)}>
                Đã hiểu <ArrowRight size={15} />
              </button>
            </footer>
          </dialog>
          {enabled && !intro && step && position && (
            <div className="usage-tour">
              <div
                className="usage-target"
                style={{
                  left: Math.max(2, position.left - 4),
                  top: Math.max(2, position.top - 4),
                  width: Math.min(viewport.width - 4, position.width + 8),
                  height: position.height + 8,
                }}
              />
              {
                <svg
                  className="usage-arrow"
                  width={viewport.width}
                  height={viewport.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="usage-arrow-head"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M0 0 L10 5 L0 10Z" fill="#dc2626" />
                    </marker>
                  </defs>
                  <path
                    d={`M ${narrow ? viewport.width / 2 : left + 170} ${above ? (narrow ? 68 : 80) + tipHeight : viewport.height - 16 - tipHeight} Q ${targetX + 36} ${targetY + (above ? -45 : 45)} ${targetX} ${targetY}`}
                    stroke="#dc2626"
                    strokeWidth="3"
                    fill="none"
                    markerEnd="url(#usage-arrow-head)"
                  />
                </svg>
              }
              <aside
                ref={tip}
                className="usage-tip"
                role="region"
                aria-label="Hướng dẫn thao tác"
                style={{
                  left: narrow ? 12 : left,
                  ...(above ? { top: narrow ? 68 : 80 } : { bottom: 16 }),
                }}
              >
                <div className="usage-tip-top">
                  <span>
                    {(index || 0) + 1}/{definitions[stage].length}
                  </span>
                  <button aria-label="Đóng tour" onClick={finish}>
                    <X size={16} />
                  </button>
                </div>
                <div aria-live="polite">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                <div className="usage-tip-actions">
                  <button
                    aria-label="Bước trước"
                    disabled={index === 0}
                    onClick={() => {
                      targetKey.current = '';
                      setPosition(null);
                      let previous = Math.max(0, (index || 0) - 1);
                      while (
                        previous > 0 &&
                        !document
                          .querySelector(`[data-usage="${definitions[stage][previous].target}"]`)
                          ?.getClientRects().length
                      )
                        previous--;
                      setIndex(previous);
                    }}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    className="usage-primary"
                    onClick={() => {
                      targetKey.current = '';
                      setPosition(null);
                      if ((index || 0) + 1 >= definitions[stage].length) finish();
                      else setIndex((index || 0) + 1);
                    }}
                  >
                    {(index || 0) + 1 === definitions[stage].length ? 'Hoàn tất' : 'Tiếp theo'}{' '}
                    <ArrowRight size={14} />
                  </button>
                  <button className="usage-skip" onClick={finish}>
                    Bỏ qua
                  </button>
                </div>
              </aside>
            </div>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
