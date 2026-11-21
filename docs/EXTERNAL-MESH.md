# Claude Code và Antigravity cộng tác trong Neralu

Kivuno cung cấp MCP server chạy trên máy bạn cho **Claude Desktop**, **Claude Code** và **Antigravity**. Với Antigravity, nút **Connect Antigravity** yêu cầu xác nhận dùng tài khoản trên máy, rồi kiểm tra phiên bằng CLI chính thức. Nếu chưa đăng nhập, CLI mở luồng Google. Chỉ hiện **Antigravity connected** sau khi nhận được tài khoản hợp lệ; không suy ra trạng thái từ việc mở cửa sổ. Với Claude, thông tin xác thực và quota do ứng dụng hoặc CLI chính thức quản lý. Bạn có thể mở client để dùng thủ công hoặc bật nhận nhiệm vụ từ Sade theo hướng dẫn bên dưới.

## PowerPoint trong Chat

Gửi yêu cầu tạo PowerPoint ở **Chat → Nhắn Sade**. Sade chuẩn bị tài liệu nguồn, giao việc và kiểm tra nội dung so với yêu cầu. Harness Codex chạy nền qua OpenAI Agents API, soạn slide, gọi công cụ xuất tệp và gửi báo cáo về Kivuno. Trong Chat, chọn **Phiên Codex** để đọc báo cáo và **Tải PowerPoint** để lấy tệp có liên kết nguồn. Luồng này dùng phiên đăng nhập Kivuno và tự thử lại khi kết nối bị gián đoạn.

## Đăng nhập Claude (0.9.9)

[Hướng dẫn connector trên web](https://kivuno.vercel.app/claude/guide) và [thông báo quyền riêng tư](https://kivuno.vercel.app/claude/privacy) áp dụng cho kết nối Claude từ xa.

Trong **Team → Connect Claude**, chọn ứng dụng đang dùng:

- **Claude Desktop**: bấm **Open Claude Desktop** để mở ứng dụng thật. Đăng nhập ở đó. Bấm **Link Kivuno to Claude** để duyệt connector một lần trong trình duyệt bằng cùng tài khoản; connector đồng bộ sang Desktop. Không cần chép JSON để liên kết tài khoản.
- **Claude Code**: bấm **Sign in to Claude Code**. Kivuno chuẩn bị CLI chính thức nếu thiếu; CLI mở đăng nhập Anthropic. Kivuno chỉ hiện **Claude Code signed in** sau khi CLI xác nhận. Gói Free không có quyền Code; dùng Desktop hoặc browser. Đăng nhập không tự cấp quyền vào dự án. Phần **Share a project (optional)** dành cho bước tiếp theo.
- **Claude in browser**: làm theo các bước bên dưới. Free và trả phí đều có thể dùng connector; đây không phải tính năng dành riêng cho Free.

Nút **View usage on Claude** mở trang usage chính thức. Trên tài khoản Free đã thử, Claude không cung cấp bảng usage mà chuyển đến trang nâng cấp. Kivuno ghi rõ giới hạn này và không tạo số quota giả. Không cần mua gói để liên kết connector.

Nếu Claude đã kết nối với một hồ sơ khác trong cùng tài khoản Kivuno, chọn **Use existing Claude connection** và xác nhận hồ sơ nguồn/đích. Không cần ngắt plugin trong Claude. Kivuno giữ nguyên thời hạn liên kết, thu hồi quyền chia sẻ project cũ và không cấp quyền project mới. Khi liên kết đã hết hạn hoặc bị thu hồi, vẫn cần đăng nhập lại.

Antigravity chưa trả số quota và danh mục skills/plugins qua các phương thức Kivuno đang dùng. Xem quota bằng `/usage` trong CLI chính thức; thiếu số liệu không đồng nghĩa mất kết nối. Chạy model vẫn cần allowance riêng của project.

Nhiều hồ sơ và nhiều tài khoản Kivuno trên cùng người dùng hệ điều hành có thể xác nhận dùng phiên Antigravity của máy. Mỗi hồ sơ phải xác nhận riêng; ngắt một hồ sơ không đăng xuất Google và không ngắt hồ sơ khác. Bản cũ giữ khóa độc quyền được chuyển sang quyền của hồ sơ cũ khi nâng cấp, không tự cấp quyền cho hồ sơ mới. Các hồ sơ này dùng chung phiên Google và quota, kể cả khi tài khoản được đổi trong Antigravity; đây không phải các tài khoản Google độc lập. Dữ liệu workspace, quyền project và allowance vẫn tách riêng.

## Claude trong trình duyệt

1. Mở **Team → Add account → Claude** trong Kivuno Desktop. Chọn **Claude in browser** và hồ sơ Claude trên máy, rồi bấm **Connect Claude in browser**. Bạn có thể chọn lại hồ sơ hiện có, chẳng hạn Nova.
2. Kivuno mở danh sách connector của bạn trong Claude. Nếu đã có **Kivuno**, bấm **Connect** (**Connecter** trong giao diện tiếng Pháp). Nếu chưa có, mở **First connection or setup did not open?** trong Kivuno Desktop để lấy URL HTTPS. Trong Claude, chọn **Add → Custom → Web**, đặt tên Kivuno, dán URL, lưu rồi bấm Connect. [Trang connector của Claude](https://claude.ai/customize/connectors/yours).
3. Đăng nhập Kivuno bằng tài khoản dùng trên desktop, kiểm tra tên hồ sơ, máy và hạn kết nối, rồi bấm **Liên kết tài khoản**. Sau khi trở về Claude, bật Kivuno trong cuộc trò chuyện nếu desktop vẫn hiện **Waiting for Claude**. Kivuno hiện **Claude connected** khi Claude dùng kết nối đã xác thực. Việc liên kết tài khoản chưa chia sẻ dự án nào.
4. Khi muốn chia sẻ, vào **Chat → Group team** của dự án trong Kivuno, thêm hồ sơ Claude vào nhóm rồi chọn **Share project messages**. Kiểm tra tên dự án và thời hạn, bấm **Allow read-only project access**. Công cụ `mesh_read` cho Claude đọc tên dự án và tin nhắn đã chia sẻ trong nhóm. Mỗi kết nối chia sẻ được một dự án tại một thời điểm. Nếu Claude chưa thấy công cụ sau khi cấp quyền, làm mới danh sách công cụ hoặc mở cuộc trò chuyện mới.
5. Giữ desktop đang chạy khi Claude đọc nhóm. Thu hồi quyền dự án hoặc ngắt liên kết tài khoản tại **Team → hồ sơ Claude → MESH connection**. Quyền dự án có thời hạn từ 15 phút tới 8 giờ. Nếu liên kết tài khoản hết hạn, thực hiện lại bước kết nối.

Claude Free hỗ trợ một custom connector. Trong Team hoặc Enterprise, người có quyền quản trị connector thực hiện bước thêm URL. Trình duyệt dùng hạn mức của tài khoản Claude. Các connector cũ dùng header riêng vẫn có hiệu lực đến khi bị thu hồi hoặc hết hạn. Anthropic cung cấp tùy chọn xác thực bằng request header dưới dạng beta cho một số tổ chức. [Hướng dẫn custom connector của Anthropic](https://claude.com/docs/connectors/custom/add-unlisted).

## Kết nối cục bộ

1. Trong **Team → Add account**, chọn **Claude** hoặc **Antigravity**. Mỗi profile tương ứng một thành viên; nhiều profile có thể dùng những tài khoản/client riêng do bạn quản lý. Trên profile Antigravity, chọn **Connect Antigravity** và xác nhận tài khoản trên máy. CLI, IDE và Antigravity App dùng chung thông tin đăng nhập cục bộ theo hướng dẫn Google.
2. Mở nhóm dự án → **Members** → thêm thành viên vừa tạo. Team toàn cục và nhóm vẫn tách biệt.
3. Mở **MESH connection** ở profile đó, chọn nhóm và thời hạn. Mặc định chỉ có quyền chat. Chỉ bật nhận task/checkpoint khi muốn cho client làm việc; quyền dùng khi quota chưa biết là một lựa chọn riêng, mặc định tắt.
4. Tạo và sao chép cấu hình MCP. Thêm entry dưới `mcpServers` vào cấu hình client, giữ lại các entry hiện có. Trong Claude Desktop, mở Settings → Developer → Edit Config, gộp entry vào `mcpServers`, thoát hẳn app rồi mở lại và bật công cụ Kivuno trong chat. Với Claude Code, dùng local/user scope và kiểm tra `claude mcp list` hoặc `/mcp`. Không commit token vào `.mcp.json` của repo. [Hướng dẫn Claude MCP](https://code.claude.com/docs/en/mcp).
5. Với Antigravity IDE, mở **MCP Servers → Manage MCP Servers → View raw config**. Với Antigravity App, mở **Customizations → Installed → MCP Servers**, lấy đường dẫn cấu hình từ menu của mục này. CLI hỗ trợ cùng cấu trúc `command`, `args`, `env`. Giữ cấu hình chứa token ở phạm vi cá nhân; không commit `.agents/mcp_config.json`. [Hướng dẫn Antigravity MCP](https://antigravity.google/docs/mcp).
6. Yêu cầu agent: “Đọc `mesh_read`, trao đổi với nhóm; nhận một task có sẵn bằng `task_claim`, chỉ sửa trong worktree được trả về, báo tiến độ và dùng `task_submit` sau khi ngừng sửa file.”

Kivuno không tự sửa cấu hình MCP của client. Máy đang chạy app phải tiếp tục bật. Token chỉ dành cho một provider, một thành viên trong một nhóm, được hiển thị một lần, có thời hạn tối đa 8 giờ và mất hiệu lực khi Kivuno khởi động lại. Có thể thu hồi ngay trong Team. Không dán cấu hình vào chat nhóm hoặc Git; checkpoint từ chối các file cấu hình MCP và nội dung chứa `KIVUNO_MCP_TOKEN`.

## Harness, tools, plugins, skills và thư mục

### Nhận nhiệm vụ từ Sade

Trong MESH connection, bật quyền nhận task và chọn số lượt tại **Sade assignments for this project**. Mỗi lượt là một nhiệm vụ hoặc một lần review do Sade phân công. Khi chưa có số liệu quota, người quản lý tài khoản có thể chọn tự theo dõi quota trong client. Sade giữ đúng người nhận khi một client đang chờ hoặc tạm ngắt kết nối.

- **Claude Code**. Lưu cấu hình MCP do Kivuno cấp ngoài repo rồi chạy lệnh worker hiện trong hộp kết nối. Worker đợi nhiệm vụ và khởi chạy bản CLI chính thức khi có việc. Người dùng đăng nhập trong Claude Code và có thể dừng worker từ terminal.
- **Claude Desktop**. Kết nối MESH từ cuộc trò chuyện bạn mở trong Claude để tham gia nhóm thủ công. Phiên kết nối có thể nhận nhiệm vụ và review theo quyền đã cấp.

Chọn **Open session** trên tin báo kết quả để mở đúng cuộc hội thoại trong sidebar. Các teammate và Sade dùng `relay_session_read` để xem các tin gần nhất từ phiên thuộc cùng dự án. Khi được giao review, teammate nhận tiêu chí và kết quả cần kiểm tra. Công cụ báo cáo gắn tên tác giả, nhiệm vụ và ID phiên vào nhóm.

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
