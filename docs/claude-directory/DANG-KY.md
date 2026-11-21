# Bàn giao đăng ký Kivuno lên Claude

**Trạng thái: hồ sơ đã soạn, chưa gửi và chưa được Anthropic chấp nhận.**

Người đứng tên: **Đào Tiến Khoa**. Tên sản phẩm: **Kivuno**. Email hỗ trợ và nhận phản hồi: **khoadao29082007@gmail.com**. Một thành viên có Claude Pro sẽ đăng nhập để làm người quản lý listing; không cần mua thêm gói cho lượt chuẩn bị này.

## Các bước người phụ trách cần làm

1. Đọc [bản nháp quyền riêng tư](PRIVACY-NOTICE.draft.md). Chốt nội dung và việc xử lý yêu cầu dữ liệu trước khi dùng nó làm chính sách chính thức. Bản nháp chưa có ngày hiệu lực và không được điền thay một URL chính sách đã công bố.
2. Thành viên có Pro mở <https://claude.ai/directory/manage> trong trình duyệt của mình và đăng nhập. Họ tự nhập mật khẩu/mã xác nhận. Nếu dùng máy này, không đăng xuất tài khoản đang dùng trước khi lưu công việc của người dùng.
3. Kiểm tra đúng tài khoản/tổ chức sẽ quản lý listing. Thông tin đăng nhập Pro thuộc người gửi, còn tên nhà phát hành phải đúng nội dung đã được nhóm duyệt; không tự điền tên một công ty chưa tồn tại.
4. Chọn đăng ký **MCP connector**. Dùng [listing.json](listing.json) để điền tên, mô tả, địa chỉ, liên hệ và cấu hình OAuth. Logo ở [assets/kivuno-512.png](assets/kivuno-512.png).
5. Chạy kịch bản [ACCEPTANCE.md](ACCEPTANCE.md) bằng project mẫu, rồi đồng bộ danh sách tool. Chưa có project được chia sẻ thì connector cố ý không trả tool đọc dữ liệu; không phải lý do để mở quyền toàn bộ workspace.
6. Người phụ trách xem lại toàn bộ hồ sơ và các điều khoản ngay trước nút Submit. Chỉ gửi sau khi họ xác nhận. Không đánh dấu đã test những phần chưa chạy.

## Những giá trị quan trọng

| Mục            | Giá trị                                                            |
| -------------- | ------------------------------------------------------------------ |
| Tên            | Kivuno                                                             |
| Website        | https://kivuno.vercel.app                                          |
| Loại URL       | Một URL chung cho mọi người dùng                                   |
| MCP server     | https://kivuno.vercel.app/api/claude/mcp                           |
| Xác thực       | OAuth; dùng danh tính công khai CIMD của Claude                    |
| Client secret  | Không cần, không tự tạo hoặc dán secret                            |
| Quyền          | Liên kết hồ sơ; đọc tin nhắn chỉ sau khi chia sẻ riêng một project |
| Tài liệu       | USER-GUIDE.md; URL GitHub đầy đủ có trong listing.json             |
| Privacy URL    | Chờ phê duyệt và công bố thông báo chính thức                      |
| Slug mong muốn | kivuno — chưa được cấp, cần kiểm tra còn trống                     |

## Mục tiêu trải nghiệm

Sau khi có listing thật: **Connect trong Kivuno → trang Kivuno trên Claude → Add/Connect → duyệt hồ sơ → Claude connected**. Người mới không phải gõ tên hay URL connector. Nếu chưa đăng nhập, Claude/Kivuno vẫn yêu cầu đăng nhập; chia sẻ dữ liệu dự án vẫn cần quyết định riêng.

Hiện chưa có URL listing thật, nên chưa thay nút Connect bằng một đường dẫn đoán. Khi Anthropic cấp URL, cần cập nhật nút trong Kivuno và kiểm thử bằng tài khoản chưa từng có connector. Đây là bước triển khai sau đăng ký, chưa được tính là đã hoàn thành.

## Đã kiểm tra và còn chờ

- Đạt 4 bài kiểm thử OAuth/relay/MCP, TypeScript và kiểm tra discovery công khai.
- Đã bổ sung title còn thiếu cho tool chỉ đọc, không thay quyền truy cập.
- Đã chuẩn bị logo PNG/SVG, mô tả tiếng Anh, hướng dẫn, thông báo quyền riêng tư nháp và bộ dữ liệu review giả lập.
- Chưa đăng nhập tài khoản Pro của thành viên, chưa chạy tool bằng tài khoản đó, chưa chấp nhận điều khoản, chưa gửi hồ sơ.

Chi tiết bằng chứng ở [EVIDENCE.md](EVIDENCE.md). Không cần gửi mật khẩu, mã OTP hay token cho người hỗ trợ.
