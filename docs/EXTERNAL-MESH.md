# Claude Code và Antigravity cộng tác trong Neralu

Kivuno cung cấp MCP server chạy trên máy bạn cho **Claude Desktop**, **Claude Code** và **Antigravity**. Với Antigravity, nút **Sign in with Google** mở lệnh đăng nhập chính thức `agy acp --login` trong Terminal; Google và Antigravity xử lý OAuth, Kivuno không nhận thông tin đăng nhập. Bạn vẫn tự mở client; Kivuno không gọi API trả phí và không khởi chạy model thay bạn. Đây là kết nối công cụ vào client, không phải một bản nhúng toàn bộ ứng dụng của provider. Antigravity là profile riêng, không phải tên khác của Gemini CLI.

## Claude trong trình duyệt

Trong **Team → Add account → Claude**, chọn **Claude in browser**, chọn một project và thời hạn, rồi tạo web connector. Trong tab Claude đang đăng nhập, mở **Customize → Connectors → Add → Custom → Web**. Dán URL HTTPS Kivuno cung cấp. Chọn **No sign-in**, thêm request header có tên `Authorization` và dán nguyên giá trị riêng tư đã sao chép, gồm cả tiền tố `Bearer`. Bật connector trong cuộc trò chuyện, rồi yêu cầu Claude đọc nhóm dự án. Với tài khoản Free, Anthropic cho một custom connector. Trong Team hoặc Enterprise, người được cấp quyền dùng chung connector cũng có thể dùng thông tin xác thực đã cấu hình. [Hướng dẫn của Anthropic](https://claude.com/docs/connectors/custom/add-unlisted).

Kivuno Desktop trên máy chủ dự án phải đang chạy. Mỗi quyền chỉ áp dụng cho một profile và một project, tối đa 8 giờ. Công cụ `mesh_read` trả tên project và các đoạn tin nhắn của nhóm. Có thể thu hồi trong **MESH connection**. Trình duyệt dùng hạn mức của tài khoản Claude. Dịch vụ HTTPS của Kivuno cần chạy phiên bản có hỗ trợ connector. Máy dùng Claude Desktop hoặc Claude Code có thể dùng cầu nối cục bộ ở phần dưới.

## Kết nối cục bộ

1. Trong **Team → Add account**, chọn **Claude** hoặc **Antigravity**. Mỗi profile tương ứng một thành viên; nhiều profile có thể dùng những tài khoản/client riêng do bạn quản lý. Trên profile Antigravity, chọn **Sign in with Google** để mở đăng nhập chính thức trong Terminal. CLI, IDE và Antigravity App dùng chung thông tin đăng nhập cục bộ theo hướng dẫn Google.
2. Mở nhóm dự án → **Members** → thêm thành viên vừa tạo. Team toàn cục và nhóm vẫn tách biệt.
3. Mở **MESH connection** ở profile đó, chọn nhóm và thời hạn. Mặc định chỉ có quyền chat. Chỉ bật nhận task/checkpoint khi muốn cho client làm việc; quyền dùng khi quota chưa biết là một lựa chọn riêng, mặc định tắt.
4. Tạo và sao chép cấu hình MCP. Thêm entry dưới `mcpServers` vào cấu hình client, giữ lại các entry hiện có. Trong Claude Desktop, mở Settings → Developer → Edit Config, gộp entry vào `mcpServers`, thoát hẳn app rồi mở lại và bật công cụ Kivuno trong chat. Với Claude Code, dùng local/user scope và kiểm tra `claude mcp list` hoặc `/mcp`. Không commit token vào `.mcp.json` của repo. [Hướng dẫn Claude MCP](https://code.claude.com/docs/en/mcp).
5. Với Antigravity IDE, mở **MCP Servers → Manage MCP Servers → View raw config**. Với Antigravity App, mở **Customizations → Installed → MCP Servers**, lấy đường dẫn cấu hình từ menu của mục này. CLI hỗ trợ cùng cấu trúc `command`, `args`, `env`. Giữ cấu hình chứa token ở phạm vi cá nhân; không commit `.agents/mcp_config.json`. [Hướng dẫn Antigravity MCP](https://antigravity.google/docs/mcp).
6. Yêu cầu agent: “Đọc `mesh_read`, trao đổi với nhóm; nhận một task có sẵn bằng `task_claim`, chỉ sửa trong worktree được trả về, báo tiến độ và dùng `task_submit` sau khi ngừng sửa file.”

Kivuno không tự sửa cấu hình MCP của client. Máy đang chạy app phải tiếp tục bật. Token chỉ dành cho một provider, một thành viên trong một nhóm, được hiển thị một lần, có thời hạn tối đa 8 giờ và mất hiệu lực khi Kivuno khởi động lại. Có thể thu hồi ngay trong Team. Không dán cấu hình vào chat nhóm hoặc Git; checkpoint từ chối các file cấu hình MCP và nội dung chứa `KIVUNO_MCP_TOKEN`.

## Harness, tools, plugins, skills và thư mục

Claude Code/Antigravity tiếp tục dùng harness và quyền công cụ trong client thật của chúng. MESH bổ sung công cụ phối hợp; nó không tải plugin của client vào Kivuno, không tự chia sẻ token, không cấp quyền shell hay mọi thư mục trên máy. Mở worktree được `task_claim` trả về trong client, giữ kiểm duyệt quyền của client, rồi dùng tools/file access của client để làm việc. Kivuno kiểm tra scope khi checkpoint; đây không phải sandbox chặn toàn bộ thao tác đọc/ghi của một process bên ngoài.

Claude Code dùng `SKILL.md` và plugin của Claude Code; plugin có thể chứa skills, hooks, agents và MCP. Antigravity dùng skills theo cơ chế của Antigravity. Hướng dẫn Markdown thuần có thể điều chỉnh để dùng lại, nhưng tool name, shell, hook, frontmatter và quyền phải được kiểm tra trước. Không có cơ chế “copy plugin Codex là chạy nguyên vẹn” giữa ba hệ. [Claude skills](https://code.claude.com/docs/en/skills), [Claude plugins](https://code.claude.com/docs/en/plugins), [Antigravity skills](https://antigravity.google/docs/skills).

## Kiểm chứng ngày 2026-11-05

`tests/claude-native.e2e.ts` chạy **Claude Code 2.1.281 thật** với thư mục cấu hình tạm: CLI thêm cấu hình, hoàn tất health check qua stdio/HTTP của Kivuno, endpoint quan sát initialize thật; thu hồi token làm health check thất bại. Test không đăng nhập, không sửa cấu hình cá nhân và không gửi model prompt. Tài khoản Claude hiện chưa đăng nhập, nên chưa xác nhận một vòng model → tools → sửa file → submit bằng tài khoản thật.

`tests/antigravity-native.e2e.ts` chạy **Antigravity CLI 1.5.0 thật**, tải từ manifest của Google, khớp SHA-512 và chữ ký Google LLC. CLI nhận cấu hình MCP trong profile tạm và hoàn tất ACP initialize. `session/new` trả yêu cầu đăng nhập; chưa có MCP handshake từ model/client Antigravity vào Kivuno, chưa tạo session hoặc gọi model. Không cài PATH, không thay cấu hình cá nhân. Kết quả này không chứng minh agent đã dùng tools/skills/plugins để code. [Bản phân phối chính thức](https://antigravity.google/download), [ACP của Antigravity](https://antigravity.google/docs/cli/acp/).

## Công cụ và quyền

| Công cụ                  | Tác dụng                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `mesh_read`, `mesh_wait` | Đọc nhóm, task, feedback; chờ tối đa 25 giây cho tin nhắn mới                                 |
| `mesh_post`, `mesh_ack`  | Báo tiến độ/reply/mention và xác nhận tin đã đọc                                              |
| `mesh_ask`               | Đưa câu hỏi lên cho người dùng                                                                |
| `usage_report`           | Ghi quota tự báo cáo và thời gian reset nếu biết                                              |
| `task_claim`             | Nhận task ready có sẵn, kiểm tra dependency và khóa scope; tạo worktree riêng                 |
| `task_submit`            | Checkpoint/push vào origin đã cấu hình, chuyển sang review; giữ khóa tới khi người dùng xử lý |

Client không được cấp API để giả làm người dùng, merge, phê duyệt, mua dịch vụ, đổi roster hay đọc nhóm khác. Tin nhắn có `!!` từ một client vẫn là tin agent. Reviewer kiểm tra diff và bằng chứng test như với Codex; nội dung “đã test” do external agent gửi không được coi là kết quả test mà coordinator đã tự chạy.

Trước checkpoint, cấu hình GitHub owner của thành viên trong Team. Author commit là owner này; coordinator kiểm tra scope, file credential, nội dung OAuth token, hook và SHA trên origin. Lỗi push giữ nguyên worktree/quyền sở hữu để xử lý, không tự chuyển sang task khác.

## Giới hạn cần hiểu

- Online nghĩa là MCP client còn kết nối/heartbeat, không chứng minh Claude đang chạy model hay tài khoản còn quota.
- Quota là **self-reported**, không được trộn với telemetry đã xác minh của Codex. Khi báo còn 50% hoặc ít hơn, không nhận task mới. App không thể cưỡng chế dừng một model chạy độc lập ngoài app.
- Client chọn model/reasoning, quản lý quyền công cụ và dùng quota của nó. Kivuno không thêm nút model giả cho kết nối external.
- `mesh_wait` hỗ trợ một client chủ động đợi tin; heartbeat tự động không đánh thức model hay tiêu tốn lượt model. Không hứa mọi client sẽ tự đọc chat khi model đang idle.
- External agent nhận các task riêng đã tạo, chưa tham gia vòng workflow tự chạy như native Codex/Gemini. Các provider vẫn dùng chung room, kiến thức, task dependencies, reactions và review.
- Worktree không phải sandbox hệ điều hành. Client của bạn phải tuân thủ scope và ngừng ghi trước submit. Mất kết nối/thu hồi token giữ task bị khóa; hãy dừng client cũ rồi xác nhận recovery, tránh hai worker sửa cùng phần việc.
- Bridge chỉ hoạt động trên máy desktop hiện tại; chưa stream hoặc kết nối external client từ cloud/SSH. Không có fallback trả phí.
