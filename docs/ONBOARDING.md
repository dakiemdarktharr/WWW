# Hướng dẫn sử dụng trong web

Tham khảo cách tổ chức hướng dẫn của [NoSleepClub Support Desk](https://github.com/dakiemdarktharr/nosleepclub-support-desk), đặc biệt [JudgeGuide](https://github.com/dakiemdarktharr/nosleepclub-support-desk/blob/main/src/components/judge-guide.tsx), [cấu hình bước](https://github.com/dakiemdarktharr/nosleepclub-support-desk/blob/main/src/domain/judge-guide.ts) và [tài liệu onboarding](https://github.com/dakiemdarktharr/nosleepclub-support-desk/blob/main/docs/JUDGE-ONBOARDING.md).

Áp dụng các pattern: popup tổng quan cuộn bên trong, minh họa SVG, footer cố định với nút Đã hiểu, tour trỏ đúng điều khiển đang hiển thị, bỏ qua và xem lại. Nội dung, minh họa và màu được viết riêng cho RELAY + MESH.

## Cách dùng

- Trang Vercel và workspace local hiện popup tiếng Việt lần đầu trong tab. Popup giải thích runner, project/Team, MESH/Sessions, quota, handoff và recovery.
- Chọn **Đã hiểu** để bắt đầu tour trên màn hình hiện tại; chọn **Bỏ qua hướng dẫn** hoặc Escape để đóng.
- Mũi tên đỏ và khung chỉ đúng thành phần thật. **Tiếp theo**, **Bước trước**, **Hoàn tất** và **Bỏ qua** điều khiển tour; bước không có trên giao diện được bỏ qua.
- Trong workspace đã kết nối (web hoặc local), Team, MESH, Sessions, Workroom, Tasks, Reviews và Settings có các bước riêng. Chuyển màn hình lần đầu trong tab sẽ mở tour tương ứng.
- Bấm **Hướng dẫn** trên thanh đầu để mở lại popup và tour màn hình hiện tại. Trên điện thoại, nút dùng biểu tượng sách với nhãn truy cập Hướng dẫn sử dụng.
- Khi web chưa kết nối, tour chỉ cách cài runner, chọn port và xác nhận kết nối qua popup. MESH/Sessions nằm trên URL Vercel; chỉ cửa sổ kết nối dùng địa chỉ local. Hướng dẫn không chuyển sang tài liệu GitHub private.
- Tour không tự click nút sản phẩm, gửi prompt, đăng nhập, cấp quyền quota, push Git hoặc thực hiện ACK. Người dùng tự quyết định các thao tác đó.

Trạng thái đã xem dùng `sessionStorage` với prefix `relay-guide-v2:`. Refresh không lặp hướng dẫn đã bắt đầu; tab mới bắt đầu lại, tùy hành vi khôi phục tab của trình duyệt. Khi storage bị chặn, bộ nhớ trang tránh lặp trong lúc điều hướng nhưng không bảo đảm giữ qua refresh.

## Kiểm chứng

Kiểm tra bằng production build local với API fixture không gọi model: mở lần đầu, cuộn popup, focus trap, Escape, xem lại, refresh không lặp, hình học khung trỏ ô Port, chuyển các màn hình local và bỏ qua target chưa tồn tại. Đã kiểm tra 1440px, 390px và 320px; không tràn ngang, không page error, không có POST do tour. Minh họa được ghi rõ là hình hướng dẫn, không phải phiên Codex thật.

Nguồn Support Desk được đọc qua GitHub connector; chưa khẳng định đã kiểm thử runtime của repo tham chiếu. Các kiểm tra trên áp dụng cho bản RELAY mới.
