# Prompt giao cho Codex trên macOS

Bạn đang tiếp tục kiểm thử và sửa Kivuno trên một máy Mac thật. Hãy thực hiện công việc, không chỉ đưa kế hoạch.

Repository chính: https://github.com/dakiemdarktharr/WWW
Website production: https://kivuno.vercel.app

## 1. Lấy đúng bản mới nhất trước khi kiểm thử

- Đọc AGENTS.md và hướng dẫn của repository. Ghi nhận chip Apple Silicon/Intel, phiên bản macOS, Node, Git và các CLI đang có; không in thông tin đăng nhập, token hay khóa API.
- Kiểm tra GitHub bằng fetch thật, xác định SHA mới nhất của origin/main, các nhánh/PR đang làm Sade, các GitHub Releases và manifest https://kivuno.vercel.app/api/desktop/release. Không suy đoán phiên bản mới nhất từ tên website hoặc nhãn Latest.
- Có một Codex trên Windows đang phát triển Sade, adapter Claude/Antigravity và quyền thực thi trên máy khác, với nhánh dự kiến codex/sade-managed-machines. Kiểm tra nhánh đó có trên remote chưa. Nếu có, đọc diff và chọn SHA phù hợp để kiểm thử; nếu chưa có, dùng origin/main và nói rõ chưa thể đánh giá phần code chưa được push. Không đánh đồng bản main với code đang phát triển trên máy Windows.
- Tải bộ cài macOS mới nhất thực sự được công bố cho kiến trúc máy này từ manifest/GitHub Releases chính thức. Kiểm tra URL, dung lượng và SHA-256; ghi nhận codesign/notarization thực tế. Phiên bản Mac có thể thấp hơn web/Windows: không đổi nhãn một binary cũ thành phiên bản mới. Nếu không có bộ cài phù hợp, build từ SHA đã chọn thay vì tải bản bên thứ ba.
- Kiểm tra phiên bản ổn định mới nhất của Gemini CLI, Claude Code và Antigravity bằng tài liệu/kênh phát hành chính thức tại thời điểm thực hiện. Cài hoặc cập nhật CLI cần thiết trong phạm vi tài khoản hiện tại, ghi lại phiên bản trước/sau và kiểm tra tính tương thích với adapter. Không tự nâng macOS hay thay đổi thiết lập bảo mật toàn máy; nếu Gatekeeper chặn bộ cài, xác minh nguồn/chữ ký và xử lý qua cơ chế macOS chính thức, không tắt Gatekeeper hoặc xóa quarantine hàng loạt.
- Kiểm tra git status trước khi sửa. Giữ nguyên thay đổi chưa commit của người dùng. Tạo worktree và nhánh riêng codex/macos-provider-verification từ SHA đã xác định; không force-push, reset hoặc ghi đè nhánh của Codex trên Windows. Không nâng hàng loạt dependency lên latest: dùng lockfile và phiên bản Node được repository yêu cầu.

## 2. Kiểm tra ứng dụng và provider trên Mac thật

Ưu tiên kiểm tra bản đã đóng gói, sau đó so với bản chạy từ source để tìm đúng tầng gây lỗi:

- Cài/chạy Kivuno; kiểm tra đường dẫn có dấu cách và tiếng Việt, quyền thực thi, quarantine, app resources, Node/Git đi kèm, PATH khi mở từ Finder khác Terminal, đăng nhập/đăng xuất, mở lại app, đóng subprocess và trình duyệt nhúng.
- Gemini: dùng CLI chính thức và profile của Kivuno; thử Google sign-in, hủy sign-in, refresh/restart, model catalog, prompt, đọc/sửa file trong scope, xử lý hết quota, pause/resume và review. Kiểm tra callback OAuth, tiến trình con, đường dẫn profile và quyền file trên macOS.
- Claude Code: kiểm tra/cài CLI chính thức nếu thiếu, xác minh version và auth status bằng đầu ra đã lọc. Thử kết nối mà không gọi model trước. Nếu code đã có adapter Sade, kiểm tra model/reasoning thực sự do CLI cung cấp, MESH tools, prompt, file approval, kết thúc turn và review độc lập. Nếu chỉ có external MCP bridge, báo rõ giới hạn đó, không coi MCP handshake là đã chạy được Sade.
- Antigravity: đây là CLI/provider riêng, không thay bằng Gemini CLI. Kiểm tra CLI chính thức, Google sign-in, ACP initialize/session/config options, quyền MCP, cancel và teardown. Chỉ chọn model/effort do CLI cung cấp; không giả danh một IDE khác để mở model bị giới hạn.
- Dùng đăng nhập của người dùng qua giao diện/CLI chính thức. Không yêu cầu họ dán mật khẩu/token vào chat; không sao chép credential giữa người dùng hoặc máy. Không tự chuyển sang API tính phí khi thiếu subscription. Nếu chưa có tài khoản, hoàn thành kiểm thử không cần đăng nhập và các test giao thức, rồi đánh dấu demo model thật là CHƯA KIỂM CHỨNG, không phải PASS.

## 3. Chạy bốn ví dụ của người dùng qua Sade

A. Một người gửi trong group/project chat:
“Tôi nhờ Gemini làm cấu trúc chung rồi đưa cho Astra làm frontend, codebase, backend và cyber.”
Kỳ vọng: chỉ cần một prompt; Gemini phụ trách cấu trúc; Astra nhận đúng đầu ra và hỏi phong cách hoặc tự chọn nếu người dùng giao quyền; các phần chưa chỉ định được phân công phù hợp. Không yêu cầu người thứ hai lặp lại prompt. Ghi rõ nếu shared group giữa nhiều người và project chat local có hành vi khác nhau.

B. “Con của ông làm sai rồi, commit này mâu thuẫn với commit Codex của tôi” và “Tôi đã commit rồi, tại sao ông làm lại y chang?”
Kỳ vọng: agent đọc history/room mới nhất; không có hai writer sở hữu scope trùng; request retry không tạo workflow trùng; thông báo mới điều hướng được công việc; không commit lại phần đã hoàn thành. Cài tình huống xung đột thật trong repo thử nghiệm và xác minh kết quả Git, không chỉ đọc prompt hệ thống.

C. “Đây là code Gemini tạo, lấy Claude và ChatGPT kiểm tra thử.”
Kỳ vọng: sau tác vụ code, Sade tự giao review cho agent khác tác giả trước tích hợp/push mà không cần người dùng nhắc lại. Dùng model tiết kiệm với reasoning cao khi model hỗ trợ; tăng năng lực cho vấn đề nhạy cảm. Cài lỗi off-by-one và một lỗi bảo mật trong fixture vô hại, ghi nhận agent tìm được gì. Sửa code sau review phải làm mất hiệu lực review cũ. Không coi một lượt review kết thúc là chứng minh code hết lỗi.

D. “Windows chạy bình thường nhưng Mac lỗi; người có Mac không có tài khoản ChatGPT.”
Kỳ vọng: chủ Mac cấp quyền cho đúng project/máy, có thời hạn và khả năng thu hồi; model/credential ở máy nguồn, thao tác kiểm thử thực thi trên Mac thật. Chủ Mac không phải đăng nhập ChatGPT để chỉ cung cấp máy thực thi.
Thử cả chưa cấp quyền, đúng quyền, hết hạn, thu hồi khi đang chạy, mất kết nối và retry sau khi kết quả chưa rõ. Không được chạy nếu thiếu quyền hoặc tự chạy lại thao tác có kết quả chưa xác định. Ghi bằng chứng OS/runtime thật từ Mac; không dùng chuỗi platform giả làm bằng chứng đã chạy trên macOS. Nếu chưa có máy nguồn/transport phù hợp, kiểm thử runner trên Mac và ghi rõ phần end-to-end còn thiếu.

## 4. Sửa tới khi các tiêu chí có thể kiểm chứng đạt

- Tạo project/fixture riêng, không thao tác vào dữ liệu hoặc repo thật của người khác trong demo.
- Với mỗi lỗi: ghi bước tái hiện, expected/actual, log đã che bí mật; xác định nguyên nhân; sửa tối thiểu nhưng đầy đủ; thêm regression test có ý nghĩa rồi chạy lại đúng tình huống trên Mac.
- Không vô hiệu hóa quota, approvals, scope locks, kiểm tra owner, sandbox hoặc kiểm tra checksum để làm test xanh. Không dùng dangerously-skip-permissions như cách sửa lỗi quyền.
- Ưu tiên lỗi đặc thù Mac và tương thích provider. Nếu cần thay đổi các adapter/quyền máy mà Codex Windows đang sửa, giữ patch trên nhánh riêng và mô tả contract cần thay đổi để tích hợp; không ghi đè công việc của nhau.
- Chạy typecheck, test liên quan, build và các E2E hiện có phù hợp; xác nhận test không chỉ chạy mock. Build bộ cài Mac từ code đã sửa, chạy thử bộ cài đó và tạo checksum; không khai đã ký/notarize nếu chưa làm được.
- Commit các sửa đổi, push nhánh riêng và tạo PR về main khi có quyền GitHub. Đính kèm SHA nền, kết quả test, lỗi đã sửa, giới hạn còn lại và metadata bộ cài. Giữ lịch sử nhánh để Codex Windows có thể review/cherry-pick/rebase an toàn.

## 5. Báo cáo kết quả

Trả về bảng cho A/B/C/D và từng provider: PASS thực tế / FAIL / CHƯA KIỂM CHỨNG, kèm bằng chứng và lý do. Ghi rõ SHA, phiên bản app/CLI, OS/chip, tài khoản nào đã được phép dùng (không chứa secret), bài test chạy thật hay mô phỏng, số lượt model đã dùng và file thay đổi. Nêu commit/PR và đường dẫn artifact/checksum.

Mục tiêu là hành vi người dùng mong muốn chạy được trên Mac, không phải chỉ build thành công. Phần email/password reset nằm ngoài phạm vi lần này.
