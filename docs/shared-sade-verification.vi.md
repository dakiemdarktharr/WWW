# Sade trong Shared Groups

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở phần **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Mỗi quyền áp dụng cho một harness trên máy của chủ tài khoản, hết hạn sau một giờ và giới hạn từ một đến mười lượt. Quyền này cũng cấp lượt cho công việc của nhóm khi provider không báo quota. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff đã lọc cho người kiểm tra.

Người gửi chọn **Ask Sade** và gửi một tin nhắn để lập kế hoạch. Sau khi gửi thành công, ô soạn quay về chế độ gửi tin nhóm thông thường. Nếu người gửi chỉ báo tình hình qua **Ask Sade**, planner có thể kết thúc bằng một thao tác riêng, kèm lời giải thích. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời. Nếu harness cần biết phong cách giao diện, người gửi có thể chọn phong cách hoặc nhờ harness quyết định. Nhiệm vụ tiếp tục trong lượt được cấp tiếp theo. Gửi lại cùng tin nhắn không lập thêm workflow.

Planner nhận mã ngắn cho từng teammate cùng tên gốc và tên không dấu khi khác nhau. Desktop đối chiếu mã với roster của lượt lập kế hoạch và chuyển về ID quyền đã cấp trước khi nộp kế hoạch. Mã ngoài roster bị từ chối. Kế hoạch tham chiếu dependency không tồn tại trả về các khóa đã khai báo để harness có thể sửa trong cùng lượt. Việc phân công chỉ bắt đầu khi kế hoạch hợp lệ.

Biểu mẫu lập kế hoạch gọi rõ hành động sửa file, sửa thiết kế, nghiên cứu chỉ đọc và review chỉ đọc. Sửa tài liệu là tác vụ sửa file. Sade chuyển các tên hành động về loại tác vụ nội bộ trước khi áp dụng quyền đã cấp và yêu cầu hệ điều hành.

Khi chia việc, Sade tính khối lượng của các tác vụ đã chỉ định trước khi chọn harness cho việc còn trống. Với tác vụ review trong kế hoạch, Sade lần theo cả các bước phụ thuộc gián tiếp và loại profile của chủ tài khoản đã nhận quyền ghi vào các file thuộc phạm vi review. Người chỉ chạy test hoặc viết file ngoài phạm vi đó vẫn đủ điều kiện. Sade kiểm tra lại trước khi giao một lượt review đã được lập từ bản cũ.

Trước khi giao việc, Sade thử phương án phân công khác nếu lựa chọn ban đầu làm mất người review độc lập hoặc lấy mất lượt cuối dành cho tác vụ chỉ chạy trên một hệ điều hành. Tác vụ đã chỉ định người vẫn giữ nguyên phân công. Hai bài hồi quy dùng grant và ngân sách thử nghiệm. Bài thứ nhất giữ Gemini làm hợp đồng, giao thêm backend cho chủ harness làm frontend để Gemini còn đủ điều kiện review cả hai file nguồn. Bài thứ hai giao việc đọc cấu hình sang Mac để dành lượt Windows cho bài kiểm tra mở app.

Trong **Sade progress**, người gửi yêu cầu, chủ nhóm và chủ harness đang chạy có thể chọn **Update task**. Codex nhận tín hiệu trong lượt hiện tại. Gemini, Claude và Antigravity đọc chỉ đạo qua công cụ Kivuno trong cùng lượt. Phạm vi, quyền và số lượt đã cấp tiếp tục áp dụng. Nhóm thấy số chỉ đạo đã được chuyển đến harness. Nếu lượt kết thúc khi còn chỉ đạo chưa đọc, Sade giữ thay đổi trong worktree và chặn việc giao nhiệm vụ tiếp theo.

Shared Groups nhận một workflow đang hoạt động cho mỗi nhóm hoặc project. Bài hồi quy dùng hai người gửi và xác nhận tin yêu cầu thứ hai bị từ chối khi tác vụ ghi đang chạy. Sau khi tác vụ kết thúc, cùng ID tin nhắn có thể được gửi lại để mở workflow mới.

Kivuno dùng tài khoản provider đã đăng nhập trên desktop của từng chủ quyền. Máy chủ nhận ID quyền, thông tin công việc và kết quả cần chia sẻ. Khi người dùng bật sửa file, hộp thoại xác nhận nêu rõ việc gửi diff cho reviewer độc lập và bàn giao patch đã duyệt cho harness được phân công. Patch chỉ đi qua hàng đợi công việc theo quyền. Worktree, đường dẫn cục bộ và credential của provider nằm ở máy sở hữu. Thu hồi quyền, hết lượt hoặc mất heartbeat sẽ dừng cấp việc mới và chặn bàn giao patch chưa gửi.

Sau review độc lập, chủ máy kiểm tra và tích hợp thay đổi cục bộ. Sade bàn giao patch đã duyệt cho nhiệm vụ phụ thuộc qua Shared Groups. Desktop nhận kiểm tra digest và danh sách file, rồi áp dụng patch trong worktree riêng trước khi mở harness. Nhánh Git của người nhận chỉ nhận thay đổi khi chủ máy chọn tích hợp. Quyền cũ vẫn sử dụng **Share published revision**. Cấp lại quyền trên desktop mới để cho phép bàn giao patch.

Khi nhánh đích đã có đúng nội dung và mode Git của toàn bộ file chịu tác động, Shared Groups báo task hoàn tất với revision hiện tại. Kiểm tra này chạy sau khi xác nhận review và bao gồm các file được chuyển từ task trước. Nếu nhánh đích vẫn thiếu một file kế thừa, Sade tiếp tục tích hợp. Nếu Git không còn gì để tích hợp nhưng nội dung đã duyệt cũng không còn ở nhánh đích, task chờ người dùng kiểm tra lại. Các project dùng AEGIS tiếp tục áp dụng quy trình duyệt tích hợp chính xác.

Nếu một tác vụ ghi hoàn tất với worktree nguyên trạng, Sade dùng revision Git gốc của lần chạy làm điều kiện bàn giao cho các tác vụ phụ thuộc. Máy nhận kiểm tra nhánh đã liên kết và chờ nếu commit chưa có trong lịch sử nhánh đó. Chỉ tải object Git về vẫn chưa đủ. Sau khi chủ máy đồng bộ nhánh, Sade tiếp tục cùng tác vụ, từ một worktree ghim vào revision vừa kiểm tra. Khâu chờ giữ một lượt cấp quyền đã đặt trước và chưa khởi động provider. Revision đi trong gói bàn giao đến desktop đã được cấp quyền. Desktop cũ cần cập nhật để báo revision cho công việc có bước phụ thuộc.

Nếu kế hoạch đã giao review cho một chủ tài khoản khác, với đúng phạm vi và chỉ phụ thuộc vào một tác vụ sửa, chính tác vụ review đó nhận diff khi bản sửa sẵn sàng. Sade giữ người được giao và tiêu chí review. Reviewer nhận tên, mô tả, tiêu chí nghiệm thu của tác vụ sửa và câu trả lời gần nhất của người gửi nếu có. Nếu cùng một diff có nhiều lượt review, mỗi lượt phải chấp thuận trước khi tích hợp. Nhiệm vụ phụ thuộc vẫn chờ kết quả tích hợp. Nếu tác vụ sửa kết thúc với worktree nguyên trạng, phần review đã yêu cầu tiếp tục dưới dạng kiểm tra chỉ đọc trên file hiện có.

Khi workflow có grant của nhiều chủ tài khoản, Sade giữ một lượt review độc lập trước khi giao mỗi tác vụ ghi mà kế hoạch chưa có reviewer. Lượt được giữ trong ngân sách của nhóm và chỉ tính đã dùng khi giao review. Tác vụ ghi khác chờ nếu chưa có lượt review trống. Nếu tác vụ trước kết thúc với worktree nguyên trạng, lượt review trở lại ngân sách. Nếu lượt đã dành cho review thực tế, tác vụ đang review vẫn có thể hoàn thành và tích hợp trước khi Sade báo thiếu lượt cho việc tiếp theo. Với kế hoạch đã dành hết lượt của bên review cho công việc khác, Sade báo thiếu lượt trước khi mở harness sửa file.

Trong project được AEGIS bảo vệ, approval vẫn xác minh chính xác tập file và byte trên nhánh đích. AEGIS có thể chặn tích hợp nhiệm vụ phụ thuộc nếu nhánh đích còn thiếu patch đầu vào.

## Kết quả A–D

| Tình huống                                | Phần đã kiểm tra                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Một tin nhắn giao việc cho hai harness | Hai workspace độc lập dùng Gemini và Codex protocol fixture, với Git thật. Kiến trúc được review và tích hợp cục bộ rồi được chuyển sang worktree frontend. Frontend hỏi về phong cách, tiếp tục sau câu trả lời và được review riêng. SHA của nhánh từ xa giữ nguyên trong suốt lần chạy.      |
| B. Công việc hoặc commit trùng            | Phạm vi ghi chồng nhau được xếp hàng. Tin nhắn lặp chỉ tạo một workflow. Hai workspace Git thật đã dùng lại commit có sẵn, chờ nhánh bên nhận đồng bộ rồi tiếp tục cùng tác vụ, và giữ một lượt đã cấp. Fixture kiểm tra chỉ đạo giữa lượt cho bốn adapter. Tương đương ngữ nghĩa chưa được đo. |
| C. Review độc lập                         | Tích hợp chờ verdict của reviewer độc lập và kiểm lại digest. Qwen cục bộ chặn đúng 8/9 bản có lỗi và duyệt đúng 6/9 bản đúng trong phép đo riêng. Chính sách desktop vẫn chọn model theo catalog của reviewer. Phiên review với tài khoản provider đã đăng nhập còn cần kiểm chứng.            |
| D. Windows nhờ Mac kiểm tra               | Windows thật dùng cầu nối Kivuno đến runner macOS arm64 thật trong CI. Công cụ trên Mac tái hiện lỗi đường dẫn, áp dụng bản sửa theo yêu cầu fixture, chạy lại thành công và gửi một file đúng scope về Windows. Mac chạy ở chế độ chỉ dùng công cụ.                                            |

Nếu máy Mac chỉ chạy công cụ, chủ máy ghép máy với project qua **Machines** và xác nhận quyền chạy lệnh. Trong nhóm, người dùng Windows chọn cùng project, bật **Allow local file changes**, chọn máy trong **Paired machine** rồi xác nhận quyền cho harness của mình. Khi **Ask Sade** nhận yêu cầu chạy trên macOS, harness dùng tài khoản trên Windows, kiểm tra hệ điều hành của máy ghép cặp trước khi chuyển worktree, chạy thao tác kiểm thử trên máy Mac và chuyển về các thay đổi trong scope để review. Kết quả nhóm ghi mã thoát hoặc timeout do máy trả về. Chủ máy Mac cần Kivuno để cấp và thu hồi quyền, còn phiên AI chạy ở máy Windows.

Fixture D dùng hai workspace và một runner công cụ trên máy kiểm thử. Runner thực sự chuẩn bị worktree và chạy Node. Bài kiểm thử trước hết để runner trả hệ điều hành thực tế và xác nhận yêu cầu bị từ chối nếu hệ điều hành khác với quyền đã ghép. Sau đó bài kiểm thử mô phỏng phản hồi đúng hệ điều hành để xác minh luồng cấp việc, chuyển file và báo kết quả. Một runner ngoài quyền và một grant đã đổi ID đều bị chặn. Các bài `machine-execution.test.ts` kiểm tra riêng việc giữ credential trên máy nguồn, phạm vi pull, hết hạn và thu hồi khi lệnh đang chạy.

Runner hỗ trợ truyền từng phần giới hạn mỗi gói dữ liệu ở 768 KiB trước khi mã hóa, mỗi file ở 4 MiB và mỗi snapshot ở 8 MiB hoặc 2.000 file. Receiver kiểm tra thứ tự, độ dài, SHA-256 và trạng thái worktree trước khi áp dụng. Runner đời cũ tiếp tục dùng định dạng một gói với giới hạn 512 KiB mỗi file và 2 MiB mỗi snapshot.

Thử thực tế trên Windows đã chuyển đủ 267 file của repo Kivuno sang một runner cục bộ biệt lập, xuất trở lại và so khớp từng byte. Snapshot chứa khoảng 5,5 MiB file gốc, dùng 10 gói mỗi chiều. Node đọc thành công `package.json` trong worktree đích. Bài hồi quy `machine-execution.test.ts` còn đi qua broker và runner agent với asset 3 MiB, đồng thời kiểm tra rằng huỷ khi đang gửi một phần không áp dụng file.

CI trên macOS arm64 với Node 24.22.1 đã chạy commit `3fc1d2f`. `npm run check` đạt 308 bài và bỏ qua 6 bài theo nền tảng. Electron Desktop và giao diện Shared Groups đều đạt. Audit dependency runtime đạt ngưỡng high và báo 20 mục moderate. Cùng commit, Windows đạt 313 bài, bỏ qua một bài theo nền tảng, và giao diện Shared Groups đạt. Bộ 1.000 tin dùng planner mô phỏng đạt trên cả hai hệ điều hành. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44471124584)

CI dùng máy ảo macOS và fixture provider. Bài kiểm thử riêng bên dưới bổ sung bằng chứng kết nối giữa hai máy qua mạng. Phiên dùng tài khoản provider đăng nhập thật và máy Mac của thành viên vẫn cần xác minh riêng.

### Chạy lại tình huống D qua mạng

Chế độ tùy chọn `paired-macos` đã có trong workflow **Verify RELAY**. Phép thử dùng project Git tổng hợp trên Windows, một runner công cụ macOS arm64 và cầu nối desktop Kivuno cô lập. Cấu hình runner chỉ cấp khi danh tính GitHub Actions khớp origin, workflow và commit. Phép thử có một lỗi xử lý đường dẫn qua dấu gạch chéo, đi qua thứ tự chạy trên Windows, tái hiện lỗi trên macOS, sửa trên máy đích, kéo thay đổi trong scope về Windows, review độc lập và tích hợp cục bộ. Quick Tunnel chỉ mở trong lúc thử. [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Commit `62f9aa2` đã qua bài kiểm thử ở cả hai đầu. Lượt chạy đầu trên macOS trả mã thoát 1, lượt sau khi sửa trả 0. File `.env.local` trên Windows không vào snapshot. Tiến trình Node trên Mac không nhận biến môi trường provider giả của runner. Windows kéo đúng `path-label.cjs`, chạy lại thành công rồi dùng review độc lập trước khi tích hợp. SHA trên Git remote của project thử giữ nguyên. Cùng commit, `npm run check` trên Windows đạt 300 bài và bỏ qua một bài theo nền tảng, còn giao diện Shared Groups đạt. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44450379635)

Mở `cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:58173` trên Windows và lấy HTTPS origin từ đầu ra. Checkout cùng nhánh và commit sẽ chạy trên macOS, cài dependency bằng `npm ci` rồi đặt môi trường trong shell Windows.

```powershell
$env:KIVUNO_CROSS_HOST_ORIGIN = '<HTTPS origin từ cloudflared>'
$env:KIVUNO_CROSS_HOST_PORT = '58173'
$env:KIVUNO_CROSS_HOST_WORKFLOW = 'dakiemdarktharr/WWW/.github/workflows/ci.yml@refs/heads/codex/shared-groups-sade'
$env:KIVUNO_CROSS_HOST_SHA = (git rev-parse HEAD).Trim()
node --import tsx --test --test-name-pattern 'two desktop workspaces' tests/shared-sade.test.ts
```

Khi Windows báo `Cross-host fixture waiting`, chạy lệnh dưới đây trong shell dùng cùng giá trị origin. Dừng tunnel sau khi hai đầu kết thúc.

```powershell
gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref codex/shared-groups-sade `
  -f platform=paired-macos -f "paired_origin=$env:KIVUNO_CROSS_HOST_ORIGIN"
```

## Kiểm thử 1.000 tin nhắn

`npm run test:shared-sade` chạy 20 tình huống × 10 cặp provider/gói × 5 cách diễn đạt. Có tiếng Việt có dấu, không dấu, người mới, kỹ thuật và chuyên gia song ngữ. Bài test đi qua Shared Groups, database, grant và bộ điều phối thật. Kế hoạch do fixture cung cấp để kiểm tra điều kiện giao việc, review, budget và phục hồi cả khi đầu ra model bị sai. Fixture cấp từ một đến năm lượt Kivuno tùy cặp và tình huống. Nhãn gói dịch vụ và quota của provider được mô phỏng.

Trong 200 tin về review, 80 ca có reviewer được chỉ định trong kế hoạch, còn 120 ca dùng reviewer do Sade chọn. Mỗi ca xác nhận có đúng một lượt review cho diff, chủ thay đổi không gửi được verdict thay reviewer và không có lượt review phát sinh sau khi tích hợp.

850 kế hoạch hợp lệ về cấu trúc đi qua bộ phân giải mã teammate trước khi đến bộ điều phối. Thêm 50 ca chỉ định teammate chưa cấp quyền, xác nhận cả bước phân giải ở desktop và bước kiểm quyền ở bộ điều phối đều từ chối. Các ca chat thường và mất lease giữ cách kiểm thử riêng.

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

## Cấu hình dùng trong Shared Groups

Dùng một lượt lập kế hoạch từ harness đã cấp quyền của người gửi. Schema yêu cầu nhiệm vụ, scope, phụ thuộc và điều kiện hoàn tất. Bộ điều phối quyết định quyền, hệ điều hành, số lượt và thứ tự thực thi. Chính sách chọn model đọc loại tác vụ, mô tả và effort từ kế hoạch. Lượt lập kế hoạch ưu tiên reasoning cao trong catalog của tài khoản. Tác vụ thường có thể dùng reasoning trung bình, và review thường ưu tiên model nhỏ hỗ trợ reasoning cao. Bài kiểm thử giao thức xác nhận ba lựa chọn này khi catalog cung cấp đủ mức. Có thể xem model và reasoning được chọn trên desktop. Qwen dùng để đánh giá offline.

## Huấn luyện Qwen trên máy

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
