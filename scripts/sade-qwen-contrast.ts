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

export const contextPairs: Pair[] = [
  [
    'general',
    'cái file điểm danh hôm nay có ba lớp á, gom thành một sheet tổng giùm với',
    'cái file điểm danh hôm nay có ba lớp á, mình vừa gom thành một sheet tổng rồi',
  ],
  [
    'general',
    'We have one Flash turn left. Spend it on extracting the failed import rows.',
    'We have one Flash turn left. I am saving it until someone asks about the failed import rows.',
  ],
  [
    'general',
    'Dựa vào ảnh menu gửi trên, giúp mình ghi lại giá từng món để mai nhập liệu nha.',
    'Dựa vào ảnh menu gửi trên, mình đã ghi lại giá từng món để mai nhập liệu nha.',
  ],
  [
    'general',
    'Mỗi trợ lý thử một cách đặt tên cho ba bộ lọc mới, gửi lại các phương án ở đây.',
    'Mỗi trợ lý đã thử một cách đặt tên cho ba bộ lọc mới, mình đưa lên đây để cả nhóm đọc.',
  ],
  [
    'mac',
    'Bản nén báo lỗi khi mở trên Mac M2, thử mở lại trên máy đã cấp quyền rồi ghi mã lỗi nhé.',
    'Bản nén từng báo lỗi khi mở trên Mac M2, Lan đã gửi mã lỗi nên mình chỉ cập nhật tiến độ.',
  ],
  [
    'mac',
    'Please check whether the app keeps its settings across a restart on the available Apple Silicon runner.',
    'The available Apple Silicon runner kept its settings across a restart last night. Just sharing the result.',
  ],
  [
    'mac',
    'cái nút export bị treo trên macbook, cho chạy ca export một lần rồi gửi thời gian chờ được ko',
    'cái nút export bị treo trên macbook, tui mới báo cho Phúc biết để tự thử lại sau',
  ],
  [
    'mac',
    'Máy em dùng Linux. Tìm máy Mac mà nhóm đã cho phép rồi kiểm tra vị trí lưu hình giúp em.',
    'Máy em dùng Linux. Em nghe nói vị trí lưu hình trên Mac khác, ghi chú lại để tuần sau tính.',
  ],
  [
    'handoff',
    'Bên Mai chốt thứ tự câu hỏi trước. Bên Lộc lấy thứ tự đó làm mẫu khảo sát nhé.',
    'Bên Mai chốt thứ tự câu hỏi trước, bên Lộc đã lấy thứ tự đó làm mẫu khảo sát rồi nhé.',
  ],
  [
    'handoff',
    'Export the cleaned schedule with the first assistant. Feed that exact file to the second to draft reminders.',
    'The first assistant exported the cleaned schedule and the second used it to draft reminders. Both are done.',
  ],
  [
    'handoff',
    'ủa chưa có danh sách ảnh hả, cho bên Google liệt kê trước rồi GPT dựa vô đó viết mô tả nha',
    'ủa chưa có danh sách ảnh hả, để mình hỏi bạn bên Google, GPT với mấy bot chờ mình nhắn sau',
  ],
  [
    'handoff',
    'Sau khi có sơ đồ đường đi từ trợ lý của Vy, chuyển sơ đồ đó cho bên Sơn chia các chặng.',
    'Sau khi có sơ đồ đường đi từ trợ lý của Vy, bên Sơn đã chia xong các chặng. Mình cập nhật đội biết.',
  ],
  [
    'review',
    'Mục sắp xếp theo ngày có bản sửa rồi, cho một model khác rà kết quả khi thiếu ngày giao nhé.',
    'Mục sắp xếp theo ngày có bản sửa rồi, mình đang kể để team để ý ca thiếu ngày giao trong buổi họp.',
  ],
  [
    'review',
    'Before we accept this checkout change, have an independent harness compare the totals with the examples.',
    'The checkout totals in the examples came up in the last independent review. No follow-up until the meeting.',
  ],
  [
    'review',
    'nhờ con bên Huy đọc cái patch của Gemini xem còn lọt tên rỗng ko nha, đọc rồi báo thôi',
    'con bên Huy hôm qua đọc cái patch của Gemini rồi, bảo ca tên rỗng đã có test, báo mng biết',
  ],
  [
    'review',
    'Bản dịch nút bấm đã sửa. Giao một bạn khác tác giả đối chiếu với danh sách nhãn cũ giúp.',
    'Bản dịch nút bấm đã sửa. Một bạn khác tác giả đang đối chiếu danh sách nhãn cũ nên cứ đợi.',
  ],
  [
    'scope',
    'An đang động vào trang lịch rồi. Cho bên Bình đổi sang phần trang trợ giúp để khỏi trùng.',
    'An đang động vào trang lịch rồi. Bình đã tự chuyển qua trang trợ giúp, xác nhận với team vậy.',
  ],
  [
    'scope',
    'The receipt formatter is already patched. Reuse that change and move the other runner to tests.',
    'The receipt formatter is already patched. The other runner is doing tests and I am just reporting the split.',
  ],
  [
    'scope',
    'hai con đang dịch chung file tiếng Nhật á, giữ một con làm file đó thôi, con kia qua tiếng Hàn hộ',
    'hai con từng dịch chung file tiếng Nhật, tụi tui chia tiếng Nhật tiếng Hàn xong rồi á',
  ],
  [
    'scope',
    'Khoanh phần lọc danh sách cho một harness duy nhất, cho bên còn lại đọc tài liệu trong lúc đợi.',
    'Phần lọc danh sách đã có người nhận, bên còn lại đang đọc tài liệu. Tin này để chốt biên bản.',
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

// Reserved for comparing checkpoint behavior. Each pair changes what the
// sender is asking the group to do while keeping the workspace context.
export const acceptancePairs: Pair[] = [
  [
    'general',
    'mình mới vô nhóm á, còn ai có lượt AI thì nhờ Sade gom các email chưa có mã vé dùm',
    'mình mới vô nhóm á, ai còn lượt AI nhắn mình để tính lịch nha, danh sách email chưa có mã vé mình tự gom',
  ],
  [
    'general',
    'Could someone have the available assistant turn the unread sponsor notes into three bullets for us today?',
    'Could someone ask Mai whether she is already turning the sponsor notes into bullets? I am checking with the team here.',
  ],
  [
    'general',
    'Claude báo hết quota. Sade xem Gemini bên Tâm có quyền đọc sheet chi phí không, nếu có nhờ làm bản tổng hợp.',
    'Claude báo hết quota. Gemini bên Tâm đọc sheet chi phí được. Mình kể để team tính người phụ trách ở buổi mai.',
  ],
  [
    'mac',
    'win ra tiếng bth, Sade gửi lượt test âm lượng sang Mac Dung đã cho nhóm dùng được k',
    'win ra tiếng bth, Mac Dung chưa tới lượt test. Dung với tớ thống nhất trao đổi trước, khoan chạy.',
  ],
  [
    'mac',
    'Smoke test the notarized build on an authorized arm64 Mac and return launch time and exit status.',
    'The arm64 Mac smoke test and exit status are written in my notes. Sharing for the release call only.',
  ],
  [
    'mac',
    'Tớ trên PC, máy Mac của Vy có cấp quyền thì nhờ kiểm mở menu Share. Vy chỉ có Kivuno, chưa cài AI.',
    'Vy chỉ có Kivuno trên máy Mac nên tớ báo nhóm trước. Menu Share để Vy tự xem trong buổi demo.',
  ],
  [
    'handoff',
    'nhờ Gemini của em lấy tên cột trước, xong chuyển nguyên tên cột qua Claude của anh để ráp form',
    'Gemini của em đưa tên cột qua Claude của anh rồi à? Anh với em xem chung giúp, em hỏi tiến độ thôi.',
  ],
  [
    'handoff',
    'After the starter design exists, route its copy notes to the translation teammate. Keep the original author free for layout.',
    'In our playbook the instruction reads “route the copy notes to translation.” Pasting the wording for the team to discuss.',
  ],
  [
    'handoff',
    'Để An viết outline. Khi An báo xong thì Sade gửi đúng bản đó cho Bình chuẩn bị slide.',
    'Hôm qua An nhắn Bình dùng outline để chuẩn bị slide. Chuyển lời lại cho nhóm biết, ai cũng đang làm phần mình.',
  ],
  [
    'review',
    'Bản Gemini thêm tính điểm xong rùi, Sade kiếm bạn AI khác đọc diff coi điểm trống xử lý sao, giữ nguyên file giúp.',
    'Bản Gemini thêm tính điểm xong rùi, mình đã nhắc cả nhóm nhớ soi điểm trống khi họp, cứ để nguyên như vậy nha.',
  ],
  [
    'review',
    'Get one non-author harness to review timezone handling in the patch. Hold the merge because an earlier review covered a different diff.',
    'We are holding the merge. “Get one non-author harness to review timezone handling” is an example for tomorrow’s onboarding doc.',
  ],
  [
    'review',
    'Mình tự đọc phần happy path rồi, nhờ Sade thuê lượt kiểm khác xem chỗ số lượng bằng 0 trước khi tích hợp.',
    'Mình tự đọc phần happy path và số lượng bằng 0 rồi, ghi vào group để mọi người xem kết quả.',
  ],
  [
    'scope',
    'hai con đang mò cùng file giỏ hàng hả, Sade giữ lượt của An còn bên kia dời sang test bảng giá giùm',
    'hai con hồi nãy mò cùng file giỏ hàng, An với tớ chia lại xong rồi, báo để cả nhóm khỏi mất công hỏi á',
  ],
  [
    'scope',
    'The date-format change is already on the sidebar branch. Ask Sade to reuse that commit and cancel the redundant write task.',
    'The date-format change is already on the sidebar branch. I canceled the redundant write task and posted this for the record.',
  ],
  [
    'scope',
    'Để tránh đụng route đăng ký, Sade cho mỗi agent giữ một file riêng rồi ghi lại ai đang phụ trách file nào.',
    'Để tránh đụng route đăng ký, bọn mình đã tự chia mỗi người một file. Ghi lại ở đây để team dễ tra.',
  ],
];
