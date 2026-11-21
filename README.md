<div align="center">
  <img src="public/kivuno.svg" width="72" alt="Kivuno" />
  <h1>Kivuno</h1>
  <p>Không gian làm việc desktop để phối hợp các trợ lý AI trên cùng một dự án phần mềm.</p>
  <p><a href="https://kivuno.vercel.app">Website & tải ứng dụng</a> · <a href="https://github.com/dakiemdarktharr/WWW/releases">Bản phát hành</a> · <a href="docs/DESKTOP.md">Hướng dẫn desktop</a></p>
</div>

Khi dùng nhiều trợ lý AI để phát triển phần mềm, nhóm thường phải chuyển yêu cầu giữa các phiên làm việc riêng, tự tổng hợp tiến độ và xử lý những thay đổi chồng chéo. Kivuno giải quyết vấn đề này bằng một không gian làm việc chung gắn với dự án Git: tập trung trao đổi, lập kế hoạch, phân công và duyệt thay đổi. Các nhiệm vụ độc lập có thể chạy song song trong Git worktree riêng, còn người phụ trách kiểm tra kết quả trước khi tích hợp.

Ứng dụng hỗ trợ **Windows x64, Linux x64 và macOS Apple Silicon**. Website cung cấp giới thiệu sản phẩm, tải ứng dụng, đăng nhập, kết nối desktop và quản lý gói, với giao diện tiếng Việt và tiếng Anh.

## Khả năng chính

| Khu vực              | Chức năng                                                                          |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Chat**             | Trao đổi theo dự án, gửi yêu cầu và theo dõi phản hồi của thành viên.              |
| **Team**             | Quản lý hồ sơ nhà cung cấp, kết nối, model và thông tin usage khả dụng.            |
| **Sade / Workroom**  | Lập kế hoạch có phụ thuộc, phân công và điều phối thực thi theo phạm vi công việc. |
| **Sessions / Tasks** | Theo dõi phiên làm việc, tiến độ, công cụ và nhiệm vụ được giao.                   |
| **Reviews**          | Kiểm tra diff và bằng chứng test; yêu cầu chỉnh sửa hoặc chấp thuận tích hợp.      |
| **Gói & thanh toán** | Xem gói, kích hoạt và gia hạn trong demo miễn phí trên Avalanche Fuji.             |
| **Quyền dự án**      | Cấu hình chính sách AEGIS, quyền máy và phê duyệt; nằm trong **Advanced**.         |

Khóa nhiệm vụ, phạm vi chỉnh sửa và cơ chế lease giúp tránh nhận trùng việc và chồng chéo khi tích hợp. Sau gián đoạn, Kivuno giữ trạng thái để người dùng kiểm tra và khôi phục; không tự coi worker cũ đã dừng khi chưa xác minh.

## Bắt đầu sử dụng

1. Tải bộ cài phù hợp tại [kivuno.vercel.app](https://kivuno.vercel.app), cài đặt và mở Kivuno.
2. Đăng nhập tài khoản Kivuno. Nếu bắt đầu từ desktop, kiểm tra mã kết nối trên trình duyệt rồi xác nhận. Đăng nhập trực tiếp trên website không yêu cầu kết nối desktop.
3. Trong **Team**, thêm hồ sơ Codex, Antigravity hoặc Claude và hoàn tất hướng dẫn kết nối của nhà cung cấp.
4. Chọn **Connect project** để mở Git repository, rồi chọn thành viên tham gia dự án.
5. Trao đổi trong **Chat**, lập và duyệt kế hoạch, sau đó kiểm tra kết quả trong **Reviews** trước khi tích hợp.

Khi có bản mới, nút **Cập nhật** trên thanh tiêu đề desktop cho phép tải, kiểm tra và cài bản phát hành. Cập nhật là tùy chọn. Mỗi bản công khai được phát hành đồng bộ cho ba nền tảng; macOS có DMG để cài mới và ZIP phục vụ cập nhật trong ứng dụng. Xem [hướng dẫn desktop](docs/DESKTOP.md).

## Kết nối nhà cung cấp AI

| Nhà cung cấp    | Cách tích hợp                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Codex**       | Codex App Server chính thức, đăng nhập ChatGPT và vùng cấu hình riêng cho từng hồ sơ.                                    |
| **Antigravity** | CLI qua ACP với tài khoản Google trên máy sau khi người dùng xác nhận; model phụ thuộc catalog thực của tài khoản.       |
| **Claude**      | Claude Web, Claude Desktop hoặc Claude Code qua MCP. Người dùng chọn model và gửi yêu cầu trong client Claude tương ứng. |

Kivuno không tạo tài khoản nhà cung cấp, không thay thế quyền sử dụng model và không tự chuyển sang API trả phí. Các hồ sơ dùng cùng tài khoản vẫn chia sẻ hạn mức của tài khoản đó. Usage chưa biết hoặc quá cũ không được mặc định là còn đầy.

Kết nối MCP cho phép Claude truy cập các công cụ Kivuno đã được cấp quyền; nó không cấp cho Kivuno credential gọi model Claude. Trạng thái kết nối cần MCP handshake, không chỉ mở trang hoặc hoàn tất OAuth. Chi tiết: [nhà cung cấp](docs/PROVIDERS.md), [kết nối MCP](docs/EXTERNAL-MESH.md), [trạng thái Claude](docs/CLAUDE-CONNECTION-UX.md).

## Mua gói trên Avalanche Fuji

Đây là **demo không thu tiền**. Plus và Max hiển thị giá mô phỏng **2 USDC** và **6 USDC** cho kỳ 30 ngày; mỗi lần mua thực trả **0 USDC**. Người dùng không cần nạp USDC hoặc AVAX và không phải tự trả gas.

Luồng hiện hành sử dụng **KivunoPlansSponsored** trên **Avalanche Fuji C-Chain, chain ID 43113**:

1. **Tạo ví theo tài khoản:** trình duyệt tạo và liên kết ví riêng khi đăng ký hoặc đăng nhập, trước checkout. Khóa riêng được mã hóa trong trình duyệt; máy chủ không giữ khóa riêng của người mua.
2. **Người mua ký:** sau khi xác nhận gói, ví ký EIP-3009 `ReceiveWithAuthorization` cho số tiền 0. Chữ ký ràng buộc đơn, gói và hợp đồng nhận.
3. **Dự án gửi giao dịch:** ví relayer gửi yêu cầu tới hợp đồng và trả gas bằng test AVAX miễn phí. Người mua không cần số dư.
4. **Hợp đồng xử lý:** kiểm tra chữ ký, chống dùng lại đơn, chuyển tiếp 0 USDC tới ví chủ, lưu gói và hạn dùng, rồi phát sự kiện `PlanPaid`.
5. **Kivuno cấp quyền:** máy chủ kiểm tra biên nhận và các sự kiện khớp đơn, sau đó đồng bộ quyền sử dụng theo hạn trên chain.

Gia hạn cùng gói đang còn hiệu lực nối thêm 30 ngày. Đổi gói bắt đầu kỳ 30 ngày mới. Mỗi lần mua cần người dùng xác nhận; không có tự động gia hạn.

| Thành phần                | Địa chỉ Fuji                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **KivunoPlansSponsored**  | [`0xC3b323443C6964404880b04F949636f742671474`](https://testnet.snowtrace.io/address/0xC3b323443C6964404880b04F949636f742671474) |
| **Circle test USDC**      | [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |
| **Ví dự án trả test gas** | [`0xDcAdCD82de8dadB9d086c579553112bB8B293d78`](https://testnet.snowtrace.io/address/0xDcAdCD82de8dadB9d086c579553112bB8B293d78) |
| **Ví chủ nhận 0 USDC**    | [`0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`](https://testnet.snowtrace.io/address/0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805) |

Trên explorer, **From → To** của giao dịch là **ví dự án → hợp đồng KivunoPlansSponsored**. Các sự kiện token thể hiện **ví người mua → hợp đồng → ví chủ**, mỗi chặng đều bằng **0 USDC**. Không có giá trị tiền được chuyển; gas vẫn được tiêu thụ bằng token thử nghiệm. Hệ thống chỉ gửi trên Fuji, không mua token và không chuyển sang mainnet khi thiếu test gas.

[Mã nguồn](contracts/KivunoPlansSponsored.sol) · [ABI và bytecode](shared/kivuno-plans-sponsored-artifact.json) · [Xác minh mã nguồn Sourcify](https://repo.sourcify.dev/43113/0xC3b323443C6964404880b04F949636f742671474) · [Kiến trúc và cấu hình](docs/KIVUNO-SPONSORED-BILLING.md).

Hợp đồng có relayer cố định do dự án vận hành. Việc nhập thời hạn đã mua từ phương thức cũ trong lần mua đầu tiên tin cậy dữ liệu của dự án và được ràng buộc trong chữ ký. Đây không phải hệ thống hoàn toàn phi tập trung. Các giao dịch QR, biên nhận mã băm và hợp đồng cũ vẫn là lịch sử; chúng không phải luồng checkout hiện hành.

## Kiến trúc và ranh giới an toàn

- **Desktop:** Electron chạy giao diện, coordinator và runtime cần thiết trên máy người dùng; Git repository và tác vụ thực thi nằm trên máy.
- **Web / cloud:** phục vụ tài khoản, kết nối desktop, điều phối kết nối từ xa và quản lý quyền sử dụng. Máy ghép nối dùng kết nối đi ra; công việc từ xa phụ thuộc kết nối và dịch vụ còn hoạt động.
- **Blockchain:** hợp đồng Fuji xác nhận mua gói và lưu hạn dùng. **AEGIS / Quyền dự án** là chức năng chính sách riêng, không phải thanh toán.

Git worktree cách ly checkout, **không phải sandbox hệ điều hành**. Các tiến trình cùng quyền người dùng có thể tiếp cận cùng tài nguyên. Phạm vi nhiệm vụ hỗ trợ điều phối và kiểm tra tích hợp, không tạo ACL riêng cho từng thư mục. Chỉ chạy repository, hooks, skills và plugins đáng tin cậy.

Thông báo hoàn thành của agent không thay thế việc kiểm tra diff và kết quả test. Reaction trong chat không cấp quyền chạy lệnh, chi tiền, merge hoặc deploy. Kiểm thử bằng fixture không chứng minh mọi tài khoản nhà cung cấp hoạt động thực tế; đăng nhập, model và quota cần được xác minh với tài khoản đang sử dụng.

Ví tài khoản cần bản sao lưu mã hóa để khôi phục trên trình duyệt khác. Đăng nhập lại không tự phục hồi khóa riêng đã mất. Xem [bảo mật](docs/SECURITY.md), [kiến trúc hybrid và recovery](docs/HYBRID.md), [trình duyệt desktop](docs/BROWSER-DESKTOP.md).

## Phát triển từ mã nguồn

Yêu cầu: **Node.js 24.22.1 đến hết dòng 24.x**, npm và Git. Bản desktop đã đóng gói runtime; yêu cầu này dành cho người phát triển từ repository.

```sh
npm ci
npm run build
npm start
```

Mở `http://127.0.0.1:4317`. Để phát triển giao diện, chạy `npm run dev` và mở `http://127.0.0.1:5173`.

| Lệnh                           | Mục đích                                        |
| ------------------------------ | ----------------------------------------------- |
| `npm test`                     | Kiểm thử đơn vị và tích hợp.                    |
| `npm run test:portal`          | Kiểm tra website, đăng nhập và kết nối desktop. |
| `npm run test:desktop`         | Kiểm tra giao diện desktop.                     |
| `npm run check`                | Kiểm tra định dạng, chạy tests và build.        |
| `npm run payment:compile`      | Biên dịch hợp đồng Fuji.                        |
| `npm run payment:compile:test` | Tạo artifact Shanghai cho kiểm thử EVM cục bộ.  |

Kiểm thử luồng mua gói:

```sh
node --import tsx --test tests/billing.test.ts tests/sponsored-billing.test.ts tests/sponsored-checkout.e2e.ts tests/cloud-runner.test.ts
```

Bộ kiểm thử bao gồm ví không có tiền, chữ ký sai, chống phát lại, gia hạn/đổi gói, nhập hạn cũ, khôi phục giao dịch đang chờ và xác minh sự kiện. Giao dịch trên mạng Fuji công khai phải được kiểm tra riêng sau triển khai.

### Cấu hình cục bộ

| Biến                  | Mặc định       | Vai trò                                                    |
| --------------------- | -------------- | ---------------------------------------------------------- |
| `RELAY_PORT`          | `4317`         | Cổng server, bind tại `127.0.0.1`.                         |
| `RELAY_DATA_DIR`      | `.relay`       | SQLite, hồ sơ và worktree cục bộ.                          |
| `RELAY_CODEX_COMMAND` | Tự tìm runtime | Đường dẫn runtime Codex khi cần chỉ định.                  |
| `NODE_ENV`            | development    | Dùng `production` để giới hạn origin theo cấu hình server. |

Không commit thư mục dữ liệu, khóa ví hoặc thông tin đăng nhập. Không công khai cổng coordinator cục bộ qua reverse proxy. Cấu hình máy chủ cho mua gói nằm trong [hướng dẫn sponsored billing](docs/KIVUNO-SPONSORED-BILLING.md).

## Cấu trúc repository

```text
src/          Giao diện React và API client
server/       Coordinator, phiên provider, quyền truy cập và billing
cloud/        Điều phối runtime cloud và kết nối máy
desktop/      Electron, đóng gói và cập nhật ứng dụng
contracts/    Hợp đồng Solidity và fixture kiểm thử
shared/       Kiểu dữ liệu, giao thức, ABI và artifact dùng chung
scripts/      Build, đóng gói, triển khai và xác minh
tests/        Kiểm thử đơn vị, tích hợp và giao diện
docs/         Hướng dẫn sử dụng, kiến trúc và vận hành
```

## Tài liệu và giấy phép

- [Cài đặt và phát hành desktop](docs/DESKTOP.md)
- [Nhà cung cấp AI](docs/PROVIDERS.md) và [kết nối MCP](docs/EXTERNAL-MESH.md)
- [Mua gói miễn phí trên Fuji](docs/KIVUNO-SPONSORED-BILLING.md)
- [Quyền dự án / AEGIS](docs/AEGIS.md)
- [Bảo mật](docs/SECURITY.md) và [phối hợp nhiều máy](docs/HYBRID.md)

Kivuno là dự án độc lập của NoSleepClub, không phải sản phẩm chính thức của các nhà cung cấp AI được tích hợp. Mã nguồn được phân phối theo [giấy phép MIT](LICENSE).
