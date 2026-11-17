# Thông báo quyền riêng tư Kivuno — dự thảo

Ngày soạn: 17/11/2026. Liên hệ thử nghiệm: **daethphate@gmail.com**. Chưa công bố: còn thiếu danh tính/địa chỉ bên kiểm soát dữ liệu, vùng lưu trữ, hợp đồng nhà cung cấp và lịch lưu giữ đã được kiểm chứng.

## Dữ liệu và mục đích

| Dữ liệu                                                       | Vì sao cần                                                  | Người nhận có thể có                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tên, email, thông tin xác thực và phiên đăng nhập             | Tạo tài khoản, đăng nhập, bảo vệ tài khoản                  | Hạ tầng cloud của bên vận hành; dịch vụ email khi được triển khai                  |
| Prompt, chat, phản hồi, tệp và phần code cần cho công việc    | AI thực hiện yêu cầu, Sade chia việc và review              | Thành viên được cấp quyền, provider AI của phiên làm việc, máy chạy được cấp quyền |
| Trạng thái model, quota, công việc, phạm vi tệp, log kỹ thuật | Điều phối, chống làm trùng, xử lý lỗi và kiểm tra hoạt động | Bên vận hành và người quản lý dự án theo quyền thực tế                             |
| Thiết bị được ghép nối, grant và token kết nối                | Xác thực desktop/runner và thu hồi truy cập                 | Các thành phần điều phối và thiết bị liên quan                                     |

Việc chỉ kết nối thư mục không đồng nghĩa tự xuất bản lên GitHub. Tuy nhiên, khi dùng AI, nội dung cần cho công việc có thể được truyền đến provider đó. Không đưa dữ liệu cá nhân nhạy cảm hoặc secret vào prompt khi không cần thiết. Bộ lọc secret hiện có không phát hiện được mọi dạng thông tin riêng tư.

## Căn cứ và lựa chọn

Trước khi công bố, bên vận hành phải xác định căn cứ pháp lý theo từng mục đích và khu vực. Không dùng “đồng ý với ToS” làm căn cứ mặc định cho mọi xử lý. Các chức năng tùy chọn như marketing, dùng nội dung để huấn luyện, hoặc chia sẻ sang provider mới cần chính sách và lựa chọn riêng phù hợp; bản dự thảo này không cho phép tự bật chúng.

Quyền chạy AI trên máy khác chỉ được dùng sau khi chủ máy và chủ tài khoản liên quan cấp quyền phù hợp. Chia sẻ project không đồng nghĩa chia sẻ mật khẩu hoặc toàn bộ ổ đĩa.

## Nhà cung cấp và chuyển dữ liệu

Trước khi xử lý dữ liệu thật, danh sách công bố cần ghi pháp nhân nhà cung cấp, mục đích, dữ liệu gửi, quốc gia/vùng, retention, chính sách huấn luyện và cơ chế chuyển dữ liệu áp dụng. Cấu hình hiện có sử dụng Vercel cho web/hạ tầng; AI phụ thuộc kết nối người dùng. Resend mới qua bước chấp nhận điều khoản, chưa tạo được dịch vụ email do chưa có tên miền gửi xác minh.

Không khẳng định dữ liệu chỉ ở Việt Nam/EU hoặc không dùng để huấn luyện khi chưa xác minh hợp đồng và cài đặt đúng loại tài khoản. Quyền đối với bản sao tại nhà cung cấp cần được xử lý theo vai trò và hợp đồng tương ứng.

## Lưu giữ, quyền và bảo mật

Lịch lưu giữ phải quy định riêng tài khoản, chat, code, log sự cố, grant, email và backup. Hiện chưa có đủ bằng chứng về cơ chế tự động xóa theo lịch; không công bố một thời hạn xóa mà hệ thống chưa thực thi. Token khôi phục dự kiến có hạn 15 phút và dùng một lần, nhưng chức năng gửi/đặt lại mật khẩu chưa được bật.

Bạn có thể liên hệ **daethphate@gmail.com** về truy cập, sửa, xuất, xóa, hạn chế, phản đối hoặc rút lại đồng ý khi áp dụng. Trước khi mở rộng thử nghiệm phải có quy trình xác minh, theo dõi thời hạn pháp lý và thực hiện yêu cầu trên cả nhà cung cấp/backup. Quyền khiếu nại với cơ quan có thẩm quyền không bị hạn chế bởi việc liên hệ chúng tôi trước.

Mã nguồn có HTTPS/cookie bảo mật khi cấu hình HTTPS, phân quyền dự án, giới hạn phạm vi, ghép nối thiết bị và che một số secret. Điều này không tự chứng minh mã hóa đầu cuối, mã hóa toàn bộ dữ liệu lưu trữ hoặc kiểm toán bảo mật độc lập. Các tuyên bố đó chỉ được bổ sung sau khi có bằng chứng.
