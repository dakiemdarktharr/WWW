# Sade trong Shared Groups

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở phần **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Mỗi quyền áp dụng cho một harness trên máy của chủ tài khoản, hết hạn sau một giờ và giới hạn từ một đến mười lượt. Quyền này cũng cấp lượt cho công việc của nhóm khi provider không báo quota. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff đã lọc cho người kiểm tra.

Người gửi chọn **Ask Sade** và gửi một tin nhắn để lập kế hoạch. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời. Nếu harness cần biết phong cách giao diện, người gửi có thể chọn phong cách hoặc nhờ harness quyết định. Nhiệm vụ tiếp tục trong lượt được cấp tiếp theo. Gửi lại cùng tin nhắn không lập thêm workflow.

Kivuno dùng tài khoản provider đã đăng nhập trên desktop của từng chủ quyền. Máy chủ nhận ID quyền, thông tin công việc và kết quả cần chia sẻ. Khi người dùng bật sửa file, quyền này cũng cho phép gửi diff văn bản đủ nhỏ qua máy chủ đến reviewer độc lập. Worktree, đường dẫn cục bộ và credential của provider nằm ở máy sở hữu. Thu hồi quyền, hết lượt hoặc mất heartbeat sẽ dừng cấp việc mới. Công việc đã tạo vẫn nằm trong worktree của chủ quyền.

Sau review độc lập, chủ máy kiểm tra và tích hợp thay đổi. Một nhiệm vụ cuối có thể hoàn tất sau khi tích hợp cục bộ. Nếu việc phía sau phụ thuộc vào code mới, chủ máy công bố commit lên nhánh đã liên kết, máy nhận đồng bộ nhánh đó, rồi chủ máy bấm **Share published revision**. Sade kiểm tra revision trước khi giao nhiệm vụ kế tiếp.

## Kết quả A–D

| Tình huống                                | Phần đã kiểm tra                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Một tin nhắn giao việc cho hai harness | Hai workspace Windows độc lập dùng Gemini và Codex protocol fixture, với Git thật. Kiến trúc được tạo trước, reviewer đọc đúng diff, frontend nhận đúng commit rồi hỏi và tiếp tục sau câu trả lời về phong cách.                                                                      |
| B. Công việc hoặc commit trùng            | Phạm vi ghi chồng nhau được xếp hàng. Tin nhắn lặp chỉ tạo một workflow. Worktree không có thay đổi không mở thêm review. Revoke và mất heartbeat chặn việc giao tiếp hoặc giao lại lượt không rõ kết quả. Việc hai model thật nhận ra thay đổi tương đương về ngữ nghĩa chưa được đo. |
| C. Review độc lập                         | Quyền của tác giả không thể gửi verdict của reviewer. Tích hợp bị chặn trước review. Digest được kiểm lại lúc tích hợp. Reviewer chạy với chính sách chọn model theo nhiệm vụ review trên desktop của mình. Kết quả phát hiện lỗi của model thật chưa được đo.                         |
| D. Windows nhờ Mac kiểm tra               | Bộ điều phối chọn quyền phù hợp với macOS trong fixture và dừng nếu thiếu nó. Desktop kiểm tra hệ điều hành thật trước khi mở harness. Chủ máy Mac có thể dùng provider đã kết nối của họ. Phiên Windows → Mac và chế độ Mac không có provider đăng nhập vẫn cần xác minh riêng.       |

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
