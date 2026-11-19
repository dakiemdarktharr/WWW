# Dùng thử thanh toán gói Kivuno bằng QR

Người mua dùng một tài khoản Kivuno để nhận quyền Plus hoặc Max. Trong bản demo cục bộ, họ chuyển VND mô phỏng trực tiếp cho bên bán sau khi chọn gói. Người mua có thể thực hiện toàn bộ quy trình trong một tab trình duyệt. Máy không cần cài Core, có ví, số dư token hay tài khoản ngân hàng.

## Chạy trên máy

Trong thư mục gốc của dự án, dùng phiên bản Node.js ghi trong `.node-version`, cài các phụ thuộc rồi khởi động ứng dụng.

```console
npm ci
npm run dev:fuji-demo
```

1. Mở [Thanh toán Kivuno trên máy này](http://127.0.0.1:5173/billing). Tạo tài khoản Kivuno cục bộ hoặc đăng nhập tài khoản demo đã có.
2. Bấm **Chọn Plus** hoặc **Chọn Max**. Kiểm tra số VND, người thụ hưởng, số tài khoản mô phỏng và nội dung chuyển khoản bên cạnh QR. Giá gói trong bài thử là 2 hoặc 6 test USDC cho 30 ngày. Số VND minh họa được chốt cho đơn trong 15 phút, theo cấu hình `KIVUNO_BANK_VND_PER_USDC` của máy chủ khi tạo đơn.
3. Bấm **Mở ngân hàng mô phỏng** ngay dưới đơn để thử trên cùng máy. Đây là màn hình thực hiện chuyển thử. Mã và thông tin người thụ hưởng chỉ có hiệu lực trong trình mô phỏng. Trên điện thoại, địa chỉ `127.0.0.1` trỏ về chính điện thoại.
4. Rà soát số tiền, tài khoản và mã đơn, bấm **Xác nhận chuyển thử**, rồi **Trở về Kivuno**. Sau đối soát, gói hiện tại hiển thị Plus hoặc Max. Tải lại trang để xem quyền vẫn còn hiệu lực. Mỗi lần gia hạn cần người mua xác nhận.
5. Bấm **Kiểm chứng biên nhận** để xem bằng chứng của đơn. Máy chủ ghi và kiểm tra một giao dịch trên sổ cái EVM cục bộ có chain ID `31337`. Hash này chỉ tra cứu được trong môi trường vừa chạy. Giao dịch thử trên Avalanche Fuji C-Chain có chain ID `43113` và được mô tả riêng trong [hồ sơ triển khai Fuji](KIVUNO-FUJI-DEPLOYMENT.md).

## Kiểm tra giao diện tự động

Giữ ứng dụng mở rồi chạy đoạn PowerShell sau trong cửa sổ thứ hai. Bài kiểm tra dùng Microsoft Edge ở chế độ headless, tạo một tài khoản cục bộ mới, mua Plus rồi đổi sang Max. Với mỗi gói, bài kiểm tra đối chiếu số VND, thông tin thụ hưởng và mã đơn, xác nhận chuyển thử, kiểm chứng biên nhận và tải lại trang để kiểm tra quyền đã cấp. Dữ liệu thử được lưu trong thư mục `.relay-fuji-demo` của dự án.

```powershell
$env:KIVUNO_RUN_BANK_SMOKE = '1'
node tests/bank-screen.e2e.mjs
```
