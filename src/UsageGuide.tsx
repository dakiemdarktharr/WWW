import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, Check, MessageSquare, Network, Users, X } from 'lucide-react';
import './guide.css';

type Stage =
  'hosted' | 'mesh' | 'sessions' | 'team' | 'workroom' | 'tasks' | 'reviews' | 'settings' | 'aegis';
const guideKey = 'kivuno-guide-v3';
const tips: Partial<Record<Stage, string>> = {
  sessions:
    'Mỗi chấm là một cuộc trò chuyện. Một Codex có thể có nhiều session, model và mức reasoning riêng.',
  team: 'Team là tất cả tài khoản của bạn. Trong mỗi nhóm, bạn chọn những thành viên cần tham gia.',
  reviews:
    'Đọc kết quả, kiểm thử và thay đổi trước khi tích hợp. React đồng ý không thay thế quyền duyệt code.',
  aegis: 'AEGIS ghi bằng chứng bàn giao trên Avalanche Fuji. Chỉ sử dụng test AVAX miễn phí.',
  settings:
    'Máy tắt thì Codex trên máy đó offline. Khôi phục phiên bị gián đoạn trước khi tiếp tục.',
};
export default function UsageGuide({
  stage,
  enabled = true,
  cloud = false,
}: {
  stage: Stage;
  enabled?: boolean;
  cloud?: boolean;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(guideKey) !== 'seen';
    } catch {
      return false;
    }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    try {
      sessionStorage.setItem(guideKey, 'seen');
    } catch {
      /* Optional memory. */
    }
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('relay-open-guide', show);
    return () => window.removeEventListener('relay-open-guide', show);
  }, []);
  useEffect(() => {
    if (open && enabled) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open, enabled]);
  return (
    <>
      <button
        ref={trigger}
        className="usage-guide-trigger"
        aria-label="Hướng dẫn sử dụng"
        title="Hướng dẫn sử dụng"
        onClick={() => setOpen(true)}
      >
        <BookOpen size={16} />
        <span>Hướng dẫn</span>
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="usage-modal"
          aria-labelledby="usage-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const box = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < box.left ||
                event.clientX > box.right ||
                event.clientY < box.top ||
                event.clientY > box.bottom
              )
                close();
            }
          }}
        >
          <header>
            <div className="guide-brand">
              <img src="/kivuno.svg" alt="" />
              <h2 id="usage-title">Bắt đầu với Kivuno</h2>
            </div>
            <button className="icon-button" aria-label="Đóng hướng dẫn" onClick={close}>
              <X size={18} />
            </button>
          </header>
          <div className="usage-modal-scroll">
            <p className="guide-definition">
              <strong>Neralu</strong> là khu trò chuyện theo dự án của Kivuno.
            </p>
            <ol className="guide-steps">
              <li>
                <span className="guide-step-icon">
                  <Users size={19} />
                </span>
                <div>
                  <h3>1. Chọn nhóm</h3>
                  <p>Thêm tài khoản trong Team. Tạo dự án, rồi chọn Codex sẽ tham gia nhóm.</p>
                </div>
              </li>
              <li>
                <span className="guide-step-icon">
                  <MessageSquare size={19} />
                </span>
                <div>
                  <h3>2. Gửi điều bạn muốn làm</h3>
                  <p>
                    Chat để hỏi và nghiên cứu. Chọn <strong>Plan project</strong> để lên kế hoạch và
                    xây dựng. Gõ <code>/</code> để chọn model, reasoning hoặc skill.
                  </p>
                </div>
              </li>
              <li>
                <span className="guide-step-icon">
                  <Network size={19} />
                </span>
                <div>
                  <h3>3. Theo dõi và phản hồi</h3>
                  <p>
                    Mở Sessions trong nhóm để xem từng cuộc trò chuyện. Đọc kết quả, phản hồi và
                    duyệt trong Reviews.
                  </p>
                </div>
              </li>
            </ol>
            <div className="guide-reactions">
              <span>♡ Đã hiểu</span>
              <span>👍 Đồng ý</span>
              <span>👎 Không đồng ý</span>
            </div>
            {tips[stage] && (
              <p className="guide-context">
                <Check size={14} />
                {tips[stage]}
              </p>
            )}
            {stage === 'hosted' && (
              <p className="guide-context">
                Đăng nhập trên web, xác nhận kết nối rồi quay lại app để làm việc.
              </p>
            )}
          </div>
          <footer>
            <button className="usage-skip" onClick={close}>
              Bỏ qua hướng dẫn
            </button>
            <button className="usage-primary" onClick={close}>
              Bắt đầu <ArrowRight size={15} />
            </button>
          </footer>
        </dialog>,
        document.body,
      )}
    </>
  );
}
