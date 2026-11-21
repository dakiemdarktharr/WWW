# Dùng thử thanh toán gói Kivuno bằng QR

Người mua dùng một tài khoản Kivuno để nhận quyền Plus hoặc Max. Trong bản demo cục bộ, họ chuyển VND mô phỏng trực tiếp cho bên bán sau khi chọn gói. Người mua có thể thực hiện toàn bộ quy trình trong một tab trình duyệt. Lần đầu mở bước thanh toán sau khi đăng nhập, Kivuno tự tạo ví riêng nếu tài khoản chưa có ví liên kết. Mở mục **Ví riêng của tài khoản Kivuno** để xem địa chỉ và sao lưu. Người mua không cần Core hoặc số dư token để dùng QR. Ví phát hành của Kivuno ký giao dịch chứng thực trên Fuji.

## Chạy trên máy

Trong thư mục gốc của dự án, dùng phiên bản Node.js ghi trong `.node-version`, cài các phụ thuộc rồi khởi động ứng dụng.

```console
npm ci
npm run dev:fuji-demo
```

1. Mở [Thanh toán Kivuno trên máy này](http://127.0.0.1:5173/billing). Tạo tài khoản Kivuno cục bộ hoặc đăng nhập tài khoản demo đã có.
2. Chọn **Plus** hoặc **Max**, mở **Xem báo giá QR mô phỏng** rồi bấm **Tạo mã QR** cho gói đã chọn. Kiểm tra số VND, người thụ hưởng, số tài khoản mô phỏng và nội dung chuyển khoản bên cạnh QR. Giá gói trong bài thử là 2 hoặc 6 test USDC cho 30 ngày. Số VND minh họa được chốt cho đơn trong 15 phút, theo cấu hình `KIVUNO_BANK_VND_PER_USDC` của máy chủ khi tạo đơn.
3. Bấm **Mở ngân hàng mô phỏng** ngay dưới đơn để thử trên cùng máy. Đây là màn hình thực hiện chuyển thử. Mã và thông tin người thụ hưởng chỉ có hiệu lực trong trình mô phỏng. Trên điện thoại, địa chỉ `127.0.0.1` trỏ về chính điện thoại.
4. Rà soát số tiền, tài khoản và mã đơn, bấm **Xác nhận chuyển thử**, rồi **Trở về Kivuno**. Sau đối soát, gói hiện tại hiển thị Plus hoặc Max. Tải lại trang để xem quyền vẫn còn hiệu lực. Mỗi lần gia hạn cần người mua xác nhận.
5. Bấm **Kiểm chứng biên nhận** để xem bằng chứng của đơn. Máy chủ ghi và kiểm tra một giao dịch trên sổ cái EVM cục bộ có chain ID `31337`. Hash này chỉ tra cứu được trong môi trường vừa chạy. Giao dịch thử trên Avalanche Fuji C-Chain có chain ID `43113` và được mô tả riêng trong [hồ sơ triển khai Fuji](KIVUNO-FUJI-DEPLOYMENT.md).

## Biên nhận Fuji cho giám khảo

Một đơn QR mô phỏng đã cấp **Max** từ **20:34:42 ngày 19/11/2026** đến **20:34:42 ngày 19/12/2026**, giờ Việt Nam. Kivuno đã ghi mã cam kết của lần cấp quyền lên Fuji C-Chain, chain ID `43113`, tại block **61.332.957**. [Biên nhận JSON](../public/kivuno-qr-fuji.json) · [Giao dịch trên Fuji Explorer](https://build.avax.network/explorer/fuji/c-chain/tx/0xa84e75b8c8524e6c307a3121092cde377cdb4a525e7d0785422d00bc87e1eb97).

Giám khảo có thể tải repo, cài các phụ thuộc theo hướng dẫn ở trên và chạy lệnh dưới đây ở thư mục gốc. Lệnh chỉ đọc RPC Fuji. Nó tính lại SHA-256 từ gói, thời hạn, địa chỉ phát hành và biên nhận cục bộ, kiểm tra dữ liệu đầu vào của giao dịch cùng địa chỉ gửi, nhận, giá trị, trạng thái và block. Không cần ví hoặc dữ liệu tài khoản Kivuno. Khi chạy bản demo, [trang đối chiếu](http://127.0.0.1:5173/tools/kivuno-qr-fuji.html) cũng thực hiện phép kiểm tra này.

```console
node scripts/fuji-qr-receipt.mjs verify
```

Nguồn về quyền được cấp là đơn đã đối soát, bút toán ghi có mô phỏng và trạng thái gói của Kivuno. Ví phát hành gửi cho chính mình 0 AVAX, kèm mã cam kết 32 byte. Chữ ký và block công khai chứng minh Kivuno đã công bố bản ghi đó. Tên người mua, mã đơn, thông tin ngân hàng và mã ngẫu nhiên riêng của đơn đều ở ngoài chuỗi. Trong màn hình mua gói, liên kết Fuji chỉ xuất hiện khi cả gói, thời hạn và biên nhận cục bộ của đơn khớp với mẫu đã công bố.

Quy trình phát hành mẫu dùng `prepare ORDER_ID` trên máy có sổ demo, Core để ký và `record TX_HASH` để xác minh trước khi lưu. `prepare` giữ nguyên mẫu đã chọn nếu chạy lại. Nếu trình duyệt mất phản hồi sau khi mở Core, chạy `node scripts/fuji-qr-receipt.mjs discover` để tìm trong 50 giao dịch gần nhất của ví phát hành. Cũng có thể dùng hash trong lịch sử của Core để chạy `verify TX_HASH`. Các lệnh đối chiếu không cấp gói thêm lần nữa.

## Kiểm tra giao diện tự động

Giữ ứng dụng mở rồi chạy đoạn PowerShell sau trong cửa sổ thứ hai. Bài kiểm tra dùng Microsoft Edge ở chế độ headless, tạo một tài khoản cục bộ mới, mua Plus rồi đổi sang Max. Với mỗi gói, bài kiểm tra đối chiếu số VND, thông tin thụ hưởng và mã đơn, xác nhận chuyển thử, kiểm chứng biên nhận và tải lại trang để kiểm tra quyền đã cấp. Dữ liệu thử được lưu trong thư mục `.relay-fuji-demo` của dự án.

```powershell
$env:KIVUNO_RUN_BANK_SMOKE = '1'
node tests/bank-screen.e2e.mjs
```
