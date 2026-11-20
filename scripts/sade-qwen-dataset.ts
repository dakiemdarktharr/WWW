import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sharedSadeCorpus } from '../tests/fixtures/shared-sade-corpus.ts';
import {
  acceptancePairs,
  challengePairs,
  contextPairs,
  trainingPairs,
} from './sade-qwen-contrast.ts';

const goldens = {
  general: [
    'Mọi người nhờ agent kéo bản ghi thời gian khởi động để mai so tốc độ.',
    'còn đúng 2 lượt bên Lan, dùng 1 lượt đọc log tạo báo cáo dùm',
    'AI bên Nam vẫn offline à? Để nó đọc requirements khi lên mạng, đừng chuyển tài khoản.',
    'Have Min summarize the sprint notes into three decisions, then stop.',
    'Mình có tệp csv điểm danh, nhờ trợ lý tính tổng từng ngày.',
    'Thu hồi quyền của bot lúc nào thì dừng luôn, giờ kiểm tra số lượt còn lại.',
    'Mời agent đọc kết quả thử nghiệm rồi nêu các số chênh lệch.',
    'Chọn một model đang rảnh để tóm tắt ảnh màn hình thông báo lỗi.',
  ],
  mac: [
    'Bản cài bên Linh bấm vẫn bật, nhờ ai dùng máy Apple kiểm tra thử.',
    'hiện máy kia là macbook á, cho biết mở bản arm64 có được không nha',
    'Windows qua hết rồi, để Quỳnh chạy thử app trên macOS rồi đưa log.',
    'Run the smoke checks on an authorized MacBook near serial rollout.',
    'Nhờ chạy kiểm tra ký app trên Apple Silicon có quyền trong nhóm.',
    'tui cần check có xài được trên mac của Duy không, máy tui PC',
    'Chỉ cần xác minh trên Darwin vì vị trí tệp cấu hình khác máy tôi.',
    'Can someone on macOS confirm the updater starts outside Terminal?',
  ],
  handoff: [
    'Em giao Linh ra bảng thiết kế, khi có bảng đó Hân mới làm trang đặt chỗ.',
    'Nam chuẩn bị dữ liệu rồi chuyển file kết quả cho Quỳnh vẽ biểu đồ giùm.',
    'thằng đầu cắt ảnh ra, con kia lấy mấy ảnh đó mới dựng trang nha',
    'Have Ada export the API contract. Start Ben as soon as the contract is available.',
    'Khánh lên wireframe. Khi Khánh xong thì Linh dựa theo đó bổ sung CSS.',
    'Cần báo cáo lỗi của An trước để Chi viết hướng dẫn xử lý theo báo cáo.',
    'Cho Hưng tạo bảng tên trường, bàn giao đúng bảng đó cho agent dựng form.',
    'Nhiệm vụ của Duy phải đợi Minh hoàn tất tài liệu đầu vào.',
  ],
  review: [
    'Cậu nhờ một AI khác nhìn bản sửa của Dương thử có tính sai phí không.',
    'anh kia vừa sửa xong luồng lưu, cho agent độc lập soi xem có regression nha',
    'Bạn đừng tích hợp trước khi một người khác đọc patch và báo lỗi rõ ràng.',
    'Give this proposed change to a second harness for read-only review before merge.',
    'Cho ai khác tác giả rà diff xử lý tiền tệ và tìm lỗi ở hàng trống.',
    'Code bot vừa xong. Nhờ reviewer chỉ ra test bị thiếu và cho verdict.',
    'Mai xem kỹ thay đổi của Bắc, đặc biệt đoạn xử lý dữ liệu không có giá trị.',
    'Patch is ready for an independent correctness and test-coverage check.',
  ],
  scope: [
    'Ơ tụi nó cùng sửa thanh menu rồi, cho mỗi bên làm file khác đi.',
    'mình đã có đúng patch đó ở branch rồi, dẹp lượt trùng giùm',
    'Hai người cùng muốn đổi phần bộ lọc, nhớ chỉ có một chủ nhiệm vụ.',
    'Prevent two writable jobs from touching the same path during this run.',
    'Đoạn đổi nút lưu vừa merge sáng nay rồi, coi lại trước khi tạo bản thứ hai.',
    'Cả hai đang chỉnh một file config; giữ lượt của Minh, agent kia chờ.',
    'Hai hãng AI cứ định lặp cùng patch, tách scope code rõ để chỉ một bên làm.',
    'Can we keep one edit owner per path and reuse changes already committed?',
  ],
  chat: [
    'Mình kể cho bạn nghe thôi nhé, chưa nhờ Sade chạy gì cả.',
    'hỏi thăm tình hình xíu thôi, khoan ping bot',
    'Lưu ý nhóm đã nói chuyện về app trên Mac. Đừng giao tác vụ nào.',
    'This is an FYI for the human team. No harness should run yet.',
    'Cho mình gửi lời cảm ơn, ai có thông tin thì nhắn, AI không cần làm.',
    'Trao đổi nội bộ thôi. Phiên điều phối để hôm khác bật.',
    'ghim ý tưởng đó lại chat thôi, đừng nhờ con AI làm',
    'Just checking with the people here. Please leave all agents idle.',
  ],
};

function route(scenario: string) {
  if (scenario === 'platform' || scenario === 'no-platform') return 'mac';
  if (Object.hasOwn(goldens, scenario)) return scenario;
  return 'general';
}

const styles = {
  natural: (message: string) => message,
  unaccented: (message: string) =>
    `mn oi, ${message}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replaceAll('đ', 'd'),
  mixed: (message: string) => `Team update for the release branch. ${message}`,
};
const args = process.argv.slice(2);
const contrastive = args.includes('--contrastive');
const extraContext = args.includes('--context-pairs');
if (extraContext && !contrastive) throw new Error('--context-pairs requires --contrastive.');
const target = path.resolve(
  args.find((arg) => arg !== '--contrastive' && arg !== '--context-pairs') || '.local/sade-qwen',
);
const corpus = sharedSadeCorpus().map(({ id, message, style, scenario }) => ({
  id,
  message,
  style,
  route: route(scenario),
}));
const holdout = Object.entries(goldens).flatMap(([route, messages]) =>
  messages.flatMap((message, index) =>
    Object.entries(styles).map(([style, render]) => ({
      id: `golden/${route}/${index + 1}/${style}`,
      route,
      style,
      message: render(message),
    })),
  ),
);
const pairRows = (rows: typeof trainingPairs, split: string) =>
  rows.flatMap(([route, request, chat], index) =>
    Object.entries(styles).flatMap(([style, render]) => [
      { id: `${split}/${index + 1}/${style}/work`, route, style, message: render(request) },
      { id: `${split}/${index + 1}/${style}/chat`, route: 'chat', style, message: render(chat) },
    ]),
  );
const pairs = extraContext ? [...trainingPairs, ...contextPairs] : trainingPairs;
const train = contrastive ? [...corpus, ...pairRows(pairs, 'contrastive')] : corpus;
const challenge = contrastive ? pairRows(challengePairs, 'challenge') : [];
const acceptance = contrastive ? pairRows(acceptancePairs, 'acceptance') : [];
const all = [...train, ...holdout, ...challenge, ...acceptance];
if (new Set(all.map((item) => item.message)).size !== all.length)
  throw new Error('Training and evaluation messages must be distinct.');
await mkdir(target, { recursive: true });
const splits = [
  ['train', train],
  ['holdout', holdout],
] as const;
for (const [name, data] of contrastive
  ? [...splits, ['challenge', challenge] as const, ['acceptance', acceptance] as const]
  : splits)
  await writeFile(
    path.join(target, `${name}.jsonl`),
    `${data.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
console.log(
  JSON.stringify({
    train: train.length,
    holdout: holdout.length,
    challenge: challenge.length,
    acceptance: acceptance.length,
  }),
);
