// Written after choosing the classifier on the separate challenge split.
const pairs = [
  [
    'general',
    'Nhóm bán vé gây quỹ.',
    'ê nhờ trợ lý đếm mấy phiếu chỉ mới đặt cọc rồi gửi số ở đây nha',
    'ê mấy phiếu mới đặt cọc tớ đang đếm, gửi mọi người biết trước thôi nha',
  ],
  [
    'general',
    'Bản trình bày dành cho buổi họp.',
    'AI lấy chương trình ngày thứ hai làm mục lục ngắn gửi giùm tui đi',
    'Chương trình ngày thứ hai dài ghê, tui định tự làm mục lục ngắn tối nay.',
  ],
  [
    'general',
    'We share one spreadsheet.',
    'Use the remaining free turn to list the rows without a room number.',
    'The remaining free turn is for later. I am just letting the team know some rooms are missing.',
  ],
  [
    'general',
    'Kho bản thiết kế của lớp.',
    'Cho Sade trích chữ trên bốn hình thành một bảng, xong ping mình.',
    'Nếu mai mình muốn Sade trích chữ trên hình thì bấm nút nào vậy? Hôm nay chưa cần chạy.',
  ],
  [
    'handoff',
    'Trang lịch trực đang làm.',
    'Gemini lập cái bảng ca trước, Claude bên Tuấn nhận đúng bảng đó làm trang lịch nha',
    'Gemini đã lập bảng ca và Claude bên Tuấn đã lấy bảng làm trang lịch, báo mọi người vậy.',
  ],
  [
    'handoff',
    'New checkout screen.',
    'Have Antigravity write out the empty-state contract. Once it is posted, assign the screen to Codex.',
    'Antigravity posted the contract yesterday. Codex got it. I am writing down the handoff for the meeting.',
  ],
  [
    'handoff',
    'Nhóm muốn làm bản dùng thử.',
    'cho con bên Hạnh soạn file cột dữ liệu xong đã, bên tui mới lấy nó chạy dựng form',
    'bên Hạnh soạn file rồi bên tui dựng form hồi trưa đó, chỉ note lại timeline',
  ],
  [
    'handoff',
    'Một nhóm mỗi người một công cụ.',
    'Bảo Gemini phác kiến trúc rồi gửi Astra, để Astra chọn giao diện sau khi đọc bản phác.',
    'Mình đang kể ví dụ “Gemini gửi Astra phác kiến trúc rồi làm giao diện” cho người mới trong nhóm.',
  ],
  [
    'review',
    'Chốt bản kiểm thử tính phí.',
    'Claude viết xong rồi, mượn model khác xem chỉ đọc, coi tổng phí lúc đủ ngưỡng có đúng không.',
    'Claude viết xong rồi, mấy bạn xem để biết. Phần tổng phí ở ngưỡng mình đã tự đối chiếu.',
  ],
  [
    'review',
    'An updated list view.',
    'Get an independent assistant to check this diff against the empty-list acceptance test before we merge.',
    'The empty-list acceptance test is one of the examples from an independent review we already finished.',
  ],
  [
    'review',
    'Bản thay đổi đang chờ vào nhánh chung.',
    'ê con kia làm rồi, cho ai khác nhìn patch kiếm chỗ sai trước khi tui bấm duyệt',
    'ê con kia làm rồi, người đọc patch cũng báo ổn rồi, tui kể lại thôi',
  ],
  [
    'review',
    'Tụi mình đang đọc file dịch.',
    'Giao một reviewer khác tác giả kiểm dấu hỏi dấu ngã, đừng sửa trực tiếp lên file.',
    'Reviewer khác tác giả đã đọc file để kiểm dấu hỏi dấu ngã. Mình ghi vào biên bản cho cả nhóm.',
  ],
  [
    'scope',
    'Hai người đều có agent mở.',
    'Mình có commit đổi tiêu đề sáng nay rồi. Sade kiểm nhánh trước và dừng phần đổi tiêu đề bị lặp.',
    'Mình có commit đổi tiêu đề sáng nay rồi. Bạn mở xem nếu muốn, các bạn đừng gọi agent.',
  ],
  [
    'scope',
    'Project on the release branch.',
    'My agent and yours both reserved the settings panel. Keep one writer there and move the other to docs.',
    'My agent and yours both reserved the settings panel on Monday. I fixed it manually, this is just an update.',
  ],
  [
    'scope',
    'Nhóm nhập hai bản làm song song.',
    'tui muốn con ở lớp dưới ngưng đụng file lịch phòng, còn con kia đang sửa thì cứ giữ lượt nó',
    'tui vừa ngưng agent bên lớp dưới để con kia sửa file lịch, chỉ báo đã chia xong',
  ],
  [
    'scope',
    'Sắp gộp thay đổi của hai người.',
    'Kiểm xem cùng thay đổi đó đã nằm trong Git chưa, giữ commit của Nguyên rồi giao người kia kiểm thử.',
    'Đổi tên cột trong Git đã nằm trong commit của Nguyên. Mình gửi tin để tụi bạn cập nhật dự án.',
  ],
  [
    'mac',
    'Có bản desktop cần xem.',
    'cùng bộ cài mà PC chạy, mượn mac của Uyên khi bạn ấy bật quyền và check lỗi lúc đóng nắp nha',
    'cùng bộ cài mà PC chạy, nghe nói mac của Uyên lỗi lúc đóng nắp, mình cập nhật để mọi người biết',
  ],
  [
    'mac',
    'Release smoke test.',
    'Run the window-close test on the paired Mac that approved tool execution. Return its exit code here.',
    'The window-close test report on a paired Mac is attached. We will inspect it at tomorrow’s meeting.',
  ],
  [
    'mac',
    'Dự án dùng nhiều loại máy.',
    'Máy tôi chỉ có Windows. Khi bên Mac chấp thuận, nhờ trợ lý chạy thử tải font trên đó một lần.',
    'Bên Mac bảo có lỗi tải font, tôi mới ghi nhận. Chưa có ai nhờ chạy lại.',
  ],
  [
    'mac',
    'Đã có log từ laptop thường.',
    'cho test bản arm trên mac mini có quyền á, chuyện chủ máy chưa có tài khoản claude khỏi chờ',
    'chủ mac mini không có claude, mình chỉ nhắn trước để khỏi chọn nhầm người lúc họp',
  ],
  [
    'general',
    'Dữ liệu đóng góp theo tháng.',
    'Có dòng ghi bằng hai đơn vị, nhờ trợ lý gom thành bảng đối chiếu trước giờ nghỉ.',
    'Có dòng ghi bằng hai đơn vị, chị Bích nói để chị làm bảng đối chiếu trước giờ nghỉ.',
  ],
  [
    'handoff',
    'Bản nháp thuyết trình.',
    'Nhờ bên Claude liệt kê tên slide, rồi đưa chính danh sách đó cho Gemini viết caption.',
    'Ghi chú từ lần trước: “Claude liệt kê slide, Gemini viết caption”. Hôm nay chỉ nhắc lại cách đã làm.',
  ],
  [
    'review',
    'Tập hợp bằng chứng từ hai người.',
    'Sau khi app in được hóa đơn, nhờ một agent khác xem ba ảnh kết quả so với yêu cầu.',
    'App in được hóa đơn rồi. Ba ảnh là để team xem tiến độ, phần so yêu cầu tớ làm xong.',
  ],
  [
    'mac',
    'Bản kiểm tra theo phần cứng.',
    'Chạy thử chức năng kéo thả trên máy Mac được ghép và báo video bị giật chỗ nào.',
    'Máy Mac được ghép có thể dùng cho kéo thả lần sau. Mình mới cho mọi người biết lịch thôi.',
  ],
] as const;

export const finalIntentRows = pairs.flatMap(([route, context, request, chat], index) => {
  const styles = {
    natural: (message: string) => message,
    unaccented: (message: string) =>
      message
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replaceAll('đ', 'd'),
    mixed: (message: string) =>
      index % 2
        ? 'One detail from our sprint. ' + context + ' ' + message
        : 'Quick note to the group. ' + context + ' ' + message,
  };
  return Object.entries(styles).flatMap(([style, render]) => [
    { id: 'final/' + (index + 1) + '/' + style + '/work', message: render(request), style, route },
    {
      id: 'final/' + (index + 1) + '/' + style + '/chat',
      message: render(chat),
      style,
      route: 'chat',
    },
  ]);
});
