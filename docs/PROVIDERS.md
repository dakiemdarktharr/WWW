# Providers trong Kivuno 0.6

Cập nhật ngày 2026-11-04. Một nhóm có thể chứa Codex, Gemini và Claude, nhưng khả năng chạy của từng provider khác nhau. Nhóm dùng chung MESH, nhiệm vụ, worktree, quyền của người dùng và quy trình review; không chia sẻ credential giữa tài khoản.

| Provider | Cách kết nối                                             | Phiên làm việc                                                                                           | Quota và quyền                                                                              |
| -------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Codex    | Codex App Server, profile riêng cho từng tài khoản       | Kivuno quản lý process, thread, model/reasoning, pause/resume, approvals                                 | Đọc quota provider; giữ ngưỡng dự phòng 50% trừ khi người dùng cho phép                     |
| Gemini   | Gemini CLI **0.66.0**, ACP stdio, Google sign-in         | Kivuno quản lý process và ACP session; model từ catalog thực                                             | ACP chưa cung cấp phần trăm quota. Cần cấp số prompt có giới hạn; không fallback API/Vertex |
| Claude   | MCP bridge nội bộ, người dùng tự kết nối client của mình | Client bên ngoài tự quản lý model, reasoning, đăng nhập và process; Kivuno ghi nhận task/session/tiến độ | Không quản lý claude.ai OAuth. Usage tự khai báo không được coi là telemetry đã xác minh    |

## Gemini: đăng nhập và sử dụng

1. Thêm Gemini trong Team và chọn đăng nhập Google. CLI mở trình duyệt sau thao tác đăng nhập rõ ràng này. Mỗi profile dùng `GEMINI_CLI_HOME` riêng trong dữ liệu Kivuno; không dùng tài khoản trong `~/.gemini` cá nhân.
2. Thêm profile vào nhóm dự án. Một tài khoản có thể có nhiều conversation nhưng mỗi conversation vẫn chịu giới hạn process, task lease và scope.
3. Trong nhóm đó, cấp **1–10 prompt, tối đa hai giờ** và xác nhận quota chưa biết. Đó là giới hạn số yêu cầu ACP `session/prompt`, không phải ước lượng phần trăm thuê bao hay token. Một prompt có thể có nhiều vòng model/tool; CLI bị giới hạn tối đa 40 lượt nội bộ cho session.
4. Gửi chat hoặc tạo conversation. Model được đọc từ ACP `session/new` và chọn qua `session/set_model`. Nếu task/config không tương thích với model hoặc reasoning đã chọn, yêu cầu không được âm thầm chuyển sang tham số khác.
5. Mỗi prompt tiếp tục/resume tiêu thụ một lượt cấp phép mới. Các tool trong prompt đang chạy kiểm tra lượt đã đặt chỗ; thu hồi hoặc hết hạn thì tool bị chặn và bộ kiểm tra quota sẽ pause process. Lượt đã bắt đầu hoặc thử bắt đầu không được tự hoàn lại khi lỗi để tránh vòng retry vượt ngân sách.

Không giả lập các mức reasoning của Codex trên Gemini: ACP đã kiểm tra không quảng cáo capability đó. Không dùng token count để suy ra quota, không đoán lúc reset. Chat nhóm kiểm tra model/reasoning với từng ứng viên trước khi claim task.

Kivuno khởi chạy Gemini với `NO_BROWSER=1` trong mọi lần refresh/restart thông thường. Credential không còn hợp lệ sẽ cần người dùng đăng nhập lại; chỉ nút đăng nhập cho phép mở trình duyệt. Không tự khởi chạy model turn sau recovery.

### Công cụ Gemini và giới hạn hiện tại

Gemini nhận MESH, browser snapshot đã được người dùng chia sẻ, và các tool đọc/liệt kê/ghi file có scope. Built-in tools, shell, hooks, MCP khác và extension tự nạp được tắt trong profile do Kivuno quản lý. Mỗi yêu cầu ghi file cần người dùng duyệt, được kiểm tra lại lease/scope sau khi duyệt; conversation read-only không có tool ghi. File credential, `.git`, đường dẫn thoát workspace và symlink bị chặn; nội dung file có giới hạn 100 KB.

Đây là **chính sách tool có scope**, không phải OS sandbox. Gemini CLI được chạy như chương trình cục bộ mà người dùng tin tưởng. Không bật shell nên Gemini chưa tự chạy test/build qua adapter này; nó phải nhờ Codex hoặc người dùng chạy và báo bằng chứng. Chỉ báo hoàn tất khi có kết quả kiểm chứng thực.

ACP hiện không hỗ trợ steer prompt đang chạy theo contract đã kiểm tra. Thông báo MESH được giữ bền vững để đọc ở lần `mesh_read` hoặc lượt tiếp theo, không khởi tạo một prompt trùng chỉ để nhận tin nhắn. Kivuno không tự chuyển file skill, plugin, hook hay credential từ Codex sang Gemini.

## Claude: cộng tác qua client do người dùng vận hành

Kivuno không cung cấp đăng nhập claude.ai hoặc sử dụng giới hạn thuê bao thông qua Agent SDK. [Tài liệu chính thức Anthropic](https://code.claude.com/docs/en/agent-sdk/overview) yêu cầu chấp thuận trước cho sản phẩm bên thứ ba cung cấp cách sử dụng đó. Bridge này không tạo tài khoản, gọi API trả phí hoặc thay thế điều kiện sử dụng của client mà người dùng tự chọn.

1. Tạo thành viên Claude và thêm vào đúng nhóm.
2. Tạo kết nối MCP có thời hạn trong desktop; mặc định chỉ đọc/nhắn tin. Cho phép claim task và cho phép quota chưa biết là hai quyết định riêng của người dùng.
3. Chép cấu hình vào client MCP mà người dùng tự quản lý. Cấu hình chứa bearer token nhạy cảm, chỉ hiển thị khi tạo. Không commit hoặc gửi nó vào group.
4. Client dùng `mesh_read`/`mesh_wait`, `mesh_post`, `mesh_ack`, `mesh_ask` để cộng tác. Các lời gọi cập nhật heartbeat; mất kết nối thì thành viên chuyển offline.
5. Nếu được phép, `task_claim` nhận **task ready đã có** và một worktree riêng. Claim dùng khóa nguyên tử, không cho viết đè task của người khác.
6. Dừng ghi trước `task_submit`; gửi tóm tắt và bằng chứng test. Kivuno checkpoint/push vào origin đã cấu hình với tác giả là owner của thành viên, chuyển sang review và giữ lease cho tới khi người dùng quyết định tích hợp.

`usage_report` nhận phần trăm/reset nhìn thấy trong client, đánh dấu là tự khai báo. Báo 50% hoặc thấp hơn thì chặn nhận việc mới. Khi quota chưa rõ, cần quyền rõ ràng cho kết nối đó. Kivuno không thể đo hoặc cưỡng chế dừng process Claude ở ngoài ứng dụng.

Thu hồi/hết hạn/mất kết nối không tự giải phóng một task đang ghi. Người dùng phải dừng client thật rồi xác nhận recovery. Recovery từ chối session lịch sử, task đã review/done, session đã bị thay thế và checkpoint/claim đang chạy. Bridge chỉ nhận loopback, không có browser Origin, token ràng buộc một thành viên/một dự án; không được publish qua web/cloud. Khởi động lại coordinator làm token cũ hết hiệu lực, vẫn giữ lease cần phục hồi.

Claude không nằm trong đội native tự dispatch brainstorm/workflow. Nó có thể tham gia thảo luận và nhận task đã chuẩn bị qua bridge. Kivuno không điều khiển model/reasoning hay tự tạo conversation bên trong client ngoài; client đó quyết định và báo tiến độ về nhóm.

## Contract phục vụ UI và tích hợp

- `Member.provider`: `codex | gemini | claude`; dữ liệu cũ được migrate thành `codex`. Session lưu provider; external session còn có `external` và `externalConnectionId`.
- `GET /api/providers`: capability thực gồm `mode`, `available`, `login`, `quota`, `models`, `reasoning`, lý do nếu có. Claude external không khả dụng trên cloud.
- `POST /api/accounts/connect {provider,runnerId?}`: Codex/Gemini trả profile và login instructions; Claude tạo external profile, không OAuth. Gemini/Claude trong bản này chỉ kết nối cục bộ; remote runner hiện vẫn dành cho Codex.
- `POST /api/members/:id/quota/turn-grants {projectId,maxTurns,expiresAt,acknowledgeUnknownQuota:true}` và `POST /api/quota/turn-grants/:id/revoke {}`: quyền prompt Gemini do người dùng cấp, không phải quota provider.
- `POST /api/external-connections {memberId,projectId,durationMinutes,allowTaskClaims,allowUnknownQuota}`: tạo cấu hình MCP, tối đa 480 phút. `GET /api/external-connections` không trả token; `POST /api/external-connections/:id/revoke {}` thu hồi.
- `POST /api/external-agent/rpc`: MCP transport cho bridge cục bộ với bearer token theo phạm vi; không dùng cookie web hay desktop bearer tổng.

Handoff khác provider dùng checkpoint Git + trạng thái/task/test/việc còn lại. Không copy provider thread, OAuth hoặc session file. Handoff tới external Claude cần người dùng kiểm tra checkpoint và chuẩn bị task ready cho client đó nhận; bộ điều phối không tự khởi chạy Claude.

## Skill và plugin

Các hướng dẫn Markdown độc lập với công cụ có thể chuyển đổi sau khi đọc license, đường dẫn, tên tool và quyền. Codex skill gọi `functions.exec`, `apply_patch` hoặc một plugin riêng không tự nhiên hoạt động trên Gemini hay Claude. Các connector OAuth, binary, hooks và MCP config là quyền thực thi; group chỉ chia sẻ inventory và tài liệu đã lọc, không chia sẻ token hoặc tự cài/chạy gói từ tin nhắn.

Antigravity chưa được tích hợp trong 0.6. Không đồng nhất quyền đăng nhập IDE Antigravity với Gemini CLI hoặc quyền API.

## Bằng chứng kiểm thử và phần cần người dùng kiểm chứng

- Chạy **CLI Gemini 0.66.0 thật** trong profile trống: handshake ACP, phiên bản/capability và `account/read` signed-out; không gửi authenticate hoặc model prompt.
- Peer ACP chạy bằng child process riêng kiểm tra framing/stream, catalog model, resume, quyền ghi file, môi trường profile, browser chỉ bật từ login rõ ràng và restart không tự đăng nhập. Đây là kiểm thử protocol được điều khiển, không phải bằng chứng model Gemini live.
- Test backend kiểm tra quota unknown/allowance, claim/fencing/recovery, scope/credential path, mixed-provider chat routing và external MCP authorization.
- Chưa dùng tài khoản người dùng để kiểm tra Google OAuth hoàn chỉnh, prompt Gemini thật, quota hết trên provider hoặc client Claude thật. Các bước đó do người dùng đăng nhập khi test; không được báo chúng đã qua chỉ vì protocol tests thành công.

Nguồn: [Gemini ACP](https://geminicli.com/docs/cli/acp-mode/), [Google sign-in](https://geminicli.com/docs/get-started/authentication/), [source Gemini CLI v0.66.0](https://github.com/google-gemini/gemini-cli/tree/v0.66.0), [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), [Claude MCP](https://code.claude.com/docs/en/mcp).
