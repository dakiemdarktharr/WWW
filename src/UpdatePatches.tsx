import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePortalLocale } from './PortalLocale';

// Newest first. Add verified bug fixes here when publishing a release.
// Sources: docs/RELEASE-*.md.
const patches = [
  {
    version: '0.9.10',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Sade chọn Claude Code hoặc Codex theo kết nối và tải hiện tại. Theo dõi việc giao, chuyển việc và xem PowerPoint có dẫn nguồn ngay trong Kivuno.',
        en: 'Sade chooses Claude Code or Codex based on availability and active work. See assignments, handoffs, and cited PowerPoint files in Kivuno.',
      },
    ],
  },
  {
    version: '0.9.9',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Tối ưu kết nối Claude và hướng dẫn xem usage.',
        en: 'Simplified Claude connections and usage guidance.',
      },
    ],
  },
  {
    version: '0.9.8',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Gửi một yêu cầu tạo PowerPoint trong Chat. Sade giao việc, Codex chạy nền soạn và xuất tệp có nguồn, rồi báo kết quả ngay trong Kivuno.',
        en: 'Request a PowerPoint in Chat. Sade assigns it to a background Codex harness, which writes the slides, exports the cited deck, and reports back in Kivuno.',
      },
    ],
  },
  {
    version: '0.9.7',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Đơn giản hóa kết nối và duy trì phiên Claude.',
        en: 'Simplified Claude connection and session renewal.',
      },
    ],
  },
  {
    version: '0.9.6',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Dọn tệp chương trình Electron của bản cài Windows cũ sau khi cập nhật thành công.',
        en: 'Remove the previous Windows installation’s Electron archive after a successful update.',
      },
    ],
  },
  {
    version: '0.9.5',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Đồng bộ giao diện sáng và tối khắp workspace. Tin nhắn, câu trả lời và bàn giao dễ phân biệt trong từng luồng.',
        en: 'Light and dark themes are consistent across the workspace, with distinct bubbles for messages, replies, and handoffs.',
      },
      {
        vi: 'Trên Windows, cập nhật trong Kivuno giữ hồ sơ và teammate. Bản cài cũ được dọn sau khi bản mới khởi động thành công.',
        en: 'On Windows, in-app updates preserve your profile and teammates. The previous installation is cleaned up after the new version starts successfully.',
      },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Cải thiện quá trình cập nhật và khởi động lại Kivuno trên Windows.',
        en: 'Improved updates and restarts on Windows.',
      },
    ],
  },
  {
    version: '0.9.3',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Tối ưu tính năng Claude.',
        en: 'Improved Claude integration.',
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Khi có phiên bản mới, bấm Cập nhật trên thanh tiêu đề để tải, kiểm tra và cài bản mới. Kivuno mở lại sau khi cài.',
        en: 'When a new version is available, select Update in the title bar to download, verify and install it. Kivuno reopens after installation.',
      },
      {
        vi: 'Sade lập kế hoạch, điều phối và kiểm tra đầu ra cho bài nghiên cứu kèm slide, trang bán hàng và dashboard trên Windows, Linux và macOS Apple Silicon. Groups hiển thị tiến độ và các phiên làm việc đã cấp quyền.',
        en: 'Sade plans, coordinates, and reviews research papers with slides, storefronts, and dashboards on Windows, Linux, and Apple Silicon Macs. Groups shows progress and sessions shared with permission.',
      },
      {
        vi: 'Sade xác nhận lệnh hoãn rõ ràng và xử lý yêu cầu đổi chữ trong một tệp ngay tại Kivuno. Nếu thiếu nội dung mới, Sade hỏi trước khi giao việc.',
        en: 'Sade handles clear holds and one-file copy edits directly in Kivuno. If the new wording is missing, Sade asks before dispatching work.',
      },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-21',
    fixes: [
      {
        vi: 'Mở Gói & thanh toán từ thanh bên để xem gói, nâng cấp hoặc gia hạn. Quyền dự án trong Advanced hướng dẫn cấp quyền máy và duyệt gộp mã.',
        en: 'Open Billing from the sidebar to view, upgrade or renew your plan. Project permissions under Advanced guides machine access and merge approvals.',
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-20',
    fixes: [
      {
        vi: 'Shared Sade dùng GPT-6 Luna Decisions để phân loại yêu cầu bằng tiếng Việt. Kivuno kiểm tra người nhận, phạm vi và quyền trước khi giao việc.',
        en: 'Shared Sade uses GPT-6 Luna Decisions to classify Vietnamese requests. Kivuno verifies assignees, scope, and permissions before dispatch.',
      },
      {
        vi: 'Shared Groups hiển thị kết quả lập kế hoạch ngay khi máy chủ xác nhận. Sade hỏi lại khi thiếu dữ kiện để giao việc.',
        en: 'Shared Groups displays planning decisions as soon as the server confirms them. Sade asks for missing details before dispatch.',
      },
    ],
  },
  {
    version: '0.8.5',
    date: '2026-11-17',
    fixes: [
      {
        vi: 'Đổi tên khu vực trò chuyện thành Chat, đơn giản hóa bước chọn thư mục và mục tiêu dự án.',
        en: 'Renamed the conversation area to Chat and simplified project folder and goal setup.',
      },
      {
        vi: 'Thêm Sade trong Chat: chia việc theo yêu cầu, kiểm tra chéo bằng AI khác và yêu cầu review lại khi code thay đổi.',
        en: 'Added Sade in Chat: coordinated assignments, independent AI review, and renewed review when code changes.',
      },
    ],
  },
  {
    version: '0.8.4',
    date: '2026-11-17',
    fixes: [
      {
        vi: 'Thêm đăng nhập Google cho Antigravity qua CLI chính thức; MESH vẫn dùng riêng để nối client với workspace.',
        en: 'Added Google sign-in for Antigravity through its official CLI; MESH remains the separate client-to-workspace connection.',
      },
    ],
  },
  {
    version: '0.8.3',
    date: '2026-11-17',
    fixes: [
      {
        vi: 'Thêm nút tải bản mới trong desktop. Sau ba phiên bản bị bỏ qua, Kivuno yêu cầu cập nhật trước khi tiếp tục.',
        en: 'Added an in-app download button. Kivuno requires an update to continue after three newer releases are skipped.',
      },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-11-09',
    fixes: [
      {
        vi: 'Sửa nâng cấp Windows khi thư mục cài cũ đã mất nhưng registry còn lưu dấu vết; bộ cài dùng TEMP cùng ổ khi phù hợp và bỏ qua bộ gỡ cài đặt không còn tồn tại.',
        en: 'Fixed Windows upgrades after an older install was removed but registry metadata remained; staging now prefers same-volume TEMP and skips a missing uninstaller.',
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-11-08',
    fixes: [
      {
        vi: 'Trang Chats hiển thị tất cả chat dự án và nhóm đã tham gia, xếp theo cập nhật mới nhất; chat chưa hoạt động nằm cuối.',
        en: 'Chats home lists project and joined shared chats by latest activity, with inactive chats last.',
      },
      {
        vi: 'Sửa thông báo cho phép usage khi số còn lại đã thấp hơn mức dừng. Công việc vẫn tạm dừng và câu hỏi quota không bị giải quyết rồi tạo lại liên tục.',
        en: 'Fixed misleading usage approval below the stop limit. Work stays paused and the quota decision is no longer repeatedly resolved and recreated.',
      },
      {
        vi: 'Quyền mới thay thế quyền cũ của cùng tài khoản và dự án; giữ nguyên giới hạn 20% trong 1 giờ nếu không nêu rõ.',
        en: 'A new permission replaces previous limits for the same account/project. The default remains a 20% floor for one hour.',
      },
    ],
  },
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
