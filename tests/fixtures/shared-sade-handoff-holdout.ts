import type { HandoffPlanningCase } from './shared-sade-handoff-planning.ts';

const gemini = { name: 'Gemini', provider: 'gemini', granted: true } as const;
const astra = { name: 'Astra', provider: 'codex', granted: true } as const;
const claude = { name: 'Claude', provider: 'claude', granted: true } as const;
const antigravity = { name: 'Antigravity', provider: 'antigravity', granted: true } as const;
const roster = [gemini, astra, claude, antigravity];
const duplicateAstra = [gemini, astra, astra, antigravity];

const greenhouse = {
  architecture: 'docs/greenhouse-tray-contract.md',
  frontend: 'src/greenhouse/TrayBoard.tsx',
  backend: 'src/greenhouse/watering.ts',
  tests: 'tests/greenhouse-tray.test.ts',
};
const uniforms = {
  architecture: 'docs/uniform-exchange-schema.md',
  frontend: 'src/uniform/ReturnCard.tsx',
  backend: 'src/uniform/returnEligibility.ts',
  tests: 'tests/uniform-return.test.ts',
};
const studios = {
  architecture: 'docs/studio-room-rules.md',
  frontend: 'src/studio/RoomDisplay.tsx',
  backend: 'src/studio/availability.ts',
  tests: 'tests/studio-room.test.ts',
};
const archives = {
  architecture: 'docs/archive-cart-contract.md',
  frontend: 'src/archive/RequestBoard.tsx',
  backend: 'src/archive/pickList.ts',
  tests: 'tests/archive-cart.test.ts',
};
const badges = {
  architecture: 'docs/visitor-desk-schema.md',
  frontend: 'src/visitors/CheckInView.tsx',
  backend: 'src/visitors/issueBadge.ts',
  tests: 'tests/visitor-checkin.test.ts',
};
const shifts = {
  architecture: 'docs/shift-swap-contract.md',
  frontend: 'src/shifts/SwapQueue.tsx',
  backend: 'src/shifts/approval.ts',
  tests: 'tests/shift-approval.test.ts',
};
const labels = {
  architecture: 'docs/seed-label-contract.md',
  frontend: 'src/seeds/PrintSheet.tsx',
  backend: 'src/seeds/printBatch.ts',
  tests: 'tests/seed-label.test.ts',
};
const lockers = {
  architecture: 'docs/key-cabinet-schema.md',
  frontend: 'src/keys/CheckoutView.tsx',
  backend: 'src/keys/checkout.ts',
  tests: 'tests/key-cabinet.test.ts',
};

// Roster order is An, Bình, Chi and Dũng. Keep these cases separate from prompt tuning.
export const handoffHoldoutCases: readonly HandoffPlanningCase[] = [
  {
    id: 'handoff-holdout/greenhouse-role-map-and-archived-note',
    reference: `Bản đồ quầy ươm đang dùng gồm hợp đồng ${greenhouse.architecture}, frontend ${greenhouse.frontend}, backend ${greenhouse.backend} và bộ test ${greenhouse.tests}. Nhật ký chuyển kho cũ legacy/greenhouse.ts dùng nhãn cyber cho một đợt rà soát đã đóng.`,
    message:
      'Ê nhờ Gemini của tui chốt cấu trúc cho khay cây trước, rồi ông đưa cho Astra của ông làm giao diện. Sade tự giao backend và bộ test sau khi có cấu trúc đó. Khi frontend và backend xong, nhờ người không viết hai file đó đọc đúng hai file đó để kiểm tra cảnh báo có hiện số điện thoại tình nguyện viên không.',
    roster,
    expected: {
      kind: 'plan',
      files: greenhouse,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'unspecified' },
      reviewSubjects: ['so dien thoai', 'phone number', 'phone'],
    },
  },
  {
    id: 'handoff-holdout/uniforms-english-three-style-details',
    message: `Have my Claude write the exchange schema in ${uniforms.architecture}. After it is ready, have Bình's Astra build ${uniforms.frontend}. Use a charcoal background, cream text and square panels. Sade can assign ${uniforms.backend} and ${uniforms.tests} once the schema is ready. When frontend and backend are ready, ask a separate teammate to read exactly those two source files and check whether error messages expose a student ID.`,
    roster: [claude, astra, gemini, antigravity],
    expected: {
      kind: 'plan',
      files: uniforms,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'supplied', tokens: ['charcoal', 'cream', 'square'] },
      reviewSubjects: ['student id', 'student number', 'ma hoc sinh', 'ma sinh vien'],
    },
  },
  {
    id: 'handoff-holdout/studios-unaccented-partial-scope',
    reference: `Tệp màn hình cho phòng tập là ${studios.frontend}. Mục kiểm thử chính nằm ở ${studios.tests}.`,
    message: `Nho Gemini cua toi viet hop dong phong tap trong ${studios.architecture} truoc, roi giao Astra cua ban lam giao dien. Phong cach de Astra tu chon. Sade tu giao backend tai ${studios.backend} va bo test khi co hop dong. Khi frontend va backend xong, nho nguoi khac doc dung hai file do de kiem tra thong bao loi co lo email dat phong khong.`,
    roster,
    expected: {
      kind: 'plan',
      files: studios,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'delegated' },
      reviewSubjects: ['email', 'e-mail'],
    },
  },
  {
    id: 'handoff-holdout/archives-chi-disambiguated-and-scoped',
    message: `Cho Gemini của mình soạn hợp đồng xe đẩy hồ sơ ở ${archives.architecture} trước, sau đó chuyển cho Astra của Chi dựng ${archives.frontend}. Giữ theme graphite và layout compact. Sade tự chia người làm API ở ${archives.backend} và viết bộ test ở ${archives.tests} sau hợp đồng. Khi frontend và backend xong, nhờ người khác đọc đúng hai file đó để kiểm tra lỗi có lộ địa chỉ thư điện tử thủ thư không.`,
    roster: duplicateAstra,
    expected: {
      kind: 'plan',
      files: archives,
      owners: { architecture: 0, frontend: 2 },
      style: { kind: 'supplied', tokens: ['graphite', 'compact'] },
      reviewSubjects: ['email', 'e-mail', 'thu dien tu'],
    },
  },
  {
    id: 'handoff-holdout/badges-english-generic-four-deliverables',
    reference: `The current visitor check-in map lists contract ${badges.architecture}, frontend ${badges.frontend}, backend ${badges.backend}, tests ${badges.tests}.`,
    message:
      'Have my Gemini prepare the visitor badge schema, then have your Astra build the frontend, backend, tests and defensive review. Sade can assign the backend and tests after the schema. When frontend and backend are both ready, ask a separate teammate to read exactly those two source files and check whether alerts expose a visitor badge number.',
    roster,
    expected: {
      kind: 'plan',
      files: badges,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'unspecified' },
      reviewSubjects: ['badge number', 'badge id', 'so the', 'ma the'],
    },
  },
  {
    id: 'handoff-holdout/shifts-owner-order-reversed',
    reference: `Shift exchange regression tests live in ${shifts.tests}.`,
    message: `Please have Bình’s Gemini prepare the shift exchange contract in ${shifts.architecture}, then have my Astra build ${shifts.frontend}. Let Astra choose the appearance. Sade can assign backend work in ${shifts.backend} and the regression tests once the contract is ready. When frontend and backend are ready, ask another teammate to read exactly those two source files and check whether errors disclose an employee number.`,
    roster: [astra, gemini, claude, antigravity],
    expected: {
      kind: 'plan',
      files: shifts,
      owners: { architecture: 1, frontend: 0 },
      style: { kind: 'delegated' },
      reviewSubjects: ['employee number', 'employee id', 'ma nhan vien'],
    },
  },
  {
    id: 'handoff-holdout/labels-relative-owner-ambiguous',
    message: `Giao Gemini của tôi viết hợp đồng nhãn hạt giống ở ${labels.architecture} trước, rồi Astra của ông làm ${labels.frontend}. Sade tự chia backend ở ${labels.backend} và bộ test ở ${labels.tests} sau hợp đồng. Khi frontend và backend xong, nhờ người khác đọc đúng hai file đó để kiểm tra lỗi có lộ số điện thoại người đăng ký không.`,
    roster: duplicateAstra,
    expected: { kind: 'question', reason: 'ambiguous-owner', harness: 'Astra', owners: [1, 2] },
  },
  {
    id: 'handoff-holdout/lockers-exact-binh-without-grant',
    message: `Have my Gemini draft the key checkout schema in ${lockers.architecture}, then give it to Bình's Astra to build ${lockers.frontend}. Sade can assign ${lockers.backend} and ${lockers.tests} after the schema. When frontend and backend are ready, ask a different teammate to read exactly those two source files and check whether an error exposes a staff email address.`,
    roster: [gemini, { ...astra, granted: false }, astra, antigravity],
    expected: { kind: 'question', reason: 'missing-grant', harness: 'Astra', owners: [1] },
  },
];
