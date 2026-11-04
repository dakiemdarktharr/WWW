# Gemini, Antigravity và Claude trong Kivuno

Nghiên cứu ngày 2026-11-04. Bản 0.5 **chỉ chạy Codex thật**; chưa quảng cáo Gemini/Claude là provider hoạt động. Không cài thêm provider, gọi model trả phí hay mua gói trong đợt này.

## Hướng tích hợp

| Provider        | Cầu nối phù hợp                                                       | Đăng nhập và chi phí                                                                                                                | Trạng thái đề xuất                        |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Codex           | App Server, một profile riêng cho mỗi tài khoản, nhiều thread/session | Người dùng tự đăng nhập tài khoản được phép dùng; giữ quota thật                                                                    | Đã có                                     |
| Gemini CLI      | Client ACP qua stdio, hoặc headless JSON cho tác vụ một lượt          | CLI hỗ trợ đăng nhập Google; headless có thể dùng credential đã cache. Quota phụ thuộc cách đăng nhập                               | Adapter tiếp theo để thử miễn phí         |
| Antigravity CLI | `agy acp` qua stdio; kiểm tra version bằng `agy acp --help`           | ACP tái sử dụng đăng nhập CLI. Không lấy cookie từ IDE hay giả lập OAuth                                                            | Thử riêng, không đồng nhất với Gemini CLI |
| Claude Agent    | Claude Agent SDK hoặc CLI `-p` với output có cấu trúc                 | Sản phẩm bên thứ ba không được cung cấp claude.ai login/usage nếu chưa có chấp thuận của Anthropic; hướng SDK mặc định dùng API key | Giữ tắt trong cấu hình chỉ miễn phí       |

Gemini CLI có [ACP cho client tích hợp](https://geminicli.com/docs/cli/acp-mode/) và [headless JSON](https://geminicli.com/docs/cli/headless/). ACP phù hợp với UI cần nhận prompt, stream tiến độ, hủy/resume session và xử lý quyền công cụ. Cần pin version, handshake capabilities và kiểm tra schema thực tế thay vì đoán RPC từ tên trong tài liệu. [Đăng nhập Gemini CLI](https://geminicli.com/docs/get-started/authentication/) xác nhận headless dùng credential đã cache; nếu chưa có credential thì luồng headless có thể yêu cầu API key/Vertex AI. Vì thế không bật fallback sang API khi người dùng chỉ cho phép miễn phí.

[Antigravity ACP](https://antigravity.google/docs/cli/acp/) cho phép editor khởi chạy CLI như subprocess và tái sử dụng sign-in/settings của CLI. [Antigravity SDK](https://antigravity.google/docs/sdk/overview) là một bề mặt khác, có cấu hình API riêng; không suy luận rằng login IDE cấp quyền API miễn phí. Đây là lý do nên phát triển adapter CLI trước, còn điều kiện phân phối thương mại phải được rà soát riêng trước khi phát hành.

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) nêu rõ hạn chế claude.ai login/rate limits cho sản phẩm bên thứ ba nếu chưa được chấp thuận. Kivuno không nên thu thập OAuth token thuê bao để lách hạn chế đó. [Chế độ programmatic](https://code.claude.com/docs/en/headless) có session tiếp tục và output cấu trúc, nhưng không biến quyền sử dụng thuê bao thành quyền nhúng thương mại. Không thể hứa tích hợp Claude miễn phí cho mọi người dùng.

## Skill Codex có dùng được trên Gemini/Antigravity không?

**Có thể, nếu phần hướng dẫn độc lập với provider. Không phải mọi skill/plugin đều tương thích.**

- Markdown có `name`, `description`, hướng dẫn kiểm thử hoặc review thông thường có thể dùng lại sau khi rà soát đường dẫn và công cụ. [Gemini CLI](https://geminicli.com/docs/cli/using-agent-skills/) hỗ trợ `.gemini/skills` và alias `.agents/skills`; có bước đồng ý khi cài và kích hoạt.
- [Antigravity Skills](https://antigravity.google/docs/skills?app=antigravity-ide) dùng thư mục chứa `SKILL.md`, workspace `.agents/skills`, và vị trí global riêng. Skill được nạp theo nhu cầu. Không copy cấu hình profile của Codex sang thư mục Gemini.
- [Claude Skills](https://code.claude.com/docs/en/skills) hỗ trợ cùng định dạng nền tảng, nhưng frontmatter, hooks, tên tool và cơ chế kích hoạt có phần riêng. Ví dụ chỉ dẫn gọi `apply_patch`, `functions.exec`, `spawn_agent` hay tool của một plugin Codex cần được chuyển sang công cụ thực có trên provider đích.
- Plugin chứa MCP, hooks, binary hoặc OAuth là gói thực thi/quyền truy cập; chia sẻ tên và tài liệu không đồng nghĩa với chuyển quyền hay credential. Không tự cài/chạy gói do một agent vừa gửi vào chat.

Thiết kế nên có manifest tương thích: tên, phiên bản/hash, nguồn, license, provider hỗ trợ, tools cần, scripts cần, quyền và kết quả kiểm thử. Trạng thái `compatible`, `needs-adapter`, `unavailable` phải phản ánh kiểm tra thật. Chỉ tự chia sẻ kiến thức dạng văn bản đã lọc; phần executable cần người dùng xem diff và cho phép. Bản 0.5 trao đổi inventory/các hướng dẫn an toàn trong introduction round, không chia sẻ token hoặc cài plugin tự động.

## Prompt, model và reasoning theo từng provider

Đây là đề xuất kiến trúc, chưa phải adapter được triển khai:

1. Kivuno giữ một task envelope chung: mục tiêu, tiêu chí xong, scope được giao, evidence, dependency, budget, checkpoint và quyền hiện có. Nội dung chat/website vẫn là dữ liệu không đáng tin cậy; không ghi đè các quyền này.
2. Adapter Codex chuyển envelope sang developer/task instructions và dynamic tools. Adapter Gemini/Antigravity dùng context của session, project rules và MCP; Claude dùng cấu hình SDK/system prompt cùng tool approval callback. Không nhồi toàn bộ lịch sử mọi agent vào mỗi prompt.
3. `/model` chọn từ catalog của đúng provider. `/reasoning` chỉ hiển thị mức provider/model hỗ trợ; không ánh xạ máy móc `xhigh` của Codex sang tham số khác hay cố ép model tiết lộ suy luận nội bộ. Nếu không có capability thì báo chưa hỗ trợ.
4. Quota là các cửa sổ riêng của từng tài khoản/provider, có nguồn và thời điểm cập nhật. Không suy ra phần trăm thuê bao từ số token đã dùng, không đoán thời điểm reset. Khi thiếu dữ liệu, hiển thị unknown và không dùng API trả phí để tiếp tục.
5. Session gắn với provider/account/machine. Handoff khác provider dùng Git checkpoint + tài liệu tiến độ + tests + việc còn lại; không copy session/token giữa nhà cung cấp. Giữ lease/fencing để worker cũ không tiếp tục ghi sau khi chuyển việc.

## Cổng kiểm thử trước khi bật provider mới

Kiểm tra đăng nhập/cancel/logout thật, model catalog và lý do chọn model, permission callback, skill discovery, reconnect/resume, lỗi quota, không rò credential, mất kết nối máy, khóa task và một handoff từ Codex sang provider đó. Chạy bằng tài khoản thử được người dùng cho phép; không coi mocked output là bằng chứng tích hợp live. Chưa thực hiện các kiểm thử provider mới trong bản 0.5.
