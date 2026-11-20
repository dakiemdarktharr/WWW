import type { ProviderId } from '../../shared/types.ts';

type OwnerIndex = 0 | 1 | 2 | 3;
type Harness = { name: string; provider: ProviderId; granted: boolean };
type Files = { architecture: string; frontend: string; backend: string; tests: string };
type Style =
  { kind: 'unspecified' } | { kind: 'delegated' } | { kind: 'supplied'; tokens: readonly string[] };

export type HandoffPlanningCase = {
  id: string;
  message: string;
  reference?: string;
  roster: readonly Harness[];
  expected:
    | {
        kind: 'plan';
        files: Files;
        owners: { architecture: OwnerIndex; frontend: OwnerIndex };
        style: Style;
        reviewSubjects: readonly string[];
      }
    | {
        kind: 'question';
        reason: 'ambiguous-owner' | 'missing-grant';
        harness: string;
        owners: readonly OwnerIndex[];
      };
};

const gemini = { name: 'Gemini', provider: 'gemini', granted: true } as const;
const astra = { name: 'Astra', provider: 'codex', granted: true } as const;
const claude = { name: 'Claude', provider: 'claude', granted: true } as const;
const antigravity = { name: 'Antigravity', provider: 'antigravity', granted: true } as const;
const standardRoster = [gemini, astra, claude, antigravity];
const duplicateAstraRoster = [gemini, astra, astra, antigravity];

const library = {
  architecture: 'docs/borrow-station-contract.md',
  frontend: 'src/library/BorrowScreen.tsx',
  backend: 'src/library/checkout.ts',
  tests: 'tests/borrow-station.test.ts',
};
const parcels = {
  architecture: 'docs/parcel-locker-contract.md',
  frontend: 'src/locker/PickupPanel.tsx',
  backend: 'src/locker/release.ts',
  tests: 'tests/parcel-locker.test.ts',
};
const bookings = {
  architecture: 'docs/desk-booking-contract.md',
  frontend: 'src/desks/BookingView.tsx',
  backend: 'src/desks/reserve.ts',
  tests: 'tests/desk-booking.test.ts',
};
const waterStock = {
  architecture: 'docs/refill-contract.md',
  frontend: 'src/refill/StockView.tsx',
  backend: 'src/refill/schedule.ts',
  tests: 'tests/refill-stock.test.ts',
};

// Owners are An, Bình, Chi and Dũng in roster order. Keep these messages out of prompt tuning.
export const handoffPlanningCases: readonly HandoffPlanningCase[] = [
  {
    id: 'handoff-planning/library-implicit-style',
    reference: `Hồ sơ trạm mượn sách gồm hợp đồng dữ liệu ${library.architecture}, màn hình ${library.frontend}, hàm xử lý ${library.backend} và bộ test ${library.tests}.`,
    message:
      'Ê nhờ Gemini của tui chốt cấu trúc trạm mượn sách trước nghen, rồi cho Astra của ông lấy bản đó làm giao diện. API với bộ test cũng theo bản đó, hai việc này Sade tự chia. Sau khi xong giao diện với API thì nhờ người không viết chúng đọc đúng hai file đó, chỉ xem lỗi có hiện số thẻ thư viện không.',
    roster: standardRoster,
    expected: {
      kind: 'plan',
      files: library,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'unspecified' },
      reviewSubjects: ['so the', 'card number', 'library card'],
    },
  },
  {
    id: 'handoff-planning/parcel-explicit-owner-and-style',
    message: `Nhờ Gemini của mình viết quy ước tủ nhận hàng trong ${parcels.architecture} trước. Có quy ước rồi giao Astra của Chi làm ${parcels.frontend} với nền màu cam và chữ đậm. Sade tự chia người viết ${parcels.backend} và thêm ${parcels.tests} sau khi có quy ước. Khi cả giao diện lẫn backend xong, giao một người không viết hai file đó rà soát chỉ đọc xem lỗi có làm lộ số điện thoại khách không.`,
    roster: duplicateAstraRoster,
    expected: {
      kind: 'plan',
      files: parcels,
      owners: { architecture: 0, frontend: 2 },
      style: { kind: 'supplied', tokens: ['cam', 'đậm'] },
      reviewSubjects: ['so dien thoai', 'phone number', 'phone'],
    },
  },
  {
    id: 'handoff-planning/booking-unaccented-style-delegation',
    message: `gemini cua tui viet quy uoc dat ban vao ${bookings.architecture} truoc nhe. co quy uoc roi thi astra cua ban lam ${bookings.frontend}, style de astra tu chon luon. sade chia nguoi lam ${bookings.backend} va ${bookings.tests} cung dua vao quy uoc. doi frontend va backend xong roi nho nguoi khong viet hai file do doc kiem tra thong bao loi co lo email nguoi dat khong, chi doc thoi.`,
    roster: standardRoster,
    expected: {
      kind: 'plan',
      files: bookings,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'delegated' },
      reviewSubjects: ['email', 'e-mail'],
    },
  },
  {
    id: 'handoff-planning/parcel-exact-owner-without-grant',
    message: `Cho Gemini của tôi viết ${parcels.architecture} trước, rồi giao đúng Astra của Chi làm ${parcels.frontend} theo quy ước đó. Sau khi có quy ước, Sade tự giao ${parcels.backend} và ${parcels.tests}. Xong frontend với backend thì giao người khác đọc hai file đó để kiểm tra số điện thoại có lọt vào thông báo lỗi không.`,
    roster: [gemini, astra, { ...astra, granted: false }, antigravity],
    expected: { kind: 'question', reason: 'missing-grant', harness: 'Astra', owners: [2] },
  },
  {
    id: 'handoff-planning/library-ambiguous-other-owner',
    reference: `Các đường dẫn đã thống nhất cho trạm mượn sách là ${library.architecture}, ${library.frontend}, ${library.backend} và ${library.tests}.`,
    message:
      'Gemini của mình ghi cấu trúc mượn sách trước, sau đó Astra của bạn làm màn mượn theo cấu trúc đó. Sade tìm người làm backend và test sau phần cấu trúc. Khi backend lẫn màn mượn xong, để một người khác đọc hai file nguồn xem thông báo lỗi có lộ số thẻ thư viện không.',
    roster: duplicateAstraRoster,
    expected: { kind: 'question', reason: 'ambiguous-owner', harness: 'Astra', owners: [1, 2] },
  },
  {
    id: 'handoff-planning/refill-english-transfer',
    message: `Have my Gemini write the refill scheduling contract in ${waterStock.architecture}. After it is ready, have Bình's Astra use it to build ${waterStock.frontend}. Start with a teal background and rounded cards. Sade can assign ${waterStock.backend} and ${waterStock.tests} once the contract is ready. When the frontend and backend are ready, ask a separate teammate to read those two source files and report whether error messages expose customer email addresses. That review is read-only.`,
    roster: standardRoster,
    expected: {
      kind: 'plan',
      files: waterStock,
      owners: { architecture: 0, frontend: 1 },
      style: { kind: 'supplied', tokens: ['teal', 'rounded'] },
      reviewSubjects: ['email', 'e-mail'],
    },
  },
];
