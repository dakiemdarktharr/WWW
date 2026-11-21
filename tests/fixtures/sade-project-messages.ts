import type { SadeProjectKind } from '../../shared/sade-project.ts';

export const projectMessages: { text: string; kind?: SadeProjectKind; label: string }[] = [
  {
    kind: 'paper-and-slides',
    label: 'casual Vietnamese',
    text: '@Sade soạn giúp tụi mình một paper ngắn về cách người đi chợ ghi nhớ giá. Kèm vài slide PowerPoint để mình nói trong 8 phút.',
  },
  {
    kind: 'storefront',
    label: 'casual Vietnamese',
    text: 'Bọn mình mới bán bánh gạo lứt và trà rang. Nhờ cả nhóm dựng cho mình web bán hàng, coi ảnh catalogue trước để hiểu từng gói nha.',
  },
  {
    kind: 'sales-dashboard',
    label: 'concise Vietnamese',
    text: '@Sade tôi muốn một dashboard bán hàng cho các quầy lưu động. Số từ file chốt ca, cho xem theo tuần và điểm bán giúp tôi.',
  },
  {
    label: 'quoted old work',
    text: 'Mình paste lại câu “hãy dựng storefront cho tiệm mứt” để lưu bối cảnh. Ý đó đã đóng hôm qua, cả nhóm khỏi mở thêm việc.',
  },
  {
    kind: 'paper-and-slides',
    label: 'formal English',
    text: 'Please coordinate a research paper and presentation deck on night-train adoption. Compare two cities and document how the passenger estimates were derived.',
  },
  {
    kind: 'storefront',
    label: 'English with preference',
    text: 'Could you build a storefront for our reclaimed tile shop? There is a public catalogue at https://example.com/tile-samples. We take enquiries by email, so base the buying flow on enquiries.',
  },
  {
    kind: 'sales-dashboard',
    label: 'formal English',
    text: 'Please build a revenue analytics dashboard for our three touring venues. Confirm how refunds and voucher redemptions affect the daily totals before you implement them.',
  },
  {
    label: 'information only',
    text: 'FYI, the committee finally saw the academic article and its slides. They plan to come back with their comments on Friday.',
  },
  {
    kind: 'paper-and-slides',
    label: 'Vietnamese plus English',
    text: 'Chốt giúp mình một bài báo về tác động của bóng cây lên chỗ đón xe buýt, có literature review rồi làm bộ slide thuyết trình nữa. Dữ liệu vẫn đang xin.',
  },
  {
    kind: 'storefront',
    label: 'formal Vietnamese',
    text: 'Xin thiết kế trang thương mại điện tử cho xưởng sản xuất lược tre. Trước hết hãy xem trang giới thiệu hiện có và hỏi chúng tôi cách bán theo lô cho đại lý.',
  },
  {
    kind: 'sales-dashboard',
    label: 'unaccented Vietnamese',
    text: 'Sade lam dum cai bang theo doi doanh thu cho xe ca phe nha. Minh co so ca sang va ca chieu, voi cot ly hoan tien.',
  },
  {
    label: 'narrow correction',
    text: 'Astra của Bình chỉ sửa chuỗi thông báo ở fixtures/coffee-cart/OrderDashboardEmptyCard.tsx. Storefront và dashboard bán hàng đều đã chạy rồi, giữ nguyên phần khác.',
  },
  {
    kind: 'paper-and-slides',
    label: 'formal Vietnamese',
    text: 'Tôi cần nhóm viết bài nghiên cứu so sánh cách hai bảo tàng ghi nguồn ảnh lưu trữ. Bàn giao file LaTeX, PDF và một bộ trình chiếu mười phút cho buổi tập huấn.',
  },
  {
    kind: 'storefront',
    label: 'mixed Vietnamese',
    text: 'Làm giúp mình cái site bán hàng cho đồ cắm trại mini. Cho mình coi preview trước buổi triển lãm, mục mua có thể gửi câu hỏi đặt hàng thôi.',
  },
  {
    kind: 'sales-dashboard',
    label: 'casual English',
    text: 'Can you make us a sales dashboard for the record fair? I want to spot when stalls ran out of stock, compare morning and afternoon, and see returns by date.',
  },
  {
    label: 'hold',
    text: 'Khoan làm dashboard bán hàng cho tiệm bánh nhé. Chưa gửi được dữ liệu vì file có mã đơn của khách. Mình sẽ nhờ lại sau khi làm sạch.',
  },
  {
    kind: 'paper-and-slides',
    label: 'concise English',
    text: 'Put together a white paper and slides on museum audio description. Keep the focus on visitor access and give the reviewers the source list.',
  },
  {
    kind: 'storefront',
    label: 'English with audience',
    text: 'We need an online shop for our ceramic planter kits. Most buyers live in apartments, and the kits come in starter and refill sizes. Help us plan and ship a working preview.',
  },
  {
    kind: 'sales-dashboard',
    label: 'decision before coding',
    text: 'Nhờ Sade dựng dashboard doanh số lớp dạy bơi. Mình muốn xem tỷ lệ đặt cọc và tiền thực thu theo cơ sở. Nếu thiếu định nghĩa tiền thực thu thì hỏi mình trước.',
  },
  {
    label: 'learn about feature',
    text: 'Chỉ hỏi để hiểu thôi, nếu sau này cần tạo web bán hàng thì Sade có đọc được ảnh catalogue không?',
  },
  {
    kind: 'paper-and-slides',
    label: 'formal request with evidence',
    text: 'We need to produce a research article and a short PPTX about library return patterns. Use the previous month’s logs and avoid claiming seasonality from one month.',
  },
  {
    kind: 'storefront',
    label: 'short unaccented Vietnamese',
    text: 'Sade, tao web ban hang cho tiem den giay cua tui voi. Hang nhap ten goi theo hinh catalogue, can gia nao thieu thi cu hoi.',
  },
  {
    kind: 'sales-dashboard',
    label: 'formal Vietnamese',
    text: 'Hãy xây dựng bảng điều khiển doanh thu cho chương trình tham quan. Ban tổ chức cần xem doanh số vé theo kênh, buổi và nhóm tuổi, dựa trên bản tổng hợp đã ẩn danh.',
  },
  {
    label: 'status only',
    text: '@Sade dự án đến đâu rồi? Tối nay mình cần biết những gì đang kẹt trước khi họp với Vy.',
  },
  {
    label: 'same filename in history',
    text: 'Jen xem thử docs/expo/last-year-slides.md rồi nhắn tôi slide nào đang nhắc đến nhà tài trợ. Chỉ đọc để chuẩn bị cho buổi tổng kết.',
  },
];
