# Sade trong Shared Groups

## Kết nối và cấp quyền

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Quyền áp dụng cho một harness trên máy của chủ tài khoản, có thời hạn và số lượt giới hạn. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff cho người kiểm tra.

Máy của người cấp quyền cần hoạt động để thực hiện công việc. Khi quyền hết hạn hoặc bị thu hồi, người dùng cần cấp lại quyền trước khi Sade có thể tiếp tục sử dụng harness đó. Không coi việc chia sẻ teammate là quyền sử dụng tài khoản không giới hạn.

## Giao việc và theo dõi

Chọn **Ask Sade** và gửi yêu cầu. Sau khi gửi thành công, ô soạn quay về chế độ gửi tin nhóm thông thường. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời trong **Sade progress**. Gửi lại cùng tin nhắn không lập thêm workflow.

Để nhờ Sade kiểm tra việc đã nêu trong một tin cũ, chọn **Ask Sade about this** ngay dưới tin đó. Ô soạn hiển thị người gửi và bản xem trước để kiểm tra trước khi gửi. Yêu cầu mới phải thuộc đúng project của tin được tham chiếu.

Sade dùng tên chủ tài khoản và quyền của project để phân biệt các harness trùng tên. Nếu còn mơ hồ, dùng **Reply to Sade**. Nếu teammate chưa được cấp quyền, chủ tài khoản xác nhận trên desktop rồi người gửi báo lại trong cùng yêu cầu.

## Kế hoạch, review và giới hạn

Planner chọn teammate từ các quyền còn hiệu lực của project. Mã teammate ngoài danh sách được cấp quyền hoặc dependency không tồn tại bị từ chối. Việc phân công chỉ bắt đầu khi kế hoạch hợp lệ. Desktop giữ kết quả đầu tiên đã được chấp nhận của mỗi lượt; lời gọi lặp đúng nội dung không tạo thêm kết quả.

Harness thực hiện và reviewer nhận nhiệm vụ riêng. Worktree cách ly checkout nhưng không thay thế ranh giới bảo mật của hệ điều hành. Người dùng vẫn cần đọc kết quả review và duyệt các quyền được yêu cầu.

Xem [demo Sade](sade-demo.md), [luồng quyết định trên cloud](sade-decisions-cloud.vi.md), [kết nối provider](EXTERNAL-MESH.md) và [mô hình bảo mật](SECURITY.md). Bộ kiểm thử có thể chạy lại nằm trong [shared-sade.test.ts](../tests/shared-sade.test.ts) và [machine-execution.test.ts](../tests/machine-execution.test.ts).
