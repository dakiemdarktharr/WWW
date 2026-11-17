# Khôi phục mật khẩu: thiết kế và điều kiện kích hoạt

Mẫu email tại `server/reset-email.ts`; tạo bản xem trước desktop/mobile bằng `node --import tsx scripts/preview-reset-email.ts`. Ảnh/HTML ở `.local`. Không gửi email và không tạo reset token thật trong bước xem trước.

Hiện chưa bật quên mật khẩu trong production. Resend đã được chấp nhận điều khoản nhưng provisioning yêu cầu domain và region; chủ dự án xác nhận chưa có tên miền. `daethphate@gmail.com` là địa chỉ hỗ trợ/Reply-To dự kiến, không phải domain có thể xác minh cho From của Resend. Không mua tên miền hoặc tạo chi phí ngoài yêu cầu.

Sau khi có tên miền do chủ dự án quản lý DNS: hoàn tất integration, xác minh SPF/DKIM, cấu hình DMARC phù hợp, giới hạn API key gửi email, lưu secret trong môi trường server và runner cloud, kiểm tra nhà cung cấp/vùng xử lý. Không đưa key vào frontend hoặc repo.

Quy trình cần triển khai với Better Auth đã có:

1. Người dùng chọn Quên mật khẩu, nhập email. Trả lời chung bất kể tài khoản tồn tại; giới hạn theo IP và định danh email đã băm. Không khóa đăng nhập chỉ vì người khác gửi yêu cầu reset.
2. Sinh token ngẫu nhiên đủ mạnh, chỉ lưu dạng băm, hạn 15 phút, một lần sử dụng; liên kết cố định HTTPS cùng origin. Không nhận URL redirect tùy ý từ request. Không để việc GET của máy quét email tiêu thụ token.
3. Trang tạo mật khẩu mới không có tracking, đặt no-referrer, bỏ token khỏi URL hiển thị sau khi đọc; không ghi token trong log. Xác nhận mật khẩu theo chính sách hiện có, không tự đăng nhập sau reset.
4. Tiêu thụ token và đổi mật khẩu nguyên tử; hai POST đồng thời chỉ một thành công. Thu hồi session và đánh giá việc thu hồi desktop grants/token liên quan. Gửi thông báo thay đổi mà không kèm mật khẩu.
5. Kiểm thử tài khoản có/không có, rate limit, token sai/hết hạn/dùng lại, race, CSRF/origin, redirect độc hại, mail timeout/bounce, secret/log và session cũ. Kiểm thử gửi tới inbox thử nghiệm chỉ sau khi người vận hành chỉ định người nhận.

Nội dung “15 phút, một lần” trong mẫu là đặc tả thiết kế; chưa phải bằng chứng tính năng reset đang hoạt động. Không công bố email thành công khi nhà cung cấp chưa chấp nhận gửi.
