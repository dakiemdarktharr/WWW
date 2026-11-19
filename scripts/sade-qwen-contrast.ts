// Synthetic near-neighbors. Each pair shares a context but changes whether the
// team is asking Sade to do anything. The held-out topics are written separately.
type WorkRoute = 'general' | 'mac' | 'handoff' | 'review' | 'scope';
type Pair = [route: WorkRoute, request: string, chat: string];

export const trainingPairs: Pair[] = [
  [
    'general',
    'Cảm ơn nha, nhờ Sade bóc cột đơn hủy từ bảng sáng nay rồi tính tổng.',
    'Cảm ơn nha, bảng đơn hủy mình tự tính xong rồi, báo team biết vậy thôi.',
  ],
  [
    'general',
    'Sade xem ai còn lượt, nhờ một bạn đọc file âm thanh rồi ghi đoạn cần cắt.',
    'Team nào còn lượt thì báo mình để tự chọn sau. Giờ mình chỉ đang hỏi mọi người.',
  ],
  [
    'general',
    'We are short on time. Get one available assistant to list the empty rows in the signup export.',
    'We are short on time. The signup export discussion is for the humans in this thread.',
  ],
  [
    'general',
    'ê nhờ bot lọc mấy hóa đơn chưa đóng dấu thành một danh sách nha',
    'ê mấy hóa đơn chưa đóng dấu để tui kiểm, mọi người chỉ đọc thông báo thôi nha',
  ],
  [
    'mac',
    'App thu âm chạy trên PC rồi. Cho AI test mở microphone trên Mac của Hòa khi Hòa cho phép.',
    'App thu âm chạy trên PC rồi. Câu chuyện Mac của Hòa chỉ để mọi người biết, khoan chạy kiểm tra.',
  ],
  [
    'mac',
    'không cần test lại win, nhờ chạy updater trên macbook để coi nó có bật không',
    'không cần test lại win hay mac nha, mình chỉ báo là có người thấy updater bật',
  ],
  [
    'mac',
    'Can the paired Mac run the menu-bar smoke test and report the OS and exit code?',
    'I saw the menu-bar smoke test fail on a Mac. This FYI has no action items.',
  ],
  [
    'mac',
    'Có Mac ARM bên Yến, nhờ Sade chạy thử xuất PDF ngay trên máy được cấp quyền.',
    'Có Mac ARM bên Yến để dùng nếu cần. Chỉ nhắn lịch, chưa mở lượt chạy.',
  ],
  [
    'handoff',
    'Nhờ Phong trích timestamp trước, rồi giao đúng timestamp đó cho Uyên làm phụ đề.',
    'Tui kể lại thôi, hôm qua Phong đưa timestamp cho Uyên làm phụ đề rồi.',
  ],
  [
    'handoff',
    'Cho Gemini soạn kịch bản podcast, sau đó Claude lấy kịch bản đó làm dàn ý thu âm.',
    'Gemini và Claude đã bàn giao kịch bản podcast. Team đọc để biết tiến độ nha.',
  ],
  [
    'handoff',
    'Have Iris export the icon set and start the packaging agent once that set is ready.',
    'Iris already passed the icon set to packaging. No follow-up is requested.',
  ],
  [
    'handoff',
    'Đợi Hạnh chuẩn hóa tên sản phẩm rồi mới giao trợ lý khác lập file in tem từ kết quả.',
    'Hạnh vừa kể cách chuẩn hóa tên sản phẩm rồi chuyển file in tem. Trao đổi nội bộ thôi.',
  ],
  [
    'review',
    'Patch ghi hóa đơn xong rồi. Cho agent khác tác giả đọc xem khi tiền bằng 0 có sai không.',
    'Patch ghi hóa đơn xong rồi. Mình báo cáo tiến độ, để team tự hẹn review khi rảnh.',
  ],
  [
    'review',
    'đừng merge vội, nhờ người thứ hai rà diff cập nhật giờ địa phương trước',
    'đừng merge vội, mình nói với người trong team thôi, để mai họ tự rà diff giờ địa phương',
  ],
  [
    'review',
    'Ask a separate reviewer to find any missing expense-rounding tests in this diff.',
    'I mentioned expense-rounding tests in the diff discussion. Please leave the bots idle.',
  ],
  [
    'review',
    'Nhờ Codex kiểm độc lập bản sửa cache của Gemini, nêu rủi ro rồi mới tích hợp.',
    'Codex và Gemini sẽ do mình mở để review cache sau. Tin này chỉ nhắc lịch.',
  ],
  [
    'scope',
    'Hai đứa sửa cùng danh sách học viên rồi, dừng bên đến sau và dùng lại commit có sẵn nhé.',
    'Mình kể chuyện hai đứa từng sửa chung danh sách học viên. Xử lý xong rồi, nhắn để rút kinh nghiệm.',
  ],
  [
    'scope',
    'Đang có hai lượt đụng trang hồ sơ. Nhờ Sade để một lượt sửa hồ sơ, lượt kia làm báo cáo.',
    'Có hai lượt đụng trang hồ sơ hồi sáng, đã tự chia xong rồi. Đừng mở tác vụ.',
  ],
  [
    'scope',
    'Keep one owner for invoice/export.ts and have the other harness wait.',
    'There was a duplicate change to invoice/export.ts yesterday. That is just background.',
  ],
  [
    'scope',
    'Commit thêm ảnh bìa đã có trên nhánh. Sade kiểm lại và ngăn làm cùng thay đổi lần nữa.',
    'Commit ảnh bìa đã có trên nhánh. Mình chỉ xác nhận với team, khỏi nhờ AI làm gì.',
  ],
];

export const challengePairs: Pair[] = [
  [
    'general',
    'ủa ai rảnh thì gom dấu thời gian trong biên bản họp thành bảng cho tớ với',
    'ủa biên bản có đủ dấu thời gian rồi à, ok tớ hỏi vậy thôi.',
  ],
  [
    'general',
    'Sade, bảng lớp trống cột mã môn, tìm trên tệp nguồn rồi liệt kê mã cho mình.',
    'Cột mã môn trống do giảng viên chưa nhập. Mình thông báo để cả lớp biết.',
  ],
  [
    'general',
    'Thanks, can the assistant make a three-line summary of the unread feedback now?',
    'Thanks, I saw the unread feedback count. Just saying hi to everyone here.',
  ],
  [
    'mac',
    'cái nút Export trên Windows bấm được rồi, thử giúp trên iMac được cấp quyền nha',
    'cái nút Export trên Windows bấm được rồi, imac để đó nha, chỉ báo tiến độ',
  ],
  [
    'mac',
    'Check Finder launch on a consented Mac; the owner need not have a model account.',
    'Someone mentioned Finder launch and a Mac owner with no model account. Quoted for context only.',
  ],
  [
    'mac',
    'Nhờ chạy trên Apple Silicon thật để xem thanh tiêu đề có biến mất khi mở toàn màn hình.',
    'Thanh tiêu đề trên Apple Silicon có lúc biến mất khi mở toàn màn hình. Để mình báo dev riêng, chưa nhờ chạy.',
  ],
  [
    'handoff',
    'Cho Thảo điền glossary, chuyển đúng bảng đó sang Cường để Cường dịch nút cài đặt.',
    'Thảo đã chuyển glossary cho Cường dịch nút cài đặt. Tớ nhắn tiếp nhận vậy thôi.',
  ],
  [
    'handoff',
    'Run the schema export first. Have another teammate generate the charts only after getting it.',
    'The schema export fed the charts last week. That is meeting context for the team.',
  ],
  [
    'handoff',
    'ai đầu đọc hồ sơ tóm ý chính, AI sau chờ bản tóm ý rồi viết thư theo bản đó nhe',
    'hai AI hồi đó truyền bản tóm ý để viết thư ấy. Tui kể thôi chớ chưa nhờ chạy.',
  ],
  [
    'review',
    'Nhờ một reviewer khác tác giả kiểm phần phân trang hóa đơn, tập trung vào trang cuối.',
    'Trang cuối hóa đơn là chỗ dễ quên khi review. Mình chỉ nhắc mấy bạn đang họp.',
  ],
  [
    'review',
    'Before integration, let an independent harness verify the filter patch and look for missing tests.',
    '“Let a second harness verify the filter patch” is the example I copied into the channel. No run today.',
  ],
  [
    'review',
    'Em thấy patch ghi chú đã xong, nhờ bạn AI khác đừng ghi file, chỉ xem có lỗi mất dấu không.',
    'Patch ghi chú đã xong và mình đã tự xem dấu. Chỉ báo tin vui với cả nhóm.',
  ],
  [
    'scope',
    'Sade kiểm soát giúp đừng để hai agent sửa chung layout lịch, giao lượt thứ hai sang trang khác.',
    'Logic layout lịch từng có hai agent cùng làm hồi nọ. Đoạn này chỉ là ghi chú cuộc họp.',
  ],
  [
    'scope',
    'Check whether the scroll reset was committed already and stop the duplicate change.',
    'The scroll reset was committed already. This is a status update for the humans, no action requested.',
  ],
  [
    'scope',
    'Nhóm vừa có commit sửa khoảng cách badge rồi, ngăn lượt mới sửa lại cùng file đó giúp.',
    'Nhóm vừa có commit sửa khoảng cách badge rồi, mọi người yên tâm nha.',
  ],
];
