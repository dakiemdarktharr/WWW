# Sade: bộ demo và tiêu chí đánh giá

Ngày: 17/11/2026. Sade dùng workflow có sẵn của Kivuno, thêm lựa chọn từ Chat, ưu tiên teammate được chỉ định, chọn model phù hợp và review độc lập. Bật **Sade · Plan and build** rồi gửi một yêu cầu. Một người trong nhóm có thể bắt đầu; các người khác không phải gửi lại cùng prompt.

## Chạy kiểm thử xác định

Yêu cầu Node theo `package.json`. Chạy:

```sh
npm run test:sade
npm run test:chat
npm run test:portal
```

`test:sade` chạy kiểm thử bộ điều phối, khóa, model selection, review, handoff và runner bằng protocol peer có kiểm soát. Không tiêu quota model và **không chứng minh chất lượng suy luận trên model thật**. Những bài chạy browser xác minh UI với backend test. Cần ghi kết quả riêng cho lần demo có tài khoản và máy thật.

## Demo A — một prompt, nhiều vai trò

Tạo project mẫu trống, kết nối Gemini và một Codex profile tên Astra; cho phép usage của từng tài khoản. Chọn nhóm này trong Chat và bật Sade.

> Làm trang đăng ký workshop cho một câu lạc bộ. Gemini lo cấu trúc và hợp đồng dữ liệu trước, Astra làm giao diện theo cấu trúc đó. Hỏi tôi thích phong cách nào hoặc có muốn để Astra tự chọn. Codebase, backend và kiểm tra bảo mật hãy giao cho AI phù hợp đang được phép dùng. Chưa xuất bản.

Kỳ vọng: một workflow, các bước có dependency; frontend nhận kết quả kiến trúc; `preferredMemberId` giữ lựa chọn được người dùng nêu. Việc chưa chỉ định được chia theo tải và vai trò. Aesthetic được hỏi một lần hoặc tự chọn khi được giao quyền. Prompt của Sade hướng dẫn hành vi này; chất lượng hiểu ngôn ngữ cần đo trên model thật, không thể suy từ schema test.

Đo: số lần con người phải lặp lại yêu cầu (mục tiêu 0), số câu hỏi cần thiết, thời gian tới bản đầu tiên, scope xung đột, tỷ lệ đạt acceptance. Gemini native và Codex native được dùng trong workflow; Claude/Antigravity được chọn khi profile đã bật managed runtime, đăng nhập và được cấp prompt; profile external không tự chạy.

## Demo B — chống trùng và mâu thuẫn

Cho hai yêu cầu cùng sửa `src/registration.ts`. Gửi lại cùng HTTP request ID khi giả lập mất kết nối. Khi một nhánh đang làm, báo: “Phần này tôi đã commit; đừng làm lại, kiểm tra commit mới trước.”

Kỳ vọng: retry không tạo workflow thứ hai; chỉ một lease ghi vào phạm vi trùng; AI nhận thông tin mới qua room; code nằm trong worktree riêng. Khi tích hợp phải kiểm tra trạng thái Git và phạm vi. Không được gán nhãn đã giải quyết xung đột nếu chưa tích hợp/test.

Đo: workflow trùng = 0; concurrent write lease chồng scope = 0; commit đã làm bị lặp = 0 qua kiểm tra thực tế. Phát hiện _tương đương ngữ nghĩa_ giữa hai commit không được bảo đảm chỉ bằng so tên task; vẫn cần agent đọc history và review diff.

## Demo C — tự kiểm tra chéo trước tích hợp

Giao viết hàm tính chỗ còn lại của workshop, cài lỗi lệch một đơn vị trong fixture. Khi task kết thúc, không gửi thêm lệnh “hãy review”.

Kỳ vọng: Sade tạo đúng một phiên chỉ đọc cho teammate khác tác giả; việc đơn giản dùng model tiết kiệm có high reasoning nếu catalog cho phép. Security/architecture dùng lựa chọn mạnh hơn. Người review ghi bằng chứng và đề xuất sửa. Người dùng đọc kết quả rồi quyết định tích hợp. Nếu sửa source sau review, kết quả cũ không đủ để tích hợp.

Test xác định hiện kiểm tra khác tác giả, chống dispatch trùng, ràng buộc digest và không chạy thêm sau pause. Demo model thật đo tỷ lệ tìm lỗi cài sẵn, false positives, thời gian và usage. Diff quá 12.000 ký tự, bị cắt, binary hoặc chứa đường dẫn credential không được tự xác nhận đã review đầy đủ; cần chia task nhỏ hơn. Chức năng GitHub push vẫn cần quyền riêng; Sade không tự push.

## Demo D — Windows chạy, macOS lỗi

Hai người A/B có Windows và Mac. A yêu cầu kiểm tra trên Mac của B; B chưa có tài khoản ChatGPT.

Chạy các ca: chưa cấp quyền; cấp quyền đúng máy/project; hết hạn/thu hồi; mất kết nối giữa lệnh; đường dẫn ngoài scope; yêu cầu mang theo token đăng nhập của A. Kỳ vọng an toàn: không thực thi khi không đủ quyền, không lộ token, không chạy lại một thao tác có trạng thái chưa rõ.

**Luồng cấp quyền và thực thi đã có trên nhánh Sade, chưa xác minh Windows → Mac end-to-end.** Trong Machines, nguồn chọn project và xuất cấu hình dùng máy để kiểm thử. Chủ máy đích mở Kivuno, nhập cấu hình và xác nhận native dialog: project, 30 phút, full access mặc định tắt. Chủ máy đích cần tài khoản Kivuno để mở ứng dụng nhưng không cần tài khoản ChatGPT/Claude/Gemini cho chế độ này. Không chuyển session AI: model ở nguồn, lệnh/file chạy trên máy đích.

machine_list chỉ trả máy đang online có grant đúng project. machine_use hỗ trợ info/sync/read/write/run/pull. Lệnh tối đa 60 giây; snapshot tối đa 2 MB/2.000 file, 512 KB mỗi file; credential paths bị loại và các mẫu secret phổ biến bị chặn (không thay thế việc chủ repo kiểm tra dữ liệu). Full access cho phép thực thi với quyền OS của chủ máy, **cwd không phải sandbox**. Không bật full access thì không chạy lệnh hoặc sửa file. Stop trên máy đích thu hồi quyền; hết hạn dừng subprocess; mất liên lạc dừng sau cửa sổ giám sát, không phải tức thời. Kết quả chưa rõ không được tự chạy lại, kể cả khi process khởi động lại. Pull phải khớp snapshot nguồn và scope đang sở hữu.

`machine-execution.test.ts` chạy tiến trình Node thật trên OS hiện tại và qua broker/MachineAgent có kiểm soát; chứng minh kiểm tra quyền, thu hồi, expiry, chống replay và giới hạn pull. Nó **không** chứng minh cloud transport hai máy hay OAuth/model thật trên Mac. Báo cáo Mac ở PR #2 kiểm thử code trước adapter/grant mới; cần chạy lại nhánh này trên Mac.

## Demo cho người không chuyên kỹ thuật

1. “Làm lịch phân công cho câu lạc bộ tuần tới từ bảng mẫu này.” Thành công: lịch có thể xem/sửa, người dùng không phải chọn model hay reasoning.
2. “Tạo trang giới thiệu workshop, có form đăng ký; cho tôi xem trước.” Thành công: hỏi nội dung và phong cách cần thiết, hiển thị bản xem trước, nói rõ form đang lưu dữ liệu ở đâu.
3. “Tóm tắt phản hồi người tham dự và đề xuất ba thay đổi.” Thành công: dùng dữ liệu giả/đã được phép, không gửi thông tin nhận dạng không cần thiết, có dẫn chứng cho kết luận.

Ghi mỗi lần thử: prompt, provider/model thật, OS, quyền, số câu hỏi, thời gian, usage, kết quả acceptance, lỗi và bằng chứng. Không cộng test protocol vào tỷ lệ thành công của demo model thật.
