# Sade trong Shared Groups

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở phần **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Mỗi quyền áp dụng cho một harness trên máy của chủ tài khoản, hết hạn sau một giờ và giới hạn từ một đến mười lượt. Quyền này cũng cấp lượt cho công việc của nhóm khi provider không báo quota. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff đã lọc cho người kiểm tra.

Người gửi chọn **Ask Sade** và gửi một tin nhắn để lập kế hoạch. Sau khi gửi thành công, ô soạn quay về chế độ gửi tin nhóm thông thường. Nếu người gửi chỉ báo tình hình qua **Ask Sade**, planner có thể kết thúc bằng một thao tác riêng, kèm lời giải thích. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời. Nếu harness cần biết phong cách giao diện, người gửi có thể chọn phong cách hoặc nhờ harness quyết định. Nhiệm vụ tiếp tục trong lượt được cấp tiếp theo. Gửi lại cùng tin nhắn không lập thêm workflow.

Để nhờ Sade kiểm tra việc đã nêu trong một tin cũ, chọn **Ask Sade about this** ngay dưới tin đó. Ô soạn hiển thị người gửi và bản xem trước để bạn kiểm tra trước khi gửi. Planner nhận tối đa 1.200 ký tự từ đúng tin đã chọn, sau khi hệ thống che các mẫu thông tin xác thực nhận diện được. Nếu tin được chọn là yêu cầu Sade, yêu cầu mới phải cùng project. Harness thực hiện và review nhận nhiệm vụ đã phân công. Desktop cũ giữ yêu cầu tham chiếu trong hàng chờ và giữ nguyên lượt đã cấp.

Desktop giữ kết quả đầu tiên đã được chấp nhận của planner hoặc reviewer. Lời gọi lặp đúng nội dung được xác nhận một lần nữa. Lời gọi mâu thuẫn trong cùng lượt bị từ chối. Planner vẫn có thể sửa và gửi lại đầu ra nếu lần trước bị lỗi kiểm tra cấu trúc.

Planner nhận mã ngắn cho từng teammate cùng tên gốc và tên không dấu khi khác nhau. Desktop đối chiếu mã với roster của lượt lập kế hoạch và chuyển về ID quyền đã cấp trước khi nộp kế hoạch. Mã ngoài roster bị từ chối. Kế hoạch tham chiếu dependency không tồn tại trả về các khóa đã khai báo để harness có thể sửa trong cùng lượt. Việc phân công chỉ bắt đầu khi kế hoạch hợp lệ.

Sade dùng tên chủ tài khoản và quyền của project để phân biệt các harness trùng tên. **Sade progress** hiển thị tên harness cùng tên chủ tài khoản. Nếu còn mơ hồ, người gửi dùng **Reply to Sade**. Nếu teammate chưa được cấp quyền, chủ tài khoản xác nhận quyền trên desktop rồi người gửi báo lại trong cùng yêu cầu. Sade đọc các quyền còn hiệu lực của đúng project ở lượt lập kế hoạch tiếp theo.

Khi project có hơn 32 harness đã cấp quyền, planner tra cứu theo từng trang bằng tên, chủ tài khoản, provider hoặc hệ điều hành. Kết quả dùng mã teammate của lượt lập kế hoạch và nhận được tên tiếng Việt không dấu. Nếu desktop chưa hỗ trợ tra cứu, yêu cầu chờ ở trạng thái xếp hàng và giữ nguyên số lượt. Bài kiểm thử hai workspace dùng 33 harness, gồm hai harness trùng tên của hai chủ khác nhau. Planner tìm đúng harness thứ 33 và giao việc cho desktop đã cấp quyền. Kết quả là bằng chứng giao thức với harness mô phỏng.

Một desktop có thể cấp quyền cho nhiều project. Desktop gửi tối đa 32 grant mỗi lượt, luôn kèm grant của công việc đang chạy và luân phiên các grant còn lại. Nếu cuộc gọi thất bại, desktop thử lại cùng trang. Bài hồi quy thêm 35 grant của project khác rồi xác nhận việc còn chờ được giao ở lượt kế tiếp và tiếp tục nhận tín hiệu duy trì phiên khi desktop sang trang.

### Chi phí hỏi việc và báo kết quả

Từ commit `836e445`, máy chủ lấy từng grant trong trang desktop gửi, đối chiếu cả chủ tài khoản lẫn mã desktop, sau đó mới đọc workflow đang hoạt động của các nhóm tương ứng. Khi desktop báo kết quả, SQLite tìm mã công việc và ứng dụng giải mã workflow khớp một lần. Việc kiểm tra ghế nhóm, quyền harness và kết quả gửi lặp vẫn áp dụng. Bài hồi quy dùng hai nhóm có công việc đồng thời, trộn grant của chủ khác vào cùng trang, rồi xác nhận mỗi desktop chỉ nhận công việc và duy trì phiên của mình.

Phép đo dùng SQLite trong bộ nhớ trên cùng máy Windows, gồm 3.000 workflow đã kết thúc, 250 workflow đang chờ ở nhóm khác và một công việc được cấp quyền. Mỗi thao tác được chạy thử năm lần rồi đo 60 lần. Lượt báo kết quả đo tình huống desktop gửi lại kết quả đã ghi nhận.

| Thao tác                | Trung vị `0fc839f` | Trung vị `836e445` | p95 `0fc839f` | p95 `836e445` |
| ----------------------- | -----------------: | -----------------: | ------------: | ------------: |
| Desktop hỏi việc        |           18,86 ms |            0,30 ms |      42,35 ms |       0,58 ms |
| Desktop gửi lại kết quả |           85,59 ms |            7,47 ms |     126,48 ms |      17,78 ms |

Mã đo trên máy thử nằm tại `.local/sade-model-evaluation/scheduler-history-benchmark.source.txt`. Chạy từ checkout của từng commit bằng `Get-Content -Raw -LiteralPath $source | node --import tsx --input-type=module`, với `$source` trỏ đến tệp đó. Kết quả trên đo bộ điều phối cục bộ. Mạng và model được đo ở các lượt riêng.

Khi nhận tin nhắn mới, SQLite dùng chỉ mục theo nhóm và theo project để tìm workflow có thể chặn yêu cầu. Sade tiếp tục chờ nếu workflow đã bị chặn hoặc hủy mà desktop còn giữ công việc. Bài hồi quy dùng hai nhóm chung repo và nhánh, kiểm tra một nhóm dùng thêm project khác, rồi xác nhận cùng mã tin nhắn chỉ tạo một workflow sau khi công việc cũ hết hạn.

Phép đo nhận yêu cầu trên Windows dùng SQLite trong bộ nhớ với 3.000 workflow đã hoàn tất, 600 workflow đã bị chặn hoặc hủy và hết hạn, cùng 250 workflow thuộc nhóm khác. Sau năm lần làm nóng, chạy 60 lần qua API Shared Groups và hoàn tác giao dịch sau từng lần. So với `947576f`, trung vị giảm từ 30,01 ms xuống 3,73 ms và p95 giảm từ 35,37 ms xuống 6,64 ms. Mã đo trên máy thử nằm tại `.local/sade-model-evaluation/scheduler-admission-benchmark.source.txt` và dùng cùng lệnh chạy ở trên.

Commit `9bb999f` đạt 420 bài trên Windows, 416 trên Ubuntu và 415 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Ba hệ điều hành đều chạy bộ 1.000 tin nhắn với planner mô phỏng và bài khóa theo nhóm và repo. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44652352062) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44652352417)

Commit `836e445` qua 63 bài collaboration và Shared Sade trên Windows, gồm bộ 1.000 tin với kế hoạch mô phỏng. Build và Electron đạt. Chromium đóng giữa lần chạy giao diện đầu ở bước đọc xác nhận cập nhật. Lần chạy riêng trên cùng commit qua toàn bộ bài giao diện. CI macOS arm64 qua 388 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và giao diện Shared Groups. Bài bàn giao Windows–Mac trên cùng commit tái hiện lỗi đường dẫn trên runner macOS arm64, chạy lại sau sửa và trả đúng file về Windows. Planner và reviewer dùng fixture. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44641351396) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44642221784)

Khi kết nối gián đoạn lúc đăng ký grant, desktop thử lại với cùng mã và phạm vi đã được người dùng xác nhận. Nếu chưa xác định được kết quả, desktop giữ phê duyệt cục bộ và hướng người dùng kiểm tra lại nhóm. Khi chủ harness thu hồi, desktop bỏ quyền ngay trong workspace rồi lưu yêu cầu đồng bộ trong cơ sở dữ liệu của tài khoản đó. Yêu cầu được gửi lại khi kết nối phục hồi, kể cả khi desktop đã hết grant để lấy việc. Máy chủ chỉ chấp nhận lệnh thu hồi từ chủ grant. Nếu người đó đã rời nhóm, phản hồi chỉ xác nhận thu hồi.

Khi một người tự rời nhóm hoặc bị gỡ, máy chủ thu hồi các grant của người đó trong nhóm ngay trong cùng giao dịch. Bỏ chia sẻ một harness hoặc đổi provider của profile đó cũng thu hồi grant của riêng harness. Mời lại hoặc chia sẻ lại cần phê duyệt mới. Desktop gắn mỗi lần xác nhận với mã lần chia sẻ để máy chủ từ chối yêu cầu đăng ký đến muộn sau khi chia sẻ lại. Đổi tên giữ nguyên lần chia sẻ.

Bản ghép với `main` tại `038bee2` kiểm tra luồng thu hồi phiên desktop được dùng khi đặt lại mật khẩu. Khi phiên của một thành viên bị thu hồi, Sade từ chối kết quả đến muộn và giữ tác vụ phụ thuộc ở trạng thái chặn. Thành viên đăng nhập lại bằng một mã desktop mới cần cấp quyền cho harness trên desktop đó.

Khi tích hợp cục bộ, desktop kiểm tra quyền trước khi chuẩn bị bản sửa, trước khi sửa nhánh đích và ngay trước khi ghi nhận thành công. Ba ca `author revokes permission at` trong `tests/git.test.ts` dùng Git thật và lệnh thu hồi của desktop. Ca đầu thu hồi khi thay đổi đang nằm trong vùng stage, ca hai thu hồi sau khi Git tạo commit, và ca cuối thu hồi khi nhánh đích đã có bản sửa tương đương. Sade giữ nguyên commit đã có từ trước, khôi phục nhánh đích nếu vừa thay đổi và giữ bản đề xuất trong worktree. Các lượt kiểm thử dùng harness mô phỏng.

Mỗi lần xác minh quyền tra đúng mã grant trong SQLite cục bộ. Phép đo tổng hợp trên Windows với 1.600 grant còn hiệu lực dùng năm lượt làm nóng và 60 lượt đo xen kẽ. Trung vị giảm từ 11,40 ms khi duyệt danh sách xuống 0,025 ms khi tra theo mã, còn p95 từ 31,53 ms xuống 0,052 ms. Phép đo trên máy thử dùng `.local/sade-model-evaluation/authorization-lookup-benchmark.source.txt`, chạy cùng lệnh benchmark ở trên. Kết quả đo bộ kiểm tra quyền cục bộ.

Commit `9bd49d5` qua 97 bài Git và Shared Sade trên Windows cục bộ. CI qua 431 bài trên Windows, 427 trên Ubuntu và 426 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Cả ba chạy bộ 1.000 tin với planner mô phỏng và ba ca thu hồi trong lúc tích hợp. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44660780298) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44660780493)

Ở commit `2b47a6d`, Windows cục bộ qua 65 bài Shared Sade. macOS arm64 qua 414 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và Shared Groups. Các lượt này gồm bộ 1.000 tin với kế hoạch mô phỏng. Phép đo SQLite tổng hợp ở phần hỏi việc và báo kết quả cho trung vị 0,22 ms khi poll và 5,09 ms khi gửi lại kết quả. [CI macOS trên bản ghép](https://github.com/dakiemdarktharr/WWW/actions/runs/44649748810)

CI Ubuntu của bản ghép bắt được lỗi tiêu đề Portal hồi về chậm khi trình duyệt rớt khung hình. Commit `ce37512` dùng thời gian thực giữa các khung hình và đặt lại mốc thời gian khi hoạt ảnh nghỉ. Giữ nguyên kiểm tra hình dạng hồi về đúng vị trí cũ. Windows qua 419 bài và bỏ qua một bài theo nền tảng. Ubuntu qua 415 bài, bỏ qua năm bài theo nền tảng, cùng Cloud E2E và Portal E2E. Bài bàn giao Windows–Mac cùng commit tái hiện lỗi đường dẫn trên runner macOS arm64, chạy lại sau sửa và trả đúng file về Windows. Planner và reviewer dùng fixture. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44650414370) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44650506524)

Máy chủ lưu lần chia sẻ đã kết thúc theo nhóm, chủ sở hữu và hồ sơ, kể cả khi chưa từng nhận grant cho hồ sơ đó. Desktop cũ có thể đăng ký grant cho hồ sơ chia sẻ lần đầu. Sau khi hồ sơ được chia sẻ lại, người dùng cần desktop hỗ trợ mã lần chia sẻ để cấp quyền mới. Mã này là thông tin của hồ sơ trong nhóm.

Ở commit `ba4d1d1`, bài Electron dùng máy chủ thử nghiệm để ngắt socket sau khi nhận yêu cầu cấp quyền, trả lỗi tạm thời ở cả hai lần thử, và từ chối dứt khoát trong một lần khác. Bài thử xác nhận hai lần gửi có cùng mã grant, lỗi chưa rõ kết quả giữ phê duyệt cục bộ, lỗi từ chối dứt khoát xóa grant cục bộ, và lần đăng ký lặp không mở lại grant đã thu hồi. Bài thu hồi dùng một desktop đã hết grant để lấy việc. Sau khi kết nối khôi phục, máy chủ nhận lệnh thu hồi, còn kết quả cũ vẫn nằm ở máy. Kiểm tra bổ sung mở cùng cơ sở dữ liệu thử nghiệm qua ba tiến trình để xác nhận lệnh chờ đồng bộ vẫn có sau khi backend mở lại và được xóa sau xác nhận.

Windows đạt 354 bài, bỏ qua một bài theo nền tảng. macOS arm64 đạt 349 bài, bỏ qua sáu bài theo nền tảng. Build, Electron, giao diện Shared Groups và bộ 1.000 tin mô phỏng đều đạt trên cùng commit. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44514777089)

Nếu phản hồi giao việc bị mất, máy chủ có tối đa 60 giây từ lần giao đầu để gửi lại cùng mã công việc cho đúng desktop. Một lượt Kivuno được giữ cho công việc đó. Desktop ghi nhận mã một lần và báo lại khi đang giữ phiên. Sau xác nhận, thời hạn duy trì trên máy chủ trở về 30 giây và việc gửi lại dừng. Bài thử mô phỏng mất phản hồi và nhận gói lặp khi lập kế hoạch, sửa file và sửa lại theo review. Nếu chủ bản vá thu hồi quyền giữa hai lần giao, máy chủ dừng bàn giao bản vá cho bước phụ thuộc.

Khi desktop mất kết nối và lease hết hạn, nhóm thấy trạng thái dừng ngay ở lần tải chat tiếp theo. Sade phân biệt mất kết nối, quyền project đã hết và số lượt đã cấp đã dùng hết. Yêu cầu mới trong nhóm hoặc project chỉ mở sau khi mọi lease của workflow cũ đã hết hạn. Bài hồi quy giữ hai harness đang chạy, cho lease hết hạn lần lượt, xác nhận kết quả đến muộn bị từ chối rồi thử gửi lại cùng mã tin mới để kiểm tra chỉ có một workflow mới. Bài trình duyệt mô phỏng việc hết lease và kiểm tra thành viên còn lại thấy lý do ngay trong **Sade progress**.

Commit `015e612` qua 105 bài Git và Shared Sade trên Windows cục bộ. CI qua 439 bài trên Windows, 435 trên Ubuntu và 434 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo hệ điều hành. Cả ba chạy bộ 1.000 tin với planner mô phỏng. macOS qua bài trình duyệt Shared Groups có tình huống mất kết nối. Để chạy riêng hai bài hồi quy, dùng `node --import tsx --test --test-name-pattern "a group read reports" tests/shared-sade.test.ts`. [Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44671467742) · [macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44671468893)

Commit `8d8620f` qua 389 bài trên macOS arm64, bỏ qua sáu bài theo nền tảng. Build, Electron, Shared Groups và bộ 1.000 tin với kế hoạch mô phỏng đều đạt. Lượt Shared Groups Windows cục bộ dừng ở tiến trình Node sau khi bài mới và bộ 1.000 tin đã đạt. Lượt Windows trên GitHub Actions qua 394 bài, bỏ qua một bài theo nền tảng và build thành công trên cùng commit. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44642888814) · [CI Windows](https://github.com/dakiemdarktharr/WWW/actions/runs/44643024337/job/135978586164)

Ubuntu qua 390 bài, bỏ qua năm bài theo nền tảng. Build, Cloud E2E và Portal E2E đạt trên cùng commit. [CI Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44643024337/job/135978586323)

Chấm lại hai kế hoạch do GPT-6-Luna với reasoning `high` tạo qua Codex CLI đã đăng nhập. Cả hai giữ đúng Codex của An cho bước đọc hợp đồng và Claude của Bình cho bước đối chiếu mã, cùng phạm vi file và thứ tự phụ thuộc. Model chọn hai nhãn chỉ đọc khác nhau cho bước đối chiếu, gồm review và nghiên cứu. Bộ chấm ban đầu chỉ chấp nhận một nhãn. Kiểm tra lại yêu cầu cho thấy cả hai đầu ra giữ đúng phạm vi chỉ đọc và bàn giao. Khi phát lại hai kế hoạch qua Shared Groups, cả hai lần đều phục hồi cùng mã lập kế hoạch với một lượt Kivuno. Phần nhận việc của hai harness dùng tài khoản mô phỏng.

Commit `d81cb6e` đạt 352 bài trên Windows và 347 bài trên macOS arm64, bỏ qua lần lượt một và sáu bài theo nền tảng. Cả hai qua build, Electron và giao diện Shared Groups. Bộ 1.000 tin gồm 50 ca mất phản hồi, thử gửi lại trước khi có xác nhận và kiểm tra việc dừng sau khi phiên đã hết hạn. Lượt Windows–Mac qua mạng chạy cùng commit và đạt cả giao việc khi mất phản hồi lẫn bàn giao kiểm thử sang máy Mac thật. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44512409445) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44512511237)

Khi kết hợp với giới hạn ghế của gói Kivuno, Sade cập nhật quyền của từng nhóm trước khi giao việc. Ghế bị khóa dừng công việc gắn với quyền đó. Các project khác trên cùng desktop vẫn nhận việc và duy trì phiên. Chủ harness có thể thu hồi grant của mình khi ghế đang khóa. Phản hồi chỉ xác nhận việc thu hồi. Desktop từ chối tạo grant cho profile bị khóa bởi gói Kivuno.

Trên nhánh đã ghép thay đổi về gói của `main`, Windows đạt 350 bài và bỏ qua một bài theo nền tảng ở commit `2832dbd`. macOS arm64 đạt 345 bài và bỏ qua sáu bài theo nền tảng trên cùng commit. Cả hai qua build, Electron, giao diện Shared Groups và bộ 1.000 tin mô phỏng. Bài bàn giao Windows–Mac arm64 đạt ở commit `7c8e736`, cùng mã ứng dụng với `2832dbd`. Hai commit khác nhau ở fixture giữ chỗ profile cho hai bài giao diện. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44510483025) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44510094728)

Windows chạy 340 bài và bỏ qua một bài theo nền tảng ở commit `912401f`. Build, Electron, giao diện Shared Groups và bộ 1.000 tin đều đạt. macOS arm64 chạy 335 bài, bỏ qua sáu bài theo nền tảng và qua các bài giao diện. [Kiểm thử macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44507015451)

Lượt bàn giao qua mạng chạy ở commit `17d038b`. Máy Mac arm64 ghép cặp tái hiện lỗi đường dẫn, chạy lại thành công sau khi sửa và trả đúng tệp được cấp quyền về Windows. Commit `912401f` bổ sung kiểm tra kiểu cho dữ liệu bài thử. [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44506869643)

GPT-6-Luna với reasoning `high` qua Codex CLI đã đăng nhập chọn đúng Astra của Bình ở cả hai câu tổng hợp, gồm cách nói có dấu và casual không dấu. Model gọi công cụ tra cứu MCP chỉ đọc và trả mã `member-33`, với đúng phạm vi `README.md`. Phép đo dùng prompt cùng bộ kiểm tra kế hoạch của Sade và danh sách 33 harness mô phỏng. Chỉ công cụ tra cứu của bài thử được cho phép trong phiên CLI tạm. Kết quả đo khả năng chọn đúng chủ sở hữu, phần giao việc giữa nhiều tài khoản vẫn dùng bài hồi quy giao thức ở trên. [Thiết lập quyền cho từng công cụ MCP](https://learn.chatgpt.com/docs/config-file/config-reference)

Biểu mẫu lập kế hoạch gọi rõ hành động sửa file, sửa thiết kế, nghiên cứu chỉ đọc và review chỉ đọc. Sửa tài liệu là tác vụ sửa file. Sade chuyển các tên hành động về loại tác vụ nội bộ trước khi áp dụng quyền đã cấp và yêu cầu hệ điều hành.

Khi chia việc, Sade tính khối lượng của các tác vụ đã chỉ định trước khi chọn harness cho việc còn trống. Với tác vụ review trong kế hoạch, Sade lần theo cả các bước phụ thuộc gián tiếp và loại profile của chủ tài khoản đã nhận quyền ghi vào các file thuộc phạm vi review. Người chỉ chạy test hoặc viết file ngoài phạm vi đó vẫn đủ điều kiện. Sade kiểm tra lại trước khi giao một lượt review đã được lập từ bản cũ.

Trước khi giao việc, Sade thử phương án phân công khác nếu lựa chọn ban đầu làm mất người review độc lập hoặc lấy mất lượt cuối dành cho tác vụ chỉ chạy trên một hệ điều hành. Tác vụ đã chỉ định người vẫn giữ nguyên phân công. Hai bài hồi quy dùng grant và ngân sách thử nghiệm. Bài thứ nhất giữ Gemini làm hợp đồng, giao thêm backend cho chủ harness làm frontend để Gemini còn đủ điều kiện review cả hai file nguồn. Bài thứ hai giao việc đọc cấu hình sang Mac để dành lượt Windows cho bài kiểm tra mở app.

Trong **Sade progress**, người gửi yêu cầu, chủ nhóm và chủ harness đang chạy có thể chọn **Update task**. Codex nhận tín hiệu trong lượt hiện tại. Gemini, Claude và Antigravity đọc chỉ đạo qua công cụ Kivuno trong cùng lượt. Phạm vi, quyền và số lượt đã cấp tiếp tục áp dụng. Nhóm thấy số chỉ đạo đã được chuyển đến harness. Nếu lượt kết thúc khi còn chỉ đạo chưa đọc, Sade giữ thay đổi trong worktree và chặn việc giao nhiệm vụ tiếp theo.

Shared Groups nhận một workflow đang hoạt động cho mỗi nhóm hoặc project. Bài hồi quy dùng hai người gửi và xác nhận tin yêu cầu thứ hai bị từ chối khi tác vụ ghi đang chạy. Sau khi tác vụ kết thúc, cùng ID tin nhắn có thể được gửi lại để mở workflow mới.

Kivuno dùng tài khoản provider đã đăng nhập trên desktop của từng chủ quyền. Máy chủ nhận ID quyền, thông tin công việc và kết quả cần chia sẻ. Khi người dùng bật sửa file, hộp thoại xác nhận nêu rõ việc gửi diff cho reviewer độc lập và bàn giao patch đã duyệt cho harness được phân công. Patch chỉ đi qua hàng đợi công việc theo quyền. Worktree, đường dẫn cục bộ và credential của provider nằm ở máy sở hữu. Thu hồi quyền, hết lượt hoặc mất heartbeat sẽ dừng cấp việc mới và chặn bàn giao patch chưa gửi. Desktop giữ kết quả chưa gửi ở máy khi quyền bị thu hồi hoặc hết hạn. Bài kiểm thử Electron giữ một lượt gửi đang chờ, thu hồi quyền của kết quả tiếp theo và xác nhận desktop bỏ bản gửi đó dù máy chủ tạm thời chưa nhận được lệnh thu hồi.

Nếu kiểm tra quota trên desktop xác nhận tác vụ chưa bắt đầu được, Sade hoàn lượt Kivuno đã giữ. Tác vụ do Sade tự phân công có thể chuyển sang teammate đủ quyền trong cùng workflow, giữ nguyên phạm vi, yêu cầu hệ điều hành, review độc lập và các chỉ đạo từ nhóm. Lần giao mới có ID riêng để kết quả đến muộn của lần cũ bị từ chối. Tác vụ chỉ định harness cụ thể sẽ chờ người dùng quyết định. Cả máy chủ và desktop cần hỗ trợ trao đổi trạng thái này.

Sau khi đã xác nhận một tài khoản hết quota, Sade áp dụng kết quả đó cho các tác vụ chưa giao trong cùng workflow. Desktop của phương án dự phòng có thể nhận việc khi các bước tiên quyết đã xong, kể cả khi desktop ban đầu đã rời mạng. Quyền dự phòng được kiểm tra riêng cho từng tác vụ. Reviewer dự phòng nhận diff khi bản vá sẵn sàng và vẫn phải thuộc chủ tài khoản khác tác giả. Các bài hồi quy dùng fixture cho quota và quyền của Gemini, Claude và Antigravity. Chạy riêng bằng `node --import tsx --test --test-name-pattern "known provider limit|queued review on a quota" tests/shared-sade.test.ts`.

Commit `c16e7ad` qua 108 bài Git và Shared Sade trên Windows cục bộ. CI qua 442 bài trên Windows, 438 trên Ubuntu và 437 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Cả ba qua bộ 1.000 tin với planner mô phỏng. macOS qua thêm Electron và giao diện Shared Groups. [Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44672907109) · [macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44672907241)

Nếu kiểm tra quota từ chối ngay ở bước lập kế hoạch, Sade hoàn lượt đã giữ và dùng một harness dự phòng do chính người gửi cấp quyền cho cùng project. Harness dự phòng nhận lại yêu cầu gốc trong cùng workflow. Sade chỉ trừ lượt khi lập kế hoạch thực sự bắt đầu. Nếu người gửi chưa cấp quyền cho harness dự phòng phù hợp, nhóm thấy lý do dừng và cách thử lại.

Nếu desktop đã dùng hết chỗ chạy, nhiệm vụ chờ cùng mã công việc và cùng grant. Desktop thử lại ở lần đồng bộ tiếp theo nếu máy chủ còn gia hạn phiên. Bài bàn giao Claude ↔ Antigravity giữ tất cả chỗ chạy của desktop lập kế hoạch, xác nhận hai lần thử dùng cùng phiên cục bộ với một lượt Kivuno đã giữ và chưa mở phiên model. Khi có chỗ trống, cùng phiên lập kế hoạch và workflow tiếp tục sang sửa file, review độc lập rồi kiểm tra đầu ra. Hai adapter dùng fixture giao thức.

Trong **Sade progress**, nhóm thấy dòng báo đang chờ desktop xử lý xong công việc khác. Dòng báo tự biến mất khi desktop tiếp tục nhiệm vụ. Máy chủ chỉ nhận trạng thái chờ từ desktop đang giữ phiên của chính nhiệm vụ đó. Desktop gửi trường trạng thái mới sau khi máy chủ xác nhận đã hỗ trợ.

Commit `323e0df` qua 65 bài collaboration và Shared Sade trên Windows, cùng build, Electron và bài trình duyệt `npm run test:collaboration`. Bài trình duyệt xác nhận thành viên còn lại thấy dòng chờ xuất hiện và biến mất khi desktop báo tiếp tục. macOS arm64 qua 390 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và Shared Groups. Bộ 1.000 tin với kế hoạch mô phỏng đạt trên cả hai hệ điều hành. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44647524767)

Ở commit `e2d82b5`, lượt Windows cục bộ có 62/64 bài đạt. Hai bài bàn giao dừng ở tiến trình CLI và Git. Trên GitHub Actions, Windows qua 394 bài, bỏ qua một bài theo nền tảng. Ubuntu qua 390 bài, bỏ qua năm bài theo nền tảng, rồi qua Cloud E2E và Portal E2E. Cả hai qua build, hai hướng bàn giao và bộ 1.000 tin mô phỏng. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44645305786)

Bài thử trên Windows gửi cùng một mã tin nhắn hai lần. Gemini gói free trả quota 100% qua fixture. Worker desktop từ chối trước khi mở lượt model. GPT-6.2-Sol với reasoning `high` chạy qua Codex App Server đã đăng nhập và lập đúng một tác vụ chỉ đọc `src/check.ts` cho Claude của Bình. Claude nhận tác vụ qua grant mô phỏng và báo kết quả. Bài thử ghi một tin, một workflow, 0 lượt cho Gemini và 1 lượt cho Codex. SHA của repo thử giữ nguyên. Bản ghi `native-plan-quota.json` và mã chạy `run-plan-quota.source.txt` nằm trong `.local/sade-native-live` trên máy thử.

Lượt bổ sung dùng câu tiếng Việt không dấu gặp ngưỡng dự trữ trên tài khoản Codex dự phòng. Desktop xác nhận cả hai lần từ chối trước khi mở phiên model. Sade hoàn cả hai lượt đã giữ, đóng workflow ở trạng thái chặn và giữ Claude chưa nhận việc. Kết quả này kiểm chứng hành vi khi hết phương án dự phòng. Câu không dấu còn cần được chấm về cách hiểu yêu cầu. Bản ghi nằm trong `native-plan-quota-unaccented-reserve.json`.

Ở commit `00ba51b`, Windows qua 80 bài Shared Groups, quota và session, cùng bước build. macOS arm64 qua 366 bài, bỏ qua sáu bài theo nền tảng, và qua build, Electron và giao diện Shared Groups. Bộ 1.000 tin với planner mô phỏng đạt trên cả hai. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44534005500)

### Giới hạn chỉ đọc cho từng tin nhắn

Trong Shared Groups, chọn project ở **Ask Sade** rồi chọn **Read-only request** để giới hạn cả workflow. Quyền này đi cùng mã tin nhắn và giữ qua lần gửi lại hoặc bước trả lời câu hỏi của planner. Cả planner trên desktop và máy chủ kiểm tra kế hoạch. Máy chủ chặn tác vụ ghi kể cả khi harness có quyền ghi cho project. Kế hoạch chỉ đọc vẫn giao được cho harness đã được cấp quyền của người khác.

Hai đầu ra Qwen đã ghi ở ca quota không dấu và tiếng Anh kỹ thuật từng đề xuất ghi file khi yêu cầu là chỉ đọc. Khi phát lại nguyên kế hoạch đó qua Shared Groups với **Read-only request** đã chọn và cả hai grant đều có quyền ghi, backend chặn cả hai và giao 0 tác vụ. Đây là phát lại kế hoạch thật với tài khoản nhóm mô phỏng. [Dữ liệu đầu ra Qwen](https://github.com/dakiemdarktharr/WWW/actions/runs/44544213702)

Planner nhận phản hồi ngay trong lượt nếu tách bước kiểm thử trên máy ghép cặp thành tác vụ phụ thuộc mà harness được chỉ định không thể chạy trên OS đó. Bài kiểm tra hai workspace dùng harness mô phỏng để gửi kế hoạch tách bước, nhận lỗi rồi nộp lại một tác vụ với đầy đủ kiểm tra trên máy ghép cặp. Sade giữ bước review tích hợp hiện có. Với hội thoại chỉ có một harness được cấp quyền, planner cũng nhận phản hồi khi kế hoạch yêu cầu review độc lập bản sửa của chính harness đó.

Ở commit `afcb0a0`, Windows qua 385 bài, bỏ qua một bài theo nền tảng. macOS arm64 qua 380 bài, bỏ qua sáu bài theo nền tảng. Bộ 1.000 tin với planner mô phỏng, build và bài giao diện `test:collaboration` đạt ở cả hai hệ điều hành. Bài giao diện chọn **Read-only request**, xác nhận planner nhận các grant với quyền ghi bị giới hạn, trả lời câu hỏi và tiếp tục trong cùng workflow. Electron cũng đạt trên macOS. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44549761634)

Bản ghép `8984515` lấy `main` tại `b9ace37`, giữ cả bài thử quyền Shared Groups và giới hạn hồ sơ theo gói. Windows qua 391 bài, bỏ qua một bài theo nền tảng và build thành công. macOS arm64 qua 386 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và giao diện Shared Groups. [CI bản ghép](https://github.com/dakiemdarktharr/WWW/actions/runs/44637527437)

### Phương án dự phòng được nêu trong tin nhắn

Với yêu cầu “nhờ Gemini đọc file này, hết lượt thì để Claude của Bình đọc”, Sade giữ một tác vụ với một harness chính và một harness dự phòng. Sade ưu tiên lượt còn dùng được của Gemini trước các việc người dùng để nhóm tự phân công. Nếu Gemini hết lượt được cấp hoặc bị kiểm tra quota từ chối trước khi chạy, Claude nhận cùng phạm vi và điều kiện nếu quyền của Claude còn hiệu lực. Sade chỉ tự chọn người dự phòng khi người gửi giao quyền lựa chọn đó.

Kiểm thử hồi quy đi qua Shared Groups và giao việc với tài khoản mô phỏng. Gemini hết lượt ở lúc lập kế hoạch hoặc trước khi bắt đầu đều chuyển đúng một tác vụ chỉ đọc cho Claude. Khi cả hai hết lượt, một harness thứ ba có quyền vẫn không nhận việc. Thử gửi lại cùng mã tin chỉ tạo một workflow. Bài thử bộ phân công xác nhận việc tự giao có effort cao vẫn nhường lượt của Gemini cho tác vụ ưu tiên đã nêu. Scope, quyền ghi, yêu cầu hệ điều hành và review độc lập vẫn được kiểm tra khi tìm harness thay thế.

Tập bổ sung có năm câu viết riêng về kiểu nhắn casual, không dấu, tiếng Anh kỹ thuật, giao Sade tự chọn phương án dự phòng và giữ người thực hiện cố định. Cả năm kế hoạch đầu vào đã biết đều qua parser và bộ phân công. Lượt GPU Qwen 4B và 1.7B trả lỗi cấp phát. Lượt 1.7B trên CPU cũng dừng khi nạp model, kể cả sau khi thử tắt repack và bật mmap. Các lỗi này chưa có đầu ra model để chấm độ hiểu. Tài khoản Codex dùng kiểm thử cũng đang ở ngưỡng dự trữ. [Tùy chọn bộ nhớ của llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-quota-fallback.json --quota-fallback
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-quota-fallback-1.7b.json --quota-fallback --model qwen3:1.7b-q4_K_M
```

Bộ `quota-followup` đo ba câu viết riêng gồm tiếng Việt casual, tiếng Việt không dấu và tiếng Anh kỹ thuật. Hai câu đầu giao hai việc chỉ đọc theo thứ tự, mỗi việc có một người dự phòng khác nhau. Câu cuối chỉ cho phép Claude thay Gemini ở việc đầu. Qwen tạo kế hoạch thật. Shared Groups đối chiếu phạm vi, phụ thuộc, harness chính và dự phòng, rồi mô phỏng Gemini hết quota. Bài chấm kiểm tra việc đầu tới đúng Claude, việc sau chỉ chạy sau khi có kết quả tiên quyết và quyền dự phòng đúng cho việc đó. Ba kế hoạch đối chứng đạt. Đối chứng tự thêm dự phòng ở việc chỉ giao cho Gemini bị loại.

Ở hạn 120 giây mỗi lần gọi, Qwen3 4B Instruct chạy trên CPU runner đạt ca tiếng Anh sau 99,9 giây. Hai ca tiếng Việt hết thời gian trước khi trả kế hoạch. Lượt kế tiếp so sánh prompt hiện tại với prompt yêu cầu đầu ra gọn và ghi phương án dự phòng theo từng tác vụ. Cả hai dùng cùng model và hạn 180 giây. [Lượt đầu](https://github.com/dakiemdarktharr/WWW/actions/runs/44673893064) · [Lượt đối chiếu](https://github.com/dakiemdarktharr/WWW/actions/runs/44674808405)

| Tin nhắn                               | Prompt hiện tại    | Prompt gọn                 | Prompt có ví dụ             |
| -------------------------------------- | ------------------ | -------------------------- | --------------------------- |
| Casual                                 | Hết hạn 180 giây   | 134,1 giây, sinh ba tác vụ | Hết hạn 180 giây            |
| Không dấu                              | Hết hạn 180 giây   | 88,0 giây, sinh ba tác vụ  | 157,7 giây, sinh bốn tác vụ |
| Kỹ thuật, giới hạn dự phòng ở việc đầu | Đạt sau 115,3 giây | Đạt sau 58,4 giây          | Đạt sau 123,9 giây          |

Trong hai câu tiếng Việt, đầu ra của prompt gọn thêm một tác vụ dành cho người dự phòng. Prompt có ví dụ còn gán Antigravity dự phòng cho sai file trong câu không dấu. Ca tiếng Anh chấm đạt vì Claude làm việc đầu, sau đó Shared Groups báo dừng đúng ở việc chỉ dành cho Gemini. Mỗi prompt đạt 1/3. Các cấu hình chạy trên runner CPU riêng. Kết quả thời gian mô tả từng lượt. [Lượt prompt có ví dụ](https://github.com/dakiemdarktharr/WWW/actions/runs/44675714506)

Cấu hình pilot dùng một lượt lập kế hoạch trên harness đã được người gửi cấp quyền, ưu tiên reasoning cao. Sade kiểm tra quyền theo tác vụ và áp dụng phương án dự phòng lúc điều phối. Qwen 4B dùng để chấm offline. Tài khoản Codex thử nghiệm vẫn ở ngưỡng dự trữ khi đo lại nên phép đo này chỉ có lượt lập kế hoạch thật từ Qwen. Việc nhận tác vụ và quota của các desktop dùng fixture.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/quota-baseline.json --quota-followup --planning-prompt baseline --timeout-ms 180000
node --import tsx scripts/eval-shared-sade-planner.ts .local/quota-compact.json --quota-followup --planning-prompt quota-compact --timeout-ms 180000
node --import tsx scripts/eval-shared-sade-planner.ts .local/quota-example.json --quota-followup --planning-prompt quota-example --timeout-ms 180000
```

Commit `12c2ac8` đã ghép `main` tại `8372bdf`. Windows qua 383 bài, bỏ qua một bài theo nền tảng, và qua format cùng build. macOS arm64 qua 378 bài, bỏ qua sáu bài theo nền tảng, và qua build, Electron cùng giao diện Shared Groups. Bộ 1.000 tin với planner mô phỏng đạt trên cả hai. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44537970731)

Lượt macOS đầu sau khi ghép `main` có bốn ca checkout ngân hàng demo lỗi vì SQLite chuẩn hóa đường dẫn qua alias của hệ điều hành. Bản sửa đối chiếu thư mục cha theo đường dẫn thực rồi giữ yêu cầu đúng thư mục `.relay-fuji-demo` và đúng file `workspace.db`. Bài hồi quy đi qua API với alias thư mục cha trên Windows và macOS. Fixture cũng dùng đường dẫn thực để dọn dữ liệu thử trên Windows.

Sau review độc lập, chủ máy kiểm tra và tích hợp thay đổi cục bộ. Sade bàn giao patch đã duyệt cho nhiệm vụ phụ thuộc qua Shared Groups. Desktop nhận kiểm tra digest và danh sách file, rồi áp dụng patch trong worktree riêng trước khi mở harness. Nhánh Git của người nhận chỉ nhận thay đổi khi chủ máy chọn tích hợp. Quyền cũ vẫn sử dụng **Share published revision**. Cấp lại quyền trên desktop mới để cho phép bàn giao patch.

Khi checkout của người nhận đã chứa commit tiên quyết và gói bàn giao có patch, desktop so nội dung và mode Git với bản review trước khi mở harness. Nếu một bước tiên quyết được review sau cập nhật cùng file, desktop dùng bản mới hơn cho file đó. Nếu checkout đã hoàn tác hoặc sửa khác bản review, công việc phụ thuộc dừng để người dùng kiểm tra. Lệnh tái lập là `node --import tsx --test --test-name-pattern 'reverted prerequisite|verified prerequisite' tests/git.test.ts`. Các ca dùng Git thật, receipt và quyền thử nghiệm, còn lời gọi harness được mô phỏng.

Commit `239be48` qua 90 bài Git và Shared Sade trên Windows cục bộ. CI qua 424 bài trên Windows, 420 trên Ubuntu và 419 trên macOS arm64 trong `npm run check`. Ba job đều qua hai ca tiên quyết và bộ 1.000 tin nhắn với planner mô phỏng. Bài Portal trên Ubuntu hết thời gian chờ hiển thị khung cuối của logo. Đồng hồ nay tính từ lúc thả chuột, còn E2E có thêm thời gian chờ trình duyệt chậm vẽ khung cuối. Kiểm tra mô phỏng vẫn đòi hỏi góc về đúng 0 sau năm giây. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44654785116) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44654785336)

Portal cũng giới hạn thời gian chờ hiệu ứng khi bấm liên kết giữa Trang chủ và Gói Kivuno. Bài E2E cố ý tạm dừng một hiệu ứng và kiểm tra lớp phủ biến mất. Chromium cục bộ giữ lớp phủ trên bản cũ và dọn nó trên bản sửa. Lỗi kế tiếp ở thao tác Back trong CI dẫn đến việc chuyển lịch sử trình duyệt không có lớp phủ. [CI phát hiện lỗi Back](https://github.com/dakiemdarktharr/WWW/actions/runs/44656854884)

Commit `276c97d` qua Portal E2E và Cloud E2E trên Ubuntu, gồm cả hiệu ứng được tạm dừng và thao tác Back. Cùng lượt CI qua 420 bài và bỏ qua năm bài theo nền tảng. [CI bản sửa Portal](https://github.com/dakiemdarktharr/WWW/actions/runs/44657531059/job/136027361378)

**Share published revision** đối chiếu nội dung và mode Git của file đã review và file tiên quyết khi nhánh remote có commit mới. Nếu người khác đã đẩy cùng thay đổi bằng một commit khác SHA, Sade còn kiểm tra toàn bộ file mà bản tích hợp cục bộ thay đổi kể từ tổ tiên chung, rồi bàn giao SHA trên remote cho tác vụ phụ thuộc. Nếu file bắt buộc bị sửa hay bị thiếu, Sade giữ bước bàn giao để người dùng kiểm tra. Bài thử dùng hai clone và một bare remote, bao gồm trường hợp máy tác giả chưa có object của commit mới. Khi tải object để đối chiếu, desktop giữ nguyên nhánh hiện tại, các ref và `FETCH_HEAD`.

Khi bàn giao SHA cho một tác vụ phụ thuộc, máy chủ lấy danh sách file từ bản review và gửi cho desktop có quyền để đối chiếu checkout. Bản diff được bỏ sau khi công bố. Danh sách file chỉ đi cùng lượt giao việc, được loại khỏi thông tin nhóm và khỏi prompt, rồi được xóa khỏi workflow khi kết thúc. Desktop cũ cần cập nhật trước khi nhận lượt có danh sách này, và số lượt được giữ nguyên trong lúc chờ. Bài `balances open implementation work` kiểm tra giao thức cấp việc và việc xóa danh sách khi workflow hoàn tất.

Khi harness báo việc đã có sẵn và không tạo diff, Sade đối chiếu phạm vi được giao với checkout đã xác nhận. Thay đổi ngoài phạm vi vẫn được giữ. Phạm vi `.` bao gồm toàn bộ cây Git đã theo dõi. File được cập nhật ở bước review sau hoặc đã được nhập từ một patch tiên quyết dùng bằng chứng của chính patch đó. Desktop tác giả ghi digest của patch đã nhập và máy chủ kiểm tra digest thuộc đúng chuỗi tiên quyết. Máy nhận cũ chờ cập nhật, còn workflow lịch sử chỉ có SHA vẫn dùng bằng chứng sẵn có. Kiểm thử gồm checkout bị hoàn tác, commit song song ngoài thư mục và bàn giao qua cả patch lẫn SHA. Dữ liệu đối chiếu được gửi tới desktop nhận việc và được xóa khi workflow kết thúc.

Commit `3e4e05d` qua 102 bài Git và Shared Sade trên Windows cục bộ. CI qua 436 bài trên Windows, 432 trên Ubuntu và 431 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Cả ba chạy bộ 1.000 tin với planner mô phỏng. Electron E2E trên macOS hết thời gian ở lần đầu và qua ở lần chạy lại cùng commit. Chính sách thực thi chặn lệnh khởi động bài thử dùng Cloudflare Tunnel, nên lượt này có kết quả CI riêng trên từng hệ điều hành. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44662669520) · [CI macOS lần hai](https://github.com/dakiemdarktharr/WWW/actions/runs/44662669614/attempts/2)

Commit `da3bf2d` đạt 94 bài Git và Shared Sade trên Windows cục bộ. CI qua 428 bài trên Windows, 424 trên Ubuntu và 423 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Ba hệ điều hành đều qua bộ 1.000 tin nhắn với planner mô phỏng. Electron E2E trên macOS kiểm tra desktop chỉ gửi cờ hỗ trợ sau khi nhận xác nhận từ máy chủ. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44659257270) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44659255992)

Chạy `node --import tsx --test --test-name-pattern 'published revision after a teammate pushes' tests/git.test.ts` để thử một commit độc lập chứa đúng thay đổi và thêm file của người kia, một commit chỉ chứa file cuối nhưng thiếu phần tiên quyết, cùng ba ca nhánh remote tiến thêm, đổi file được review hoặc viết lại lịch sử. Bằng chứng là nội dung và mode của cây Git. Hai bản triển khai khác nhau về nội dung cần được review riêng.

Commit `dd99645` qua 88 bài Git và Shared Sade trên Windows cục bộ. CI qua 422 bài trên Windows, 418 trên Ubuntu và 417 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Ba job đều qua hai ca commit khác SHA và bộ 1.000 tin nhắn với planner mô phỏng. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44653298671) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44653298758)

Khi reviewer yêu cầu sửa, Sade có thể dùng một lượt sửa và lượt review tiếp theo trong ngân sách đã cấp. Desktop và máy chủ xác nhận hỗ trợ trước khi dùng luồng này. Sade đưa nhận xét về phiên và worktree gốc của tác giả. Mỗi lần giao việc có ID riêng để kết quả cũ không thể duyệt bản sửa. Tác vụ phụ thuộc chờ bản mới được review và tích hợp. Sade dừng nếu hết lượt, phiên gốc mất liên lạc, một lượt review khác vẫn đang chạy, bản sửa rỗng hoặc trùng bản bị từ chối, hoặc reviewer yêu cầu sửa lần thứ hai. Worktree ở lại máy tác giả.

Nếu reviewer đã dùng lượt cuối để yêu cầu sửa, Sade xét lại các grant cho lượt review bản mới. Harness dự phòng được nêu trong kế hoạch có thể nhận đúng phạm vi nếu còn quyền và lượt, đáp ứng hệ điều hành yêu cầu và thuộc chủ tài khoản khác tác giả. Bài hồi quy xác nhận trường hợp có backup hợp lệ đi hết đến bước tích hợp. Khi người gửi chỉ cho phép reviewer ban đầu hoặc backup thuộc chủ tác giả, Sade dừng và giữ worktree cục bộ.

Commit `3e40fde` qua 68 bài collaboration và Shared Sade trên Windows, cùng build và kiểm thử trình duyệt. macOS arm64 qua 393 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và Shared Groups. Cả hai gồm bộ 1.000 tin với kế hoạch mô phỏng và ba ca phân công reviewer bản sửa với phán quyết fixture. Kiểm tra quota thực tế trên Windows vẫn báo tài khoản Codex ở ngưỡng dự trữ. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44648555830)

Khi reviewer từ chối bản vá và Sade phải dừng workflow, nhóm có thể gửi yêu cầu mới ngay nếu mọi lượt liên quan đã kết thúc. Máy chủ bỏ qua thời hạn của các bước đã xong và giải phóng quyền chờ tích hợp của bản vá chưa được duyệt. Một tác vụ khác còn chạy tiếp tục giữ thời hạn bảo vệ của nó.

Khi nhánh đích đã có đúng nội dung và mode Git của toàn bộ file chịu tác động, Shared Groups báo task hoàn tất với revision hiện tại. Kiểm tra này chạy sau khi xác nhận review và bao gồm các file được chuyển từ task trước. Nếu nhánh đích vẫn thiếu một file kế thừa, Sade tiếp tục tích hợp. Nếu Git không còn gì để tích hợp nhưng nội dung đã duyệt cũng không còn ở nhánh đích, task chờ người dùng kiểm tra lại. Các project dùng AEGIS tiếp tục áp dụng quy trình duyệt tích hợp chính xác.

Tích hợp qua Shared Groups đối chiếu nội dung và mode Git của các file chịu tác động sau khi gộp. Nếu nhánh đích đã thay đổi cùng file và kết quả Git gộp khác bản đã review, Sade giữ task ở trạng thái review và trả nhánh đích về trước lần tích hợp. Worktree vẫn giữ bản đề xuất. Bài hồi quy dùng Git thật để xác nhận hai sửa đổi ở hai đoạn tách biệt trong một file bị giữ lại khi tổ hợp của chúng chưa được duyệt. Khi commit mới sửa file khác, Sade tích hợp bình thường và giữ cả commit đó.

Nếu một tác vụ ghi hoàn tất với worktree nguyên trạng, Sade dùng revision Git gốc của lần chạy làm điều kiện bàn giao cho các tác vụ phụ thuộc. Máy nhận kiểm tra nhánh đã liên kết và chờ nếu commit chưa có trong lịch sử nhánh đó. Chỉ tải object Git về vẫn chưa đủ. Sau khi chủ máy đồng bộ nhánh, Sade tiếp tục cùng tác vụ, từ một worktree ghim vào revision vừa kiểm tra. Khâu chờ giữ một lượt cấp quyền đã đặt trước và chưa khởi động provider. Revision đi trong gói bàn giao đến desktop đã được cấp quyền. Desktop cũ cần cập nhật để báo revision cho công việc có bước phụ thuộc.

Nếu kế hoạch đã giao review cho một chủ tài khoản khác, với đúng phạm vi và chỉ phụ thuộc vào một tác vụ sửa, chính tác vụ review đó nhận diff khi bản sửa sẵn sàng. Sade giữ người được giao và tiêu chí review. Reviewer nhận tên, mô tả, tiêu chí nghiệm thu của tác vụ sửa và câu trả lời gần nhất của người gửi nếu có. Nếu cùng một diff có nhiều lượt review, mỗi lượt phải chấp thuận trước khi tích hợp. Nhiệm vụ phụ thuộc vẫn chờ kết quả tích hợp. Nếu tác vụ sửa kết thúc với worktree nguyên trạng, phần review đã yêu cầu tiếp tục dưới dạng kiểm tra chỉ đọc trên file hiện có.

Khi workflow có grant của nhiều chủ tài khoản, Sade giữ một lượt review độc lập trước khi giao mỗi tác vụ ghi mà kế hoạch chưa có reviewer. Lượt được giữ trong ngân sách của nhóm và chỉ tính đã dùng khi giao review. Tác vụ ghi khác chờ nếu chưa có lượt review trống. Nếu tác vụ trước kết thúc với worktree nguyên trạng, lượt review trở lại ngân sách. Nếu lượt đã dành cho review thực tế, tác vụ đang review vẫn có thể hoàn thành và tích hợp trước khi Sade báo thiếu lượt cho việc tiếp theo. Với kế hoạch đã dành hết lượt của bên review cho công việc khác, Sade báo thiếu lượt trước khi mở harness sửa file.

Trong project được AEGIS bảo vệ, approval vẫn xác minh chính xác tập file và byte trên nhánh đích. AEGIS có thể chặn tích hợp nhiệm vụ phụ thuộc nếu nhánh đích còn thiếu patch đầu vào.

## Kết quả A–D

| Tình huống                                | Phần đã kiểm tra                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Một tin nhắn giao việc cho hai harness | Codex đã đăng nhập lập kế hoạch Gemini → Astra, giao đúng phạm vi và yêu cầu Astra hỏi về phong cách. Fixture chạy bàn giao qua hai worktree Git và tiếp tục frontend sau câu trả lời. Gửi lại cùng mã tin nhắn chỉ tạo một workflow.                    |
| B. Công việc hoặc commit trùng            | Codex đã đăng nhập lập kế hoạch đọc lại commit có sẵn và chỉ giao ghi file kiểm thử. Hai worktree Git thật kiểm tra việc dùng lại commit, xếp hàng khi phạm vi ghi chồng nhau và tiếp tục sau đồng bộ. Tương đương ngữ nghĩa chưa được đo.               |
| C. Review độc lập                         | Codex đã đăng nhập, dùng GPT-6-Luna với reasoning cao, yêu cầu sửa bản sai ở ngưỡng giảm giá và duyệt bản đúng. Tác giả Gemini dùng fixture. Tích hợp kiểm lại digest. Qwen cục bộ chặn đúng 8/9 bản lỗi và duyệt đúng 6/9 bản đúng trong phép đo riêng. |
| D. Windows nhờ Mac kiểm tra               | Codex đã đăng nhập trên Windows tái hiện lỗi và chạy lại thành công trên runner macOS arm64 chỉ dùng công cụ. Bản sửa về đúng một file trong scope. Review fixture cho phép tích hợp cục bộ, với Git remote giữ nguyên.                                  |

Ca A trên `74f938a` gửi nguyên văn “Tôi nhờ Gemini của tôi làm cấu trúc chung rồi ông đưa cho Astra của ông làm frontend, codebase, backend, cyber nhé.” Fixture cấp quyền cho hai chủ harness riêng và trả kế hoạch năm việc. Gửi lại tin và thử nhận việc lần nữa chỉ giữ một lượt planner. Astra chờ kiến trúc của Gemini qua review và nhận đúng đầu ra trước khi hỏi người gửi muốn chọn phong cách hay để Astra chọn. Hai bước codebase và backend tiếp tục trong lúc câu hỏi chờ. Người gửi trả lời và Astra tiếp tục cùng tác vụ với đầu ra kiến trúc. Rà soát phòng thủ chỉ đọc đợi cả ba phần triển khai. Ca này xác minh điều phối với kế hoạch và phản hồi harness được kiểm soát.

```powershell
node --import tsx --test --test-name-pattern 'hands Gemini architecture' tests/shared-sade.test.ts
```

Windows cục bộ qua 85/85 ca Shared Sade và 172/172 ca Sade, gồm corpus 1.000 tin với kế hoạch fixture. Lần CI đầu báo lỗi kiểu ở thông báo của một assertion trong ca mới. Sau khi sửa assertion trên `38215fd922905dce942b7842446f3a949d7686ab`, `npm run check` qua 458 ca Windows, 454 Ubuntu và 453 macOS arm64, với 0 lỗi. Số ca bỏ qua theo hệ điều hành lần lượt là một, năm và sáu. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44693599187) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44693599004)

Phép đo `frontend-style` đối chiếu prompt cũ với phiên bản giao việc hỏi phong cách cho frontend sau khi đủ phụ thuộc. Bốn ca dùng cùng bản đồ project tổng hợp từ tin trước, gồm nguyên văn A, thêm phong cách cụ thể, cho Astra tự chọn, và thiếu quyền project của Astra. Hai prompt dùng cùng model, schema và seed, chạy theo cặp trên cùng runner. Thứ tự đảo ở hai shard. Báo cáo giữ prompt, kỳ vọng, phản hồi thô, digest model, thời gian và bộ nhớ model do Ollama báo sau lượt gọi. Đây là số bộ nhớ cấp cho model, chưa đo đỉnh RAM của cả runner. [Ollama API](https://docs.ollama.com/api/ps)

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=sade-eval -f sade_suite=frontend-style
```

Qwen3 4B Instruct 2507 trên `74f938a` đạt **0/4 với cả hai prompt**. Khi Gemini và Astra đều có quyền, model vẫn hỏi lại việc phân công trước khi lập kế hoạch. Khi thiếu quyền của Astra, model hỏi về khả năng nhầm tên thay vì yêu cầu chủ Astra cấp quyền. Cả hai lượt ở ca giao Astra tự chọn đều hết thời gian 120 giây. Trong sáu lượt có phản hồi, bốn câu hỏi vượt giới hạn 500 ký tự. Không có kế hoạch được chấp nhận trong phép đo này. [Kết quả và artifact của bốn cặp](https://github.com/dakiemdarktharr/WWW/actions/runs/44693097763)

Thời gian của các lượt có phản hồi là 47,2–84,3 giây với prompt cũ và 53,8–78,2 giây với biến thể. Trong từng cặp, mẫu bộ nhớ hai prompt bằng nhau. Ollama báo 3,19 GB RAM và 0 VRAM trên hai runner, hoặc 1,01 GB RAM và 2,54 GB VRAM trên hai runner còn lại. Phép đo dùng Ollama cục bộ trên runner chuẩn của repo công khai, chi phí 0 đồng. Có thể đối chiếu tám đầu ra trong `.local/sade-frontend-style-eval/44693097763` của worktree. Kivuno tiếp tục dùng prompt đang triển khai vì phép đo chưa cho thấy biến thể cải thiện khả năng phân công.

Phép đo `owner-routing` trên `0dd3f05` đối chiếu prompt đang dùng với biến thể đưa quyết định về chủ harness lên đầu. Biến thể dùng ngay một harness khớp duy nhất trong danh sách có quyền, hỏi đúng lựa chọn khi trùng chủ, hỏi quyền hoặc khả dụng khi không có harness phù hợp, và đưa quyết định phong cách vào tác vụ frontend. Tám tin mới được giữ riêng khỏi phần viết prompt. Chúng gồm tên chủ rõ ràng, cách gọi không dấu, hai harness trùng tên, chủ chỉ định chưa cấp quyền, phủ định việc giao cho một harness, trích dẫn để báo nhóm và hai quyết định dự phòng quota. Bốn ca A trước đó chạy cùng phép đo. Mỗi cặp dùng cùng digest, bộ công cụ, đầu vào, seed và runner. Thứ tự chạy đảo ở các shard lẻ.

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=sade-eval -f sade_suite=owner-routing
```

Cả hai prompt đạt **2/8** trên tập độc lập và **0/4** trên nhóm A. Prompt đang dùng giữ đúng hai chủ trong ca bàn giao có hai Astra trùng tên. Biến thể hỏi lại ở ca đó, nhưng giữ đúng Astra khi người gửi cấm chuyển việc do hết quota. Cả hai đóng đúng tin chỉ báo nhóm. Cả hai tự chọn Astra của Bình khi người gửi nói rõ Astra của Chi và người này chưa cấp quyền. Chúng cũng tự chọn Bình trong ca có hai Astra mà người gửi chưa phân biệt. Bộ điều phối nhận được kế hoạch hợp lệ theo quyền của Bình và xếp việc trong fixture. Sai ở đây là chủ được chọn khác yêu cầu. [CI và 24 đầu ra](https://github.com/dakiemdarktharr/WWW/actions/runs/44698224337)

Các lượt có phản hồi mất 48,4–112,8 giây với prompt đang dùng và 30,3–108,4 giây với biến thể. Một lượt prompt đang dùng hết thời gian sau 120 giây. Số thời gian gồm cả nạp model và có thể chênh lệch giữa lượt đầu và lượt sau trên cùng runner. Mẫu bộ nhớ cấp cho model bằng nhau trong từng cặp. Hai cấu hình runner ghi lần lượt 3,19 GB RAM và 0 VRAM, hoặc 1,01 GB RAM và 2,54 GB VRAM. Phép đo dùng Ollama trên runner chuẩn của repo công khai, chi phí 0 đồng. Kivuno vẫn dùng prompt hiện tại. Cần xác minh ràng buộc chủ harness trước khi cho kế hoạch như hai ca chọn sai ở trên được xếp việc.

Tám đầu ra kiểm soát đúng đều qua bộ chấm. Tám đầu ra cố ý sai bị loại, gồm thay chủ chưa cấp quyền và tự bật dự phòng. Bộ chấm câu hỏi dùng từ khóa và có thể cho qua câu nhắc đúng từ nhưng hỏi sai ý. Đối chiếu phản hồi thô cho lần chạy này xác nhận cả hai prompt gửi kế hoạch trong hai ca cần hỏi, nên hạn chế đó không làm thay đổi điểm. Artifact lưu prompt, phản hồi và phép đo. Bản tải về và bảng ghép cặp nằm trong `.local/sade-owner-routing-check/44698224337` trên worktree.

`d6ab76d1fe1b5dafd61a49b85df853c32f9cf877` sửa hai ca giao nhầm Astra ở bộ điều phối. Với yêu cầu đọc trực tiếp một file có đường dẫn rõ, Sade xác định danh tính đã chia sẻ trước khi xét grant của project. Nếu trùng tên và chưa rõ chủ, Sade hỏi người gửi chọn. Nếu đúng chủ chưa cấp quyền, Sade giữ nguyên tin chờ và tiếp tục khi grant cho đúng project và đúng lần chia sẻ xuất hiện. Hai ca chờ đều dùng 0 lượt planner. Một harness vừa lập kế hoạch vừa đọc cần đủ hai lượt. Sade có thể dùng một harness khác đã được chính người gửi cấp làm planner để giữ lại lượt đọc.

Sau khi xác định đúng chủ, bộ điều phối chỉ nhận một tác vụ nghiên cứu chỉ đọc trên đúng file, đúng grant và không kèm phương án dự phòng. Desktop hỗ trợ trường mới gửi phản hồi lỗi ngay trong lượt hiện tại để planner có thể sửa kế hoạch. Bộ điều phối kiểm tra cả kế hoạch từ desktop chưa nhận trường này. Các hồi quy cũng kiểm tra grant trên project khác, thu hồi rồi chia sẻ lại cùng hồ sơ, câu phủ định một người làm, và tin trích dẫn chỉ để báo nhóm. Câu giao nhiều việc như nguyên văn A vẫn dựa vào planner để hiểu các mục giao việc.

```powershell
node --import tsx --test --test-name-pattern 'Shared Sade (holds Astra|asks before spending|enforces a single named read|corrects a pinned read draft|keeps the last turn|keeps a named read)' tests/shared-sade.test.ts
$originalOllamaHost = $env:OLLAMA_HOST
try {
  $env:OLLAMA_HOST = '127.0.0.1:1'
  node --import tsx scripts/eval-shared-sade-planner.ts .local/preflight-missing-chi.json --owner-routing --case owner-routing/missing-exact-owner-with-alternative
  node --import tsx scripts/eval-shared-sade-planner.ts .local/preflight-two-astras.json --owner-routing --case owner-routing/relative-owner-ambiguous
} finally {
  $env:OLLAMA_HOST = $originalOllamaHost
}
```

Hai lệnh eval ghi `execution: coordinator-preflight`, mỗi lệnh xác nhận một ca điều phối và 0 ca model. Có thể lặp lại với `--planning-prompt owner-routing`. Dùng checkout `0dd3f05` để đối chiếu đúng các lượt model lịch sử. Ở bản sửa, lệnh CI `owner-routing` chỉ chấm model trên những tin thực sự được chuyển tới planner.

Windows cục bộ qua 17/17 ca hồi quy tập trung, 102/102 ca Shared Sade và 189/189 ca Sade. Hai shard CI tương ứng tải được cả bốn báo cáo điều phối, một báo cáo mỗi ca cho mỗi lựa chọn prompt. Báo cáo cho thấy không có lượt model, không có hash prompt và không có số đo thời gian suy luận. [CI hỏi chủ Astra](https://github.com/dakiemdarktharr/WWW/actions/runs/44700562147/job/136167632793) · [CI chờ đúng grant của Chi](https://github.com/dakiemdarktharr/WWW/actions/runs/44700562147/job/136167632484)

Trên sáu ca độc lập còn chuyển đến Qwen, prompt hiện tại đạt 3/6 và biến thể đạt 2/6. Cả hai vẫn đạt 0/4 trên nhóm A. Hai ca đã được chặn ở điều phối không tính vào điểm model. Việc chọn model và reasoning giữ nguyên. Bản tải đủ 24 đầu ra và bảng đã đối chiếu nằm trong `.local/sade-read-assignment-verification/44700562147/complete` trên worktree. [Lượt đo và artifact trên bản sửa](https://github.com/dakiemdarktharr/WWW/actions/runs/44700562147)

`npm run check` trên đúng `d6ab76d` qua 475 ca Windows, 471 Ubuntu và 470 macOS arm64, với 0 lỗi. Số ca bỏ qua theo nền tảng lần lượt là một, năm và sáu. Cả ba qua corpus 1.000 tin với kế hoạch mô phỏng và ca desktop sửa kế hoạch sai trong cùng lượt. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44700561777) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44700561375)

Phép đo `handoff-planning` trên `780f775aa87069ee666765c6e229d4cc187cacaf` dùng lại bốn ca A và thêm sáu tin giữ riêng, gồm bốn ca cần lập kế hoạch và hai ca cần hỏi chủ hoặc quyền. Bộ chấm mới đòi ứng viên giữ đúng chủ được chỉ định, không thêm phương án dự phòng hoặc hệ điều hành, giữ bốn phạm vi file, và giao review phòng thủ cho người khác hai tác giả. Ca kế hoạch hợp lệ được đưa qua điều phối mô phỏng để xác nhận frontend chờ kiến trúc qua review và nhận đúng revision khi kiến trúc đã được tích hợp.

Hai lựa chọn dùng cùng Qwen3 4B, digest, tin nhắn, roster, seed, mức sinh tối đa 1.600 token và hạn 180 giây. Mỗi lựa chọn gọi model một lần trong mỗi ca. Baseline dùng các tool hiện có. Biến thể thử nghiệm giảm kích thước đầu ra bằng JSON theo schema của Ollama, thêm gợi ý chủ harness nếu câu có cấu trúc bàn giao rõ, rồi đưa kết quả qua cùng bộ phân tích và bộ điều phối. Các runner chạy theo cặp và đảo thứ tự ở các shard lẻ. Đây là phép so cả cách biểu diễn đầu vào và cách nhận đầu ra, nên kết quả không quy riêng cho prompt hoặc schema. [Tài liệu JSON theo schema của Ollama](https://docs.ollama.com/capabilities/structured-outputs)

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=sade-eval -f sade_suite=handoff-planning
```

Hai nhánh đều đạt **0/4** ở A. Trên sáu ca giữ riêng, bộ chấm tự động ghi baseline 1/6 và JSON gọn 0/6. Đọc lại đầu ra duy nhất đạt điểm cho thấy baseline hỏi đúng nên dùng Astra của Bình hay Chi, nhưng hỏi thêm người làm backend và test dù Sade đã được giao quyền chọn. Biến thể JSON gửi chín kế hoạch và một câu hỏi sai trọng tâm. Các kế hoạch gộp API với bộ test, mở rộng phạm vi file, đặt hệ điều hành chưa được yêu cầu hoặc chọn sai người. Trong ca chỉ định Astra của Chi mà thiếu grant, biến thể giao việc cho Astra của Bình. Khi có hai Astra và người gửi chưa phân biệt, biến thể cũng tự chọn Bình. Các gợi ý nhận diện chủ xuất hiện ở bốn ca A, còn sáu ca giữ riêng dùng phần hướng dẫn JSON chung. [CI và 20 đầu ra gốc](https://github.com/dakiemdarktharr/WWW/actions/runs/44702757247)

Baseline có bảy phản hồi trong 51,6–136,6 giây và ba timeout. Biến thể có mười phản hồi trong 41,1–115,6 giây. Số token đầu vào ghi nhận lần lượt là 2.044–2.284 và 680–855. Thời gian gồm nạp model, có thể khác nhau giữa lượt đầu và lượt sau trên cùng runner. Mẫu bộ nhớ cấp cho model bằng nhau ở cả mười cặp. Runner ghi 3,19 GB RAM và 0 VRAM, hoặc 1,01 GB RAM và 2,54 GB VRAM. Phép đo chạy trên runner chuẩn miễn phí của repo công khai. Kivuno giữ cấu hình hiện tại vì biến thể chưa cho kế hoạch đúng. Bản tải và bảng đối chiếu lưu trong `.local/sade-handoff-compact/44702757247/complete` của worktree.

Các đầu ra kiểm soát xác nhận bộ chấm loại kế hoạch sai chủ, dự phòng ngoài yêu cầu, thiếu phụ thuộc và review sai phạm vi. Các ca kiểm tra diễn đạt cũng cho thấy bộ chấm từ khóa có thể bỏ lọt câu phủ định hoặc hỏi thêm quyền không phù hợp. Kết luận về điểm đạt đã đối chiếu với nội dung phản hồi gốc.

`npm run check` trên `780f775` qua 475 ca Windows, 471 Ubuntu và 470 macOS arm64, với 0 lỗi. Số ca bỏ qua theo hệ điều hành lần lượt là một, năm và sáu. Cả ba chạy corpus 1.000 tin với kế hoạch mô phỏng. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44702834110) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44702834453)

Trên `9e566cff116a4f155373eddf66a3e09361bc3365`, bộ điều phối giữ cả hai chủ trong câu bàn giao rõ từ kiến trúc hoặc hợp đồng sang frontend. Danh sách harness đã chia sẻ được dùng để xác định chủ trước khi xét quyền ghi và lượt còn lại của từng grant trong project. Sade hỏi đúng người gửi khi có nhiều tên khớp, hoặc tiếp tục chính tin nhắn đã chờ khi grant ghi của đúng chủ và đúng lần chia sẻ được cấp. Mã câu hỏi đổi khi yêu cầu chuyển sang bước chờ khác, nên trả lời lại câu cũ không chọn nhầm người ở bước mới. Cả hai cách chờ diễn ra trước khi gọi planner.

Kế hoạch phải giữ grant đã xác định ở cả hai công việc và để frontend phụ thuộc vào kiến trúc. Nếu tin hiện tại nêu đúng file, tác vụ phải giữ file đó và tránh một tác vụ ghi khác chồng phạm vi. Khi tin chỉ định công việc theo vai trò, planner dùng khóa `architecture` và `frontend`. Desktop có hỗ trợ truyền các ràng buộc này vào lượt lập kế hoạch và cho sửa đầu ra sai trong cùng lượt. Sade vẫn kiểm tra ở bộ điều phối đối với desktop cũ. Lượt thử nguyên văn A xác nhận Astra nhận bản kiến trúc đã duyệt rồi mới hỏi về phong cách, còn kiểm thử hết quota giữ nguyên Astra đã chọn. Câu trích dẫn chỉ báo nhóm và câu có dự phòng được giữ luồng phân tích thông thường.

```powershell
node --import tsx --test --test-name-pattern 'holds a named handoff|invalid named handoff|selected handoff receiver|hands Gemini architecture|quoted or conditional handoffs' tests/shared-sade.test.ts
$previousOllamaHost = $env:OLLAMA_HOST
try {
  $env:OLLAMA_HOST = 'http://127.0.0.1:1'
  node --import tsx scripts/eval-shared-sade-planner.ts .local/ungranted-a.json --frontend-style --case frontend-style/ungranted
  node --import tsx scripts/eval-shared-sade-planner.ts .local/ungranted-handoff.json --handoff-planning --case handoff-planning/parcel-exact-owner-without-grant
  node --import tsx scripts/eval-shared-sade-planner.ts .local/ambiguous-handoff.json --handoff-planning --case handoff-planning/library-ambiguous-other-owner
} finally {
  $env:OLLAMA_HOST = $previousOllamaHost
}
```

Ba ca trên ghi kết quả `coordinator-preflight` và dùng 0 lượt model, 0 lượt grant. Dùng checkout `780f775` nếu cần chạy lại kết quả model trước khi có ràng buộc này. Sáu prompt hồi quy cũ giữ nguyên hash và kết quả khi phát lại. Ràng buộc mới áp dụng cho cấu trúc câu bàn giao kiến trúc sang frontend mà bộ nhận diện hỗ trợ. Chất lượng phân rã từng việc của model vẫn được chấm riêng.

Windows cục bộ qua 18/18 ca tập trung, 120/120 ca Shared Sade và 207/207 ca Sade. Ở CI, mỗi nhánh của phép đo `handoff-planning` xác nhận cả ba ca chờ. Ca nguyên văn A báo cần Bình cấp quyền ghi cho Astra. Ca yêu cầu Astra của Chi báo đúng Chi. Ca chưa phân biệt hai Astra hỏi người gửi chọn giữa Bình và Chi. Các artifact chờ không có model, hash prompt hoặc số đo suy luận. [CI và artifact của phép đo](https://github.com/dakiemdarktharr/WWW/actions/runs/44705873623)

Bảy ca được phép chuyển đến Qwen vẫn chưa có đầu ra đạt toàn bộ yêu cầu ở cả hai nhánh. Cả bảy lượt baseline hết hạn ở 180 giây. Biến thể JSON trả bảy kế hoạch trong 51,1–115,6 giây, với 837–945 token đầu vào. Bộ điều phối chặn ba kế hoạch vì phạm vi ghi chồng nhau hoặc biến việc viết kiến trúc thành nghiên cứu chỉ đọc. Bốn kế hoạch khác đi qua ràng buộc hai chủ nhưng bộ chấm phát hiện thiếu việc backend hoặc kiểm thử, hoặc thiếu loại review phòng thủ đúng yêu cầu. Bảy cặp ghi cùng mẫu bộ nhớ cấp cho model trong từng cặp. Kết quả được tách khỏi ba ca chờ trước planner và nằm trong `.local/sade-handoff-preflight/44705873623/complete`. Kivuno giữ nguyên lựa chọn model và reasoning. [CI và phản hồi gốc](https://github.com/dakiemdarktharr/WWW/actions/runs/44705873623)

Trên `9e566cf`, luồng ghép Windows–macOS arm64 lại qua cả hai đầu. Windows tái hiện lỗi trên Mac, giữ kết quả đã ký, chỉ nhận `path-label.cjs` và xác nhận revision. Chủ Mac mô phỏng dừng một chẩn đoán đang chạy trong Electron. Tiến trình dừng, Windows không nhận kết quả cho lệnh bị dừng, từ chối yêu cầu mới và đóng tunnel. Bài Windows đạt 1/1 trong 241,1 giây. [CI ghép Mac trên cùng SHA](https://github.com/dakiemdarktharr/WWW/actions/runs/44706161537)

`npm run check` trên `9e566cf` qua 493 ca Windows, 489 Ubuntu và 488 macOS arm64, với 0 lỗi. Cả ba chạy corpus 1.000 tin với kế hoạch mô phỏng và hai ca chờ chọn chủ hoặc grant mới. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44705873651) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44705873638)

Rà soát `f814b337a7b886a4670178152966220c2507e234` bổ sung ba ca. Câu đổi người nhận ở phần sau và đường dẫn chỉ làm nguồn đối chiếu được chuyển cho planner thường, nên bộ nhận diện không khóa nhầm chủ hoặc file ghi. Khi câu trả lời `1` đồng thời khớp tên chủ và một số thứ tự chỉ người khác, Sade giữ yêu cầu chờ. Nhập `option 2` hoặc `lựa chọn 2` chọn đúng phương án đã hiển thị. Windows cục bộ qua 21/21 ca tập trung, 123/123 ca Shared Sade và 210/210 ca Sade.

Chạy lại sáu tổ hợp ca chờ với hai lựa chọn prompt vẫn ghi 0 lượt model. Phát lại bằng `--replay` đủ 20 artifact từ `44705873623` trên bản sửa cuối với Ollama không truy cập được. Kết quả và hash prompt của các ca có suy luận khớp bản gốc, còn các ca chờ vẫn được tách khỏi điểm model. Báo cáo phát lại nằm trong `.local/sade-handoff-preflight/f814b33-replay`.

`npm run check` trên `f814b33` qua 496 ca Windows, 492 Ubuntu và 491 macOS arm64. Số ca bỏ qua là một, năm và sáu, với 0 lỗi trong bộ này. Cả ba chạy corpus 1.000 tin có kế hoạch mô phỏng và các ca chặn chọn sai chủ. Job Ubuntu lần đầu lỗi sau đó ở `test:portal` vì trình duyệt không thấy phần tử hiệu ứng chuyển trang `.kp-route-blinds`. Chạy lại riêng job lỗi trên cùng SHA bằng `gh run rerun 44707623917 --repo dakiemdarktharr/WWW --failed` qua cả 492 ca và `test:portal`. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44707623917) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44707624013) · [Ubuntu lần đầu](https://github.com/dakiemdarktharr/WWW/actions/runs/44707623917/job/136191057471) · [Ubuntu chạy lại](https://github.com/dakiemdarktharr/WWW/actions/runs/44707623917/job/136195137242)

#### Kiểm tra đủ đầu việc trước khi giao

Với các mẫu tin yêu cầu đủ kiến trúc, frontend, backend, codebase và rà soát phòng thủ đã nhận diện, Shared Sade kiểm tra kế hoạch trước khi giao. Backend và codebase là hai tác vụ ghi riêng, cùng dùng kết quả kiến trúc. Rà soát chỉ đọc chạy sau frontend và backend, bao phủ cả hai phạm vi. Bộ phân công dùng quyền, hạn mức và chủ của các tác vụ ghi để chọn người rà soát độc lập. Desktop hỗ trợ giao thức mới thăm dò khả năng trước poll nhận việc đầu tiên khi đang rảnh. Poll thăm dò dùng 0 lượt grant. Trong bài desktop giả lập, planner nhận lỗi thiếu codebase rồi nộp kế hoạch đủ năm tác vụ trong cùng một lượt provider. Bộ điều phối áp dụng cùng kiểm tra với desktop cũ. Các thay đổi này nằm ở `cb4814439655386f8f03381130d787ff3c1db51f`.

`aec98f7bb26c8465eb1d839d1a1aae1f00a039fe` giữ ràng buộc chủ Gemini và Astra khi người gửi giảm phạm vi rà soát xuống còn một đầu ra hoặc từ chối kiểm tra rò rỉ. Ba hồi quy kiểm tra lời yêu cầu chỉ review backend, lời bổ sung chỉ review frontend và lời yêu cầu đọc hai phần mà bỏ qua kiểm tra rò rỉ. Cả ba vẫn chuyển việc bàn giao kiến trúc và frontend vào planner, với phạm vi rà soát do nội dung hiện tại quyết định.

Trên `0a14e3139c92a4ca5480b4e95aa3f46548bc12de`, đã phát lại 20 artifact của `44705873623` bằng `scripts/eval-shared-sade-planner.ts --replay` khi Ollama không mở cổng `11565`. Chế độ prompt, suite và shard theo từng artifact. Hash của 14 prompt suy luận khớp bản gốc. Cả bốn kế hoạch từng sang trạng thái `running` chuyển sang `blocked` trước khi giao tác vụ, gồm ba ca workshop thiếu backend và một ca tiếng Anh thiếu file kiểm thử. Ba kế hoạch JSON còn lại vẫn bị chặn ở kiểm tra tác vụ kiến trúc hoặc phạm vi. Sáu kết quả chờ chủ hoặc quyền vẫn dùng 0 lượt model. Báo cáo phát lại nằm trong `.local/sade-handoff-preflight/0a14e31-replay/original`. [Artifact đầu vào](https://github.com/dakiemdarktharr/WWW/actions/runs/44705873623)

```powershell
node --import tsx --test --test-name-pattern 'incomplete Qwen handoff|explicitly requested handoff deliverable|short handoff|hands Gemini architecture|corrects an incomplete handoff draft|defensive review is declined' tests/shared-sade.test.ts
node --import tsx scripts/eval-shared-sade-planner.ts .local/sade-handoff-preflight/0a14e31-replay/original/0-handoff-compact.json --frontend-style --one-planner-call --shard 0/4 --timeout-ms 180000 --planning-prompt handoff-compact --replay .local/sade-handoff-preflight/44705873623/complete/sade-handoff-planning-0/handoff-planning-handoff-compact.json
```

Trên `cb48144`, Windows lại ghép với Electron chạy trên macOS arm64 qua runner. Mac tái hiện lỗi với mã thoát 1 và xác minh bản sửa với mã thoát 0. Windows nhận đúng `path-label.cjs`, kiểm tra kết quả có chữ ký và đánh dấu revision mới đã đạt. Khi chủ Mac mô phỏng thu hồi quyền, tiến trình chẩn đoán còn chạy bị dừng và Windows từ chối lệnh tiếp theo. Bài Windows đạt 1/1 trong 229,4 giây. Tunnel thử nghiệm đã đóng. [CI macOS arm64](https://github.com/dakiemdarktharr/WWW/actions/runs/44711049879)

Lượt Qwen mới chạy hai cách lập kế hoạch trên cùng bảy ca cần model và ba ca chờ. Model là `qwen3:4b-instruct-2507-q4_K_M`, cùng digest, seed 7013, giới hạn 1.600 token sinh và 180 giây mỗi lượt. Sáu lượt chờ ở cả hai nhánh đều dùng 0 lượt model và 0 lượt grant. Bảy lượt gọi công cụ baseline hết hạn. Biến thể JSON trả bảy kế hoạch trong 72,3–93,6 giây, với 899–993 token đầu vào và 316–380 token sinh. Mỗi cặp ghi cùng mẫu bộ nhớ sau lượt trả lời. Một cặp dùng 3,19 GB RAM và 0 VRAM, sáu cặp dùng 1,01 GB RAM và 2,54 GB VRAM. Phép đo chạy qua Ollama trên runner chuẩn của kho công khai.

Hai cách cùng đạt 0/7 theo toàn bộ tiêu chí. Trong biến thể JSON, một kế hoạch bị chặn vì phạm vi ghi chồng nhau. Sáu kế hoạch có đủ đầu việc để bộ điều phối xếp hàng. Ba kế hoạch workshop bỏ chi tiết kiểm tra lộ email, hai kế hoạch đưa thêm file test vào rà soát chỉ được yêu cầu trên hai file nguồn, và kế hoạch tiếng Anh tự thêm Windows. Kivuno tiếp tục dùng cấu hình baseline. Đã đối chiếu hash prompt, chạy lại kết quả điều phối và điểm chấm của cả 20 artifact trên `0a14e31`; toàn bộ khớp lượt mới. Báo cáo và dữ liệu gốc nằm trong `.local/sade-handoff-preflight/44711031462/complete` và `.local/sade-handoff-preflight/0a14e31-replay/fresh`. [Phép đo Qwen và artifact](https://github.com/dakiemdarktharr/WWW/actions/runs/44711031462)

Windows cục bộ qua 21/21 ca tập trung, 143/143 ca `npm run test:shared-sade` và 230/230 ca `npm run test:sade`. `npm run check` trên `0a14e31` qua 516 ca Windows, 512 Ubuntu và 511 macOS arm64, với lần lượt một, năm và sáu ca bỏ qua theo nền tảng và 0 lỗi. Cả ba chạy corpus 1.000 tin với kế hoạch mô phỏng. macOS qua cả Electron và bài trình duyệt Shared Groups. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44711885375) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44711885267)

#### Giữ yêu cầu rà soát từ tin nhắn hiện tại

Commit `fc39ac92d49e8424afce5ca136250c609690a060` áp dụng giới hạn khi tin nhắn chỉ định rà soát đúng hai đầu ra frontend và backend. Bộ điều phối từ chối phạm vi gộp thêm file test. Desktop nhận biết cùng giới hạn trước khi nộp bản nháp, nhờ đó planner trong bài thử có thể sửa ngay trong lượt đang dùng. Tác vụ được giao giữ nguyên câu yêu cầu rà soát đã che thông tin nhạy cảm, kể cả khi model bỏ chi tiết như số thẻ hoặc địa chỉ email trong mô tả của nó. Tin nhắn được tham chiếu vẫn cung cấp ngữ cảnh cho planner. Bài thử xác nhận nội dung của tin cũ không tự trở thành yêu cầu bắt buộc của reviewer, gửi lại kết quả giữ cùng tác vụ, và câu A dùng từ `cyber` chung vẫn cho phép rà soát các đầu ra khác được yêu cầu.

Đã phát lại 20 artifact của `44711031462` qua `--replay` khi Ollama không mở cổng `11565`. Prompt và dữ liệu model giữ nguyên. Hai kế hoạch của ca tủ nhận hàng và đặt bàn trước đó đã được xếp hàng nay bị chặn trước khi giao vì cả hai thêm file test vào phạm vi rà soát. Ba ca chờ chủ hoặc grant vẫn dùng 0 lượt model ở cả hai chế độ. Báo cáo nằm trong `.local/sade-handoff-review/fc39ac9-check/replay`. [Artifact đầu vào](https://github.com/dakiemdarktharr/WWW/actions/runs/44711031462)

```powershell
node --import tsx --test --test-name-pattern 'corrects expanded review|limits explicitly scoped handoff reviews|hands Gemini architecture' tests/shared-sade.test.ts
node --import tsx scripts/eval-shared-sade-planner.ts .local/sade-handoff-review/fc39ac9-check/replay/5-handoff-compact.json --handoff-planning --shard 1/6 --one-planner-call --timeout-ms 180000 --planning-prompt handoff-compact --replay .local/sade-handoff-preflight/44711031462/complete/sade-handoff-planning-5/handoff-planning-handoff-compact.json
```

Commit thử nghiệm `8a186babfe1d33acdd2c20188b408ad0c37c4d9e` thêm cách biên dịch bản nháp bàn giao thành lời gọi công cụ Shared Sade chuẩn. Bộ biên dịch dùng chủ đã được điều phối xác định và các file có bằng chứng trong tin hiện tại hoặc tin tham chiếu. Model chọn file còn thiếu, phong cách và trọng tâm rà soát còn chưa rõ qua một JSON ngắn. Phần biên dịch điền phụ thuộc, phạm vi review hai file, phân công theo quyền, và giữ lựa chọn máy chạy mở trong tập bàn giao không yêu cầu hệ điều hành. Yêu cầu ngoài phạm vi nhận diện dùng cùng cách lập kế hoạch JSON đối chứng. Cách này chỉ chạy trong phép đo.

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=sade-eval -f sade_suite=handoff-compiled
```

Trên cùng input, digest Qwen 4B, seed và hạn 180 giây, bản biên dịch đạt 2/7, còn JSON tự viết cả kế hoạch đạt 0/7. Hai ca đạt là đặt bàn tiếng Việt không dấu và bàn giao bổ sung nước tiếng Anh. Bản biên dịch có trung vị 17,6 giây, khoảng 7,3–24,1 giây, với 277–378 token đầu vào. JSON đối chứng có trung vị 77,1 giây, khoảng 71,2–136,6 giây, với 899–993 token đầu vào. Mỗi ca dùng một lượt model qua Ollama trên runner chuẩn của kho công khai. Ba ca chờ cho mỗi phương án dùng 0 lượt model và 0 lượt grant. Mẫu bộ nhớ Ollama bằng nhau trong từng cặp. Bốn cặp báo 3,19 GB RAM và 0 VRAM, ba cặp báo 1,01 GB RAM và 2,54 GB VRAM. Đây là ước lượng phân bổ sau phản hồi.

Bản biên dịch còn lỗi mất tiêu chí lộ email ở hai ca workshop, mất một hoặc nhiều chi tiết phong cách ở workshop và tủ nhận hàng, và gán nhầm file test cho frontend ở ca thư viện. Commit `107aef1` so sánh kế hoạch biên dịch theo dạng JSON đã lưu. Đã phát lại cả 20 artifact khi Ollama tắt, gồm biên dịch lại bảy phản hồi JSON gốc. Hash, điểm và trạng thái điều phối khớp từng artifact. Tệp tổng hợp và dữ liệu nằm ở `.local/sade-handoff-review/44714143196/complete` và `.local/sade-handoff-review/44714143196/verified-replay`. [CI phép đo và artifact](https://github.com/dakiemdarktharr/WWW/actions/runs/44714143196)

Windows cục bộ trên `fc39ac9` qua 11/11 ca tập trung, 152/152 ca `npm run test:shared-sade` và 239/239 ca `npm run test:sade`. `npm run check` trên cùng SHA qua 525 ca Windows, 521 Ubuntu và 520 macOS arm64, với 0 lỗi. Số ca bỏ qua theo nền tảng lần lượt là một, năm và sáu. Cả ba chạy bộ 1.000 tin với planner mô phỏng. macOS qua thêm kiểm chứng Electron và Shared Groups. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44713863014) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44713863954)

Ca hết quota của A dùng tín hiệu từ fixture trước khi mở lượt model. Gemini, Claude và Antigravity có thể trả trạng thái quota chưa rõ. Nếu chưa biết quota, Sade vẫn giới hạn số lượt theo quyền do chủ harness cấp. Cần lượt tài khoản thật để đo hành vi khi provider hết quota.

Ca hai desktop ở `eb9f686` kiểm tra lại B và C trên hai worktree Git. Khi tác giả đổi `architecture.txt` sau khi nhận verdict độc lập, Sade từ chối tích hợp, giữ cả hai HEAD và chưa giao bước frontend. Khôi phục đúng nội dung đã duyệt cho phép dùng lại commit có sẵn. HEAD trên Git remote thử nghiệm giữ nguyên. Ca này kiểm tra nội dung file và bản vá đã duyệt. Tương đương hành vi vẫn cần phép đo riêng.

Ca C trên `4bff7a426f0ffe44c6da5748c0f441b4bf20eff4` gửi nguyên văn “Đây là code Gemini tạo, lấy Claude và ChatGPT check thử.” Kế hoạch mô phỏng gắn hai lượt review chỉ đọc vào cùng bản vá Gemini, với hai grant thuộc hai chủ khác nhau. Bản vá đầu dùng điều kiện `total > 50`, sai tại 50. Claude duyệt trong fixture và ChatGPT yêu cầu sửa. Bộ điều phối chặn tích hợp sau verdict đầu, cấp hai mã review mới sau khi Gemini sửa thành `total >= 50`, và từ chối kết quả đến từ cả hai mã cũ. Chỉ khi cả hai reviewer duyệt bản mới thì digest mới được chuyển cho tác vụ tích hợp. Các tác vụ, verdict và tích hợp đều dùng fixture. Bài thử đo việc điều phối hai reviewer và hiệu lực digest, còn năng lực phát hiện lỗi của model đã đăng nhập được đo riêng.

```powershell
node --import tsx --test --test-name-pattern 'Claude and ChatGPT must both review|planned patch reviews use their allocated' tests/shared-sade.test.ts
```

Windows cục bộ trên `4bff7a4` qua cả hai ca tập trung, 103/103 ca Shared Sade và 190/190 ca Sade. `npm run check` trên cùng SHA qua 476 ca Windows, 472 Ubuntu và 471 macOS arm64, với 0 lỗi. Số ca bỏ qua theo hệ điều hành lần lượt là một, năm và sáu. Cả ba chạy ca hai reviewer và corpus 1.000 tin với kế hoạch mô phỏng. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44703420431) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44703420500)

Windows cục bộ qua 82/82 bài `npm run test:shared-sade` và 169/169 bài `npm run test:sade` với Node 24.22.1. Trên cùng SHA, `npm run check` qua 455 bài trên Windows, 451 trên Ubuntu và 450 trên macOS arm64. Ba nền tảng lần lượt bỏ qua một, năm và sáu bài theo hệ điều hành, với 0 lỗi. Tổng số mỗi nền tảng gồm cả hai chiều bàn giao qua adapter Claude và Antigravity với tiến trình provider mô phỏng. Ubuntu qua cloud và portal, macOS qua Electron và Shared Groups. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44685817040) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44685816520)

```powershell
node --import tsx --test --test-name-pattern 'two desktop workspaces hand off reviewed code' tests/shared-sade.test.ts
```

Ca `disjoint writers hold concurrent leases` xác nhận hai grant riêng có thể cùng giữ lease ghi cho `src/menu.ts` và `src/search.ts` khi có đủ lượt review độc lập. Mất xác nhận của desktop thứ hai trả lại cùng mã tác vụ và không dùng thêm lượt. Cả hai tác vụ ở trạng thái đang chạy trước khi có bên nào hoàn tất. Chạy bằng `node --import tsx --test --test-name-pattern 'disjoint writers hold concurrent leases' tests/shared-sade.test.ts`.

Trên `8315a466b2cd7e0c8ab4f790aac734dd1c1e3ac0`, Windows cục bộ qua 83/83 ca `npm run test:shared-sade` và 170/170 ca `npm run test:sade`. `npm run check` trên CI qua 456 ca Windows, 452 Ubuntu và 451 macOS arm64. Ba nền tảng lần lượt bỏ qua một, năm và sáu ca theo hệ điều hành, với 0 lỗi. Cả ba qua ca lease song song mới và corpus fixture 1.000 tin. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44688365308) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44688365328)

Planner Shared Groups có công cụ chỉ đọc `relay_read_shared_git` trong cùng lượt lập kế hoạch. Khi người gửi báo commit trùng, xung đột hoặc công việc đã hoàn tất, prompt yêu cầu gọi công cụ trên một file hoặc thư mục cụ thể trước khi giao ghi. Công cụ đọc checkout liên kết với grant và trả HEAD cục bộ, trạng thái thay đổi trong scope, tối đa năm SHA lịch sử, cùng dữ kiện về commit được dẫn nếu có. Kết quả phân biệt commit nằm trong HEAD, commit chạm scope và cây trong scope hiện còn khớp, kể cả mode file. Khi đường dẫn, trạng thái hoặc hành vi còn chưa rõ, prompt yêu cầu xác minh chỉ đọc hoặc hỏi người gửi trước khi giao sửa. Trạng thái GitHub, bản vá tương đương và hành vi tương đương cần bằng chứng riêng.

Ca B dùng lời nhắn “Cái đó tui commit rồi mà sao ông commit y chang? Nhờ Mây kiểm tra bản đã có.” Tin trước nêu SHA rút gọn và `docs/contract.md`. Repo thử có một commit đã hoàn tất hợp đồng và một commit mới chỉ sửa `README.md`, cùng một thay đổi chưa commit ở `README.md`. Planner Gemini mô phỏng đọc Git qua đường công cụ thường. Commit cũ vẫn nằm trong HEAD và cây hợp đồng vẫn khớp, trong khi truy vấn riêng `README.md` báo có thay đổi cục bộ. Planner giao xác minh hợp đồng chỉ đọc. Gửi lại cùng tin và cùng mã giao việc dùng một lượt planner, giữ nguyên HEAD cục bộ, HEAD của bare remote thử và trạng thái file.

Ca này cũng xác nhận công cụ từ chối đường dẫn cấu hình riêng, đường dẫn ngoài project, tên branch thay cho SHA, origin khác grant, gọi sau khi đã nộp kế hoạch và gọi sau khi lease kết thúc. Phản hồi chỉ gồm SHA và cờ trạng thái trong phiên planner. Hai ca bàn giao chạy qua các adapter Claude và Antigravity thật, với tiến trình provider mô phỏng, cũng gọi công cụ Git trong lượt planner. Quyết định tự gọi công cụ từ model provider đăng nhập thật cần lượt đo riêng.

Thao tác Git chặn tải object từ remote và bỏ cập nhật index kiểu tùy chọn. Khi có filter Git được cấu hình, lệnh kiểm tra trạng thái tắt filter trong tiến trình đó và trả `statusUsesDisabledFilters`. File chịu filter như Git LFS cần xác minh riêng. [Tài liệu Git về khóa tùy chọn](https://git-scm.com/docs/git) · [Tài liệu Git về filter](https://git-scm.com/docs/gitattributes)

```powershell
node --import tsx --test --test-name-pattern 'Shared Sade reads scoped Git evidence' tests/shared-sade.test.ts
```

Trên Windows cục bộ ở `9d2fc5f500b7c45dc73b2715105b766cee6c89ae`, `npm run test:shared-sade` qua 84/84 và `npm run test:sade` qua 171/171. Hai lượt đều qua 1.000 tin với đầu ra planner fixture. Bộ Git và provider chạy bằng `node --import tsx --test --test-concurrency=2 tests/git.test.ts tests/providers.test.ts` qua 43/43 ca. Prompt và bộ công cụ của các lượt đo Qwen offline cũ được giữ để đối chiếu. Công cụ Git chạy trong lượt planner đã cấp quyền.

`npm run check` trên cùng SHA qua 457 ca Windows, 453 Ubuntu và 452 macOS arm64, với 0 lỗi. Các nền tảng lần lượt bỏ qua một, năm và sáu ca theo hệ điều hành. Cả ba đều chạy ca B mới và corpus 1.000 tin. Log cục bộ và xác nhận CI được lưu trong `.local/sade-verification-9d2fc5f` của worktree. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44690812310) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44690812517)

CI macOS tái hiện lỗi khi hai phiên ghi tạo worktree đồng thời và Git đọc `commondir` của một worktree còn đang được tạo. Kivuno sắp thứ tự thao tác tạo worktree theo thư mục Git chung trong cùng tiến trình. Bài hồi quy tạo hai worktree đồng thời từ repo chính và từ một worktree đã liên kết, rồi kiểm tra nội dung và nhánh riêng của từng phiên. [Lượt tái hiện trên macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44645092465)

Commit `05fb000` qua bốn bài Windows về worktree, phiên ghi đồng thời và bàn giao Claude ↔ Antigravity. macOS arm64 qua 389 bài, bỏ qua sáu bài theo nền tảng, rồi qua build, Electron và Shared Groups. Bộ 1.000 tin với kế hoạch mô phỏng đạt trong CI macOS. Cùng commit, bài bàn giao Windows–Mac dùng runner macOS arm64 thật, tái hiện lỗi đường dẫn rồi chạy lại thành công và trả đúng file về Windows. Planner và reviewer dùng fixture. [CI macOS sau khi sửa](https://github.com/dakiemdarktharr/WWW/actions/runs/44645920186) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44646383664)

Nếu máy Mac chỉ chạy công cụ, chủ máy ghép máy với project qua **Machines** và xác nhận quyền chạy lệnh. Trong nhóm, người dùng Windows chọn cùng project, bật **Allow local file changes**, chọn máy trong **Paired machine** rồi xác nhận quyền cho harness của mình. Khi **Ask Sade** nhận yêu cầu chạy trên macOS, harness dùng tài khoản trên Windows, kiểm tra hệ điều hành của máy ghép cặp trước khi chuyển worktree, chạy thao tác kiểm thử trên máy Mac và chuyển về các thay đổi trong scope để review. Kết quả nhóm ghi mã thoát hoặc timeout do máy trả về. Chủ máy Mac cần Kivuno để cấp và thu hồi quyền, còn phiên AI chạy ở máy Windows.

Sade giữ bản vá tại worktree của tác giả cho tới khi kiểm tra có chữ ký xác nhận đúng nội dung hiện tại. Nếu kiểm tra thất bại hoặc chỉ khớp bản cũ, **Sade progress** báo đang chờ kiểm tra đạt trên máy ghép cặp. Chủ worktree có thể chạy lại từ **Reviews**. Reviewer chỉ dùng lượt sau khi máy ghép cặp xác nhận bản mới. Bài hồi quy thực thi Node thật qua giao thức thử nghiệm, kiểm tra trạng thái chờ khi sửa file sau lượt đạt, chạy lại nhận mã thoát 1, rồi sửa và chạy lại thành công. Sau đó chỉ diff của bản đã kiểm tra được giao cho reviewer. Phần phân vai tác giả, reviewer và hệ điều hành máy ghép cặp dùng fixture trong ca này.

Commit `fe97ce2` đạt 445 bài trên Windows, 441 trên Ubuntu và 440 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Cả ba qua ca chờ kiểm tra trước review và bộ 1.000 tin với planner mô phỏng. macOS qua thêm Electron và giao diện Shared Groups. Để chạy riêng luồng review, dùng `node --import tsx --test --test-name-pattern "two desktop workspaces hand off" tests/shared-sade.test.ts`. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44679038888) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44679038831)

Harness có thể gọi `machine_run` với `purpose: "diagnostic"` khi chạy lệnh tạm để phân tích hoặc tái hiện lỗi. Lệnh kiểm tra bản sửa dùng `purpose: "verification"` hoặc giá trị mặc định. **Reviews** giữ cả hai loại kết quả và gắn nhãn **Diagnostic** cho lệnh chẩn đoán. Một lần chạy như vậy không dùng để mở review, không tạo điều kiện xác minh mới cho tác vụ thường và không thay kết quả xác minh của cùng lệnh. Khi chạy lại từ **Reviews**, mục đích của lệnh vẫn được ghi nhận. Bài thử Shared Sade dùng hai lệnh Node khác nhau và kiểm tra lỗi chẩn đoán vẫn hiện sau khi bản sửa đã qua xác minh.

Commit `cc27a7e` qua 80 bài runner và Shared Sade trên Windows cục bộ. CI đạt 446 bài trên Windows, 442 trên Ubuntu và 441 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo nền tảng. Cả ba kiểm tra lệnh chẩn đoán thành công không thay thế lần xác minh thất bại với cùng lệnh, lượt chạy lại giữ mục đích, và bộ 1.000 tin với planner mô phỏng. macOS qua thêm Electron và giao diện Shared Groups. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44680678164) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44680678302)

Phép thử qua Codex App Server cho thấy model có thể đưa cả lệnh vào trường tên chương trình của `machine_use`. Công cụ `machine_run` tách executable và mảng đối số, ví dụ `node` đi với `["platform-smoke.cjs"]`. App Server tạo đúng hai trường trong một lần gọi khi kiểm tra với model thật. Runner tiếp tục dùng cơ chế hiện có để kiểm tra quyền, thực thi và xác minh kết quả. Luồng gọi `machine_use` với thao tác `run` vẫn được xử lý cho các phiên cũ.

Fixture D dùng hai workspace và một runner công cụ trên máy kiểm thử. Runner thực sự chuẩn bị worktree và chạy Node. Bài kiểm thử trước hết để runner trả hệ điều hành thực tế và xác nhận yêu cầu bị từ chối nếu hệ điều hành khác với quyền đã ghép. Sau đó bài kiểm thử mô phỏng phản hồi đúng hệ điều hành để xác minh luồng cấp việc, chuyển file và báo kết quả. Một runner ngoài quyền và một grant đã đổi ID đều bị chặn. Các bài `machine-execution.test.ts` kiểm tra riêng việc giữ credential trên máy nguồn, phạm vi pull, hết hạn và thu hồi khi lệnh đang chạy.

Runner hỗ trợ truyền từng phần giới hạn mỗi gói dữ liệu ở 768 KiB trước khi mã hóa, mỗi file ở 4 MiB và mỗi snapshot ở 8 MiB hoặc 2.000 file. Receiver kiểm tra thứ tự, độ dài, SHA-256 và trạng thái worktree trước khi áp dụng. Runner đời cũ tiếp tục dùng định dạng một gói với giới hạn 512 KiB mỗi file và 2 MiB mỗi snapshot.

Thử thực tế trên Windows đã chuyển đủ 267 file của repo Kivuno sang một runner cục bộ biệt lập, xuất trở lại và so khớp từng byte. Snapshot chứa khoảng 5,5 MiB file gốc, dùng 10 gói mỗi chiều. Node đọc thành công `package.json` trong worktree đích. Bài hồi quy `machine-execution.test.ts` còn đi qua broker và runner agent với asset 3 MiB, đồng thời kiểm tra rằng huỷ khi đang gửi một phần không áp dụng file.

CI trên macOS arm64 với Node 24.22.1 đã chạy commit `3fc1d2f`. `npm run check` đạt 308 bài và bỏ qua 6 bài theo nền tảng. Electron Desktop và giao diện Shared Groups đều đạt. Audit dependency runtime đạt ngưỡng high và báo 20 mục moderate. Cùng commit, Windows đạt 313 bài, bỏ qua một bài theo nền tảng, và giao diện Shared Groups đạt. Bộ 1.000 tin dùng planner mô phỏng đạt trên cả hai hệ điều hành. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44471124584)

CI dùng máy ảo macOS và fixture provider. Bài kiểm thử riêng bên dưới dùng Codex đã đăng nhập ở Windows qua mạng và runner macOS trên GitHub Actions. Cấp quyền và chạy từ desktop của một thành viên Mac vẫn cần xác minh riêng.

### Bàn giao giữa Claude và Antigravity

Bài kiểm thử dùng hai desktop có hồ sơ và worktree Git riêng. Một tin tiếng Việt mở một lượt lập kế hoạch qua adapter Claude. Máy này ghi đúng một file sau khi người dùng duyệt. Antigravity dùng quyền chỉ đọc để review diff và kiểm tra đầu ra khi bản sửa đã được tích hợp cục bộ. Worktree kiểm tra nhận bản vá đã duyệt, còn nhánh Git của máy Antigravity giữ nội dung gốc. Mỗi bên dùng đúng hai lượt theo quyền đã cấp. Catalog thử nghiệm có biến thể Flash, nên bài test xác nhận Sade chọn Flash với reasoning cao cho review và model mặc định với reasoning trung bình cho bước kiểm tra đầu ra.

Hai adapter mở tiến trình fixture qua giao thức tương ứng và gọi công cụ Kivuno qua MCP. Phép thử dùng hồ sơ đăng nhập giả và không gọi dịch vụ model. Hướng dẫn đọc phòng chat và gửi tiến độ của Claude chỉ xuất hiện khi phiên có công cụ tương ứng.

Bài kiểm thử Antigravity gửi yêu cầu ACP trước mỗi lượt gọi MCP. Cấp quyền Shared Groups hiện đủ để nộp kế hoạch, nộp review và đọc file trong project qua công cụ Kivuno. Khi Antigravity được giao sửa file, chủ harness xác nhận từng thao tác sửa qua hộp thoại hiện có. Bài thử kiểm tra một xác nhận sửa file, yêu cầu read-only không có công cụ ghi, đường dẫn thông tin đăng nhập bị chặn và patch chỉ được tích hợp sau review của chủ harness còn lại.

Commit `95f5899` qua 392 bài trên Windows và 387 bài trên macOS arm64, bỏ qua lần lượt một và sáu bài theo nền tảng. Cả hai qua build, Electron, giao diện Shared Groups, bộ 1.000 tin nhắn với kế hoạch mô phỏng và bài bàn giao Claude → Antigravity lẫn Antigravity → Claude. Kiểm tra riêng dùng Claude Code 2.1.281 và Gemini CLI đi kèm 0.66.0 trên Windows. Hai adapter báo cần đăng nhập khi mở hồ sơ thử nghiệm trống. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44639442994)

```powershell
node --import tsx --test --test-name-pattern 'one group message (hands off|lets Antigravity)' tests/shared-sade.test.ts
```

Kiểm tra trước đăng nhập trên Windows dùng Claude Code 2.1.281 có chữ ký Anthropic hợp lệ, Node 24.22.1 và một thư mục cấu hình tạm. Adapter managed trả `account: null`, khởi tạo stream-json và đọc được năm mục trong catalog, gồm bốn mục hỗ trợ reasoning `high`. Kết quả có 0 lượt model và 0 yêu cầu đăng nhập. Thư mục hồ sơ tạm và tiến trình do bài thử tạo đã được dọn. Phép thử dùng cả thư mục Windows Roaming và Local tạm vì CLI có thể tìm hồ sơ ở Roaming. [Quản lý credential của Claude Code](https://code.claude.com/docs/en/authentication#credential-management)

Bản ghi `claude-managed-preflight.json` và mã thử nằm trong `.local/sade-native-preflight` của worktree. Chạy lại bằng lệnh sau trên máy có Claude Code chính thức.

```powershell
& .\.local\sade-native-preflight\claude-managed-preflight.ps1 -NodeExecutable 'D:\multiplayer agent\.desktop-build\runtime\node.exe'
```

Đã kiểm tra chữ ký Google LLC và phiên bản 1.5.0 của `agy.exe` có sẵn ngoài đường dẫn mặc định của Kivuno. Antigravity có thể tự chọn phiên từ Windows Credential Manager dù dùng thư mục cấu hình trống. Phiên kiểm tra managed cho Antigravity cần tài khoản hệ điều hành tách biệt với kho đăng nhập trống. Hai chủ provider vẫn cần tự đăng nhập và cấp quyền cho cùng Git origin và nhánh trước khi chạy thử. [Đăng nhập Antigravity CLI](https://antigravity.google/docs/install)

Phép thử `antigravity-preflight` dùng runner Windows chuẩn mới của repo công khai. Tệp CLI 1.5.13 ghim theo manifest Google. Runner kiểm tra SHA-512, chữ ký Authenticode của Google LLC và Credential Manager trống trước khi mở CLI trong thư mục tạm. Bộ kiểm tra dùng `AntigravityClient` thật và chỉ cho gửi ACP `initialize` cùng `session/new` để thăm dò trạng thái đăng nhập. Báo cáo lưu mã và kết quả xác thực đã lọc. [Manifest Windows chính thức](https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_amd64.json) · [Xác thực ACP](https://antigravity.google/docs/ide/extensions/acp/#authentication)

Lần đầu dừng ở bước kiểm tra chữ ký trước khi mở CLI. Thử riêng cùng tệp xác nhận SHA-512 và chữ ký Google LLC hợp lệ. Lỗi do Windows PowerShell 5.1 kế thừa `PSModulePath` của PowerShell 7, khiến module Authenticode không nạp được. `c8b9168` bỏ biến kế thừa riêng cho tiến trình kiểm tra chữ ký và giữ nguyên điều kiện xác minh. [Lần CI đầu](https://github.com/dakiemdarktharr/WWW/actions/runs/44694261261)

Hai lượt tiếp theo qua kiểm tra chữ ký rồi dừng ở Credential Manager trước khi mở CLI. Kết quả trên `2a22e35` xác định tài khoản mặc định của runner có mục lưu. Log chỉ ghi `contains-entries`. [Lần thử chữ ký](https://github.com/dakiemdarktharr/WWW/actions/runs/44695058033) · [Lần kiểm tra kho đăng nhập](https://github.com/dakiemdarktharr/WWW/actions/runs/44695759341)

`a063db9` tạo một tài khoản Windows cục bộ không có quyền quản trị trên runner tạm. Tiến trình con kiểm tra đúng SID và profile đã nạp trước khi đọc trạng thái Credential Manager của tài khoản thử. Bộ kiểm tra giữ nguyên điều kiện hash, chữ ký và kho đăng nhập trống. Mật khẩu sinh cho tài khoản hệ điều hành chỉ nằm trong bộ nhớ. [Tài liệu Start-Process](https://learn.microsoft.com/powershell/module/Microsoft.PowerShell.Management/Start-Process) · [Runner GitHub chuẩn](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

CI trên `a063db921bfd9aad04dd56086a5cf78fa836d9ab` đã qua trên Windows x64. CLI 1.5.13 có chữ ký Google LLC, khởi động qua adapter Kivuno, báo ACP 1 và hỗ trợ `oauth-personal`. `session/new` trả `-32000 Authentication required` và `account/read` trả tài khoản rỗng. Không mở đăng nhập và không gọi model. Bộ kiểm tra xác nhận tiến trình đã dừng và thư mục thử đã được dọn. Artifact `antigravity-managed-preflight` có SHA-256 của tệp JSON là `986c1eeccf4450a4a54cd13965f7ea742efbb7a0932005519f9f3a5474ace4f2`. Bàn giao Claude ↔ Antigravity từ hai tài khoản đã đăng nhập và có quyền riêng vẫn cần chạy. [CI và artifact Windows](https://github.com/dakiemdarktharr/WWW/actions/runs/44696825770)

Trước `026b515`, lỗi phiên của Claude và Antigravity có thể yêu cầu người dùng đăng nhập ChatGPT hoặc nhắc tới danh mục model Codex. Các lỗi về đăng nhập, model đã chọn và danh mục trống giờ dùng đúng tên provider. Test chạy các adapter Claude và Antigravity với tiến trình giao thức mô phỏng, xác nhận không gửi prompt, không mở đăng nhập và không sửa file khi bị chặn. Cục bộ có 38/38 ca Codex, Gemini và managed provider đạt trên Node 24.22.1.

```powershell
node --import tsx --test --test-concurrency=2 tests/codex.test.ts tests/managed-providers.test.ts tests/providers.test.ts
```

CI trên `026b515758e526a3b483be7727833cb86c8c4097` qua 458 ca Windows, 454 Ubuntu và 453 macOS arm64, không có ca lỗi. Số ca bỏ qua theo hệ điều hành lần lượt là một, năm và sáu. Ba nền tảng đều qua corpus 1.000 tin với kế hoạch mô phỏng. Windows cục bộ qua 85/85 ca Shared Sade và 172/172 ca Sade. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44698275592) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44698280109)

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=antigravity-preflight
```

### Kiểm tra thông tin xác thực trong bản vá

Máy tác giả kiểm tra nội dung diff, danh sách tên tệp và phần thống kê trước khi chuyển bản vá. Nếu phát hiện mẫu thông tin xác thực, Sade báo cần kiểm tra trên máy tác giả. Desktop kiểm tra lại bản vá còn trong hàng đợi khi đồng bộ sau khi nâng cấp hoặc khi lần gửi trước mất xác nhận. Bộ điều phối kiểm tra bản vá đã lưu trước khi giao review, bàn giao cho tác vụ phụ thuộc hoặc ghi nhận kết quả review. Khi chặn, Sade giữ file nguồn trong worktree của tác giả và bỏ bản vá khỏi dữ liệu điều phối.

Các ca hồi quy dùng token và khối khóa riêng tổng hợp. Chúng kiểm tra bản vá mới, hàng đợi desktop và các workflow còn dang dở. Ca hàng đợi cũng xác nhận bản vá sạch vẫn đi tiếp và xác nhận của bản vá cũ không xóa trạng thái mới.

Commit `18c22ff605aff53207cd68cbc9bca0e05a19b9d2` qua 10/10 ca trong lệnh bên dưới trên Windows cục bộ với Node 24.22.1. `npm run check` trên cùng SHA đạt 455 bài trên Windows, 451 trên Ubuntu và 450 trên macOS arm64. Ba nền tảng lần lượt bỏ qua một, năm và sáu bài theo hệ điều hành, với 0 lỗi. Cả ba qua các ca tổng hợp về thông tin xác thực và bộ 1.000 tin dùng kế hoạch mô phỏng. Ubuntu qua thêm cloud và portal, còn macOS qua Electron và Shared Groups. [CI Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44683793164) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44683793172)

```powershell
node --import tsx --test --test-name-pattern 'private review data|desktop replaces an unsafe queued|desktop keeps staged patches' tests/shared-sade.test.ts
```

### Chạy lại tình huống D qua mạng

Chế độ `paired-files` của **Verify RELAY** dùng hai runner Windows và một runner macOS arm64 để thử riêng việc trao đổi snapshot và biên nhận có chữ ký. Windows chạy baseline rồi xuất đúng hai file tổng hợp. macOS tái hiện lỗi đường dẫn bằng lệnh chẩn đoán, sửa `path-label.cjs` và ký kết quả xác minh bằng lệnh khác. Windows đối chiếu chữ ký và trạng thái file, kiểm tra biên nhận của bản sửa còn ở trạng thái cũ trước khi áp dụng patch, rồi chỉ nhận `path-label.cjs`. File cấu hình tổng hợp `.env.local` ở lại Windows. GitHub Actions chuyển các file thử giữa các job. Phép thử này đo luồng file và bằng chứng của tính năng ghép máy. [GitHub Actions artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/sade-shared-groups-verification -f platform=paired-files
```

Lượt `662c8d9` qua cả ba job. Lệnh chẩn đoán trên macOS trả mã 1, lệnh xác minh sau sửa trả mã 0. Hai biên nhận có cùng khóa công khai và digest khác nhau cho hai snapshot. Windows báo `stale` trước khi áp dụng đúng `path-label.cjs`, rồi báo kiểm tra đạt và chạy lại thành công. Đối chiếu bằng cách tải hai gói `paired-source-1` và `paired-results-1` về cùng một thư mục rồi chạy `node --import tsx scripts/verify-shared-sade-paired-files.ts verify <thư-mục>` trên Windows ở đúng commit đã thử. Lượt chạy lại trên máy Windows cục bộ cho báo cáo JSON trùng SHA-256 với báo cáo của CI. Cùng commit, 80 bài runner và Shared Sade cục bộ đạt, gồm bộ 1.000 tin với planner mô phỏng. [Kết quả Windows–macOS–Windows](https://github.com/dakiemdarktharr/WWW/actions/runs/44682178974)

Lượt `eb9f686` qua lại cả ba job trên runner Windows và macOS arm64 chuẩn. Tải hai gói đầu vào và gói `paired-verification-1` về `.local/sade-verification-eb9f686/paired-files` trong worktree. Chạy lại `verify` trên Windows ở đúng SHA thu được `windows-verification.json` trùng SHA-256 với bản CI trong `ci-final`. Hash là `c2b8176a75b0042fc4879aa9375e12f72be08b1905cd7cb4957f383024134207`. [CI và artifact ghép file](https://github.com/dakiemdarktharr/WWW/actions/runs/44685816453)

Chế độ tùy chọn `paired-macos` đã có trong workflow **Verify RELAY**. Phép thử dùng project Git tổng hợp trên Windows, một runner công cụ macOS arm64 và cầu nối desktop Kivuno cô lập. Cấu hình runner chỉ cấp khi danh tính GitHub Actions khớp origin, workflow và commit. Phép thử có một lỗi xử lý đường dẫn qua dấu gạch chéo, đi qua thứ tự chạy trên Windows, tái hiện lỗi trên macOS, sửa trên máy đích, kéo thay đổi trong scope về Windows, review độc lập và tích hợp cục bộ. Quick Tunnel chỉ mở trong lúc thử. [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Ở commit `b9d8d20`, một tin casual tiếng Việt đăng lại cùng mã vẫn tạo một tin và một workflow. Codex App Server dùng GPT-6.2-Sol với reasoning `high` để lập kế hoạch và GPT-6-Luna với reasoning `low` để sửa. Cả hai lượt dùng phiên Codex đã đăng nhập trên Windows. Runner macOS arm64 được cấp quyền qua OIDC và chỉ chạy công cụ. Snapshot bốn file loại `.env.local`. Hai biên nhận đã xác thực của `machine_run` ghi mã 1 trước khi sửa và mã 0 với đầu ra `darwin` sau khi sửa `path-label.cjs`. macOS xác nhận giao nhận hai chiều. Bản sửa về đúng file trong worktree Windows và qua bước chạy lại. Review độc lập dùng fixture, giữ chặn tích hợp đến khi có verdict đúng digest. SHA của Git remote thử nghiệm giữ nguyên sau tích hợp cục bộ. [Lượt kiểm thử Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44531098964)

Chạy lại trên `95f5899` với planner và reviewer mô phỏng. Node chạy thật trên Windows và runner macOS arm64. Mac tái hiện lỗi đường dẫn, chạy lại thành công sau khi sửa và trả đúng file về worktree Windows. Runner xác nhận `round-trip-verified`. Lượt kiểm thử kết thúc sau 126,4 giây. [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44639956006)

Trên `eb9f686770bc5a13c5f77273c1854f3126c818fa`, chạy lại `paired-macos` với câu “Windows chạy bình thường, trên macOS bị lỗi. Dùng Mac của tôi thử đi, nhưng tôi không có tài khoản ChatGPT.” Hai người dùng, quyền harness, planner và reviewer dùng fixture riêng. Máy Windows cục bộ kết nối qua Cloudflare Quick Tunnel đến runner macOS arm64 chuẩn của repo công khai. Runner dùng quyền công cụ thử nghiệm do OIDC xác nhận theo origin, workflow, SHA và ID lượt chạy. Lệnh chẩn đoán trên Mac trả mã 1. Lệnh xác minh sau sửa trả mã 0 và `darwin`. Windows thấy biên nhận xác minh ở trạng thái `stale` trước khi kéo đúng `path-label.cjs`, rồi thấy `passed` sau khi áp dụng file. Hai biên nhận cùng signer, `.env.local` nằm ngoài snapshot và Git remote thử nghiệm giữ nguyên. Mac xác nhận `round-trip-verified`. Bài Windows kết thúc sau 77,8 giây và tunnel được dừng. [CI ghép trực tiếp](https://github.com/dakiemdarktharr/WWW/actions/runs/44685883835)

Lượt mô phỏng dùng runner GitHub chuẩn và Quick Tunnel miễn phí. Các hồi quy `test:sade` kiểm tra hết hạn quyền khi đang chạy lệnh, thu hồi quyền và biên nhận đến sau khi tác vụ đã kết thúc. Hai ca thực địa còn mở gồm Claude và Antigravity với hai chủ tài khoản tự cấp quyền, và một chủ máy Mac xác nhận quyền qua **Join as machine** trên desktop Kivuno. [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Chế độ `paired-macos-desktop` chạy trên `1ea993d9aff645ae932224fcd75331dab58246a5`. Runner mở Electron Kivuno thật trên macOS arm64, dùng danh tính Kivuno Mac mô phỏng, khác danh tính Windows. Bài thử thao tác qua nút **Join as machine** và **Stop connection**. Fixture chỉ cung cấp đường dẫn tệp và phản hồi cho hộp thoại native. Mặc định là **Cancel** và ô cho phép chạy lệnh chưa chọn. Chọn hủy không tạo grant. Chọn cho phép đầy đủ tạo grant 30 phút cho đúng project trong dữ liệu riêng của desktop. Windows đọc được grant đó, tái hiện lỗi với mã 1, xác minh bản sửa với mã 0 và chỉ kéo `path-label.cjs`. Biên nhận xác minh có chữ ký chuyển từ `stale` sang `passed` sau khi Windows nhận đúng file.

Sau khi Windows hoàn tất, bài thử nhấn **Stop connection**, thấy trạng thái **Stopped**, kiểm tra grant đã bị xóa và kết nối lưu trên Mac đã bị tắt. Mac báo `round-trip-verified` và `desktopGrant: removed`. Bài Windows đạt 1/1 sau 207,7 giây và tunnel đã được dừng. Lần đầu ở `8315a46` bị hộp hướng dẫn lần đầu chặn nút **Team**. Lần chạy lại đóng hộp hướng dẫn bằng nút thật. Phép thử xác nhận thời hạn được cấp và thu hồi qua desktop. Việc dừng lệnh khi quyền hết hạn chạy trong nhóm hồi quy riêng. Quyền do một chủ máy Mac thật xác nhận vẫn cần lượt thực địa. [CI ghép qua desktop macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44688823268) · [Lần đầu bị hộp hướng dẫn chặn](https://github.com/dakiemdarktharr/WWW/actions/runs/44688379502)

Chạy lại chế độ `paired-macos-desktop` trên `9d2fc5f` sau khi thêm công cụ Git. Windows đạt 1/1 sau 134,6 giây. Mac tái hiện lỗi đường dẫn, xác minh bản sửa có chữ ký, chuyển đúng file và xác nhận xóa grant sau **Stop connection**. [CI chạy lại ghép macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44690828175)

Lượt `762daaf57427638a4f8dd45443e11b2e02d903f7` lặp lại vòng chẩn đoán, sửa và kéo đúng file, rồi chạy một lệnh Node chẩn đoán vô hại làm đối chứng thu hồi. Electron trên macOS arm64 xác nhận PID còn chạy trước khi chủ Mac mô phỏng bấm **Stop connection**. Tiến trình dừng trước thời điểm tự kết thúc, không tạo mốc hoàn thành, và Mac xóa grant cùng dấu phiên runner. Windows không nhận đầu ra hay chữ ký của lệnh bị dừng, từ chối yêu cầu mới và giữ biên nhận đã ký của lần xác minh trước. Windows chờ hết thời hạn của yêu cầu đang gửi mới báo lỗi kết nối. Bài Windows qua 1/1 sau 227,9 giây và đóng tunnel. [CI Mac và kết quả thu hồi](https://github.com/dakiemdarktharr/WWW/actions/runs/44698551233)

Biên nhận chạy từ máy ghép cặp gắn với mã tác vụ Shared Groups tại lúc gửi. Khi kết quả đến sau gián đoạn, bộ điều phối kiểm tra quyền của cả máy ghép cặp lẫn đúng tác vụ Shared Groups trước khi ghi nhận kết quả đạt. Bài hồi quy chạy Node thật trên máy thử, nhận kết quả có chữ ký qua giao thức runner và mô phỏng lần gửi lại đến sau khi phiên không còn hoặc tác vụ đã được thay. Hai ca đó giữ trạng thái chưa xác nhận. Ca đối chứng mô phỏng quyền của tác vụ còn hiệu lực và xác nhận lưu đúng biên nhận. Chạy riêng bằng `node --import tsx --test --test-name-pattern "delayed signed machine result" tests/runners.test.ts`.

Commit `2907206` qua 79 bài runner và Shared Sade trên Windows cục bộ. CI đạt 445 bài trên Windows, 441 trên Ubuntu và 440 trên macOS arm64, bỏ qua lần lượt một, năm và sáu bài theo hệ điều hành. Cả ba qua bài khôi phục kiểm tra thông thường sau khi hai đầu khởi động lại, ba ca biên nhận Shared Groups và bộ 1.000 tin với planner mô phỏng. macOS qua thêm Electron và Shared Groups. [Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44677367018) · [macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44677367225)

Trên máy thử Windows, `.local/sade-native-live` giữ bản ghi `scoped-native-paired-mac.json`, mã chạy `run-paired-native.source.txt` và lệnh tái lập `run-paired-native.ps1`. Phép đo ghi 104,3 giây từ khi gửi tin nhắn đến khi hoàn tất tích hợp và các kiểm tra cục bộ.

Cùng commit, Windows qua 80 bài liên quan và build. macOS arm64 qua 364 bài, bỏ qua sáu bài theo nền tảng, và đạt build, Electron cùng giao diện Shared Groups. Cả hai qua bộ 1.000 tin dùng kế hoạch mô phỏng. [Bộ kiểm tra đầy đủ trên macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44531356710)

Commit `62f9aa2` đã qua bài kiểm thử ở cả hai đầu. Lượt chạy đầu trên macOS trả mã thoát 1, lượt sau khi sửa trả 0. File `.env.local` trên Windows không vào snapshot. Tiến trình Node trên Mac không nhận biến môi trường provider giả của runner. Windows kéo đúng `path-label.cjs`, chạy lại thành công rồi dùng review độc lập trước khi tích hợp. SHA trên Git remote của project thử giữ nguyên. Cùng commit, `npm run check` trên Windows đạt 300 bài và bỏ qua một bài theo nền tảng, còn giao diện Shared Groups đạt. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44450379635)

Commit `bc04550` của nhánh `codex/sade-shared-groups-verification` chứa các đầu PR #5–#10 tại lúc kiểm chứng. Cùng commit đó chạy trên Windows và macOS arm64. Windows qua bài kiểm tra ban đầu, macOS trả mã 1 vì lỗi tách đường dẫn, rồi trả mã 0 sau khi sửa. Bài kiểm thử xác nhận `.env.local` ở Windows nằm ngoài dữ liệu gửi, kéo đúng `path-label.cjs` vào worktree và chỉ tích hợp sau review độc lập. SHA của Git remote thử nghiệm giữ nguyên. Bên Mac xác nhận giao nhận hai chiều. Kịch bản model dùng fixture giao thức, còn lệnh Node và việc chuyển bản vá chạy trên hai hệ điều hành thật. [Lượt kiểm thử macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44499579242)

Trên cùng mã nguồn, Windows đạt 340 bài khi chạy tuần tự và bỏ qua một bài theo nền tảng. macOS arm64 đạt 335 bài và bỏ qua sáu bài theo nền tảng. Hai bên đều build thành công và qua kiểm thử Electron, giao diện Shared Groups cùng bộ 1.000 tin dùng kế hoạch mô phỏng. [Bộ kiểm tra đầy đủ trên macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44500123122)

Trên Windows, checkout nhánh cần thử và cài dependency bằng `npm ci`. Mở `cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:58173` trong một shell riêng và lấy HTTPS origin từ đầu ra. Dùng cùng nhánh và commit trên GitHub.

```powershell
$env:KIVUNO_CROSS_HOST_ORIGIN = '<HTTPS origin từ cloudflared>'
$env:KIVUNO_CROSS_HOST_PORT = '58173'
# Đặt biến thành '1' để chạy thêm desktop Mac hoặc '0' để dùng runner headless.
$env:KIVUNO_MAC_OWNER_DESKTOP = '1'
$platform = if ($env:KIVUNO_MAC_OWNER_DESKTOP -eq '1') { 'paired-macos-desktop' } else { 'paired-macos' }
$branch = (git branch --show-current).Trim()
$env:KIVUNO_CROSS_HOST_WORKFLOW = "dakiemdarktharr/WWW/.github/workflows/ci.yml@refs/heads/$branch"
$env:KIVUNO_CROSS_HOST_SHA = (git rev-parse HEAD).Trim()
$remote = (git ls-remote --heads origin "refs/heads/$branch").Split()[0]
if ($remote -ne $env:KIVUNO_CROSS_HOST_SHA) { throw 'Windows và GitHub phải dùng cùng commit.' }
$run = gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $branch `
  -f "platform=$platform" -f "paired_origin=$env:KIVUNO_CROSS_HOST_ORIGIN"
if ($LASTEXITCODE -ne 0 -or $run -notmatch '/actions/runs/(\d+)') { throw 'Không tìm thấy lượt chạy Mac.' }
$env:KIVUNO_MAC_RUN_ID = $Matches[1]
node --import tsx --test --test-name-pattern 'two desktop workspaces' tests/shared-sade.test.ts
```

Đối chiếu kết quả trên Windows và ở lượt GitHub Actions đã lưu. Máy Mac nhận quyền thử nghiệm khi token OIDC khớp nhánh, commit, origin và ID lượt chạy. Dừng tunnel khi hai đầu đã kết thúc.

## Kiểm thử 1.000 tin nhắn

`npm run test:shared-sade` chạy 20 tình huống × 10 cặp provider/gói × 5 cách diễn đạt. Có tiếng Việt có dấu, không dấu, người mới, kỹ thuật và chuyên gia song ngữ. Bài test đi qua Shared Groups, database, grant và bộ điều phối thật. Kế hoạch do fixture cung cấp để kiểm tra điều kiện giao việc, review, budget và phục hồi cả khi đầu ra model bị sai. Fixture cấp từ một đến năm lượt Kivuno tùy cặp và tình huống. Nhãn gói dịch vụ và quota của provider được mô phỏng.

Trong 200 tin về review, 80 ca có reviewer được chỉ định trong kế hoạch, còn 120 ca dùng reviewer do Sade chọn. Mỗi ca xác nhận có đúng một lượt review cho diff, chủ thay đổi không gửi được verdict thay reviewer và không có lượt review phát sinh sau khi tích hợp.

850 kế hoạch hợp lệ về cấu trúc đi qua bộ phân giải mã teammate trước khi đến bộ điều phối. Thêm 50 ca chỉ định teammate chưa cấp quyền, xác nhận cả bước phân giải ở desktop và bước kiểm quyền ở bộ điều phối đều từ chối. Các ca chat thường và mất lease giữ cách kiểm thử riêng.

Từ `eb9f686`, dòng `Shared Sade corpus` trong log in số ca đạt theo tình huống, kiểu nhắn và cặp provider/gói. Lượt Windows cục bộ đạt 200/200 cho mỗi kiểu nhắn và 100/100 cho mỗi cặp. Theo tình huống, bàn giao và review đều đạt 200/200. Phạm vi ghi chồng lấn và giao việc theo hệ điều hành đều đạt 150/150. Sáu nhóm còn lại đạt 50/50 mỗi nhóm, gồm thiếu máy đúng hệ điều hành, thiếu quyền, thu hồi, ngân sách lượt, mất kết nối và tin chat. Nhóm ngân sách thử số lượt được cấp trong Kivuno.

| Phép đo                                              | Kết quả                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Shared Groups và bộ điều phối với kế hoạch kiểm soát | 1.000/1.000 yêu cầu đúng hành vi mong đợi                          |
| Qwen3 1.7B Q4_K_M, 5 trường đầu ra                   | 0/1.000 khớp cả 5 trường, p50 412 ms, p95 567 ms                   |
| Qwen3 1.7B Q4_K_M, 1 nhãn đầu ra                     | 310/1.000 khớp, 1 lỗi đầu ra, p50 151 ms, p95 252 ms               |
| Qwen3 4B Instruct 2507 Q4_K_M, 1 nhãn đầu ra         | 162/200 trên mẫu rải đều, không lỗi đầu ra, p50 440 ms, p95 598 ms |

Ở cấu hình một nhãn, kết quả theo cách diễn đạt lần lượt là 86/200 casual, 50/200 không dấu, 29/200 người mới, 86/200 kỹ thuật và 59/200 chuyên gia song ngữ. Mỗi lượt model chỉ đọc tin tổng hợp và phân loại ý định. Các lượt này chưa đo chất lượng lập DAG, sửa code hay review bằng Claude, Gemini, Codex và Antigravity đăng nhập thật. Có thể chạy lại với Ollama đã cài model tại localhost. [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)

```powershell
node --import tsx scripts/eval-shared-sade-local.ts --port 11565 --output .local/shared-sade-baseline.jsonl
node --import tsx scripts/eval-shared-sade-local.ts --port 11565 --categories --output .local/shared-sade-categories.jsonl
```

### Chạy model trên runner CI

Chế độ `sade-eval` của **Verify RELAY** chạy khi được yêu cầu trên repo công khai. Runner Ubuntu tải Ollama 0.40.16 và kiểm tra SHA-256 của gói cài. Sau đó runner kiểm tra digest của Qwen3 4B Instruct 2507 Q4_K_M trước khi chạy trên CPU với một lượt tại một thời điểm. Các bài chỉ đọc chat tổng hợp và không cần tài khoản của thành viên. [Bản phát hành Ollama](https://github.com/ollama/ollama/releases/tag/v0.40.16) · [Runner công khai của GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#standard-github-hosted-runners-for-public-repositories)

`pilot` đo việc lập kế hoạch trên năm ca phương án dự phòng và 18 ca A–D cùng nhóm đối chứng. Lượt này cũng lấy một mẫu 40 tin để đo thời gian phân loại. `corpus` chạy đủ 1.000 tin theo năm phần gồm 200 ID riêng mỗi phần. `contrast` so sánh hai prompt phân loại trên 15 cặp tin viết riêng, mỗi cặp có một yêu cầu làm việc và một cập nhật cho nhóm. Kết quả corpus và contrast đo phân loại ý định. Quyết định cấp quyền, phân công và thực thi theo kế hoạch được chấm ở các bài Shared Groups và luồng A–D riêng.

Mẫu pilot 40 tin trước `eb9f686` chỉ chạm bốn câu gốc do bước lấy mẫu lặp lại theo thứ tự corpus. Bản sửa phủ cả 20 câu gốc với 40 ID khác nhau, đủ 4 tin mỗi cặp provider/gói và 8 tin mỗi kiểu nhắn. Bộ 1.000 ID và mẫu 200 ID giữ nguyên. So sánh kết quả pilot cũ và mới trên cùng ID nếu cần đo thay đổi chất lượng model.

Qwen3 4B Instruct 2507 Q4_K_M đạt 33/40 ở mẫu mới, với 0 lỗi gọi model, p50 3,00 giây và p95 4,11 giây trên CPU. Điểm theo kiểu nhắn là 7/8 casual, 5/8 không dấu, 6/8 người mới, 8/8 kỹ thuật và 7/8 song ngữ. Model nhận đúng 8/8 ca bàn giao và 8/8 ca yêu cầu macOS, gồm ca thiếu máy. Model nhầm một ca tránh sửa chồng với bàn giao, nhầm ba ca review với giới hạn phạm vi hoặc yêu cầu chung, và nhầm cả ba ca ngân sách lượt với bàn giao hoặc giới hạn phạm vi. Artifact `sade-pilot-4` giữ ID, nhãn mong đợi, nhãn model trả về và hash prompt. Thư mục `.local/sade-verification-eb9f686/pilot-sample` của worktree giữ bản tải về và bảng đối chiếu kèm tin gốc cho bảy ca sai. Kết quả dùng để đánh giá offline. Cấu hình planner của Shared Groups vẫn dùng harness đã cấp quyền. [Pilot Qwen](https://github.com/dakiemdarktharr/WWW/actions/runs/44685951210)

Phần lập kế hoạch của cùng lượt Qwen đạt 13/23. A đạt 0/3 do hai kế hoạch giao sai số người ghi và một kế hoạch thiếu dependency đã tham chiếu. B đạt 3/3. C đạt 2/3 và một ca hết thời gian chờ. D đạt 1/3 khi có Mac và 2/3 khi thiếu Mac. Hai kế hoạch có Mac tự thêm review khi thiếu reviewer khả dụng, còn một ca thiếu Mac không gửi lời gọi công cụ. Tin chat đạt 3/3 và nhóm dự phòng theo quota đạt 2/5. Artifact `sade-pilot-0` đến `sade-pilot-3` giữ kế hoạch, lỗi chấm và hash prompt từng ca. Các bản tải về nằm trong `.local/sade-verification-eb9f686/pilot-planner`. Ví dụ, chạy `node --import tsx scripts/eval-shared-sade-planner.ts .local/sade-missing-mac.json --case missing-mac/2 --timeout-ms 120000` ở đúng SHA để thử lại ca thiếu Mac không dấu. [Lượt lập kế hoạch Qwen](https://github.com/dakiemdarktharr/WWW/actions/runs/44685951210)

```powershell
$ref = 'codex/sade-shared-groups-verification'
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $ref -f platform=sade-eval -f sade_suite=pilot
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $ref -f platform=sade-eval -f sade_suite=corpus
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $ref -f platform=sade-eval -f sade_suite=corpus -f sade_intent_prompt=ordered
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $ref -f platform=sade-eval -f sade_suite=contrast
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $ref -f platform=sade-eval -f sade_suite=planner-constraints
```

Khi lượt chạy kết thúc, tải bằng `gh run download <run-id> --repo dakiemdarktharr/WWW --dir .local/sade-ci-results`. Pilot lưu JSON của các kế hoạch và JSONL phân loại mẫu. Corpus lưu năm file JSONL. Mỗi dòng JSONL có ID, digest model, hash prompt, thời gian, đáp án và dự đoán hoặc lỗi. Dùng một thư mục riêng cho từng run để đối chiếu. Artifact CI giữ trong bảy ngày.

```powershell
node --import tsx scripts/summarize-shared-sade-corpus.ts .local/sade-ci-results
```

Lệnh tổng hợp yêu cầu đủ 1.000 ID khác nhau, kiểm tra cùng model và prompt, rồi in số đúng theo cách diễn đạt, tình huống, cặp provider/gói và ma trận nhầm lẫn.

Pilot đầu trên CPU ở commit `0e3c3fa` ghi đủ 23 dòng lập kế hoạch. Sáu ca trả kết quả và đều đạt tiêu chí chấm, gồm một ca giữ người đã chỉ định, một ca chống sửa trùng và bốn ca xác minh hoặc báo thiếu Mac. Mười bốn ca hết thời gian chờ 60 giây. Ba ca chat gặp lỗi kết nối khi runner bị dừng ở phút 20. Lượt này chưa chạy tới mẫu 40 tin. Cấu hình sau chạy năm ca quota, ba phần A–D và mẫu phân loại ở các job riêng, với 120 giây cho mỗi yêu cầu lập kế hoạch. [Pilot đầu và dữ liệu kết quả](https://github.com/dakiemdarktharr/WWW/actions/runs/44539788906)

Trên 15 cặp viết riêng, cùng Qwen 4B chấm đúng 19/30 với prompt ban đầu và 24/30 với prompt có thứ tự ưu tiên. Hai prompt nhận đúng cả hai tin trong lần lượt 4 và 9 cặp. Số tin chỉ cập nhật nhận đúng tăng từ 5/15 lên 12/15. Số yêu cầu làm việc nhận đúng giảm từ 14/15 xuống 12/15. Prompt có thứ tự nhầm hai yêu cầu chung thành chat và một yêu cầu chung thành tránh sửa trùng. Đây là phép đo offline. [Lượt so sánh prompt](https://github.com/dakiemdarktharr/WWW/actions/runs/44543948618)

Chấm lại đầu ra pilot dài hơn phát hiện hai lỗi riêng. Fixture cũ không gửi heartbeat trong lúc chờ model, nên có kế hoạch hợp lệ bị báo hết hạn. Đã thêm heartbeat và kiểm tra một phản hồi mô phỏng đến sau 65 giây vẫn được chấm. Sau khi phát lại đầu ra Qwen, các lỗi model còn thấy gồm bỏ trống trường dự phòng, thấy yêu cầu chỉ đọc nhưng tạo tác vụ ghi, và tách một ca chạy trên Mac ghép cặp thành hai tác vụ. Chế độ `planner-constraints` thử prompt có thêm ba ràng buộc này trên năm ca quota và ca Mac không dấu. Đây là prompt thử nghiệm trong bộ đo.

Các kế hoạch đã lưu ở pilot thứ hai được phát lại sau sửa heartbeat. Nhóm A–D và đối chứng đạt 14/18. B đạt 3/3, C đạt 2/3, D đạt 5/6 tính cả các ca thiếu Mac, A đạt 1/3 và chat đạt 3/3. Nhóm quota đạt 1/5. Một ca C vẫn hết thời gian 120 giây và một ca A tham chiếu tác vụ phụ thuộc chưa khai báo. Phát lại dùng cùng hash prompt và schema, giữ nguyên các đầu ra đã ghi. [Pilot thứ hai và dữ liệu kết quả](https://github.com/dakiemdarktharr/WWW/actions/runs/44544213702)

Lượt corpus đầu dùng Qwen thật và đúng 747/1.000 câu, với 0 lỗi gọi model. Độ trễ CPU là p50 3,02 giây và p95 5,02 giây. Theo cách nhắn, điểm là 159/200 casual, 145/200 không dấu, 154/200 người mới, 153/200 kỹ thuật và 136/200 song ngữ. Ca Mac đạt 200/200 nếu gộp cả thiếu máy. Ca review đạt 73/200. Ca về quota đạt 7/50. [Dữ liệu corpus với prompt ban đầu](https://github.com/dakiemdarktharr/WWW/actions/runs/44542052380)

Trên cùng 1.000 ID và cùng digest model, prompt có thứ tự ưu tiên đạt 557/1.000 và 0 lỗi gọi model. Prompt này sửa được 69 ca mà prompt ban đầu đoán sai và làm sai thêm 259 ca mà prompt ban đầu đoán đúng. Nó nhận nhầm 311 yêu cầu làm việc thành tin chat, so với 10 ca ở prompt ban đầu. Điểm review tăng từ 73/200 lên 99/200, còn điểm Mac giảm từ 200/200 xuống 143/200. Độ trễ quan sát trên các runner CPU là p50 4,60 giây và p95 5,47 giây. [Dữ liệu corpus với prompt có thứ tự ưu tiên](https://github.com/dakiemdarktharr/WWW/actions/runs/44544731216)

Thử riêng prompt lập kế hoạch có thêm ràng buộc tăng điểm quota từ 1/5 lên 3/5. Câu casual và tiếng Anh kỹ thuật giữ tác vụ chỉ đọc và phương án dự phòng. Câu không dấu vẫn tạo hai tác vụ. Câu giao Sade tự chọn lại gắn Claude cố định. Ca Mac không dấu gửi một việc sửa đúng hệ điều hành và thêm một review người gửi chưa yêu cầu, khiến bước giao việc bị chặn. Prompt thử vẫn dùng offline. [Lượt thử prompt lập kế hoạch](https://github.com/dakiemdarktharr/WWW/actions/runs/44546215018)

Cấu hình dùng trong Shared Groups tiếp tục giao lượt lập kế hoạch có cấu trúc cho harness đã được cấp quyền, ưu tiên reasoning cao theo catalog. Bộ điều phối xác thực quyền, scope, quota, thứ tự, người dự phòng và review độc lập trước khi thi hành. Dữ liệu Qwen 4B phù hợp để chấm offline. Tỉ lệ nhận nhầm chat và tác vụ ghi sai ý định khiến model này chưa phù hợp để quyết định giao việc tự động.

### Qwen lập kế hoạch A–D qua công cụ thật

Dùng Qwen3 4B Instruct 2507 Q4_K_M qua Ollama cục bộ và 18 tin tổng hợp. Mỗi tình huống có ba cách nhắn thường, không dấu và kỹ thuật song ngữ. Model nhận prompt và schema của planner. Kế hoạch đi qua bộ kiểm tra của Shared Groups với grant thử nghiệm. Bài chấm đo đúng người, phạm vi file, dependency, số việc review và yêu cầu macOS. Phần thực thi provider, sửa code và quyền trên máy của người dùng được kiểm tra riêng.

| Tình huống                              | Công cụ cũ | Công cụ và prompt mới |
| --------------------------------------- | ---------- | --------------------- |
| A. Đúng hai người và thứ tự bàn giao    | 0/3        | 1/3                   |
| B. Một người ghi vào file được nêu      | 0/3        | 3/3                   |
| C. Review độc lập trong một lượt review | 0/3        | 0/3                   |
| D. Chọn Mac ghép cặp                    | 0/3        | 3/3                   |
| D. Báo thiếu Mac và giữ đúng yêu cầu OS | 0/3        | 3/3                   |
| Chỉ báo tình hình trong Ask Sade        | 3/3        | 2/3                   |
| Tổng số ca đúng                         | 3/18       | 12/18                 |

Công cụ cũ tạo danh sách việc rỗng cho cả 18 tin. Kết quả này lặp lại qua cả chế độ ép JSON và gọi công cụ trực tiếp. Công cụ mới yêu cầu danh sách việc có ít nhất một mục, dành riêng một công cụ để đóng tin không giao việc và xác thực các trường người được chỉ định cùng hệ điều hành. Kết quả mới có 16/18 phản hồi qua được kiểm tra cấu trúc. Các ca còn lại gồm chọn sai người, dependency thiếu, hai kế hoạch thêm bước review dư, một lỗi HTTP 500 từ Ollama và một tin cập nhật bị phân loại thành yêu cầu rồi bị chặn. Điểm số này dùng để cải thiện hợp đồng lập kế hoạch. Cấu hình sản phẩm tiếp tục dùng tài khoản harness đã được cấp quyền.

Chạy Ollama trên `127.0.0.1:11565` với model `qwen3:4b-instruct-2507-q4_K_M`, digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`. Kết quả JSON ghi digest model, hash schema và prompt, từng kế hoạch, trạng thái, lỗi và thời gian. Commit `dfb8edc` giữ phiên bản đối chứng. Chạy cùng lệnh thêm `--native` ở commit đó để kiểm tra lại chế độ gọi công cụ cũ.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-native.json
```

Ở commit `b91a40b`, khi chấm lại cùng 18 đầu ra đã lưu, với cùng digest model, hash prompt và hash bộ công cụ, bộ điều phối mới đạt 14/18. Hai kế hoạch C có review khớp phạm vi đều chạy đúng một lượt review rồi hoàn tất. Ca C gặp HTTP 500 vẫn giữ kết quả lỗi. Bước chấm lại dùng diff tổng hợp và verdict thử nghiệm. Kết quả đo việc dùng lại tác vụ review ở bộ điều phối. Chất lượng tìm lỗi bằng model đăng nhập thật vẫn cần đo riêng. Với bản hiện tại, tạo lại tệp đầu ra khi prompt hoặc schema đã đổi.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-review-replay.json `
  --replay .local/shared-sade-planner-native.json
```

### Tên teammate và sửa lỗi dependency trong lượt lập kế hoạch

Qwen nhận mã teammate ngắn và tên không dấu, sau đó chạy lại đủ 18 ca. Kết quả là 15/18, gồm A 1/3, B 3/3, C 3/3, D 6/6 và tin chỉ báo tình hình 2/3. Ca A có dependency thiếu vẫn lỗi sau khi gửi lại phản hồi công cụ. Ba câu bàn giao giữ riêng đạt 0/3, với hai kế hoạch xếp việc sửa tài liệu vào loại chỉ đọc và một kế hoạch giao sai người. Một biến thể prompt thử đánh số task và nhấn mạnh đường dẫn đạt cả ba ca A của bộ chính, đồng thời chỉ đạt 12/18 do điểm B, C và D giảm. Qwen tiếp tục dùng để đánh giá offline.

Bài hồi quy desktop dùng phiên Gemini mô phỏng để nộp kế hoạch thiếu dependency, nhận lỗi có khóa hợp lệ, rồi nộp lại trong cùng lượt. Chỉ có một lần `turn/start`. Người được giao vẫn phải có quyền trong roster. Phép đo Ollama gửi thông báo lỗi qua `role: tool` trong cùng hội thoại và thử nhiều nhất một lần nếu nhận được lời gọi kế hoạch sai schema hoặc dependency. [Gọi công cụ trên Ollama](https://docs.ollama.com/capabilities/tool-calling)

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-roster-final.json
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-roster-handoff-holdout.json --handoff-holdout
```

### Lập kế hoạch theo hành động

Biểu mẫu mới yêu cầu lập riêng việc tạo đầu ra và việc dùng đầu ra đó. Planner ghi rõ ai làm mỗi việc, file nào được sửa và task nào phải hoàn tất trước. Với yêu cầu tránh hai người sửa cùng một file, prompt yêu cầu một người kiểm tra commit cũ rồi chỉ sửa phần còn thiếu. Với tin chỉ báo tình hình, planner kết thúc mà không cấp lượt thực thi.

| Tập tin nhắn                            | Prompt trước | Prompt và biểu mẫu theo hành động |
| --------------------------------------- | ------------ | --------------------------------- |
| 18 tin tình huống A–D và chat           | 15/18        | 16/18                             |
| 3 câu bàn giao viết riêng               | 0/3          | 2/3                               |
| 6 câu bàn giao có file và assignee khác | 2/6          | 2/6                               |

Qwen đạt B và C 3/3 mỗi tình huống, D 6/6 và chat 3/3. Điểm A trong tập chính vẫn là 1/3. Một câu tạo tác vụ sửa tài liệu ở phạm vi cả project, một câu giao bước frontend như review chỉ đọc. Trong tập sáu câu, còn có kế hoạch thiếu người tạo đầu ra, đảo dependency hoặc gộp hai file vào cùng một việc. Các biến thể ẩn vai trò hoặc nhận tên trực tiếp có ba điểm đúng ở tập sáu câu, đồng thời giảm kết quả ở B và D. Sade giữ mã teammate và chính sách cấp quyền hiện tại. Qwen vẫn dùng offline.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-main.json
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-handoff.json --handoff-holdout
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-varied.json --handoff-varied
```

### Tình huống A có đủ năm đầu việc

Bốn câu mới dùng nhóm mô phỏng có Gemini, Astra, Claude và Antigravity. Mỗi câu giao Gemini viết tài liệu hợp đồng, Astra làm giao diện, rồi để Sade tự chia backend, kiểm thử và review phòng thủ việc lộ email trong thông báo lỗi. Bài chấm kiểm tra đủ năm tác vụ, file được yêu cầu, hai assignee đã chỉ định, các dependency, quyền sửa và reviewer độc lập.

Qwen3 4B cục bộ đạt 0/4. Ba câu cho kế hoạch đã qua schema nhưng sai yêu cầu, gồm thiếu tác vụ, khóa cứng người dùng đã giao Sade tự quyết, hoặc đọc tài liệu thay vì tạo tài liệu. Câu còn lại không sửa được dependency trong lần thử lại. Biểu mẫu thử rút gọn đạt 12/18 ở bộ chính và có một lỗi bộ nhớ Ollama trong bốn câu mới. Một biến thể prompt nhấn mạnh thứ tự và review nhiều file cũng đạt 0/4 ở bộ mới. Sade giữ biểu mẫu hiện tại và dùng Qwen cho đánh giá offline.

Bài hồi quy bộ phân công cho thấy một tác vụ backend chưa chỉ định có thể dùng Claude đang rảnh sau khi giữ việc kiến trúc cho Gemini và frontend cho Astra. Một bài Shared Groups xác nhận profile Claude của chính người đã viết bản sửa không nhận review, dù profile đó có vai trò reviewer.

Trên commit `3fc1d2f`, tôi chấm lại các phản hồi Qwen đã lưu với cùng hash prompt và schema. Tập chính giữ 16/18 và tập năm đầu việc giữ 0/4. Lần chấm lại đi qua bộ điều phối mới bằng dữ liệu đã ghi từ trước.

Sau khi sửa phân công để giữ lượt Windows và reviewer độc lập, chấm lại cùng đầu ra vẫn đạt 16/18 và 0/4. Hai bài hồi quy phân công dùng kế hoạch có đủ tác vụ. Các ca Qwen bỏ sót đầu việc, chọn sai người hoặc khai dependency sai vẫn được tính lỗi.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-full-handoff.json --full-handoff
```

### Kiểm tra một kế hoạch bằng Codex đăng nhập

Chạy hai lượt Codex CLI trên Windows bằng phiên ChatGPT có sẵn và cùng tin nhắn tổng hợp `full-handoff/1`. Cả hai lượt xuất kế hoạch JSON trong thư mục chỉ đọc. Lượt đầu có đủ năm tác vụ nhưng gắn kiểm tra dữ liệu lỗi là nghiên cứu. Vì vậy nó không qua điều kiện review độc lập. Sau khi prompt và schema mô tả rõ mục đích của từng loại việc, lượt thứ hai đạt 1/1. Kế hoạch giữ Gemini làm hợp đồng, Astra hỏi phong cách hoặc đề nghị tự chọn, Sade tự giao backend và test theo dependency, rồi chọn Antigravity mô phỏng cho review độc lập trên hai file nguồn.

Codex nhận prompt và schema hiện hành qua CLI. Kivuno chấm kết quả bằng parser, Shared Groups và grant mô phỏng. Hai lượt chỉ lập kế hoạch và không chạy hành động nhóm. Phần chạy nhiều provider trên tài khoản thật vẫn cần được kiểm chứng.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/codex-plan-prompt.json --full-handoff --case full-handoff/1 --export-prompt
$bundle = Get-Content .local/codex-plan-prompt.json -Raw -Encoding UTF8 | ConvertFrom-Json
$schema = Join-Path (Get-Location).Path '.local/codex-plan-schema.json'
$answer = Join-Path (Get-Location).Path '.local/codex-plan-answer.json'
[IO.File]::WriteAllText($schema, ($bundle.tool.inputSchema | ConvertTo-Json -Depth 35))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only benchmark. Do not execute work, run commands, use tools, or read files. Return the argument object for relay_submit_plan as the final structured response.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema $schema --output-last-message $answer --json -
node --import tsx scripts/eval-shared-sade-planner.ts .local/codex-plan-score.json --full-handoff --case full-handoff/1 --external-plan $answer
```

### Phân biệt chủ tài khoản khi harness trùng tên

Codex CLI đã đăng nhập chạy bốn tin tổng hợp trước và sau khi sửa prompt. Bản cũ đạt 3/4. Khi Gemini của Bình đã được chia sẻ trong nhóm nhưng chưa có quyền cho project, model nhầm thành thiếu thành viên. Bản mới đạt 4/4. Hai câu có đủ thông tin tạo đúng việc viết hợp đồng rồi bàn giao giao diện. Câu có hai Astra hỏi người gửi chọn Bình hay Chi. Câu thiếu quyền yêu cầu Bình cấp quyền cho đúng project. Phần chấm chạy qua Shared Groups với các chủ quyền mô phỏng.

Bài hồi quy xác nhận chỉ người gửi được trả lời câu hỏi và chưa có tác vụ nào được giao trước đó. Khi Bình cấp quyền rồi người gửi trả lời, Sade tiếp tục cùng workflow và giao đúng công việc. Quyền mà Bình cấp cho project khác bị loại khỏi danh sách của lượt lập kế hoạch. Bài kiểm thử hai cửa sổ Shared Groups xác nhận cả hai người nhìn thấy câu hỏi, người gửi có ô trả lời và việc được giao hiển thị tên chủ harness.

```powershell
$case = 'owner/ungranted'
node --import tsx scripts/eval-shared-sade-planner.ts .local/owner-prompt.json --owner-handoff --case $case --export-prompt
$bundle = Get-Content .local/owner-prompt.json -Raw -Encoding UTF8 | ConvertFrom-Json
$schema = Join-Path (Get-Location).Path '.local/owner-schema.json'
$answer = Join-Path (Get-Location).Path '.local/owner-answer.json'
[IO.File]::WriteAllText($schema, ($bundle.decisionSchema | ConvertTo-Json -Depth 45))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only benchmark. Do not execute work, run commands, use tools, or read files. Return the action you would take and its arguments as the final structured decision.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema $schema --output-last-message $answer --json -
node --import tsx scripts/eval-shared-sade-planner.ts .local/owner-score.json --owner-handoff --case $case --external-decision $answer
```

### Phân biệt tin báo tình hình và yêu cầu làm việc

GPT-6-Luna với reasoning `high` qua Codex CLI đã đăng nhập đạt 8/8 trên bốn cặp tin nhắn tổng hợp. Trong mỗi cặp, hai câu dùng cùng tên harness và file. Câu chỉ trích lại yêu cầu cũ, chờ người gửi xác nhận, báo tiến độ hoặc nhắc ví dụ chạy Mac đều kết thúc với 0 tác vụ. Câu giao việc tương ứng chọn đúng người và file. Ca chỉ đọc giữ quyền chỉ đọc. Ca chạy Mac giữ yêu cầu macOS và máy ghép cặp. Shared Groups chấm đầu ra với grant mô phỏng.

Bài thử desktop cũng tái hiện việc lời gọi lập kế hoạch đến sau có thể ghi đè kết quả báo tình hình trong cùng lượt. Sau bản sửa, lời gọi đó bị từ chối và nhóm vẫn thấy workflow kết thúc với 0 tác vụ. Các ca nộp lại cùng kết quả, nộp kế hoạch hợp lệ sau lỗi cấu trúc và đổi verdict sau khi reviewer đã nộp đều có bài hồi quy.

Dùng lệnh xuất và chấm cấu trúc `decisionSchema` ở mục trên với `--intent-contrasts` thay cho `--owner-handoff`. Chọn một trong các ca `intent/quoted-update`, `intent/quoted-request`, `intent/deferred`, `intent/confirmed`, `intent/status`, `intent/read-only`, `intent/mac-status`, `intent/mac-request`. Lệnh Codex trong phép thử dùng `-m gpt-6-luna -c "model_reasoning_effort='high'"`.

### Qwen review bản vá chức năng

Phép đo dùng Qwen3 4B Instruct 2507 Q4_K_M qua Ollama cục bộ, temperature 0 và seed 7013. Sáu cặp chính và ba cặp bổ sung đều có một bản đúng và một bản lỗi. Script chạy input mẫu trên các hàm có sẵn để xác nhận đáp án, rồi gửi diff qua prompt và schema review của Sade. Model đọc diff. Shared Groups ghi verdict bằng hai chủ quyền mô phỏng và kiểm tra trạng thái tích hợp trong SQLite. Luồng Git thật được kiểm tra riêng trong các bài workspace.

| Prompt và tập bản vá                  | Phát hiện bản lỗi | Duyệt bản đúng | Trạng thái tích hợp khớp verdict |
| ------------------------------------- | ----------------- | -------------- | -------------------------------- |
| Chỉ gửi diff, sáu cặp chính           | 6/6               | 1/6            | 12/12                            |
| Có yêu cầu và tiêu chí, sáu cặp chính | 5/6               | 6/6            | 12/12                            |
| Cùng prompt mới, ba cặp bổ sung       | 3/3               | 0/3            | 6/6                              |

Qwen bỏ sót điều kiện giảm giá tại đúng ngưỡng trên tập chính. Ở ba cặp bổ sung, Qwen chặn cả ba bản đúng vì suy diễn thêm yêu cầu hoặc đọc sai tác dụng của hàm. Có lượt yêu cầu sửa đúng nhưng giải thích một phần sai, như nêu kết quả làm tròn về 0 của `-1.7` là `-2`. Điểm trong bảng tính theo quyết định duyệt hoặc yêu cầu sửa. Phép đo trạng thái xác nhận Sade thi hành quyết định model đã gửi, kể cả quyết định sai. Sade giữ chính sách chọn reviewer theo quyền và catalog. Qwen dùng để đo offline.

Chạy từ hai commit khác nhau để so sánh prompt. Bản chỉ gửi diff nằm ở commit `28eb3e7`. Dùng `--holdout` ở bản mới để chạy ba cặp bổ sung. Cả hai dùng Ollama cục bộ tại `127.0.0.1:11565` với model `qwen3:4b-instruct-2507-q4_K_M`. Báo cáo JSON lưu digest model và hash prompt của từng ca.

```powershell
node --import tsx scripts/eval-shared-sade-review.ts .local/shared-sade-review-main.json
node --import tsx scripts/eval-shared-sade-review.ts .local/shared-sade-review-holdout.json --holdout
```

### Tình huống C với Codex đã đăng nhập

Catalog của tài khoản ChatGPT trên Windows có GPT-6-Luna và mức reasoning `high`. Chính sách Sade chọn cấu hình đó cho ca review logic tính giảm giá. Hai lượt chỉ đọc qua Codex CLI dùng cùng yêu cầu và hai bản vá tổng hợp. Bản lỗi dùng `>` và trả 0 ngay tại ngưỡng chi tiêu. Model chỉ đúng trường hợp đó và yêu cầu sửa. Model duyệt bản dùng `>=` trả 10. Shared Groups nhận hai verdict qua grant thử nghiệm, giữ bản lỗi ở trạng thái chặn và chỉ cấp digest để tích hợp bản đúng. Cả hai lượt đều đọc diff mà không chạy mã.

Kiểm thử tiếp theo giao chính công việc review qua Shared Groups và worker desktop tới Codex App Server 0.166.0 đã đăng nhập trên Windows. GPT-6-Luna với reasoning `high` gọi `relay_submit_shared_review` cho cả hai bản vá. Bản dùng `> 50` bị chặn với kết quả thực tế 0 thay vì 10 ở ngưỡng 50. Bản dùng `>= 50` được duyệt và cấp đúng digest trước khi fixture xác nhận tích hợp. Cả hai lượt dùng worktree thử nghiệm và giữ nguyên nhánh Git. Bên Gemini tạo kế hoạch và bản vá bằng fixture. Hai tài khoản nhóm được tạo cho bài thử.

Sau khi sửa thời hạn giữ workflow, tôi chạy lại hai bản vá theo thứ tự trên trong cùng nhóm và project. Ngay sau verdict yêu cầu sửa, máy chủ nhận tin nhắn thứ hai với cùng hai grant. Codex App Server duyệt bản sửa và máy chủ xác nhận quyền tích hợp của đúng diff. Mỗi lượt review có tiến trình App Server riêng, dùng tài khoản Codex đã đăng nhập trên máy thử. Bản ghi ở `.local/sade-native-live/native-review-same-group-retry.json` và mã chạy lại ở `run-review-retry.source.txt`.

Codex App Server có thể cung cấp connector của tài khoản trong phiên chỉ đọc. Phiên Shared Groups tắt Apps, plugin, hook và các MCP server đã cấu hình, sau đó kiểm tra danh mục công cụ và tài nguyên theo đúng mã phiên trước khi gửi lượt. Phép đo trên máy thật xác nhận phiên Shared Groups có danh mục MCP trống và phiên cá nhân trong cùng tiến trình giữ danh mục của tài khoản. Desktop hoặc máy chạy harness cũ cần hỗ trợ bước xác nhận này. [Phạm vi của Apps trong Codex](https://learn.chatgpt.com/docs/config-file/config-reference#configuration-reference)

Chạy ca hồi quy bằng `node --import tsx --test tests/codex.test.ts tests/shared-sade.test.ts`. Bản ghi hai lượt App Server thật nằm trong các tệp `scoped-native-review-defect.json` và `scoped-native-review-clean.json` ở `.local/sade-native-live` trên máy thử. Tệp `run-review.source.txt` trong cùng thư mục chứa mã chạy lại từng biến thể.

Cùng App Server trên Windows, một câu tiếng Việt kiểu casual chạy phần bàn giao của ví dụ A. Shared Groups giao lượt lập kế hoạch thật cho GPT-6.2-Sol với reasoning `high`. Model gọi `relay_submit_plan` để giao `docs/contract.md` cho Gemini của An và `src/form.ts` cho Astra của Bình, kèm phụ thuộc giữa hai file và yêu cầu Astra hỏi về phong cách. Sade giao bước hợp đồng trước và giữ bước giao diện chờ. Gửi lại cùng mã tin nhắn vẫn chỉ có một tin và một workflow. Hai harness nhận việc dùng fixture. Bản ghi nằm ở `.local/sade-native-live/scoped-native-handoff.json`, với mã chạy lại trong `run-handoff.source.txt`.

Ở ví dụ B, tin casual nêu mã commit thật của hợp đồng đã có và yêu cầu chỉ viết test ở `tests/form.test.ts`. GPT-6.2-Sol lập kế hoạch qua Shared Groups và mã công cụ của App Server. Bước của Gemini bên An chỉ đọc `docs/contract.md`. Bước của Astra bên Bình có đúng một file được phép ghi và chờ báo cáo của Gemini. Sade mở bước test sau khi fixture xác nhận bước đọc đã hoàn tất. Git giữ nguyên commit ban đầu. Hai harness nhận việc dùng fixture. Bản ghi và mã chạy lại nằm trong `.local/sade-native-live/scoped-native-reuse.json` và `run-reuse.source.txt`.

Windows qua 107 ca liên quan và build trên mã ứng dụng của `667e316`. macOS arm64 qua 359 ca, bỏ qua sáu ca theo nền tảng, rồi qua Electron, giao diện Shared Groups và kiểm tra dependency. Bộ 1.000 tin nhắn dùng phản hồi planner mô phỏng tiếp tục đạt trên cả hai hệ điều hành. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44523780317)

Ở commit `d0f6c25`, Windows qua 74 ca Git và Shared Groups cùng build. macOS arm64 qua 364 ca và kiểm thử Electron, gồm việc bàn giao commit cũ khi nhánh remote đã tiến thêm. Hai hệ điều hành tiếp tục qua bộ 1.000 tin nhắn với planner mô phỏng. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44527498309)

Một bài hồi quy desktop tái hiện việc tiêu chí bảo mật của tác vụ gốc bị bỏ khỏi khâu chọn model cho review. Desktop giờ đưa yêu cầu đã gửi đến reviewer vào thông tin chọn model và đặt scope của review theo danh sách file trong diff. Review thường vẫn dùng model nhẹ có reasoning cao. Khi yêu cầu có tiêu chí bảo mật, chính sách dùng model mặc định của catalog với reasoning cao nếu hỗ trợ.

Chạy từ repo bằng tài khoản ChatGPT đã đăng nhập. Chọn một variant mỗi lần để tái lập đúng bản vá. Tệp điểm ghi hash prompt và digest bản vá dùng để đối chiếu với bản xuất.

```powershell
$variant = 'defect'
$base = Join-Path (Get-Location).Path ".local/codex-review-$variant"
node --import tsx scripts/eval-shared-sade-review.ts "$base-prompt.json" --case discount --variant $variant --export-prompt
$bundle = Get-Content "$base-prompt.json" -Raw -Encoding UTF8 | ConvertFrom-Json
[IO.File]::WriteAllText("$base-schema.json", ($bundle.tool.inputSchema | ConvertTo-Json -Depth 35))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only review benchmark. Inspect only the supplied data. Do not run commands, use tools, read project files, or make changes. Return the argument object for relay_submit_shared_review as the final structured response.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -m gpt-6-luna -c "model_reasoning_effort='high'" -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema "$base-schema.json" --output-last-message "$base-verdict.json" --json -
node --import tsx scripts/eval-shared-sade-review.ts "$base-score.json" --case discount --variant $variant --external-verdict "$base-verdict.json"
```

### Reasoning cho tin nhắn có nhiều đầu việc

Đo `gpt-6-luna` qua Codex CLI đã đăng nhập ChatGPT trên bốn biến thể bàn giao đủ năm đầu việc và hai ca về quyền. Mỗi prompt được gửi một lần ở `low` và một lần ở `high`, xen kẽ thứ tự. Prompt mới yêu cầu tách bước thêm test khi người gửi đặt nó sau triển khai, ghi cả hai lựa chọn phong cách và để Sade phân công mọi việc chưa chỉ định người.

| Prompt | Reasoning | Ca đúng | Trung vị thời gian CLI | Trung vị output token |
| ------ | --------- | ------: | ---------------------: | --------------------: |
| Trước  | `low`     |     1/6 |              12,6 giây |                 490,5 |
| Trước  | `high`    |     3/6 |              22,1 giây |                 972,5 |
| Mới    | `low`     |     4/6 |              12,6 giây |                 489,5 |
| Mới    | `high`    |     6/6 |              21,4 giây |                 982,5 |

Ba ca chưa dùng để sửa prompt cũng đạt với `high`. `Low` vẫn tự chọn một người khi hai harness cùng tên phù hợp và bỏ sót lựa chọn để người gửi cung cấp phong cách ở một ca. Bộ chấm nhận cách mời người gửi chọn giữa hai phương án. Toàn bộ đầu ra cũ và mới được chấm lại bằng cùng quy tắc, với hash prompt và bộ công cụ đối chiếu cho mỗi ca.

Dùng lệnh xuất và chấm bên trên với `--full-handoff --case full-handoff/1` đến `full-handoff/4`, rồi `--owner-handoff --case owner/ambiguous` và `owner/ungranted`. Đổi cấu hình Codex giữa `model_reasoning_effort='low'` và `model_reasoning_effort='high'`. Kiểm tra bổ sung dùng `--handoff-varied` với `handoff/varied-1` và `handoff/varied-5`, cùng `--owner-handoff --case owner/named`. Đọc `turn.completed` trong JSONL để lấy số token. Các lượt chỉ lập kế hoạch trên dữ liệu tổng hợp. Thời gian gồm khởi chạy CLI và có cả lượt dùng cache. [OpenAI Reasoning](https://developers.openai.com/api/docs/guides/reasoning)

Bài hồi quy desktop gửi tin 8.000 ký tự cùng danh sách 32 harness và xác nhận planner nhận đủ nội dung. Nội dung do Sade ghép đi qua giới hạn dành cho phiên đã có quyền thực thi. Giới hạn nhập chat thường vẫn là 16.000 ký tự.

### Tin mới tham chiếu đến tin trước

Bài hồi quy đưa một câu “cái đó tui đã commit rồi” qua Shared Groups và kiểm tra một tác vụ chỉ đọc cho chủ harness còn lại. Bài kiểm tra cũng bao gồm gửi lại cùng ID, khác nhóm, khác project, giữ nguyên số lượt trên desktop cũ, và lọc một chuỗi giống khóa API khỏi bản gửi cho planner. Bài giao diện dùng hai tài khoản Kivuno mô phỏng để chọn, gỡ và gửi lại tin tham chiếu, rồi xác nhận tin đã chọn chỉ đi vào các lượt lập kế hoạch. Ở `8cbc660`, Windows đạt 438 bài, Ubuntu đạt 434 và macOS arm64 đạt 433. Bỏ qua lần lượt một, năm và sáu bài theo hệ điều hành. [Windows và Ubuntu](https://github.com/dakiemdarktharr/WWW/actions/runs/44667698069) · [Electron và Shared Groups trên macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44667698524)

Qwen3 4B Instruct ở lượt đầu đạt 3/4 trên bộ ca riêng. Nó đọc đúng file và commit nhưng giao nhầm người trong câu không dấu. Lượt thử câu lệnh cho model đối chiếu tên đạt 3/5. Một câu không dấu bị hiểu thành báo tình hình. Câu mới yêu cầu Bếp đọc, trong khi tin cũ nhắc đến Mây, bị giao cho Mây. Bản tiếp theo đưa các mã harness có tên khớp ngay đầu tin mới vào dữ liệu của planner. So khớp theo tên gốc và tên không dấu trong danh sách có quyền, phân biệt “Mây” với “mày” có dấu. Prompt yêu cầu lập tác vụ cho yêu cầu chỉ đọc và hỏi lại nếu có nhiều tên trùng. [Lượt đầu](https://github.com/dakiemdarktharr/WWW/actions/runs/44667697825) · [Lượt thử prompt](https://github.com/dakiemdarktharr/WWW/actions/runs/44668403551)

Ở `a064d0b`, model đạt 4/5 và giao đúng người trong cả hai ca không dấu. Ca còn lỗi nêu đúng `docs/contract.md` và commit `4107e5e` trong mô tả nhưng dùng phạm vi đọc `.`. Prompt bổ sung cách ghi đường dẫn file được tham chiếu vào trường phạm vi và ghi mã commit vào mô tả hoặc điều kiện nghiệm thu. [Lượt chấm với dữ liệu đối chiếu tên](https://github.com/dakiemdarktharr/WWW/actions/runs/44669278899)

Ở `52364fd`, Qwen đạt 5/5. Bốn yêu cầu đọc giữ đúng file, commit và người nhận. Tin báo tình hình không tạo tác vụ dù tin tham chiếu chứa yêu cầu sửa file. Thời gian mỗi ca trên CPU runner từ 32,5 đến 99,6 giây. Cùng commit, macOS arm64 đạt 433 bài, bỏ qua sáu bài theo nền tảng, rồi qua Electron và giao diện Shared Groups. Bộ 1.000 tin với kế hoạch mô phỏng thuộc lượt kiểm tra đó. [Kết quả Qwen](https://github.com/dakiemdarktharr/WWW/actions/runs/44670144695) · [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44670144393)

Chạy lại phép đo bằng Ollama tại `127.0.0.1:11565` với model `qwen3:4b-instruct-2507-q4_K_M`. Kết quả ghi hash prompt, digest model, quyết định từng ca và thời gian. Qwen lập kế hoạch trên tin tổng hợp, Shared Groups nộp kế hoạch và kiểm tra người nhận, phạm vi và trạng thái bằng fixture.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/referenced-requests.json --referenced-requests --timeout-ms 120000
```

## Cấu hình dùng trong Shared Groups

Dùng một lượt lập kế hoạch từ harness đã cấp quyền của người gửi. Schema yêu cầu nhiệm vụ, scope, phụ thuộc và điều kiện hoàn tất. Bộ điều phối quyết định quyền, hệ điều hành, số lượt và thứ tự thực thi. Chính sách chọn model đọc loại tác vụ, mô tả và effort từ kế hoạch. Lượt lập kế hoạch ưu tiên reasoning cao trong catalog của tài khoản. Tác vụ thường có thể dùng reasoning trung bình, và review thường ưu tiên model nhỏ hỗ trợ reasoning cao. Bài kiểm thử giao thức xác nhận ba lựa chọn này khi catalog cung cấp đủ mức. Có thể xem model và reasoning được chọn trên desktop. Qwen dùng để đánh giá offline.

## Huấn luyện Qwen trên máy

### Đối chiếu Qwen 0,6B với bộ phân loại CPU

Bài này đo hai nhãn, yêu cầu làm việc và tin chỉ để trao đổi. Cấu hình CPU được chọn ở commit `b4b9dee` bằng 90 tin hiệu chỉnh, rồi mới viết tập chấm gồm 24 cặp câu với ba cách diễn đạt. Hai câu trong một cặp nói về cùng tình huống nhưng chỉ một câu yêu cầu hành động. Tập chấm có 144 tin, gồm 72 yêu cầu và 72 tin trao đổi. SHA-256 của `final.jsonl` là `a036295b7716cf3a6eb4c4e44df31381548ec08aa97ca822c2337ef754e67a8d`.

Ứng viên CPU dùng hồi quy logistic trên từ và cặp từ sau khi bỏ dấu. Cấu hình được chọn dùng 240 tin từ 40 cặp bối cảnh và có 1.574 trọng số. Nó đạt 83/90 trên tập hiệu chỉnh, so với 72/90 khi thêm 1.000 tin gốc và cân bằng theo câu nguồn. Trên tập chấm mới, tiến trình đánh giá CPU đạt p50 0,009 ms, p95 0,015 ms cho mỗi tin và dùng đỉnh khoảng 109 MiB RSS trong lần chạy ghi báo cáo. Lượt chấm Qwen nạp lại đúng LoRA 0,6B đã lưu trên RTX 5050 Laptop GPU và đọc hai tập gồm tổng cộng 288 tin trong 38,6 giây, tính cả nạp model.

| Phép đo trên 144 tin mới      |   CPU | Qwen 0,6B LoRA |
| ----------------------------- | ----: | -------------: |
| Đúng tổng cộng                |   122 |            105 |
| Yêu cầu làm việc bị bỏ sót    |     6 |             30 |
| Tin trao đổi bị nhận nhầm     |    16 |              9 |
| Đúng ở kiểu nói tự nhiên      | 42/48 |          36/48 |
| Đúng ở kiểu không dấu         | 42/48 |          31/48 |
| Đúng ở kiểu song ngữ          | 38/48 |          38/48 |
| Đúng cả hai tin trong một cặp | 51/72 |          34/72 |

Một nguồn lỗi CPU là cụm từ hành động xuất hiện trong lời kể. Ví dụ, câu “tui định tự làm mục lục ngắn tối nay” bị nhầm với yêu cầu giao trợ lý làm mục lục. Ngưỡng chọn để đạt 0 tin trao đổi bị gợi ý sai trên tập hiệu chỉnh vẫn nhầm 8 trong 72 tin trao đổi ở tập mới. Khi mô phỏng gọi Qwen chỉ cho 65 tin CPU vượt ngưỡng và gợi ý nếu cả hai đồng ý, 36 yêu cầu được gợi ý và cả 36 đều đúng. Phương án đó bỏ sót 36 yêu cầu. Cấu hình Shared Groups tiếp tục dùng **Ask Sade** để xác nhận ý định và một lượt lập kế hoạch trên harness đã cấp quyền.

Bộ 1.000 tin gốc vẫn là bài kiểm thử giao thức có 20 câu nguồn. Với các nhãn gộp `work` và `chat`, CPU đúng 781/1.000, bỏ sót 219 yêu cầu và nhận đúng 50 tin trao đổi. Đọc lại kết quả Qwen 4B đã lưu cho riêng hai nhãn này cho 990/1.000, còn kết quả đầy đủ với các trường điều phối là 747/1.000. Số liệu từ hai phép chấm đo hai đầu ra khác nhau. [Kết quả Qwen 4B gốc](https://github.com/dakiemdarktharr/WWW/actions/runs/44542052380)

```powershell
$dataset = '.local/sade-intent-eval'
node --import tsx scripts/sade-qwen-dataset.ts $dataset --contrastive --context-pairs
node --import tsx scripts/eval-shared-sade-intent.ts $dataset
```

Để chấm lại cùng adapter trên Windows, dùng Python trong môi trường PyTorch CUDA và thư mục model cục bộ có `base-0.6b`. Adapter epoch 2 có SHA-256 `bc9cc3f75a365c044c37027e020b20bc9a840141b3617c521eea6f75e6f3c216`. Script dùng lại bộ đệm CPU 16 MiB để nạp lần lượt các trọng số BF16 vào GPU.

```powershell
$qwen = '.local/sade-qwen'
$adapter = "$qwen/action-intent-0.6b-context-pairs-v2-full/epoch-2"
python scripts/train-sade-qwen.py --root $qwen --data-dir $dataset --adapter $adapter `
  --action-intent --size 0.6b --batch 1 --acceptance "$dataset/final.jsonl" `
  --output "$dataset/qwen-replay"
node --import tsx scripts/eval-shared-sade-intent.ts $dataset "$dataset/qwen-replay/acceptance.json"
```

### Phân loại sáu ý định với Qwen 1,7B

Bài thử LoRA chỉ học phân loại một trong sáu ý định. Dữ liệu huấn luyện được lấy mẫu cân bằng từ bộ 1.000 tin nhắn tổng hợp. Tập chấm có 144 tin nhắn từ 48 câu gốc viết riêng. Script giữ nguyên trọng số nền và so sánh model trước và sau train trên cùng prompt, cùng tập chấm. Quyền, quota và lịch của Sade vẫn do bộ điều phối quyết định. [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) · [PEFT LoRA](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)

Chạy bằng Python 3.11, PyTorch 2.10.0 CUDA 12.8, Transformers 4.57.6, Accelerate 1.12.0 và PEFT 0.18.1. Lưu bản Qwen3-1.7B revision `70d244cc86ccca08cf5af4e1e306ecf908b1ad5e` ở `.local/sade-qwen/base`. Các lần train dùng thư mục đầu ra khác nhau. [Bản PyTorch cho Windows](https://pytorch.org/get-started/previous-versions/)

```powershell
node --import tsx scripts/sade-qwen-dataset.ts
python scripts/train-sade-qwen.py --root .local/sade-qwen --output .local/sade-qwen/experiment-1
```

Checkpoint dùng định dạng Safetensors. `metrics.json` ghi phiên bản model, seed, dấu vân tay dữ liệu, đỉnh VRAM, kết quả theo nhãn và ID mẫu dự đoán sai. Trọng số và log nằm trong `.local` trên máy thử.

Trên RTX 5050 Laptop 8 GB, lần chạy thành công dùng LoRA rank 8, 350 mẫu, hai epoch và 176 bước. Tổng thời gian là 82,9 giây, tính cả nạp model và chấm. Bộ cấp phát PyTorch giữ đỉnh 3.916 MiB VRAM (`max_memory_reserved`). Trình nạp đọc từng tensor để tránh lỗi truy cập bộ nhớ khi nạp shard trên Windows.

| Cùng tập chấm 144 mẫu            | Kết quả         |
| -------------------------------- | --------------- |
| Qwen3 1.7B trước train           | 45/144 (31,25%) |
| Qwen3 1.7B + LoRA                | 108/144 (75%)   |
| Nạp adapter từ file rồi chấm lại | 108/144 (75%)   |

Điểm theo ý định gồm chạy trên Mac 23/24, bàn giao 22/24, review 21/24, tránh sửa trùng 17/24, yêu cầu chung 16/24 và chat không giao việc 9/24. Điểm tiếng Việt không dấu là 30/48. Hạn chế lớn nhất là nhận ra yêu cầu không chạy AI. Cấu hình chạy hiện tại dùng lựa chọn **Ask Sade** của người gửi và các kiểm tra quyền của bộ điều phối. Adapter hiện dùng cho đánh giá offline.

```powershell
python scripts/train-sade-qwen.py --root .local/sade-qwen --adapter .local/sade-qwen/experiment-3/epoch-2 --output .local/sade-qwen/recheck-epoch-2
```

### Phân biệt trò chuyện với yêu cầu làm việc

Thử nghiệm thứ hai tăng độ đa dạng bằng 20 cặp bối cảnh giống nhau nhưng khác ý định. Một tin trong mỗi cặp yêu cầu hành động, tin còn lại là cập nhật cho người trong nhóm. Mỗi cặp được diễn đạt theo ba kiểu. Tập chấm cũ giữ nguyên từng byte. Tập mới gồm 15 cặp viết riêng theo cùng ba kiểu, tổng cộng 90 tin. Mỗi lần chấm tính đúng cả cặp khi model nhận đúng loại việc và nhận đúng tin chat trong cùng kiểu diễn đạt.

| Phép đo                                   | LoRA cũ | LoRA với dữ liệu theo cặp |
| ----------------------------------------- | ------- | ------------------------- |
| Phân loại đúng trên tập 144 tin cũ        | 108/144 | 98/144                    |
| Nhận đúng chat trên tập cũ                | 9/24    | 22/24                     |
| Yêu cầu bị nhận nhầm là chat trên tập cũ  | 0/120   | 28/120                    |
| Phân loại đúng trên tập 90 tin mới        | 38/90   | 64/90                     |
| Nhận đúng chat trên tập mới               | 4/45    | 35/45                     |
| Yêu cầu bị nhận nhầm là chat trên tập mới | 2/45    | 6/45                      |
| Đúng cả hai tin trong mỗi cặp mới         | 3/45    | 23/45                     |

Lượt train dùng cùng model nền, prompt và seed. Dữ liệu đầu vào gồm 1.120 dòng, trong đó script lấy 360 dòng cân bằng theo nhãn để train hai epoch. Tổng thời gian 85,6 giây, gồm nạp model và chấm cả hai tập. Bộ cấp phát PyTorch giữ đỉnh 3.916 MiB VRAM. Do số yêu cầu bị bỏ sót tăng, hai adapter tiếp tục dùng để đánh giá offline. Shared Groups dùng thao tác **Ask Sade** để xác nhận ý định.

Nạp lại checkpoint epoch 2 cho cùng dự đoán trên cả 234 tin của hai tập chấm. Kết quả từng tập được ghi vào `metrics.json`, `reloaded.json` và `challenge.json` trong các thư mục đầu ra tương ứng.

```powershell
node --import tsx scripts/sade-qwen-dataset.ts .local/sade-qwen/contrastive --contrastive
$data = '.local/sade-qwen/contrastive'
python scripts/train-sade-qwen.py --root .local/sade-qwen --data-dir $data `
  --challenge "$data/challenge.jsonl" --adapter .local/sade-qwen/experiment-3/epoch-2 `
  --output .local/sade-qwen/contrastive-prior-recheck
python scripts/train-sade-qwen.py --root .local/sade-qwen --data-dir $data `
  --challenge "$data/challenge.jsonl" --output .local/sade-qwen/contrastive-trial-recheck
```
