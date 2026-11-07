import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePortalLocale } from './PortalLocale';

// Newest first. Add verified bug fixes here when publishing a release.
// Sources: docs/RELEASE-0.6.2.md and docs/RELEASE-0.6.1.md.
const patches = [
  {
    version: '0.7.0',
    date: '2026-11-07',
    fixes: [
      {
        vi: 'Xác nhận đăng nhập AI tự cập nhật, có tiến trình và không chờ tải plugins.',
        en: 'AI sign-in updates automatically with progress, without waiting for plugins.',
      },
      {
        vi: 'Mỗi lần mở app yêu cầu đăng nhập Kivuno; dữ liệu được tách theo tài khoản trên cùng máy.',
        en: 'Each launch requires Kivuno sign-in; accounts on a shared computer have separate workspaces.',
      },
      {
        vi: 'Group chat hỗ trợ mời tài khoản Kivuno và mỗi thành viên thêm teammate riêng.',
        en: 'Group chats support Kivuno invitations and each participant’s own teammates.',
      },
      {
        vi: 'Thanh điều khiển cửa sổ tự ẩn khi toàn màn hình; đưa chuột lên mép trên hoặc nhấn F10 để mở.',
        en: 'Fullscreen window controls hide automatically; move to the top edge or press F10 to reveal them.',
      },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-11-07',
    fixes: [
      {
        vi: 'Link Update patches mở đúng vị trí ngay lần truy cập đầu tiên.',
        en: 'Update patches links open at the right section on the first visit.',
      },
      {
        vi: 'Thêm tài khoản Codex luôn tạo profile riêng, không dùng lại profile chưa đăng nhập xong.',
        en: 'Adding a Codex account creates a separate profile instead of reusing an unfinished sign-in.',
      },
      {
        vi: 'Đóng hộp thoại đăng nhập sẽ hủy đúng phiên, tránh chặn kết nối tài khoản tiếp theo.',
        en: 'Closing sign-in cancels that attempt so the next account can connect.',
      },
      {
        vi: 'Đăng xuất hoặc hủy một tài khoản không ảnh hưởng phiên đăng nhập của tài khoản khác.',
        en: 'Signing out or cancelling one account leaves other accounts’ sign-in attempts intact.',
      },
      {
        vi: 'Thông báo hết thời gian đăng nhập đến trễ không còn chuyển tài khoản đã kết nối sang offline.',
        en: 'Late sign-in timeout messages no longer mark an already connected account offline.',
      },
      {
        vi: 'Làm mới tài khoản cập nhật usage riêng; đăng xuất xóa số liệu quota cũ.',
        en: 'Refreshing an account updates its own usage; signing out clears old quota readings.',
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-11-05',
    fixes: [
      {
        vi: 'Bộ cài giải nén trên ổ được chọn, tránh lỗi ghi file khi ổ C thiếu dung lượng.',
        en: 'The installer extracts on the selected drive, avoiding write errors when C: is low on space.',
      },
      {
        vi: 'Profile Codex mới trên Windows được thiết lập sandbox để ghi trong thư mục làm việc đã cấp quyền.',
        en: 'New Windows Codex profiles configure the sandbox for writes inside the approved workspace.',
      },
      {
        vi: 'Khởi động lại không còn kẹt vì khóa của tiến trình đã thoát hoặc PID bị tái sử dụng.',
        en: 'Restarting recovers stale locks from exited processes or reused process IDs.',
      },
      {
        vi: 'Antigravity được nhận diện riêng, không bị nhầm thành Gemini CLI.',
        en: 'Antigravity is identified separately instead of being mistaken for Gemini CLI.',
      },
      {
        vi: 'Checkpoint chặn cấu hình chứa token MESH khỏi commit tiến trình.',
        en: 'Checkpoints block configuration containing MESH tokens from progress commits.',
      },
    ],
  },
] as const;

export default function UpdatePatches() {
  const { locale } = usePortalLocale();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash !== '#updates') return;
    // The portal is lazy-loaded, so the browser may resolve the fragment before
    // this section exists. Resolve it once after the actual content mounts.
    const frame = requestAnimationFrame(() =>
      section.current?.scrollIntoView({ behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  const dateFormat = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    dateStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return (
    <section id="updates" ref={section} className="kp-updates" aria-labelledby="updates-heading">
      <h2 id="updates-heading">Update patches</h2>
      <div className="kp-patch-list">
        {patches.map((patch, index) => (
          <details className="kp-patch glass" key={patch.version} open={index === 0}>
            <summary>
              <strong>{patch.version}</strong>
              {index === 0 && (
                <span className="kp-patch-latest">{locale === 'vi' ? 'Mới nhất' : 'Latest'}</span>
              )}
              <time dateTime={patch.date}>
                {dateFormat.format(new Date(`${patch.date}T12:00:00+07:00`))}
              </time>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <ul>
              {patch.fixes.map((fix) => (
                <li key={fix.en}>{fix[locale]}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
