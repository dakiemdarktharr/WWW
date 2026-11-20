import type { ProviderId } from '../../shared/types.ts';

type OwnerIndex = 0 | 1 | 2 | 3;
type RoutingHarness = { name: string; provider: ProviderId; granted: boolean };
type RoutingTask = {
  owner: OwnerIndex;
  file: string;
  mode: 'read' | 'edit';
  after?: string;
  fallback?: OwnerIndex | 'auto';
};
type RoutingExpectation =
  | { kind: 'plan'; tasks: readonly RoutingTask[] }
  | {
      kind: 'question';
      reason: 'ambiguous-owner' | 'missing-grant';
      harness: string;
      owners: readonly OwnerIndex[];
    }
  | { kind: 'no-work' };

export type OwnerRoutingCase = {
  id: string;
  tag:
    | 'explicit-owner'
    | 'relative-owner'
    | 'ambiguous-owner'
    | 'missing-grant'
    | 'negated-assignee'
    | 'quoted-no-work'
    | 'quota-pinned'
    | 'quota-named-backup';
  message: string;
  reference?: string;
  roster: readonly RoutingHarness[];
  expected: RoutingExpectation;
};

const gemini = { name: 'Gemini', provider: 'gemini', granted: true } as const;
const astra = { name: 'Astra', provider: 'codex', granted: true } as const;
const claude = { name: 'Claude', provider: 'claude', granted: true } as const;

// Owners are An, Bình, Chi and Dũng, in fixture roster order. Keep these inputs out of prompt tuning.
export const ownerRoutingCases: readonly OwnerRoutingCase[] = [
  {
    id: 'owner-routing/explicit-dual-astra',
    tag: 'explicit-owner',
    message:
      'Gemini của mình ghi quy ước mã vận đơn vào docs/labels.md nhé. Xong giao Astra của Bình làm màn in nhãn ở src/shipping/PrintLabel.tsx theo đúng bản quy ước.',
    roster: [gemini, astra, astra],
    expected: {
      kind: 'plan',
      tasks: [
        { owner: 0, file: 'docs/labels.md', mode: 'edit' },
        { owner: 1, file: 'src/shipping/PrintLabel.tsx', mode: 'edit', after: 'docs/labels.md' },
      ],
    },
  },
  {
    id: 'owner-routing/unaccented-relative-gemini',
    tag: 'relative-owner',
    message:
      'gemini cua tui ghi mau nguong canh bao vao docs/stock-thresholds.md truoc nha. co file do roi gemini cua ong moi sua src/stock/threshold.ts theo mau.',
    roster: [gemini, gemini, claude],
    expected: {
      kind: 'plan',
      tasks: [
        { owner: 0, file: 'docs/stock-thresholds.md', mode: 'edit' },
        {
          owner: 1,
          file: 'src/stock/threshold.ts',
          mode: 'edit',
          after: 'docs/stock-thresholds.md',
        },
      ],
    },
  },
  {
    id: 'owner-routing/relative-owner-ambiguous',
    tag: 'ambiguous-owner',
    message:
      'Astra của bạn đọc docs/pickup-policy.md rồi giải thích giúp mình các khung giờ nhận hàng nha. Chỉ đọc thôi.',
    roster: [gemini, astra, astra],
    expected: { kind: 'question', reason: 'ambiguous-owner', harness: 'Astra', owners: [1, 2] },
  },
  {
    id: 'owner-routing/missing-exact-owner-with-alternative',
    tag: 'missing-grant',
    message:
      'Nhờ đúng Astra của Chi đọc docs/returns.md và tóm tắt điều kiện trả hàng giúp mình. Chỉ đọc, đừng sửa gì.',
    roster: [gemini, astra, { ...astra, granted: false }],
    expected: { kind: 'question', reason: 'missing-grant', harness: 'Astra', owners: [2] },
  },
  {
    id: 'owner-routing/ignore-negated-assignee',
    tag: 'negated-assignee',
    message:
      'Astra của Bình khỏi tham gia phần này nha. Chỉ nhờ Gemini của mình đọc docs/reorder.md rồi cho mình biết khi nào cần đặt thêm hàng.',
    roster: [gemini, astra, claude],
    expected: { kind: 'plan', tasks: [{ owner: 0, file: 'docs/reorder.md', mode: 'read' }] },
  },
  {
    id: 'owner-routing/quoted-assignment-no-work',
    tag: 'quoted-no-work',
    reference: 'Giao Astra của Bình sửa src/shipping/parcel.ts giúp mình.',
    message:
      'Mình trích lại câu ở trên để mọi người đối chiếu biên bản. Việc đó xong rồi, tin này chỉ để báo nhóm. Đừng giao việc mới nhé.',
    roster: [gemini, astra, claude],
    expected: { kind: 'no-work' },
  },
  {
    id: 'owner-routing/quota-pin-astra',
    tag: 'quota-pinned',
    message:
      'Assign Astra under Bình alone to read docs/dispatch-calendar.md and summarize changes. If Astra is out of turns, tell me it is waiting. Don’t transfer it to Claude under Chi.',
    roster: [gemini, astra, claude],
    expected: {
      kind: 'plan',
      tasks: [{ owner: 1, file: 'docs/dispatch-calendar.md', mode: 'read' }],
    },
  },
  {
    id: 'owner-routing/quota-backup-same-name',
    tag: 'quota-named-backup',
    message:
      'Nhờ Astra của Bình xem docs/carrier-cutoffs.md rồi tóm tắt giờ chốt đơn, chỉ đọc thôi. Khi nào bên Bình hết quota thì chuyển đúng việc đó cho Astra của Chi.',
    roster: [gemini, astra, astra],
    expected: {
      kind: 'plan',
      tasks: [{ owner: 1, file: 'docs/carrier-cutoffs.md', mode: 'read', fallback: 2 }],
    },
  },
];
