# Sade trong Shared Groups

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở phần **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Mỗi quyền áp dụng cho một harness trên máy của chủ tài khoản, hết hạn sau một giờ và giới hạn từ một đến mười lượt. Quyền này cũng cấp lượt cho công việc của nhóm khi provider không báo quota. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff đã lọc cho người kiểm tra.

Người gửi chọn **Ask Sade** và gửi một tin nhắn để lập kế hoạch. Sau khi gửi thành công, ô soạn quay về chế độ gửi tin nhóm thông thường. Nếu người gửi đã chọn **Ask Sade** nhưng chỉ báo tình hình, planner có thể kết thúc với phần giải thích và danh sách nhiệm vụ rỗng. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời. Nếu harness cần biết phong cách giao diện, người gửi có thể chọn phong cách hoặc nhờ harness quyết định. Nhiệm vụ tiếp tục trong lượt được cấp tiếp theo. Gửi lại cùng tin nhắn không lập thêm workflow.

Trong **Sade progress**, người gửi yêu cầu, chủ nhóm và chủ harness đang chạy có thể chọn **Update task**. Codex nhận tín hiệu trong lượt hiện tại. Gemini, Claude và Antigravity đọc chỉ đạo qua công cụ Kivuno trong cùng lượt. Phạm vi, quyền và số lượt đã cấp tiếp tục áp dụng. Nhóm thấy số chỉ đạo đã được chuyển đến harness. Nếu lượt kết thúc khi còn chỉ đạo chưa đọc, Sade giữ thay đổi trong worktree và chặn việc giao nhiệm vụ tiếp theo.

Kivuno dùng tài khoản provider đã đăng nhập trên desktop của từng chủ quyền. Máy chủ nhận ID quyền, thông tin công việc và kết quả cần chia sẻ. Khi người dùng bật sửa file, hộp thoại xác nhận nêu rõ việc gửi diff cho reviewer độc lập và bàn giao patch đã duyệt cho harness được phân công. Patch chỉ đi qua hàng đợi công việc theo quyền. Worktree, đường dẫn cục bộ và credential của provider nằm ở máy sở hữu. Thu hồi quyền, hết lượt hoặc mất heartbeat sẽ dừng cấp việc mới và chặn bàn giao patch chưa gửi.

Sau review độc lập, chủ máy kiểm tra và tích hợp thay đổi cục bộ. Sade bàn giao patch đã duyệt cho nhiệm vụ phụ thuộc qua Shared Groups. Desktop nhận kiểm tra digest và danh sách file, rồi áp dụng patch trong worktree riêng trước khi mở harness. Nhánh Git của người nhận chỉ nhận thay đổi khi chủ máy chọn tích hợp. Quyền cũ vẫn sử dụng **Share published revision**. Cấp lại quyền trên desktop mới để cho phép bàn giao patch.

Trong project được AEGIS bảo vệ, approval vẫn xác minh chính xác tập file và byte trên nhánh đích. AEGIS có thể chặn tích hợp nhiệm vụ phụ thuộc nếu nhánh đích còn thiếu patch đầu vào.

## Kết quả A–D

| Tình huống                                | Phần đã kiểm tra                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Một tin nhắn giao việc cho hai harness | Hai workspace độc lập dùng Gemini và Codex protocol fixture, với Git thật. Kiến trúc được review và tích hợp cục bộ rồi được chuyển sang worktree frontend. Frontend hỏi về phong cách, tiếp tục sau câu trả lời và được review riêng. SHA của nhánh từ xa giữ nguyên trong suốt lần chạy. |
| B. Công việc hoặc commit trùng            | Phạm vi ghi chồng nhau được xếp hàng. Tin nhắn lặp chỉ tạo một workflow. Fixture kiểm tra chỉ đạo giữa lượt cho bốn adapter và chặn kết quả chưa đọc chỉ đạo. Worktree không thay đổi không mở thêm review. Việc hai model thật nhận ra thay đổi tương đương về ngữ nghĩa chưa được đo.    |
| C. Review độc lập                         | Quyền của tác giả không thể gửi verdict của reviewer. Tích hợp bị chặn trước review. Digest được kiểm lại lúc tích hợp. Reviewer chạy với chính sách chọn model theo nhiệm vụ review trên desktop của mình. Kết quả phát hiện lỗi của model thật chưa được đo.                             |
| D. Windows nhờ Mac kiểm tra               | Windows thật dùng cầu nối Kivuno đến runner macOS arm64 thật trong CI. Công cụ trên Mac tái hiện lỗi đường dẫn, áp dụng bản sửa theo yêu cầu fixture, chạy lại thành công và gửi một file đúng scope về Windows. Mac chạy ở chế độ chỉ dùng công cụ.                                       |

Nếu máy Mac chỉ chạy công cụ, chủ máy ghép máy với project qua **Machines** và xác nhận quyền chạy lệnh. Trong nhóm, người dùng Windows chọn cùng project, bật **Allow local file changes**, chọn máy trong **Paired machine** rồi xác nhận quyền cho harness của mình. Khi **Ask Sade** nhận yêu cầu chạy trên macOS, harness dùng tài khoản trên Windows, kiểm tra hệ điều hành của máy ghép cặp trước khi chuyển worktree, chạy thao tác kiểm thử trên máy Mac và chuyển về các thay đổi trong scope để review. Kết quả nhóm ghi mã thoát hoặc timeout do máy trả về. Chủ máy Mac cần Kivuno để cấp và thu hồi quyền, còn phiên AI chạy ở máy Windows.

Fixture D dùng hai workspace và một runner công cụ trên máy kiểm thử. Runner thực sự chuẩn bị worktree và chạy Node. Bài kiểm thử trước hết để runner trả hệ điều hành thực tế và xác nhận yêu cầu bị từ chối nếu hệ điều hành khác với quyền đã ghép. Sau đó bài kiểm thử mô phỏng phản hồi đúng hệ điều hành để xác minh luồng cấp việc, chuyển file và báo kết quả. Một runner ngoài quyền và một grant đã đổi ID đều bị chặn. Các bài `machine-execution.test.ts` kiểm tra riêng việc giữ credential trên máy nguồn, phạm vi pull, hết hạn và thu hồi khi lệnh đang chạy.

Runner hỗ trợ truyền từng phần giới hạn mỗi gói dữ liệu ở 768 KiB trước khi mã hóa, mỗi file ở 4 MiB và mỗi snapshot ở 8 MiB hoặc 2.000 file. Receiver kiểm tra thứ tự, độ dài, SHA-256 và trạng thái worktree trước khi áp dụng. Runner đời cũ tiếp tục dùng định dạng một gói với giới hạn 512 KiB mỗi file và 2 MiB mỗi snapshot.

Thử thực tế trên Windows đã chuyển đủ 267 file của repo Kivuno sang một runner cục bộ biệt lập, xuất trở lại và so khớp từng byte. Snapshot chứa khoảng 5,5 MiB file gốc, dùng 10 gói mỗi chiều. Node đọc thành công `package.json` trong worktree đích. Bài hồi quy `machine-execution.test.ts` còn đi qua broker và runner agent với asset 3 MiB, đồng thời kiểm tra rằng huỷ khi đang gửi một phần không áp dụng file.

CI trên macOS arm64 với Node 24.22.1 đã chạy commit `fca7edb`. `npm run check` đạt 293 bài và bỏ qua 6 bài theo nền tảng. Electron Desktop và giao diện Shared Groups đều đạt, gồm chuyển về chế độ gửi tin thường sau **Ask Sade** và xác nhận đã đọc chỉ đạo. Audit dependency runtime đạt ngưỡng high và báo 20 mục moderate. Trên Windows, `check` đạt 298 bài, bỏ qua một bài theo nền tảng, và các bài Electron, Shared Groups và Cloud đều đạt. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44447535717)

CI dùng máy ảo macOS và fixture provider. Bài kiểm thử riêng bên dưới bổ sung bằng chứng kết nối giữa hai máy qua mạng. Phiên dùng tài khoản provider đăng nhập thật và máy Mac của thành viên vẫn cần xác minh riêng.

### Chạy lại tình huống D qua mạng

Chế độ tùy chọn `paired-macos` đã có trong workflow **Verify RELAY**. Phép thử dùng project Git tổng hợp trên Windows, một runner công cụ macOS arm64 và cầu nối desktop Kivuno cô lập. Cấu hình runner chỉ cấp khi danh tính GitHub Actions khớp origin, workflow và commit. Phép thử có một lỗi xử lý đường dẫn qua dấu gạch chéo, đi qua thứ tự chạy trên Windows, tái hiện lỗi trên macOS, sửa trên máy đích, kéo thay đổi trong scope về Windows, review độc lập và tích hợp cục bộ. Quick Tunnel chỉ mở trong lúc thử. [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Commit `c8ce015` đã qua bài kiểm thử ở cả hai đầu. Lượt chạy đầu trên macOS trả mã thoát 1, lượt sau khi sửa trả 0. File `.env.local` trên Windows không vào snapshot. Tiến trình Node trên Mac không nhận biến môi trường provider giả của runner. Windows kéo đúng `path-label.cjs`, chạy lại thành công rồi dùng review độc lập trước khi tích hợp. SHA trên Git remote của project thử giữ nguyên. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44446192162)

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

`npm run test:shared-sade` chạy 20 tình huống × 10 cặp provider/gói × 5 cách diễn đạt. Có tiếng Việt có dấu, không dấu, người mới, kỹ thuật và chuyên gia song ngữ. Bài test đi qua Shared Groups, database, grant và bộ điều phối thật. Kế hoạch do fixture cung cấp để kiểm tra điều kiện giao việc, review, budget và phục hồi cả khi đầu ra model bị sai. Gói dịch vụ trong bộ test là nhãn mô phỏng.

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

## Cấu hình dùng trong Shared Groups

Dùng một lượt lập kế hoạch từ harness đã cấp quyền của người gửi. Schema yêu cầu nhiệm vụ, scope, phụ thuộc và điều kiện hoàn tất. Bộ điều phối quyết định quyền, hệ điều hành, số lượt và thứ tự thực thi. Mỗi thay đổi nhận một reviewer độc lập, ưu tiên vai trò review và dùng model nhỏ có reasoning cao khi catalog của tài khoản hỗ trợ. Có thể xác nhận cấu hình của phiên từ model và reasoning hiển thị trên desktop. Kết quả phân loại Qwen 1.7B hiện phù hợp để tiếp tục đánh giá offline.

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
