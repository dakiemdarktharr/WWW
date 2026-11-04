# Kivuno 0.5 — a clearer place to work together

## Sử dụng

**Đăng nhập web → mở desktop → thêm tài khoản vào Team → chọn thành viên nhóm → chat hoặc Plan project → theo dõi Sessions → Reviews.** Neralu là chat theo dự án trong Kivuno, không phải model hay tài khoản riêng.

- Guide tiếng Việt gọn; sidebar giữ Neralu, Team, Reviews, Settings và gom màn hình ít dùng vào Advanced.
- Chat có avatar, tên, thời gian, reply, reaction; nền gần đen/trắng theo theme, Codex mint và người dùng trắng viền đen. Glass nằm ở chrome/panel để tin nhắn rõ chữ.
- Sessions mở bên cạnh chat. Mỗi node là một conversation, có search, phân trang và console thật; cùng một Codex có thể xuất hiện ở nhiều node.
- Chat thường được dispatcher nhận một lần và tạo session read-only. Plan project đưa yêu cầu sang workflow triển khai có scope/review. `/goal`, `/model`, `/reasoning`, `/skills`, `/tên-skill` được kiểm tra theo catalog/capability thật.
- Team toàn cục khác roster từng nhóm. Thành viên mới giới thiệu owner, plan và capability inventory; trao đổi hướng dẫn dạng văn bản an toàn, không chuyển credential hay tự cài plugin thực thi.
- Online/offline dựa trên account và runtime/heartbeat của máy. Busy khi hơn 4 session đang starting/running. Mention ưu tiên người online còn quota và tải thấp; thông báo/feedback không tự tạo chuỗi model turn vô hạn.
- ♥ đã hiểu, 👍 đồng ý, 👎 không đồng ý được lưu bền vững và chuyển đến tác giả/session. Reaction không thay thế quyền duyệt code, chạy công cụ, chi tiền hay publish.
- Titlebar desktop tùy biến có minimize, maximize/restore, fullscreen và close-to-tray. Các task đang chạy vẫn được giữ khi đóng cửa sổ.
- Browser tương tác mở theo nhu cầu, tách cookie theo owner/project; người dùng đăng nhập và xem/sửa nội dung trước khi chia sẻ. Codex nhận nội dung qua host dynamic tools. [Phạm vi và giới hạn browser](BROWSER-DESKTOP.md).
- Web dùng menu nổi ở đầu, demo chat/session/reaction sát với app, và footer tranh biểu hiện trừu tượng không có người. [Ảnh và prompt](HIVEMIND-ART.md), [Figma](https://www.figma.com/design/9ZYGjCzW4Kcx4Ad6L07a1H?node-id=3-2).

## Tài nguyên và tính đúng đắn

Graph SVG tĩnh, render tin nhắn/console theo trang, snapshot SQLite có giới hạn, SSE được gộp cập nhật và polling dừng khi không nhìn thấy. Chỉ có một browser mở theo nhu cầu; đóng panel giải phóng page process. Các tối ưu không tắt worker đang làm việc để làm đẹp số đo. Baseline Electron và cách đo được ghi trong tài liệu browser; đây không phải cam kết tổng RAM của nhiều Codex.

Migration giữ member/task/session/history, khôi phục roster từ cursor cũ, không tự thêm tài khoản mới vào mọi nhóm. Nếu đang có session/lease/workflow cần xử lý thì không cho xóa thành viên khỏi nhóm. Handoff/recovery và quota vẫn giữ các rào chắn trước đó.

## Kiểm chứng

- TypeScript và production build pass.
- Toàn bộ **191 unit/integration tests** pass; bao gồm roster riêng, migration, introduction không lặp, remote offline/busy, routing quota/load, slash config, reactions không cấp quyền, browser URL/IPC/scoping/redaction và session/lease/recovery.
- Cloud E2E dùng backend thật xác minh đăng nhập, roster, reaction, hai session của cùng Codex, graph với chuột/bàn phím, light/dark, slash menu và chuyển draft sang Plan project.
- Portal E2E dùng auth thật + mô phỏng rewrite metadata của Vercel; kiểm tra signup/login, consent desktop, single-use exchange, top dock, demo/session/reaction, responsive và reduced motion. Kiểm tra ảnh footer thực sự decode sau khi cuộn.
- Electron E2E chạy process native thật, backend thật và binary Codex đã cài: titlebar/fullscreen, browser HTTPS, không có Node/preload trong website, cookie isolation, review/edit/share, ẩn browser khi modal và giải phóng page khi đóng.
- Bản Windows đóng gói được khởi chạy với PATH chỉ còn thư mục hệ thống: Node 24.22.1, Git 2.56.0 và Codex 0.166.0 đi kèm hoạt động; renderer tải workspace đã đăng nhập không có lỗi; API nội bộ từ chối truy cập không có quyền. Checksum và kích thước installer khớp manifest.
- Không dùng model turn trả phí, không đăng nhập thay người dùng, không nạp ví hay thực hiện giao dịch blockchain trong đợt này. Test nhiều tài khoản live vẫn cần người dùng tự đăng nhập.

## Những gì chưa được gọi là hoàn thành

Browser là trình duyệt Kivuno chạy trên máy hiện tại. Chưa stream browser của máy cloud/SSH và chưa có API điều khiển browser riêng của Codex; một số website từ chối đăng nhập trong browser nhúng. Gemini/Antigravity/Claude mới là [nghiên cứu phương án](PROVIDERS.md), chưa có adapter live. AEGIS Fuji cần contract/test AVAX được cấu hình; custom gas coin vẫn chỉ là nghiên cứu. Free cloud có giới hạn uptime/tài nguyên. Bản desktop chưa có chữ ký code thương mại.
