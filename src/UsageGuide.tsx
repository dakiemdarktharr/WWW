import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, MessageSquare, Network, Users, X } from 'lucide-react';
import './guide.css';

type Stage =
  'hosted' | 'mesh' | 'sessions' | 'team' | 'workroom' | 'tasks' | 'reviews' | 'settings' | 'aegis';
const guideKey = 'kivuno-guide-v3';
export default function UsageGuide({
  enabled = true,
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
            <ol className="guide-steps">
              <li>
                <span className="guide-step-icon">
                  <Users size={19} />
                </span>
                <div>
                  <h3>1. Chọn nhóm</h3>
                  <p>Team → Thêm tài khoản. Dự án → Chọn thành viên.</p>
                </div>
              </li>
              <li>
                <span className="guide-step-icon">
                  <MessageSquare size={19} />
                </span>
                <div>
                  <h3>2. Gửi điều bạn muốn làm</h3>
                  <p>
                    Neralu → Gửi prompt. <strong>Plan project</strong> → Lên kế hoạch.{' '}
                    <code>/</code> → Lệnh nhanh.
                  </p>
                </div>
              </li>
              <li>
                <span className="guide-step-icon">
                  <Network size={19} />
                </span>
                <div>
                  <h3>3. Theo dõi và phản hồi</h3>
                  <p>Sessions → Theo dõi. Reviews → Kiểm tra và duyệt kết quả.</p>
                </div>
              </li>
            </ol>
            <div className="guide-reactions">
              <span>♡ Đã hiểu</span>
              <span>👍 Đồng ý</span>
              <span>👎 Không đồng ý</span>
            </div>
          </div>
          <footer>
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
