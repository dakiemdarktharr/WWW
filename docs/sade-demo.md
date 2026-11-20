# Sade: bộ demo và tiêu chí đánh giá

Ngày 19/11/2026. Trong Chat của project, bật **Sade · Plan and build** rồi gửi một yêu cầu. Một tài khoản đã kết nối lập kế hoạch. Sade kiểm tra kế hoạch, phân công theo tên hoặc vai trò, chờ đầu ra cần thiết và giao review độc lập. Xem [cấu hình và kết quả nghiên cứu](sade-workspace-research.vi.md) để phân biệt luồng Chat của project với Shared Groups.

Trong Shared Groups, mỗi người thêm teammate, liên kết cùng Git origin và nhánh, rồi xác nhận số lượt và quyền trên desktop. Người gửi chọn **Ask Sade** và dùng cùng các prompt A–D. Sau review và tích hợp cục bộ, patch có thể đi thẳng đến harness phụ thuộc nếu chủ patch đã cấp quyền bàn giao. [Thiết lập Shared Groups và kết quả kiểm thử](shared-sade-verification.vi.md)

## Chạy kiểm thử xác định

Yêu cầu Node theo `package.json`. Chạy:

```sh
npm run test:sade
npm run test:shared-sade
npm run test:chat
npm run test:portal
```

`test:sade` chạy kiểm thử bộ điều phối, khóa, model selection, review, handoff và runner bằng protocol peer có kiểm soát. Không tiêu quota model và **không chứng minh chất lượng suy luận trên model thật**. Những bài chạy browser xác minh UI với backend test. Cần ghi kết quả riêng cho lần demo có tài khoản và máy thật.

## Demo A — một prompt, nhiều vai trò

Tạo repo mẫu có commit đầu tiên. A kết nối Gemini, B kết nối Codex với tên Astra. Trong Shared Groups, mỗi thành viên chia sẻ harness và cấp quyền cho repo đó. A chọn **Ask Sade** và gửi một tin.

> Làm trang đăng ký workshop cho một câu lạc bộ. Gemini lo cấu trúc và hợp đồng dữ liệu trước, Astra làm giao diện theo cấu trúc đó. Hỏi tôi thích phong cách nào hoặc có muốn để Astra tự chọn. Codebase, backend và kiểm tra bảo mật hãy giao cho AI phù hợp đang được phép dùng. Chưa xuất bản.

Kỳ vọng: một workflow, các bước có dependency; frontend nhận kết quả kiến trúc; `preferredMemberId` giữ lựa chọn được người dùng nêu. Việc chưa chỉ định được chia theo tải và vai trò. Aesthetic được hỏi một lần hoặc tự chọn khi được giao quyền. Prompt của Sade hướng dẫn hành vi này; chất lượng hiểu ngôn ngữ cần đo trên model thật, không thể suy từ schema test.

Đo: số lần con người phải lặp lại yêu cầu (mục tiêu 0), số câu hỏi cần thiết, thời gian tới bản đầu tiên, scope xung đột, tỷ lệ đạt acceptance. Gemini native và Codex native được dùng trong workflow; Claude/Antigravity được chọn khi profile đã bật managed runtime, đăng nhập và được cấp prompt; profile external không tự chạy.

## Demo B — chống trùng và mâu thuẫn

Trong một yêu cầu Shared Groups, giao hai việc có phạm vi cùng chạm `src/registration.ts`. Gửi lại cùng mã tin nhắn qua API thử nghiệm để mô phỏng mất phản hồi. Khi một nhiệm vụ đang chạy, chọn **Update task** và gửi “Phần này tôi đã commit rồi. Kiểm tra commit mới trước khi sửa tiếp nhé.”

Khi gửi lại cùng yêu cầu, nhóm chỉ thấy một workflow. Các nhiệm vụ ghi vào cùng phạm vi chạy lần lượt. Chỉ đạo mới được chuyển đến harness trong lượt đang chạy. Nếu harness kết thúc lượt trước khi đọc chỉ đạo, nhóm thấy nhiệm vụ bị chặn. Code nằm trong worktree riêng và bước tích hợp kiểm tra trạng thái Git cùng phạm vi.

Đo: workflow trùng = 0; concurrent write lease chồng scope = 0; commit đã làm bị lặp = 0 qua kiểm tra thực tế. Phát hiện _tương đương ngữ nghĩa_ giữa hai commit không được bảo đảm chỉ bằng so tên task; vẫn cần agent đọc history và review diff.

## Demo C — tự kiểm tra chéo trước tích hợp

Giao viết hàm tính chỗ còn lại của workshop, cài lỗi lệch một đơn vị trong fixture. Khi task kết thúc, không gửi thêm lệnh “hãy review”.

Chạy lại với một yêu cầu chỉ định Mây review đúng file Bếp sửa. Trong Shared Groups, tác vụ đã giao cho Mây nhận diff và tiêu chí review. Sau khi Mây chấp thuận, nhóm thấy có đúng một lượt review cho diff đó. Bếp vẫn xác nhận tích hợp trên desktop của mình.

Kỳ vọng: Sade tạo đúng một phiên chỉ đọc cho teammate khác tác giả; việc đơn giản dùng model tiết kiệm có high reasoning nếu catalog cho phép. Security/architecture dùng lựa chọn mạnh hơn. Người review ghi bằng chứng và đề xuất sửa. Người dùng đọc kết quả rồi quyết định tích hợp. Nếu sửa source sau review, kết quả cũ không đủ để tích hợp.

Test xác định hiện kiểm tra khác tác giả, chống dispatch trùng, ràng buộc digest và không chạy thêm sau pause. Demo model thật đo tỷ lệ tìm lỗi cài sẵn, false positives, thời gian và usage. Diff quá 12.000 ký tự, bị cắt, binary hoặc chứa đường dẫn credential không được tự xác nhận đã review đầy đủ; cần chia task nhỏ hơn. Chức năng GitHub push vẫn cần quyền riêng; Sade không tự push.

## Demo D — Windows chạy, macOS lỗi

Hai người A/B có Windows và Mac. A yêu cầu kiểm tra trên Mac của B; B chưa có tài khoản ChatGPT.

Chạy các ca: chưa cấp quyền; cấp quyền đúng máy/project; hết hạn/thu hồi; mất kết nối giữa lệnh; đường dẫn ngoài scope; yêu cầu mang theo token đăng nhập của A. Kỳ vọng an toàn: không thực thi khi không đủ quyền, không lộ token, không chạy lại một thao tác có trạng thái chưa rõ.

Trong **Machines**, A chọn project và xuất cấu hình ghép cặp. B nhập cấu hình trên Mac rồi xác nhận quyền cho project và thời hạn hiển thị trong hộp thoại. A mở **Let Sade use your teammate** trong Shared Groups, chọn project, bật **Allow local file changes** và chọn Mac ở **Paired machine**. B đăng nhập Kivuno để cấp quyền. Model dùng tài khoản của A trên Windows. Mac nhận file project được phép và chạy các lệnh kiểm thử đã cấp quyền.

`machine_list` chỉ trả máy đang online có grant đúng project. Dùng `machine_use` để kiểm tra máy, đồng bộ, đọc, ghi và nhận file sửa. `machine_run` nhận tên chương trình và danh sách đối số. Lệnh tối đa 60 giây. Runner hỗ trợ chia gói nhận snapshot tối đa 8 MiB, 2.000 file và 4 MiB mỗi file. Runner đời cũ nhận tối đa 2 MiB và 512 KiB mỗi file. Credential paths bị loại và các mẫu secret phổ biến bị chặn. Full access cho phép thực thi với quyền OS của chủ máy, **cwd chỉ là thư mục làm việc**. Stop trên máy đích thu hồi quyền. Hết hạn dừng subprocess và mất liên lạc dừng sau cửa sổ giám sát. Kết quả chưa rõ không tự chạy lại. Pull phải khớp snapshot nguồn và scope đang sở hữu.

`machine-execution.test.ts` kiểm tra quyền, thu hồi, hết hạn, gửi lại và giới hạn nhận file sửa. Bài `paired-macos` chạy Node trên Windows và runner macOS arm64, tái hiện lỗi đường dẫn rồi chạy lại sau khi sửa. Windows nhận đúng file đã sửa. Một lượt riêng dùng Codex đã đăng nhập trên Windows và reviewer mô phỏng. Lượt cấp quyền từ desktop Mac của thành viên B vẫn cần kiểm chứng. [Bằng chứng trên Windows và macOS](shared-sade-verification.vi.md)

## Chấm demo với hai tài khoản thật

1. Hai thành viên mở cùng một repo thử nghiệm, mỗi người dùng một profile provider mà mình đã đăng nhập. Chia sẻ và cấp quyền cho từng harness trong Shared Groups. Ghi commit app, hệ điều hành, provider, số lượt và quyền sửa của từng grant.
2. Với mỗi ca A–D, một thành viên dùng **Ask Sade** gửi prompt một lần. Ghi thứ tự phân công, số lượt model thật đã mở, thao tác cần chủ harness xác nhận, kết quả review và bằng chứng bàn giao. Dùng cùng mã tin nhắn khi kiểm tra gửi lại qua API thử nghiệm.
3. Chạy thêm ca một provider hết quota với phương án dự phòng được nêu trong tin, và ca chủ harness thu hồi quyền khi nhiệm vụ phụ thuộc đang chờ. Ghi grant nào đã dùng, nhiệm vụ nào dừng và vai trò nào dùng fixture. Dùng mã công việc để đối chiếu. Mỗi người giữ thông tin đăng nhập trên máy của mình.

## Demo cho người không chuyên kỹ thuật

1. “Làm lịch phân công cho câu lạc bộ tuần tới từ bảng mẫu này.” Thành công: lịch có thể xem/sửa, người dùng không phải chọn model hay reasoning.
2. “Tạo trang giới thiệu workshop, có form đăng ký; cho tôi xem trước.” Thành công: hỏi nội dung và phong cách cần thiết, hiển thị bản xem trước, nói rõ form đang lưu dữ liệu ở đâu.
3. “Tóm tắt phản hồi người tham dự và đề xuất ba thay đổi.” Thành công: dùng dữ liệu giả/đã được phép, không gửi thông tin nhận dạng không cần thiết, có dẫn chứng cho kết luận.

Ghi mỗi lần thử: prompt, provider/model thật, OS, quyền, số câu hỏi, thời gian, usage, kết quả acceptance, lỗi và bằng chứng. Không cộng test protocol vào tỷ lệ thành công của demo model thật.
