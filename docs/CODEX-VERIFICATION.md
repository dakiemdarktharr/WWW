# Kiểm chứng Codex thật trong Kivuno

Ngày kiểm tra: **2026-11-05**, Windows x64, Codex CLI chính thức **0.166.0** trong dependency của Kivuno. Bằng chứng được tạo bằng `npm run test:codex-native`; không dùng một server giả thay cho Codex trong bài này.

## Kết quả đã quan sát

| Phần               | Bằng chứng                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nhiều profile      | Bốn process App Server thật, bốn `CODEX_HOME` độc lập, tất cả bắt đầu ở trạng thái chưa đăng nhập.                                                                   |
| Skills             | Mỗi profile đọc được skill Markdown riêng và không nhận skill riêng của ba profile còn lại.                                                                          |
| Plugins            | CLI thật đăng ký marketplace local, cài plugin thử chỉ chứa skill; App Server trả plugin và skill của nó trong inventory. Profile khác không được cài plugin này.    |
| Harness và thư mục | App Server `command/exec` thật chạy Node đọc và tạo file trong worktree thử. Cùng sandbox policy từ `thread/start` từ chối ghi file ở thư mục anh em ngoài worktree. |
| Chế độ đọc         | Thread `read-only` thật từ chối tạo file ngay trong worktree.                                                                                                        |
| MESH tools         | App Server thật chấp nhận schema dynamic tools của Kivuno khi tạo thread. Luồng gọi/reply tools và phê duyệt có thêm test protocol riêng.                            |
| Phê duyệt          | Thread trả đúng `on-request` và reviewer `user`. Nếu provider thay đổi sandbox/reviewer, Kivuno từ chối bắt đầu model turn.                                          |

Các file thử đều nằm trong thư mục riêng dưới `.local` và được xóa sau khi dừng các process do bài test tạo. Không đọc, sao chép hoặc chia sẻ file đăng nhập của người dùng.

## Lỗi đã sửa

Profile Windows mới trong 0.6 chưa hoàn tất thiết lập sandbox của Codex: yêu cầu `workspace-write` trả về `readOnly`, nên tác vụ ghi file sẽ bị Kivuno chặn trước khi bắt đầu. Chỉ kiểm tra handshake không phát hiện được lỗi này.

Kivuno nay hỏi `windowsSandbox/readiness`. Chỉ khi trạng thái là `notConfigured`, app gọi quy trình chính thức `windowsSandbox/setupStart` với mode `unelevated`, chờ kết quả có giới hạn thời gian, rồi khởi động lại App Server để nạp cấu hình. Không xin quyền admin, không chọn `danger-full-access`, không thay sandbox đã cấu hình hoặc tự hạ cấu hình đang cần cập nhật. Thiết lập thất bại làm profile dừng. Lần restart nội bộ giữ đúng reference và khóa đăng nhập của tài khoản.

## Cách dùng thực tế

1. Thêm Codex trong **Team**, đăng nhập ChatGPT cho chính profile đó, rồi thêm thành viên vào nhóm dự án. Các tài khoản có profile riêng dù cùng một máy.
2. Chọn thư mục dự án. Tác vụ ghi dùng worktree riêng; tác vụ nghiên cứu/review có thể dùng chế độ đọc. Hệ điều hành vẫn có các thư mục tạm được Codex cho phép; `workspace-write` không có nghĩa chặn mọi lượt đọc trên máy.
3. Dùng **Import local skills** khi muốn đưa bộ skill local vào profile, hoặc cài skill/plugin cho đúng `CODEX_HOME` qua công cụ chính thức. Skill có thể được Codex phát hiện từ đường dẫn người dùng/repo dùng chung, nhưng token, cấu hình OAuth và plugin của một tài khoản không được tự sao chép sang tài khoản khác.
4. Refresh capabilities trong Kivuno. Plugin kết nối dịch vụ cần đăng nhập/quyền riêng theo provider; một plugin có tên trong inventory không chứng minh mọi công cụ từ xa của plugin đã đăng nhập.

## Chưa được chứng minh bằng bài test này

- Không gửi prompt lên model và không dùng quota thuê bao: chưa kiểm tra một model thật tự chọn tool, tự sửa code, gọi plugin có OAuth hoặc hoàn thành handoff giữa nhiều tài khoản đã đăng nhập.
- Khả năng của app Codex chính thức như browser/computer use, connector riêng hoặc tính năng gắn với giao diện không mặc nhiên xuất hiện trong Kivuno. Kivuno chạy App Server và tools mà profile/giao thức hiện tại cung cấp.
- Worktree và khóa task ngăn điều phối trùng phạm vi; không thay thế việc kiểm tra quyền truy cập của plugin/MCP. Quyền đọc filesystem và quyền ghi filesystem khác nhau.

Nguồn đối chiếu: schema JSON sinh trực tiếp từ binary 0.166.0 bằng `app-server generate-json-schema --experimental`, [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox), [Windows sandbox source 0.166.0](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/windows_sandbox.rs), [đóng gói và cài plugin chính thức](https://developers.openai.com/plugins/build/plugins).
