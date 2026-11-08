# Kivuno 0.8.0

Website: https://kivuno.vercel.app

## Sử dụng

Mỗi cuộc thi nên có một project/group riêng và chọn các teammate tham gia. Dán link HTTPS của cuộc thi vào chat. Kivuno chuẩn bị hồ sơ **Research**, tự đọc các liên kết liên quan đến luật, FAQ, tiêu chí chấm, nguồn tham khảo, lịch nộp và bài thi cũ. Một link được nhiều teammate sử dụng trong cùng hồ sơ chỉ được đọc một lần.

Teammate nhận hồ sơ cùng các công cụ `competition_read`, `competition_fetch`, `competition_note`. Nó phải kiểm tra từng nhóm thông tin, tìm các bài thi/winner của các năm trước, ghi nguồn và chia sẻ kết quả. Ghi nhận “verified” cần có đoạn dẫn chứng khớp nội dung nguồn đã tải. Các phần chưa xác minh vẫn hiện **unknown**; trang cần đăng nhập, PDF, nội dung JavaScript hoặc lỗi mạng được báo để nhờ người dùng qua Browser. Agent có thể dùng công cụ tìm kiếm sẵn có của client để tìm archive không được liên kết trực tiếp.

Mỗi hồ sơ tự đọc tối đa 16 URL ban đầu; teammate có thể mở rộng đến 32 nguồn. Mỗi trang giới hạn 1 MB, văn bản lưu tối đa 50.000 ký tự và có phân trang khi đọc. Có tối đa hai yêu cầu đọc nguồn đồng thời trong workspace. Đây là giới hạn tài nguyên của bản miễn phí, không phải cam kết đã đọc toàn bộ Internet. **Refresh sources** tải lại nguồn, lưu bản ghi trước đó và xóa trạng thái xác minh cũ để tránh dùng luật đã thay đổi.

Sau khi lập kế hoạch, workflow cuộc thi chờ **Approve plan** trong Workroom trước khi triển khai. Kiểm tra các mục unknown, deadline/timezone và yêu cầu nộp trước khi duyệt. Agent không được lấy nội dung website làm quyền đăng ký dịch vụ trả phí, gửi thông tin hoặc tự nộp bài.

## Nhiều cuộc thi, một ngân sách usage

Một teammate có thể nằm trong nhiều workflow. Quyền thực thi vẫn gắn với từng task/session, worktree và phạm vi file; không giữ độc quyền cả tài khoản chỉ vì nó là thành viên một workflow.

`portfolio_read` và ngữ cảnh đầu mỗi lượt cho teammate biết các project, deadline, task đang chờ, session đang chạy và usage chung. Khi dùng Auto, model/reasoning được chọn từ catalog thật của tài khoản, theo độ phức tạp và số dự án đang cần xử lý. Công việc thông thường ưu tiên model nhẹ nếu có nhiều dự án hoặc ít usage vượt ngưỡng dự trữ; kiến trúc, bảo mật, debug và tổng hợp kế hoạch giữ reasoning mạnh. Chế độ Manual vẫn do người dùng chọn. Đây là chính sách tiết kiệm, không phải dự đoán chính xác số token hoặc phần trăm sẽ tiêu thụ.

Hàng đợi ưu tiên dự án ít được phục vụ gần đây; deadline dùng để phân định khi mức ưu tiên bằng nhau. Giới hạn máy, máy SSH bận, giới hạn tài khoản, quota dùng chung và các lease vẫn được kiểm tra. Session chưa thể bắt đầu vì hết slot được giữ với prompt gốc; không đánh dấu hoàn thành hoặc phát lại một lượt khởi động chưa rõ kết quả. User pause vẫn ngăn tự tiếp tục.

Codex/Gemini native nhận các công cụ Research và Portfolio. Claude Code/Antigravity qua MCP cũng nhận Research; token external vẫn chỉ đọc chi tiết project được cấp, còn workload dự án khác chỉ hiện số lượng. Việc đổi model/reasoning bên client external vẫn do client đó điều khiển. Quota không xác minh được vẫn cần allowance giới hạn lượt, không giả lập usage.

## Các kịch bản stress đã xét

Kiểm chứng bản phát hành: 251 tests qua, một test Linux boot-identity được bỏ qua trên Windows; build TypeScript/Vite, UI chat/Research, portal/auth và desktop Electron đều qua. Bộ đọc HTTPS cũng đã thực hiện thành công một GET công khai không dùng model.

| Kịch bản                                             | Cách xử lý / kiểm tra                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 cuộc thi cùng dùng 4 tài khoản                    | Bài kiểm tra workflow thật với protocol peer kiểm soát: tối đa 4 lượt đang chạy, cả 10 project nhận được lượt, không trùng lease.                              |
| 10 hồ sơ cùng tải nguồn                              | Fixture HTTP kiểm soát xác nhận tối đa 2 lượt đọc, không nhân đôi crawl khi gọi lại.                                                                           |
| Một teammate thuộc nhiều project                     | Cho phép nhiều workflow; tài khoản đang sở hữu task vẫn chặn task khác chiếm lease.                                                                            |
| Nhiều deadline gần nhau                              | Deadline phân định lượt chờ có ưu tiên bằng nhau; project đã được phục vụ phải nhường lượt. Nguồn lực hữu hạn không bảo đảm hoàn thành mọi cuộc thi trước hạn. |
| Tất cả quota thấp / hết quota / quá hạn cho phép     | Giữ các kiểm thử quota, hạn sử dụng allowance và chặn provider exhaustion. Không lấy allowance project này áp cho project khác.                                |
| Một máy offline hoặc SSH đang train                  | Admission giữ công việc chờ; không tạo model turn trên máy không sẵn sàng.                                                                                     |
| Máy đầy slot đúng lúc gửi prompt                     | Session giữ prompt gốc ở hàng đợi capacity; không tạo thêm một task mới để thử lại.                                                                            |
| Website lỗi, login, PDF hoặc JS                      | Nguồn unavailable và coverage unknown; không báo đã hiểu luật. Dùng Browser khi cần.                                                                           |
| URL nội bộ / metadata cloud / DNS rebinding          | Chỉ GET HTTPS công khai, kiểm tra từng redirect và ghim IP DNS đã duyệt; không gửi cookie hoặc credential.                                                     |
| Nguồn chứa chỉ dẫn giả mạo                           | Nguồn được đánh dấu untrusted; không cấp quyền chạy code, chi tiền hay thay đổi bảo mật.                                                                       |
| Agent ghi chứng cứ không có trong trang              | `competition_note` từ chối verified nếu không khớp đoạn dẫn chứng.                                                                                             |
| Luật thay đổi sau lần đọc đầu                        | Refresh tải lại và bỏ xác minh cũ; bản ghi trước được giữ để đối chiếu.                                                                                        |
| Mất kết nối hoặc gửi lại chat                        | Client request ID và claim nguyên tử ngăn nhận trùng prompt.                                                                                                   |
| Restart khi đang khởi động                           | Workflow và lượt khởi động không chắc chắn dừng để kiểm tra; không tự chạy model lại.                                                                          |
| Người dùng pause trong lúc preflight                 | Fencing ngăn lượt khởi động trễ; pause không bị coi là quota recovery.                                                                                         |
| Nhiều provider, model không hỗ trợ reasoning đã chọn | Kiểm tra catalog và policy trước lượt model; không bịa tên model hoặc số usage.                                                                                |

Các stress test sử dụng store, scheduler, workflow và HTTP route thật với nguồn/protocol model kiểm soát. Không tiêu hao lượt tài khoản thật, không dùng paid API và không thể thay thế một cuộc thi thật kéo dài nhiều ngày trên nhiều máy vật lý. Chưa có cam kết về xếp hạng, kết quả cuộc thi hoặc việc nộp bài tự động.
