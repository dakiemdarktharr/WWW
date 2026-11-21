# Kivuno · Team1 Vietnam UniHack 2026

**Đội NoSleepClub · Ý tưởng tự chọn · Avalanche Fuji**

Kivuno là ứng dụng desktop giúp nhóm dùng Codex, Claude và Antigravity trong cùng một dự án. Nhóm chọn tài khoản và thành viên, duyệt kế hoạch, theo dõi các việc được giao, xem diff rồi quyết định tích hợp thay đổi vào Git.

## Bắt đầu

| Mục | Đường dẫn |
| --- | --- |
| Ứng dụng và bản tải | [Kivuno](https://kivuno.vercel.app/) |
| Mã nguồn công khai | [GitHub · dakiemdarktharr/WWW](https://github.com/dakiemdarktharr/WWW) |
| Chạy demo checkout | [Hướng dẫn QR và quyền gói](KIVUNO-BANK-DEMO.md) |
| Kiểm chứng kết quả | [Biên nhận Max](../public/kivuno-qr-fuji.json) · [Giao dịch Fuji](https://build.avax.network/explorer/fuji/c-chain/tx/0xa84e75b8c8524e6c307a3121092cde377cdb4a525e7d0785422d00bc87e1eb97) |
| Thể lệ và hồ sơ | [Team1 Vietnam UniHack](https://team1vn.xyz/) · [Đối chiếu yêu cầu Avalanche](KIVUNO-UNIHACK-CHECK.md) |

## Kịch bản demo

1. Trong **Team**, kết nối tài khoản được phép sử dụng. Trong **Neralu**, tạo dự án Git và chọn thành viên.
2. Trong **Workroom**, gửi yêu cầu và duyệt kế hoạch. Các nhiệm vụ độc lập có thể chạy song song. Người phụ trách vào **Reviews** để xem diff và duyệt tích hợp.
3. Với demo checkout, chạy `npm run dev:fuji-demo` và mở `/billing`. Chọn Max, xác nhận chuyển khoản VND mô phỏng và kiểm tra quyền gói 30 ngày. Không có khoản tiền thật trong demo.
4. Chạy `node scripts/fuji-qr-receipt.mjs verify` để đối chiếu mẫu Max đã công bố. Công cụ tính lại mã cam kết và kiểm tra giao dịch đã final trên Fuji C-Chain, chain ID 43113, block 61.332.957. Bản ghi công khai đủ để kiểm chứng mà không cần database của lần chạy gốc.

Đơn QR và quyền gói được xử lý trong Kivuno. Ví phát hành dùng test AVAX làm phí gas và công bố mã băm qua giao dịch giá trị 0 AVAX. Fuji cung cấp một bản ghi độc lập để đối chiếu kết quả do Kivuno phát hành. Sổ ngân hàng trong demo là mô phỏng. [Chi tiết triển khai Fuji](KIVUNO-FUJI-DEPLOYMENT.md) · [Định hướng thu phí tại Việt Nam](KIVUNO-VN-PAYMENTS.md).

## Trạng thái công khai ngày 21/11/2026

| Thành phần | Trạng thái đối chiếu |
| --- | --- |
| GitHub | Repo công khai, nhánh mặc định `main`. [Lịch sử commit](https://github.com/dakiemdarktharr/WWW/commits/main/) |
| Windows x64 / Linux x64 | Feed công khai trả về bản **0.9.3** và checksum SHA-256 cho từng bộ cài. |
| macOS Apple Silicon | Feed công khai trả về bản **0.9.2**. [GitHub Release v0.9.2-macos-r4](https://github.com/dakiemdarktharr/WWW/releases/tag/v0.9.2-macos-r4) |
| Demo Avalanche | Đã chạy lại trình xác minh cho mẫu biên nhận Max và xác nhận giao dịch ở block 61.332.957. |

[Feed phiên bản chính thức](https://kivuno.vercel.app/api/desktop/release) cung cấp đường dẫn và checksum đang phục vụ.
