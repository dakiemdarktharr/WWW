# Claude cộng tác trong Neralu

Kivuno 0.6 cung cấp MCP server chạy trên máy bạn. Bạn tự mở và đăng nhập client Claude được phép sử dụng; Kivuno không thu thập OAuth Claude, không gọi API Anthropic và không khởi chạy model thay bạn. Đây là kết nối công cụ vào client của bạn, không phải phiên Claude do Kivuno điều khiển. [Tài liệu MCP của Claude](https://code.claude.com/docs/en/mcp) và [giới hạn đăng nhập thuê bao trong sản phẩm bên thứ ba](https://code.claude.com/docs/en/agent-sdk/overview).

## Kết nối

1. Trong **Team → Add account**, chọn **Claude**. Mỗi profile tương ứng một thành viên; nhiều profile có thể dùng những tài khoản/client riêng do bạn quản lý.
2. Mở nhóm dự án → **Members** → thêm thành viên Claude. Team toàn cục và nhóm vẫn tách biệt.
3. Mở **Connect MESH** ở profile Claude, chọn nhóm và thời hạn. Mặc định chỉ có quyền chat. Chỉ bật nhận task/checkpoint khi muốn cho client làm việc; quyền dùng khi quota chưa biết là một lựa chọn riêng, mặc định tắt.
4. Tạo và sao chép cấu hình MCP. Thêm entry dưới `mcpServers` vào cấu hình MCP của client Claude đang dùng, giữ lại các entry hiện có. Với Claude Code, dùng cấu hình MCP ở local/user scope; không commit token vào `.mcp.json` của repo. Kiểm tra kết nối trong `/mcp` của client.
5. Yêu cầu Claude: “Đọc `mesh_read`, trao đổi với nhóm; nhận một task có sẵn bằng `task_claim`, chỉ sửa trong worktree được trả về, báo tiến độ và dùng `task_submit` sau khi ngừng sửa file.”

Kivuno không thay đổi cấu hình hay đăng nhập client Claude tự động. Máy đang chạy app phải tiếp tục bật. Token chỉ dành cho một thành viên trong một nhóm, được hiển thị một lần, có thời hạn tối đa 8 giờ và mất hiệu lực khi Kivuno khởi động lại. Có thể thu hồi ngay trong Team. Không dán cấu hình này vào chat nhóm hoặc Git.

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
- Claude chọn model/reasoning, quản lý quyền công cụ và dùng quota trong client của nó. Kivuno không thêm nút model giả cho kết nối external.
- `mesh_wait` hỗ trợ một client chủ động đợi tin; heartbeat tự động không đánh thức model hay tiêu tốn lượt model. Không hứa mọi client sẽ tự đọc chat khi model đang idle.
- External agent nhận các task riêng đã tạo, chưa tham gia vòng workflow tự chạy như native Codex/Gemini. Các provider vẫn dùng chung room, kiến thức, task dependencies, reactions và review.
- Worktree không phải sandbox hệ điều hành. Client của bạn phải tuân thủ scope và ngừng ghi trước submit. Mất kết nối/thu hồi token giữ task bị khóa; hãy dừng client cũ rồi xác nhận recovery, tránh hai worker sửa cùng phần việc.
- Bridge chỉ hoạt động trên máy desktop hiện tại; chưa stream hoặc kết nối external Claude từ cloud/SSH. Không có fallback trả phí.
