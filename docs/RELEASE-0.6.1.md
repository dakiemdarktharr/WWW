# Kivuno 0.6.1 — kiểm tra bộ cài và provider thật

Ngày kiểm chứng: 2026-11-05, Windows x64. Phạm vi người dùng chọn: **runtime, tools và MCP trước; người dùng tự đăng nhập thử hội thoại sau**. Không mua dịch vụ, không gọi API trả phí, không dùng model turn hoặc sao chép đăng nhập cá nhân.

## Các lỗi đã sửa

- **Bộ cài:** bản 0.6.0 có thể lỗi `Extract: error writing to file` khi chọn D nhưng C thiếu dung lượng. Archive và nội dung giải nén nay được đặt trong thư mục tạm riêng trên ổ cài đặt. Khi nâng cấp, uninstaller cũ cũng nhận TEMP/TMP trên ổ cài cũ, tránh di chuyển dữ liệu giữa hai ổ. Không cache thêm một bản installer đầy đủ trên C. Dự toán dung lượng đã tính cả staging.
- **Codex trên Windows:** profile mới chưa cấu hình sandbox khiến `workspace-write` bị trả về `readOnly`. Kivuno dùng quy trình sandbox chính thức ở chế độ không cần admin, rồi restart đúng App Server; lỗi setup chặn chạy task. Không chuyển sang full access. [Chi tiết và bằng chứng](CODEX-VERIFICATION.md).
- **Khởi động lại:** khóa coordinator kết hợp guard của hệ điều hành với định danh thời điểm tạo process. PID được tái sử dụng không làm workspace kẹt vĩnh viễn; hai coordinator không cùng nhận dữ liệu. Windows có thể trả `EPERM` cho PID đã thoát: Kivuno chỉ thu hồi khi OS xác nhận không còn process, vẫn giữ khóa nếu quyền hoặc trạng thái chưa rõ. Giữ khóa PID số để tương thích bản cũ, không giết process không rõ chủ. Cache định danh của chính process để giảm việc mở PowerShell khi máy bận; luôn đọc lại định danh PID khác.
- **Antigravity:** provider MCP riêng, không nhận diện nhầm thành Gemini CLI. Cả Claude Code và Antigravity bị loại khỏi các thao tác native không được hỗ trợ, gồm khởi chạy model, brainstorm tự động và remote runner. Hai provider vẫn có thể trao đổi, nhận task đã chuẩn bị và submit qua MCP.
- **Bảo vệ checkpoint:** chặn cấu hình MCP/Antigravity và nội dung chứa token MESH khỏi commit progress.

## Bằng chứng runtime

| Thành phần            | Kết quả                                                                                                                                                     | Giới hạn                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex CLI 0.166.0     | Bốn profile App Server thật; skill riêng; cài plugin local chứa skill; đọc/ghi worktree thật; từ chối ghi ngoài scope và trong read-only; nhận schema tools | Không gọi model, không kiểm tra plugin OAuth từ xa                                     |
| Gemini CLI 0.66.0     | ACP handshake/capability và trạng thái chưa đăng nhập từ binary thật                                                                                        | Không Google OAuth, không model turn; adapter giữ tool policy có scope, chưa bật shell |
| Claude Code 2.1.281   | CLI thật thêm cấu hình MCP tạm, health check qua bridge Kivuno thành công; thu hồi token làm health check thất bại                                          | Client đang chưa đăng nhập; chưa có vòng model → tool → submit                         |
| Antigravity CLI 1.5.0 | Binary chính thức khớp SHA-512, chữ ký Google LLC; đọc MCP config và ACP initialize thật                                                                    | `session/new` yêu cầu đăng nhập; chưa có MCP tool session hoàn chỉnh từ Antigravity    |
| Coordinator           | Test process thật: tranh khóa, crash/recovery, PID tái sử dụng, khóa legacy và release không xóa khóa thay thế                                              | Test boot ID chỉ chạy trên Linux; chưa kiểm tra GUI Linux/macOS                        |

Các profile kiểm thử nằm trong thư mục tạm riêng. Không thay PATH hay cấu hình provider của người dùng. Antigravity CLI kiểm chứng riêng, không tự cài vào máy hoặc đóng gói trong app. [Cách kết nối external MCP](EXTERNAL-MESH.md), [khác biệt capabilities và plugins](PROVIDERS.md).

## Kiểm tra có thể chạy lại

```sh
npm run format:check
npm test
npm run build
npm run test:codex-native
npm run test:claude-native
npm run test:cloud
npm run test:desktop
npm run test:portal
node tests/nsis-upgrade-staging.e2e.mjs
npm run desktop:stage
npm run desktop:package
npm run test:desktop-package
npm run verify:download -- --platform=windows
npm run verify:download -- --platform=linux
```

`tests/antigravity-native.e2e.ts` yêu cầu `KIVUNO_TEST_ANTIGRAVITY_BINARY` trỏ tới CLI chính thức đã kiểm tra. Test packaged có thể nhận `KIVUNO_PACKAGE_DIR` là thư mục đã cài thật; `KIVUNO_RELEASE_MANIFEST` và `KIVUNO_INSTALLER_FILE` chọn artifact tải từ web. Các bài native không yêu cầu đăng nhập.

Bộ test cuối đạt **227 pass, 0 fail, 1 skip dành riêng cho Linux**, gồm backend, quyền truy cập, quota/handoff/recovery, workflow và regression Windows `EPERM`. Trên máy ít tài nguyên, lượt này dùng Git đi kèm app và `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts`, sau khi kết thúc nén installer. Build TypeScript/web/cloud thành công. Probe NSIS đã biên dịch và chạy cả ba nhánh: nâng cấp thành công, uninstaller lỗi giữ recovery, và lỗi chuẩn bị dừng trước khi chạy uninstaller.

Đã cài bản 0.6.0 tải từ website rồi chạy nâng cấp NSIS 0.6.1 tại `D:\Kivuno` với ổ C còn khoảng **105 MB** lúc bắt đầu. Bộ cài hoàn tất; archive/extraction nằm trên D và thư mục staging được dọn sau thành công. App đóng gói đã mở workspace bằng Node 24.22.1, Git 2.56.0.windows.4, Codex 0.166.0 và Gemini 0.66.0 đi kèm, với PATH chỉ có thư mục hệ thống Windows. Git tạo commit trong repo thử thành công, API local từ trình duyệt không có khóa bị từ chối, renderer không có Node access hoặc lỗi tải tài nguyên.

Kiểm tra browser qua backend thật đã qua: đăng nhập/đăng ký và device consent, mã chỉ dùng một lần, cô lập owner, tiếng Việt/Anh, font tiếng Việt, mobile, keyboard/reduced motion, ba demo độc lập và scroll đảo chiều. Tài khoản đăng ký trong bài này thuộc fixture cục bộ, không phải tài khoản dịch vụ thật.

## Sau khi cài

1. Mở Kivuno, đăng nhập web và xác nhận mã để trở lại app.
2. Thêm tài khoản ở **Team**, rồi chọn thành viên cho từng nhóm dự án.
3. Với Codex/Gemini, đăng nhập profile của chính tài khoản. Với Claude Code/Antigravity, tạo kết nối MESH trong app và thêm config vào client thật.
4. Bắt đầu bằng một task nhỏ trong repo thử. Kiểm tra tool permissions, diff và bằng chứng test trước khi tăng số session.

Windows installer chưa có chứng thư ký mã. SHA-256 chứng minh file tải khớp manifest, không thay thế chữ ký nhà phát hành. Linux có gói riêng; macOS vẫn ẩn. Quota của client ngoài là tự báo cáo và Kivuno không cưỡng chế dừng process chạy ngoài app. Không có lời hứa rằng mọi tính năng riêng của Codex Desktop, Claude Code hoặc Antigravity sẽ được nhúng vào Kivuno.
