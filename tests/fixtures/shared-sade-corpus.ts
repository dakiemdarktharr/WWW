import type { ProviderId } from '../../shared/types.ts';

const teams = [
  ['câu lạc bộ sách', 'gemini', 'Google free', 'codex', 'ChatGPT Plus'],
  ['lịch phòng lab', 'codex', 'ChatGPT Pro', 'claude', 'Claude Pro'],
  ['bảng đăng ký workshop', 'claude', 'Claude Max', 'gemini', 'Google AI Pro'],
  ['app quản lý quỹ lớp', 'antigravity', 'Google AI Pro', 'codex', 'ChatGPT Plus'],
  ['trang portfolio', 'gemini', 'Google AI Ultra', 'antigravity', 'Google free'],
  ['lịch bảo trì', 'codex', 'ChatGPT Plus', 'gemini', 'Google free'],
  ['kho tài liệu', 'claude', 'Claude Pro', 'antigravity', 'Google AI Pro'],
  ['study tracker', 'codex', 'ChatGPT Free', 'claude', 'Claude Max'],
  ['team expense tool', 'antigravity', 'Google AI Ultra', 'gemini', 'Google AI Pro'],
  ['chợ đồ cũ', 'gemini', 'Google free', 'claude', 'Claude Pro'],
] as const;

const situations = [
  ['handoff', 'Tớ cần Bếp làm khung trước, Mây lấy khung đó làm giao diện.'],
  ['handoff', 'Giao Bếp lên cấu trúc dữ liệu, rồi để Mây nối giao diện với cấu trúc đó.'],
  ['handoff', 'Bếp chuẩn bị quy ước file trước. Mây đợi kết quả đó rồi viết hướng dẫn chạy.'],
  ['handoff', 'Cho Bếp xem yêu cầu, chốt phạm vi. Chuyển kết quả đã chốt cho Mây kiểm tra.'],
  ['scope', 'Tôi đã làm gần xong phần đăng ký. Hai AI coi chừng sửa chung đúng file đó.'],
  ['scope', 'Bếp và Mây đang đụng nhau ở cấu hình. Để một bên làm trước, bên kia chờ.'],
  ['scope', 'Cái patch đó đừng làm hai lần. Tách việc và giữ một người sửa cùng một chỗ.'],
  ['review', 'Nhờ Bếp sửa đoạn tính tổng, cho AI khác coi lỗi trước khi đưa lên Git.'],
  ['review', 'Để Bếp sửa kiểm tra quyền trong repo của mình, Mây đọc lại và báo điểm cần sửa.'],
  ['review', 'Bếp làm code trước. Mây đọc diff và xác nhận test nào còn thiếu.'],
  ['review', 'Tách người sửa lỗi khỏi người kiểm tra hồi quy, chỉ bàn giao commit đã duyệt.'],
  ['platform', 'Windows ok mà Mac lỗi, nhờ Mây kiểm tra trên Mac thật.'],
  ['platform', 'Mình cần bằng chứng app mở được trên macOS, người thử có tài khoản AI khác tôi.'],
  ['platform', 'Tìm harness đang ở darwin, nhờ nó xác minh đầu ra trên máy đó.'],
  ['no-platform', 'Nhờ chạy kiểm tra trên Mac dù phòng mới có máy Windows.'],
  ['no-access', 'Dùng Mây làm phần xem lại, dù bên bạn chưa bật quyền.'],
  ['revoked', 'Nhờ Mây đọc log, nhưng dừng nếu chủ tài khoản thu hồi quyền giữa chừng.'],
  ['budget', 'Mây chỉ còn một lượt. Hãy để nó làm hai việc độc lập trong nhóm giúp tôi.'],
  ['lost', 'Nhờ Bếp mở đầu. Nếu máy mất mạng lúc chạy thì đừng làm lại lần nữa.'],
  ['chat', 'Cảm ơn nha. Mình chỉ nhắn hỏi tình hình, chưa giao việc cho AI.'],
] as const;

const styles = [
  {
    label: 'casual',
    render: (meaning: string, project: string, plans: string) =>
      `ê mng, cái ${project} á 😅 ${meaning} bên mình ${plans} nha`,
  },
  {
    label: 'informal-no-accents',
    render: (meaning: string, project: string, plans: string) =>
      `mn oi project ${project}, gap xiu: ${meaning} goi AI: ${plans}`
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replaceAll('đ', 'd'),
  },
  {
    label: 'first-time',
    render: (meaning: string, project: string, plans: string) =>
      `Mình mới dùng AI. Nhóm đang làm ${project} và dùng ${plans}. ${meaning} Nhờ nói đơn giản cho mình biết đang chờ gì nhé.`,
  },
  {
    label: 'technical',
    render: (meaning: string, project: string, plans: string) =>
      `Project: ${project}\nHarness subscriptions: ${plans}\nYêu cầu: ${meaning}\nGhi rõ đầu vào, scope, điều kiện bắt đầu và bằng chứng đầu ra.`,
  },
  {
    label: 'expert-bilingual',
    render: (meaning: string, project: string, plans: string) =>
      `In ${project}, orchestrate this once across our authorized harnesses (${plans}): ${meaning} Keep dependency order, bounded turns, scoped Git worktrees and recoverable delivery.`,
  },
] as const;

export function sharedSadeCorpus() {
  return teams.flatMap(([project, first, firstPlan, second, secondPlan], team) =>
    situations.flatMap(([scenario, meaning], index) =>
      styles.map((style) => ({
        id: `team-${team + 1}/${index + 1}/${style.label}`,
        scenario,
        style: style.label,
        providers: [first, second] as readonly [ProviderId, ProviderId],
        subscriptions: [firstPlan, secondPlan],
        message: style.render(meaning, project, `Bếp ${firstPlan}, Mây ${secondPlan}`),
      })),
    ),
  );
}
