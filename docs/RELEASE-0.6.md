# Kivuno 0.6

## Giao diện

Ba demo trên web là ba phần liên tiếp: **Chia việc → Bàn giao → Review**. Từng chat bubble xuất hiện theo tiến độ cuộn và thu lại khi cuộn ngược. Reduced motion hiển thị trọn nội dung. Menu, giới thiệu, demo, tải app và hộp đăng nhập hỗ trợ Việt/Anh, lưu lựa chọn trên thiết bị. Đổi ngôn ngữ không xóa dữ liệu đang nhập trong hộp đăng nhập. Các mô tả phụ và chrome demo thừa đã được bỏ; giữ nhãn thao tác, nội dung chat, lỗi và lựa chọn cấp quyền.

Geist được self-host cùng subset tiếng Việt. Kiểm tra Chrome rendered-font cho tiêu đề có dấu cho kết quả Geist, không dùng font fallback. App giữ ocean/mint/ivory và glassmorphism ở các panel.

Tạo dự án có **No deadline** mặc định và lựa chọn đặt ngày giờ. Giá trị được chuyển từ múi giờ thiết bị sang ISO có timezone, kiểm tra ngày không hợp lệ. Titlebar còn ba nút: thu nhỏ, maximize/restore, đóng xuống tray; fullscreen dùng F11.

## Cộng tác đa provider

Team và nhóm có thể chứa nhiều profile Codex, Gemini và Claude. Profile cũ được hiểu là Codex. Provider hiện rõ ở Team, roster và Session graph; mỗi session vẫn là một conversation riêng.

- **Codex:** App Server thật, đăng nhập ChatGPT, catalog model/reasoning và telemetry quota hiện có.
- **Gemini:** CLI chính thức 0.66.0, ACP, profile Google riêng. Chỉ Google OAuth, không nhận API key hay tự chuyển Vertex/API. Catalog model từ ACP; không hiển thị reasoning nếu giao thức không hỗ trợ. Khi không có phần trăm quota, người dùng cấp số prompt và thời hạn giới hạn, có thể thu hồi. File tools giới hạn vào worktree/scope; chưa có shell tự chạy trong adapter này. Quyền file cần xác nhận và không được gọi là OS sandbox.
- **Claude:** client do người dùng tự chạy kết nối [MESH MCP](EXTERNAL-MESH.md), có room/mentions/reactions, task claim, checkpoint và review chung. Kivuno không quản lý đăng nhập thuê bao hoặc gọi model Claude. Quyền/task allowance mặc định tắt, token giới hạn nhóm và thời gian; không có API merge/approve/spend trong bridge.

Model và reasoning không được ánh xạ mù giữa provider. Ngữ cảnh cộng tác là mục tiêu, scope, evidence, task dependencies, tin nhóm và Git checkpoint; không chia sẻ credential hoặc ép trao đổi suy luận nội bộ. Gemini chưa chạy remote; Claude external chưa tham gia managed workflow hoặc được Kivuno tự khởi động khi idle. Xem [provider capabilities và nguồn chính thức](PROVIDERS.md).

## Kiểm chứng và giới hạn

Bộ unit/integration có **216 test pass**. TypeScript, format check và production build đều pass. Các kiểm tra riêng cho provider, recovery và cloud login cũng pass sau lần chỉnh cuối.

Portal E2E kiểm tra ba phần riêng, cuộn thuận/ngược, Việt/Anh, persistence, auth/consent, reduced motion và mobile. Cloud UI test kiểm tra provider selector, quyền Gemini giới hạn, No deadline và không cung cấp cầu nối localhost trên cloud. Electron thật kiểm tra ba nút titlebar/F11, browser hiện có và tạo/thu hồi cấu hình MCP trong backend local.

MCP được kiểm tra bằng process stdio thật nối HTTP local thật, cùng các trường hợp hết quyền, thu hồi, chống nhận task trùng, kiểm soát scope, giữ khóa recovery, checkpoint đúng tác giả và chặn credential. Gemini được kiểm tra với binary chính thức ở trạng thái chưa đăng nhập và các fixture ACP; test không đăng nhập hộ người dùng hoặc gọi model trả phí.

Bản `.exe` Windows 0.6 cũng đã mở workspace thật với PATH chỉ có thư mục hệ thống: Node 24.22.1, Git 2.56.0, Codex 0.166.0 và Gemini 0.66.0 đều dùng bản đóng gói. MCP bridge có trong installer, API local có bảo vệ, không có lỗi renderer và SHA-256 của installer khớp manifest.

Kiểm thử bằng nhiều tài khoản provider đã đăng nhập và model turn thật vẫn cần người dùng tự thực hiện. Không mua gói, không nạp ví và không triển khai blockchain trong lượt này. AEGIS, cloud browser streaming và custom gas coin giữ nguyên các giới hạn đã ghi trong bản trước.
