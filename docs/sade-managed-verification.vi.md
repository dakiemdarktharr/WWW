# Sade: kết quả tích hợp Windows và bàn giao Mac

Ngày 17/11/2026. Nhánh `codex/sade-managed-machines`, chưa phát hành production. Nền là `dc85c9d` cộng commit `7a1d6e4` của [PR #2](https://github.com/dakiemdarktharr/WWW/pull/2); việc lấy commit vào nhánh này không merge PR #2 vào main.

## Thay đổi có thể kiểm tra

- Claude và Antigravity có adapter CLI do Sade quản lý khi người dùng bật rõ ràng. Profile external cũ không tự chuyển chế độ. Chuyển chế độ thu hồi kết nối cũ, không giữ hai bên cùng có quyền chạy.
- Đăng nhập riêng theo profile, không nhận API-key fallback. Model/reasoning lấy từ capability do CLI trả về. Quota chưa biết cần prompt allowance giới hạn. Công cụ ghi file kiểm tra scope, lease và phê duyệt của người dùng.
- Machines có mục dùng máy để kiểm thử project. Chủ máy đích cấp quyền bằng native dialog, hết hạn sau 30 phút; full access mặc định tắt. AI tiếp tục ở nguồn; máy đích không cần tài khoản model. Chế độ này chặn tạo process AI trên máy đích.
- Lệnh có giới hạn thời gian/output, chống replay bằng receipt bền vững. Thu hồi/hết hạn dừng process; pull về nguồn kiểm tra snapshot và scope. Khác biệt `/var`–`/private/var` và titlebar từ PR Mac được giữ lại.

## Kiểm thử trong lần tích hợp

- `npm run check`: 281 pass, 1 skip; format, typecheck và build đạt. Sau đó bổ sung regression cho shutdown trong lúc chờ mạng: 10 test machine/runner đều đạt; typecheck và build cuối cùng cũng đạt.
- `npm run test:sade`: 72/72 pass trên code cuối cùng.
- E2E Electron desktop, chat UI và cloud UI đều đạt. Cloud fixture được cập nhật theo API prepareProvider mới; UI không cho cài provider ngoài khả năng của backend cloud.
- CLI thật không đăng nhập: Claude Code 2.1.281 và Antigravity CLI 1.5.0. Mac cần thử lại các version 2.1.326 / 1.5.10 ghi trong báo cáo PR #2.
- Giới hạn test concurrency xuống 2 để tránh các subprocess Node cùng làm cạn bộ nhớ trên Windows. Lượt bị OOM không được tính là pass.

## Bằng chứng và giới hạn

| Kiểm tra                            | Phạm vi bằng chứng                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude/Antigravity protocol fixture | Process thật trao đổi stream-json/ACP với peer có kiểm soát; không gọi model. Kiểm tra catalog, scoped MCP, duyệt ghi file, read-only, từ chối native permission giả danh MCP và dừng server không tương thích.   |
| CLI chính thức trên Windows         | Cả hai khởi động và báo chưa đăng nhập. Claude trả catalog model/effort. Không có prompt model hay OAuth thật.                                                                                                    |
| Máy đích                            | Node subprocess thật trên Windows; broker/MachineAgent đồng bộ, chạy, pull; kiểm tra quyền theo project, full access, expiry, revocation, chống replay sau restart, đường dẫn credential và thay đổi ngoài scope. |
| Mac PR #2                           | Báo cáo của máy Mac cho SHA `7a1d6e4`, trước phần managed runtime/machine grant mới. Không dùng kết quả đó để xác nhận adapter mới.                                                                               |
| Demo A/B/C                          | Test bộ điều phối và lifecycle kiểm tra phân công/dependency, chống request lặp, scope lease, tác giả reviewer khác và digest. Chưa đo chất lượng hiểu prompt/aesthetic/phát hiện bug bằng model thật.            |
| Demo D                              | Chưa chạy Windows → Mac qua transport cloud với chủ máy cấp quyền thật. Kiểm thử broker trong một môi trường không thay thế bài này.                                                                              |

Chạy `npm run check`, `npm run test:sade`, `npm run test:desktop`, `npm run test:chat` và `npm run test:cloud`. Bộ test không tự đăng nhập hoặc tiêu prompt của tài khoản thật. Nếu TEMP nằm trong repo, test thư mục Git chưa khởi tạo có thể nhận diện repo cha; dùng thư mục tạm ngoài repo.

## Cảnh báo dependency đã đối chiếu

Audit lockfile trên nhánh tích hợp bằng npm 11.16.0: **35 cảnh báo** (1 critical, 6 high, 27 moderate, 1 low); `--omit=dev`: **21 moderate, 0 high/critical**. Đây là kết quả của lần quét, không phủ nhận số 60/5 trong môi trường Mac khác và không chứng minh app hết lỗ hổng.

Critical nằm ở `ganache/node_modules/elliptic`; Ganache chỉ được import trong test EVM (`tests/aegis.test.ts`), là devDependency. Bộ đóng gói Windows cài với `--omit=dev`. Không dùng private key thật với Ganache test. [Advisory elliptic](https://github.com/advisories/GHSA-vjh7-7g9h-fjfh) công bố bản sửa 6.6.1; [Ganache upstream](https://github.com/ConsenSys-archive/ganache) đã lưu trữ. Nhánh này chưa thay engine EVM hoặc sửa các dependency đóng gói bên trong Ganache.

Các cảnh báo production trong lần quét đi qua npm đóng gói và dependency minimatch. [Advisory minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) yêu cầu 11.0.1 cho dòng bị ảnh hưởng. Không chạy audit fix tự động: các gợi ý gồm downgrade major npm/electron-builder/Ganache và cần kiểm chứng tương thích riêng. Lockfile của main được giữ nguyên, không thêm các package extraneous mà npm install có thể ghi lại từ bundle Ganache.

## Việc cần làm trên Mac

Fetch nhánh `codex/sade-managed-machines` sau khi được push và tạo worktree riêng từ SHA của nhánh, không chỉ dùng main/PR #2. Dùng [prompt kiểm thử Mac](mac-verification-prompt.vi.md), chạy lại check và protocol tests, rồi thử đăng nhập/model khi có tài khoản. Ghép Windows nguồn với Mac đích để xác minh demo D và việc thu hồi quyền trong lúc chạy.

Ký/notarize cần môi trường và danh tính phát hành Apple phù hợp. Không tắt Gatekeeper để coi lỗi phân phối đã được sửa. Email khôi phục vẫn để sau khi có tên miền.
