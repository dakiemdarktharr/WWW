import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePortalLocale } from './PortalLocale';

// Newest first. Add verified bug fixes here when publishing a release.
// Sources: docs/RELEASE-*.md.
const patches = [
  {
    version: '0.8.0',
    date: '2026-11-08',
    fixes: [
      {
        vi: 'Dán link cuộc thi để tạo hồ sơ Research chung: nguồn, luật, tiêu chí chấm, bài thi cũ và các mục chưa xác minh.',
        en: 'Paste a competition link to create a shared Research dossier: sources, rules, judging, previous entries and unverified gaps.',
      },
      {
        vi: 'Teammate biết workload ở các dự án khác, tự chọn model/reasoning từ catalog theo nhiệm vụ và usage còn dùng được.',
        en: 'Teammates see their other projects and select available models/reasoning using task complexity and shared usage headroom.',
      },
      {
        vi: 'Một team có thể tham gia nhiều cuộc thi. Hàng đợi luân phiên dự án, giữ giới hạn máy và khóa task riêng.',
        en: 'One team can join multiple competitions. Project rotation preserves machine limits and task ownership.',
      },
      {
        vi: 'Duyệt kế hoạch cuộc thi bằng Approve plan trước khi triển khai; làm mới nguồn sẽ bỏ trạng thái xác minh cũ.',
        en: 'Approve competition plans before implementation; refreshing sources clears outdated verification.',
      },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-11-07',
    fixes: [
      {
        vi: 'Gõ @ để chọn teammate. Trả lời tin nhắn giữ ngữ cảnh session; gửi lại khi mất kết nối không tạo prompt trùng.',
        en: 'Type @ to choose a teammate. Replies keep session context; reconnect retries do not duplicate prompts.',
      },
      {
        vi: 'Cho phép usage bằng tin nhắn Việt/Anh. Mặc định dừng ở 20% còn lại trong 1 giờ; mức ghi rõ được ưu tiên.',
        en: 'Allow reserve usage in Vietnamese or English. Defaults to a 20% remaining floor for one hour; explicit limits take precedence.',
      },
      {
        vi: 'Tự bàn giao khi usage thấp, giữ checkpoint, ngữ cảnh và quyền sở hữu công việc. Session bạn chủ động dừng sẽ không tự chạy lại.',
        en: 'Low usage triggers handoff with checkpoints, context and task ownership. Manually paused sessions stay paused.',
      },
      {
        vi: 'Hiện bubble khi teammate đang làm việc, tự mở Sessions và cho chỉnh model/reasoning cho lượt tiếp theo.',
        en: 'Working teammates show activity bubbles, Sessions opens automatically, and model/reasoning changes apply to the next turn.',
      },
      {
        vi: 'Địa chỉ mới kivuno.vercel.app, bản tải Windows/Linux 0.7.2 và thông tin tìm kiếm cập nhật.',
        en: 'New kivuno.vercel.app address, Windows/Linux 0.7.2 downloads, and updated search metadata.',
      },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-07',
    fixes: [
      {
        vi: 'Sửa lỗi đã đăng nhập và có usage nhưng vẫn hiện Not signed in khi tải plugins.',
        en: 'Fixed signed-in accounts showing Not signed in after loading plugins despite available usage.',
      },
      {
        vi: 'Chỉ tải plugins đã cài, tránh danh mục marketplace quá lớn làm ngắt kết nối Codex.',
        en: 'Load installed plugins without downloading the full marketplace catalog that disconnected Codex.',
      },
      {
        vi: 'Các Codex trên cùng máy dùng chung thư mục skills cục bộ, giữ đăng nhập riêng cho từng tài khoản.',
        en: 'Codex profiles on the same machine share local skill folders while retaining separate sign-ins.',
      },
      {
        vi: 'Nạp plugins trước khi quét skills để hiện đầy đủ ngay lần làm mới đầu tiên.',
        en: 'Load plugins before scanning skills so the first refresh includes their skills.',
      },
    ],
  },
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
