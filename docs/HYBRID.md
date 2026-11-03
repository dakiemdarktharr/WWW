# Tài khoản tự quản và nhiều máy

Trong **Team**, chọn **Machine → Add account**, rồi đăng nhập trên trang device-code của OpenAI. RELAY đặt tên Atlas, Vega, Nova…; tài khoản đã đăng nhập tự tham gia group của mọi project. Một tài khoản gắn với một máy và có `CODEX_HOME` riêng. Đăng nhập trên máy khác không sao chép token từ máy cũ.

## Cloud, máy cá nhân, lattice

- Cloud giữ SQLite, MESH, quota, task leases, Git worktree và quyền chủ workspace. Giao diện trên Vercel dùng được từ nhiều thiết bị.
- Máy cá nhân/lattice chạy `server/runner-agent.ts`, kết nối HTTPS đi ra. Không mở cổng vào, không cần localhost hoặc popup giữ kết nối. Codex chạy bằng App Server stdio chính thức trên máy đã chọn.
- Mặc định cloud nhận 2 lượt; máy cá nhân 2; máy SSH/training 1. Mỗi tài khoản còn có giới hạn conversation riêng. Busy/offline giữ công việc chờ; không giả mạo usage hay chuyển credentials để vượt quota.
- Cấu hình lattice giới hạn nice 15, CPU quota 50% của **một core**, MemoryHigh 768 MB, MemoryMax 1 GB. Runner kiểm tra load/RAM trước khi nhận lượt mới, ẩn GPU qua biến môi trường. Đây không phải chặn GPU ở cấp hệ điều hành. Không chỉnh hay dừng training job.

**Pair machine** tải cấu hình riêng cho máy mới. Giữ file ngoài repository, chỉ owner được đọc. Dùng Node 24.22.1 và dependencies từ `npm ci`:

```sh
node --import tsx server/runner-agent.ts /absolute/path/relay-machine.private.json
```

Token máy chỉ dùng ở `/api/runner/exchange`, không đăng nhập được giao diện owner. SSH dùng để cài/chăm sóc tiến trình; cloud không cần truy cập IP tailnet của lattice.

## Conversation và capabilities

Conversation mới mặc định **Automatic model selection**. Bộ chọn dùng `model/list` của tài khoản: task phức tạp/review ưu tiên reasoning cao; việc nhẹ ưu tiên model nhỏ nếu catalog có. Đây là heuristic, không phải bộ tối ưu đã học. Có thể chọn model/reasoning thủ công.

Tool `mesh_create_conversation` tạo conversation cùng project/account, tối đa 8 conversation mở; prompt xếp hàng theo quota, capacity và scope. Conversation chỉ đọc không tạo conversation ghi file. Sau restart, hàng đợi chưa chắc đã chạy chuyển sang paused để người dùng xem và tiếp tục rõ ràng.

Skills đủ điều kiện được sao chép thành phiên bản có hash/provenance khi tài khoản rảnh. Bỏ qua symlink, file xác thực/cấu hình, secret nhận diện được, skill quá lớn; giữ nguyên bản đã có ở tài khoản nhận. Đồng bộ giữa các máy dùng cùng kiểm tra. Plugins chỉ được cài khi tài khoản nhận thấy cùng plugin/marketplace trong catalog thật; yêu cầu kết nối dịch vụ chuyển lên MESH. Không sao chép quyền truy cập dịch vụ, tự mua gói hoặc bảo đảm mọi plugin local có thể di chuyển.

## File, handoff và recovery

Máy nhận snapshot source vào Git repository riêng của task. Giới hạn: **2 MB source, 2.000 file, 512 KB/file**; không chuyển `.git`, `.env`, credentials, symlink hoặc dữ liệu train lớn. Snapshot không chuyển lịch sử Git đầy đủ hay dependencies đã cài.

Khi lượt hoàn tất hoặc tiến trình được dừng, cloud kiểm tra hash gốc, scope và lease trước khi nhận output. Checkpoint/handoff vẫn diễn ra ở cloud với author owner đã cấu hình. Lệnh đã giao không được phát lại khi mất phản hồi. Mất liên lạc khóa task cho recovery; máy dừng tiến trình nó quản lý khi không liên lạc được cloud. Coordinator mới yêu cầu máy xác nhận đã dừng tiến trình cũ trước khi cho recovery. Kết quả trễ không được sửa task đã đổi chủ.

Output lỗi đồng bộ được giữ trên máy nguồn; packet đã nhận còn lưu trong bảng `remoteRecovery`, tải qua `/api/sessions/<session-id>/remote-output` bằng phiên owner. Nếu agent bị kill đột ngột, `runner-active.json` buộc kiểm tra tiến trình cũ trước khi xóa marker và khởi động lại. Không xóa marker trong khi Codex cũ còn chạy.

Cloud miễn phí vẫn có thời gian chạy mỗi đợt và hạn mức tháng. Machine polling **không đánh thức** sandbox đang ngủ; mở web để tiếp tục. Hybrid không biến hạ tầng miễn phí thành server 24/7 và không tự mua thêm tài nguyên.

## Kiểm chứng

Tests dùng protocol peer để kiểm tra machine authentication, epoch fencing, capacity, delivery không lặp, snapshot/scope, model parameters, skills và late output mà không tiêu usage. Browser test dùng owner auth/Fastify/SQLite thật ở hai browser context. Startup máy chạy `account/read` trên App Server thật trong diagnostic home trống; không đăng nhập hay tạo model turn. Luồng model với các tài khoản thật cần owner tự đăng nhập để thử.
