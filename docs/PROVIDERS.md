# Providers trong Kivuno

Cập nhật ngày 21/11/2026. Một nhóm có thể chứa Codex, Claude và Antigravity. Mỗi provider quản lý đăng nhập và model theo cách riêng.

| Provider    | Cách kết nối                                                                                 | Phiên làm việc                                                           | Quota và quyền                                                          |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Codex       | Codex App Server, profile riêng cho từng tài khoản                                           | Kivuno quản lý process, thread, model/reasoning, pause/resume, approvals | Đọc quota provider; giữ ngưỡng dự phòng 50% trừ khi người dùng cho phép |
| Claude      | Claude web (Free hoặc trả phí), Claude Desktop hoặc Claude Code (gói có quyền), qua MCP      | Người dùng chọn model và giao việc trong Claude                          | Kivuno cấp quyền theo project, Claude áp dụng quota của tài khoản       |
| Antigravity | Một kết nối managed tới tài khoản Antigravity của người dùng hệ điều hành, hoặc external MCP | Sade đọc model, mức suy luận và tên gói khi CLI cung cấp                 | Cấp lượt theo project. Kivuno tắt dùng thêm AI credits                  |

## Model Gemini qua Antigravity

Từ ngày 18/06/2026, Google ngừng cung cấp Gemini CLI qua Gemini Code Assist cho tài khoản cá nhân, kể cả Google AI Pro và Ultra. Kivuno từng gọi Gemini CLI 0.66.0 bằng ACP và yêu cầu đăng nhập Google cá nhân. CLI vẫn khởi động được, nhưng Google từ chối xác thực khi client yêu cầu quyền Code Assist. Các cách dùng API key, Vertex AI hoặc giấy phép doanh nghiệp có điều kiện và cách tính phí riêng. [Thông báo của nhóm Gemini CLI](https://github.com/google-gemini/gemini-cli/discussions/28017) · [Lịch vòng đời Code Assist cho tổ chức](https://docs.cloud.google.com/gemini/docs/codeassist/sunset).

Trong Team, chọn **Antigravity** để dùng các model Gemini do tài khoản trên máy cung cấp. Kivuno đọc danh sách model trực tiếp từ CLI sau khi bạn xác nhận kết nối. Khi mở workspace cũ, Kivuno lưu trữ hồ sơ Gemini độc lập, giữ lịch sử và giải phóng chỗ trong Team. Bạn có thể thêm Antigravity vào nhóm dự án muốn sử dụng.

## Antigravity dưới sự điều phối của Sade

Trong Team → Add account, chọn provider và chế độ chạy CLI. Với Antigravity, xác nhận dùng tài khoản Google hiện tại của Antigravity trên máy. Google lưu đăng nhập trong kho thông tin xác thực của hệ điều hành. Nếu đổi tài khoản trong Antigravity, kết nối này sẽ dùng tài khoản mới. Một hồ sơ Kivuno được giữ kết nối cho mỗi người dùng hệ điều hành, kể cả khi có nhiều workspace. Hồ sơ managed từ 0.9.0 cần xác nhận một lần. **Settings → Disconnect device account** giải phóng kết nối để hồ sơ khác có thể dùng. Dữ liệu đăng nhập của Antigravity vẫn do Google quản lý. [Xác thực Antigravity](https://antigravity.google/docs/install?tab=cli).

Hồ sơ external có thể chuyển chế độ bằng **Enable Sade execution**. Kivuno thu hồi kết nối MCP cũ sau khi người dùng xác nhận và đã dừng hoặc khôi phục công việc đang có.

Cấp số prompt có giới hạn cho project trước khi chạy. Antigravity dùng catalog/config options ACP. Không suy đoán rằng mọi model đều có high reasoning. Native file/shell tools bị tắt; MCP Kivuno kiểm tra lease, quota, scope và duyệt ghi file. Đây là chính sách công cụ, không phải sandbox hệ điều hành. Chế độ read-only không có tool ghi. Các request xin quyền native bất ngờ đều bị từ chối.

Antigravity dùng ACP với tên client Kivuno; không giả danh IDE để mở model bị hạn chế. Credential không chuyển giữa provider hay máy. Refresh không tự mở OAuth. Cần kiểm thử tài khoản thật trên từng nền tảng trước khi coi integration đã được xác nhận ngoài fixture.

[Antigravity ACP](https://antigravity.google/docs/ide/extensions/acp), [permissions](https://antigravity.google/docs/permissions).

## Claude web, Claude Desktop và Claude Code qua MCP

Claude web có thể đọc tin nhắn nhóm qua connector HTTPS có thời hạn. Desktop và CLI dùng MCP cục bộ. [Cách kết nối từng client](EXTERNAL-MESH.md).

Thêm một thành viên Claude rồi chọn client trong **MESH connection**. Tài khoản Free có thể dùng chat của Claude Desktop. Tài khoản có quyền Claude Code còn có thể mở CLI tại thư mục dự án. Người dùng đăng nhập, chọn model và gửi yêu cầu trong ứng dụng của Anthropic. Việc tạo hồ sơ Kivuno chỉ dành một chỗ trong Team. Trạng thái kết nối dựa trên MCP handshake của client. [Bảng quyền theo gói](https://claude.com/pricing) · [MCP trên Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) · [Quy định xác thực của Anthropic](https://code.claude.com/docs/en/legal-and-compliance).

1. Tạo thành viên Claude và thêm vào đúng nhóm.
2. Tạo kết nối MCP có thời hạn trong desktop; mặc định chỉ đọc/nhắn tin. Cho phép claim task và cho phép quota chưa biết là hai quyết định riêng của người dùng.
3. Chép cấu hình vào client MCP mà người dùng tự quản lý. Cấu hình chứa bearer token nhạy cảm, chỉ hiển thị khi tạo. Không commit hoặc gửi nó vào group.
4. Client dùng `mesh_read`/`mesh_wait`, `mesh_post`, `mesh_ack`, `mesh_ask` để cộng tác. Các lời gọi cập nhật heartbeat; mất kết nối thì thành viên chuyển offline.
5. Nếu được phép, `task_claim` nhận **task ready đã có** và một worktree riêng. Claim dùng khóa nguyên tử, không cho viết đè task của người khác.
6. Dừng ghi trước `task_submit`; gửi tóm tắt và bằng chứng test. Kivuno checkpoint/push vào origin đã cấu hình với tác giả là owner của thành viên, chuyển sang review và giữ lease cho tới khi người dùng quyết định tích hợp.

`usage_report` nhận phần trăm/reset nhìn thấy trong client, đánh dấu là tự khai báo. Báo 50% hoặc thấp hơn thì chặn nhận việc mới. Khi quota chưa rõ, cần quyền rõ ràng cho kết nối đó. Kivuno không thể đo hoặc cưỡng chế dừng process Claude ở ngoài ứng dụng.

Thu hồi/hết hạn/mất kết nối không tự giải phóng một task đang ghi. Người dùng phải dừng client thật rồi xác nhận recovery. Recovery từ chối session lịch sử, task đã review/done, session đã bị thay thế và checkpoint/claim đang chạy. Bridge chỉ nhận loopback, không có browser Origin, token ràng buộc một thành viên/một dự án; không được publish qua web/cloud. Khởi động lại coordinator làm token cũ hết hiệu lực, vẫn giữ lease cần phục hồi.

Ở chế độ external, Claude và Antigravity có thể tham gia thảo luận và nhận task đã chuẩn bị qua bridge. Client ngoài chọn model và báo tiến độ về nhóm.

## Contract phục vụ UI và tích hợp

### Tự chuẩn bị runtime khi thêm account

Trong desktop, nút **Add account** quét provider vừa chọn trước khi tạo hồ sơ. Nếu thiếu Antigravity CLI, Kivuno dùng [hướng dẫn cài Antigravity CLI của Google](https://antigravity.google/docs/getting-started?tab=cli) cho tài khoản hệ điều hành hiện tại, không yêu cầu quyền quản trị; chỉ tạo account sau khi lệnh `--version` chạy được. Codex CLI `0.166.0` được đóng gói sẵn. Nếu runtime Codex bị thiếu hoặc hỏng, Kivuno tự khôi phục đúng phiên bản vào `provider-runtimes` trong dữ liệu riêng của Kivuno bằng npm CLI đã đóng gói, chỉ từ npm registry qua HTTPS và tắt lifecycle scripts.

Với Claude, Kivuno mở cấu hình MCP cho client người dùng chọn. Người dùng Free chỉ cần Claude Desktop.

- `Member.provider`: `codex | gemini | claude | antigravity`; giá trị `gemini` dành cho lịch sử. Profile cũ thiếu trường provider được nhận diện là Codex. Session lưu provider; external session còn có `external` và `externalConnectionId`.
- `GET /api/providers`: capability thực gồm `mode`, `available`, `login`, `quota`, `models`, `reasoning`, lý do nếu có. External không khả dụng trên cloud. `available` của external chỉ nói bridge sẵn sàng, không chứng minh client đã được cài hoặc đăng nhập.
- `POST /api/accounts/connect` nhận `provider`, `runnerId?` và `managedRuntime?`. Antigravity managed yêu cầu thêm `confirmDeviceAccount: true` sau bước xác nhận. Với phiên Google có sẵn, CLI có thể xác minh qua ACP mà không mở trình duyệt. External trả hướng dẫn MESH. Remote runner hiện dành cho Codex.
- `POST /api/members/:id/quota/turn-grants {projectId,maxTurns,expiresAt,acknowledgeUnknownQuota:true}` và `POST /api/quota/turn-grants/:id/revoke {}`: quyền prompt cho provider managed ngoài Codex do người dùng cấp, không phải quota provider.
- `POST /api/external-connections {memberId,projectId,durationMinutes,allowTaskClaims,allowUnknownQuota}`: tạo cấu hình MCP, tối đa 480 phút. `GET /api/external-connections` không trả token; `POST /api/external-connections/:id/revoke {}` thu hồi.
- `POST /api/external-agent/rpc`: MCP transport cho bridge cục bộ với bearer token theo phạm vi; không dùng cookie web hay desktop bearer tổng.

Handoff khác provider dùng checkpoint Git + trạng thái/task/test/việc còn lại. Không copy provider thread, OAuth hoặc session file. Handoff tới external client cần người dùng kiểm tra checkpoint và chuẩn bị task ready cho client đó nhận; bộ điều phối không tự khởi chạy client đó.

## Skill và plugin

Các hướng dẫn Markdown độc lập với công cụ có thể chuyển đổi sau khi đọc license, đường dẫn, tên tool và quyền. Codex skill gọi `functions.exec`, `apply_patch` hoặc một plugin riêng không tự nhiên hoạt động trên Gemini hay Claude. Các connector OAuth, binary, hooks và MCP config là quyền thực thi; group chỉ chia sẻ inventory và tài liệu đã lọc, không chia sẻ token hoặc tự cài/chạy gói từ tin nhắn.

Antigravity managed đọc tên gói từ metadata của phiên ACP khi có. CLI 1.5.14 trên Windows đã trả catalog model và mức suy luận. Adapter chưa nhận inventory skill/plugin hoặc phần trăm quota. Trong chế độ external, nút đăng nhập mở `agy acp --login` và client kết nối qua MESH. [Cấu hình external MCP](EXTERNAL-MESH.md).

## Bằng chứng kiểm thử và phần cần người dùng kiểm chứng

- Trước khi gỡ provider, đã chạy **CLI Gemini 0.66.0 thật** trong profile trống: handshake ACP, phiên bản/capability và `account/read` signed-out; không gửi authenticate hoặc model prompt.
- Peer ACP chạy bằng child process riêng kiểm tra framing/stream, catalog model, resume, quyền ghi file, môi trường profile, browser chỉ bật từ login rõ ràng và restart không tự đăng nhập. Đây là kiểm thử protocol được điều khiển, không phải bằng chứng model Gemini live.
- Test backend kiểm tra quota unknown/allowance, claim/fencing/recovery, scope/credential path, mixed-provider chat routing và external MCP authorization.
- Claude Code 2.1.330 trên Windows đã gửi MCP initialize thành công đến project thử. CLI báo mất kết nối sau khi Kivuno thu hồi quyền. Phép thử dùng cấu hình tạm và 0 lượt model.
- Antigravity CLI 1.5.0 thật đã nhận cấu hình MCP và trả ACP initialize. Tạo session yêu cầu đăng nhập; chưa có vòng MCP/model hoàn chỉnh với Antigravity. CLI được tải/kiểm tra riêng để xác minh, không tự cài vào tài khoản người dùng hay đóng gói trong Kivuno.
- Chưa dùng tài khoản người dùng để kiểm tra Google OAuth hoàn chỉnh, prompt Gemini thật, quota hết trên provider hoặc model Claude/Antigravity thật. Người dùng sẽ tự kiểm tra hội thoại sau bước runtime/tools/MCP.

Nguồn: [Gemini ACP](https://geminicli.com/docs/cli/acp-mode/), [Google sign-in](https://geminicli.com/docs/get-started/authentication/), [source Gemini CLI v0.66.0](https://github.com/google-gemini/gemini-cli/tree/v0.66.0), [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), [Claude MCP](https://code.claude.com/docs/en/mcp).
