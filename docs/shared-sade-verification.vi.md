# Sade trong Shared Groups

Mỗi thành viên chia sẻ teammate của mình trong nhóm, mở phần **Let Sade use your teammate**, chọn project và xác nhận trên desktop. Hai project phải dùng cùng Git origin và nhánh. Mỗi quyền áp dụng cho một harness trên máy của chủ tài khoản, hết hạn sau một giờ và giới hạn từ một đến mười lượt. Quyền này cũng cấp lượt cho công việc của nhóm khi provider không báo quota. Quyền xem là mặc định. Tùy chọn sửa file cho phép chuẩn bị thay đổi trong worktree riêng và chuyển diff đã lọc cho người kiểm tra.

Người gửi chọn **Ask Sade** và gửi một tin nhắn để lập kế hoạch. Sau khi gửi thành công, ô soạn quay về chế độ gửi tin nhóm thông thường. Nếu người gửi chỉ báo tình hình qua **Ask Sade**, planner có thể kết thúc bằng một thao tác riêng, kèm lời giải thích. Nhóm xem được người đang làm, nhiệm vụ chờ và câu hỏi cần trả lời. Nếu harness cần biết phong cách giao diện, người gửi có thể chọn phong cách hoặc nhờ harness quyết định. Nhiệm vụ tiếp tục trong lượt được cấp tiếp theo. Gửi lại cùng tin nhắn không lập thêm workflow.

Desktop giữ kết quả đầu tiên đã được chấp nhận của planner hoặc reviewer. Lời gọi lặp đúng nội dung được xác nhận một lần nữa. Lời gọi mâu thuẫn trong cùng lượt bị từ chối. Planner vẫn có thể sửa và gửi lại đầu ra nếu lần trước bị lỗi kiểm tra cấu trúc.

Planner nhận mã ngắn cho từng teammate cùng tên gốc và tên không dấu khi khác nhau. Desktop đối chiếu mã với roster của lượt lập kế hoạch và chuyển về ID quyền đã cấp trước khi nộp kế hoạch. Mã ngoài roster bị từ chối. Kế hoạch tham chiếu dependency không tồn tại trả về các khóa đã khai báo để harness có thể sửa trong cùng lượt. Việc phân công chỉ bắt đầu khi kế hoạch hợp lệ.

Sade dùng tên chủ tài khoản và quyền của project để phân biệt các harness trùng tên. **Sade progress** hiển thị tên harness cùng tên chủ tài khoản. Nếu còn mơ hồ, người gửi dùng **Reply to Sade**. Nếu teammate chưa được cấp quyền, chủ tài khoản xác nhận quyền trên desktop rồi người gửi báo lại trong cùng yêu cầu. Sade đọc các quyền còn hiệu lực của đúng project ở lượt lập kế hoạch tiếp theo.

Khi project có hơn 32 harness đã cấp quyền, planner tra cứu theo từng trang bằng tên, chủ tài khoản, provider hoặc hệ điều hành. Kết quả dùng mã teammate của lượt lập kế hoạch và nhận được tên tiếng Việt không dấu. Nếu desktop chưa hỗ trợ tra cứu, yêu cầu chờ ở trạng thái xếp hàng và giữ nguyên số lượt. Bài kiểm thử hai workspace dùng 33 harness, gồm hai harness trùng tên của hai chủ khác nhau. Planner tìm đúng harness thứ 33 và giao việc cho desktop đã cấp quyền. Kết quả là bằng chứng giao thức với harness mô phỏng.

Một desktop có thể cấp quyền cho nhiều project. Desktop gửi tối đa 32 grant mỗi lượt, luôn kèm grant của công việc đang chạy và luân phiên các grant còn lại. Nếu cuộc gọi thất bại, desktop thử lại cùng trang. Bài hồi quy thêm 35 grant của project khác rồi xác nhận việc còn chờ được giao ở lượt kế tiếp và tiếp tục nhận tín hiệu duy trì phiên khi desktop sang trang.

Nếu phản hồi giao việc bị mất, máy chủ có tối đa 60 giây từ lần giao đầu để gửi lại cùng mã công việc cho đúng desktop. Một lượt Kivuno được giữ cho công việc đó. Desktop ghi nhận mã một lần và báo lại khi đang giữ phiên. Sau xác nhận, thời hạn duy trì trên máy chủ trở về 30 giây và việc gửi lại dừng. Bài thử mô phỏng mất phản hồi và nhận gói lặp khi lập kế hoạch, sửa file và sửa lại theo review. Nếu chủ bản vá thu hồi quyền giữa hai lần giao, máy chủ dừng bàn giao bản vá cho bước phụ thuộc.

Chấm lại hai kế hoạch do GPT-6-Luna với reasoning `high` tạo qua Codex CLI đã đăng nhập. Cả hai giữ đúng Codex của An cho bước đọc hợp đồng và Claude của Bình cho bước đối chiếu mã, cùng phạm vi file và thứ tự phụ thuộc. Model chọn hai nhãn chỉ đọc khác nhau cho bước đối chiếu, gồm review và nghiên cứu. Bộ chấm ban đầu chỉ chấp nhận một nhãn. Kiểm tra lại yêu cầu cho thấy cả hai đầu ra giữ đúng phạm vi chỉ đọc và bàn giao. Khi phát lại hai kế hoạch qua Shared Groups, cả hai lần đều phục hồi cùng mã lập kế hoạch với một lượt Kivuno. Phần nhận việc của hai harness dùng tài khoản mô phỏng.

Commit `d81cb6e` đạt 352 bài trên Windows và 347 bài trên macOS arm64, bỏ qua lần lượt một và sáu bài theo nền tảng. Cả hai qua build, Electron và giao diện Shared Groups. Bộ 1.000 tin gồm 50 ca mất phản hồi, thử gửi lại trước khi có xác nhận và kiểm tra việc dừng sau khi phiên đã hết hạn. Lượt Windows–Mac qua mạng chạy cùng commit và đạt cả giao việc khi mất phản hồi lẫn bàn giao kiểm thử sang máy Mac thật. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44512409445) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44512511237)

Khi kết hợp với giới hạn ghế của gói Kivuno, Sade cập nhật quyền của từng nhóm trước khi giao việc. Ghế bị khóa dừng công việc gắn với quyền đó. Các project khác trên cùng desktop vẫn nhận việc và duy trì phiên. Chủ harness có thể thu hồi grant của mình khi ghế đang khóa. Phản hồi chỉ xác nhận việc thu hồi. Desktop từ chối tạo grant cho profile bị khóa bởi gói Kivuno.

Trên nhánh đã ghép thay đổi về gói của `main`, Windows đạt 350 bài và bỏ qua một bài theo nền tảng ở commit `2832dbd`. macOS arm64 đạt 345 bài và bỏ qua sáu bài theo nền tảng trên cùng commit. Cả hai qua build, Electron, giao diện Shared Groups và bộ 1.000 tin mô phỏng. Bài bàn giao Windows–Mac arm64 đạt ở commit `7c8e736`, cùng mã ứng dụng với `2832dbd`. Hai commit khác nhau ở fixture giữ chỗ profile cho hai bài giao diện. [CI macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44510483025) · [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44510094728)

Windows chạy 340 bài và bỏ qua một bài theo nền tảng ở commit `912401f`. Build, Electron, giao diện Shared Groups và bộ 1.000 tin đều đạt. macOS arm64 chạy 335 bài, bỏ qua sáu bài theo nền tảng và qua các bài giao diện. [Kiểm thử macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44507015451)

Lượt bàn giao qua mạng chạy ở commit `17d038b`. Máy Mac arm64 ghép cặp tái hiện lỗi đường dẫn, chạy lại thành công sau khi sửa và trả đúng tệp được cấp quyền về Windows. Commit `912401f` bổ sung kiểm tra kiểu cho dữ liệu bài thử. [Bàn giao Windows–Mac](https://github.com/dakiemdarktharr/WWW/actions/runs/44506869643)

GPT-6-Luna với reasoning `high` qua Codex CLI đã đăng nhập chọn đúng Astra của Bình ở cả hai câu tổng hợp, gồm cách nói có dấu và casual không dấu. Model gọi công cụ tra cứu MCP chỉ đọc và trả mã `member-33`, với đúng phạm vi `README.md`. Phép đo dùng prompt cùng bộ kiểm tra kế hoạch của Sade và danh sách 33 harness mô phỏng. Chỉ công cụ tra cứu của bài thử được cho phép trong phiên CLI tạm. Kết quả đo khả năng chọn đúng chủ sở hữu, phần giao việc giữa nhiều tài khoản vẫn dùng bài hồi quy giao thức ở trên. [Thiết lập quyền cho từng công cụ MCP](https://learn.chatgpt.com/docs/config-file/config-reference)

Biểu mẫu lập kế hoạch gọi rõ hành động sửa file, sửa thiết kế, nghiên cứu chỉ đọc và review chỉ đọc. Sửa tài liệu là tác vụ sửa file. Sade chuyển các tên hành động về loại tác vụ nội bộ trước khi áp dụng quyền đã cấp và yêu cầu hệ điều hành.

Khi chia việc, Sade tính khối lượng của các tác vụ đã chỉ định trước khi chọn harness cho việc còn trống. Với tác vụ review trong kế hoạch, Sade lần theo cả các bước phụ thuộc gián tiếp và loại profile của chủ tài khoản đã nhận quyền ghi vào các file thuộc phạm vi review. Người chỉ chạy test hoặc viết file ngoài phạm vi đó vẫn đủ điều kiện. Sade kiểm tra lại trước khi giao một lượt review đã được lập từ bản cũ.

Trước khi giao việc, Sade thử phương án phân công khác nếu lựa chọn ban đầu làm mất người review độc lập hoặc lấy mất lượt cuối dành cho tác vụ chỉ chạy trên một hệ điều hành. Tác vụ đã chỉ định người vẫn giữ nguyên phân công. Hai bài hồi quy dùng grant và ngân sách thử nghiệm. Bài thứ nhất giữ Gemini làm hợp đồng, giao thêm backend cho chủ harness làm frontend để Gemini còn đủ điều kiện review cả hai file nguồn. Bài thứ hai giao việc đọc cấu hình sang Mac để dành lượt Windows cho bài kiểm tra mở app.

Trong **Sade progress**, người gửi yêu cầu, chủ nhóm và chủ harness đang chạy có thể chọn **Update task**. Codex nhận tín hiệu trong lượt hiện tại. Gemini, Claude và Antigravity đọc chỉ đạo qua công cụ Kivuno trong cùng lượt. Phạm vi, quyền và số lượt đã cấp tiếp tục áp dụng. Nhóm thấy số chỉ đạo đã được chuyển đến harness. Nếu lượt kết thúc khi còn chỉ đạo chưa đọc, Sade giữ thay đổi trong worktree và chặn việc giao nhiệm vụ tiếp theo.

Shared Groups nhận một workflow đang hoạt động cho mỗi nhóm hoặc project. Bài hồi quy dùng hai người gửi và xác nhận tin yêu cầu thứ hai bị từ chối khi tác vụ ghi đang chạy. Sau khi tác vụ kết thúc, cùng ID tin nhắn có thể được gửi lại để mở workflow mới.

Kivuno dùng tài khoản provider đã đăng nhập trên desktop của từng chủ quyền. Máy chủ nhận ID quyền, thông tin công việc và kết quả cần chia sẻ. Khi người dùng bật sửa file, hộp thoại xác nhận nêu rõ việc gửi diff cho reviewer độc lập và bàn giao patch đã duyệt cho harness được phân công. Patch chỉ đi qua hàng đợi công việc theo quyền. Worktree, đường dẫn cục bộ và credential của provider nằm ở máy sở hữu. Thu hồi quyền, hết lượt hoặc mất heartbeat sẽ dừng cấp việc mới và chặn bàn giao patch chưa gửi. Desktop giữ kết quả chưa gửi ở máy khi quyền bị thu hồi hoặc hết hạn. Bài kiểm thử Electron giữ một lượt gửi đang chờ, thu hồi quyền của kết quả tiếp theo và xác nhận desktop bỏ bản gửi đó dù máy chủ tạm thời chưa nhận được lệnh thu hồi.

Nếu kiểm tra quota trên desktop xác nhận tác vụ chưa bắt đầu được, Sade hoàn lượt Kivuno đã giữ. Tác vụ do Sade tự phân công có thể chuyển sang teammate đủ quyền trong cùng workflow, giữ nguyên phạm vi, yêu cầu hệ điều hành, review độc lập và các chỉ đạo từ nhóm. Lần giao mới có ID riêng để kết quả đến muộn của lần cũ bị từ chối. Tác vụ chỉ định harness cụ thể sẽ chờ người dùng quyết định. Cả máy chủ và desktop cần hỗ trợ trao đổi trạng thái này.

Sau review độc lập, chủ máy kiểm tra và tích hợp thay đổi cục bộ. Sade bàn giao patch đã duyệt cho nhiệm vụ phụ thuộc qua Shared Groups. Desktop nhận kiểm tra digest và danh sách file, rồi áp dụng patch trong worktree riêng trước khi mở harness. Nhánh Git của người nhận chỉ nhận thay đổi khi chủ máy chọn tích hợp. Quyền cũ vẫn sử dụng **Share published revision**. Cấp lại quyền trên desktop mới để cho phép bàn giao patch.

Khi reviewer yêu cầu sửa, Sade có thể dùng một lượt sửa và lượt review tiếp theo trong ngân sách đã cấp. Desktop và máy chủ xác nhận hỗ trợ trước khi dùng luồng này. Sade đưa nhận xét về phiên và worktree gốc của tác giả. Mỗi lần giao việc có ID riêng để kết quả cũ không thể duyệt bản sửa. Tác vụ phụ thuộc chờ bản mới được review và tích hợp. Sade dừng nếu hết lượt, phiên gốc mất liên lạc, một lượt review khác vẫn đang chạy, bản sửa rỗng hoặc trùng bản bị từ chối, hoặc reviewer yêu cầu sửa lần thứ hai. Worktree ở lại máy tác giả.

Khi nhánh đích đã có đúng nội dung và mode Git của toàn bộ file chịu tác động, Shared Groups báo task hoàn tất với revision hiện tại. Kiểm tra này chạy sau khi xác nhận review và bao gồm các file được chuyển từ task trước. Nếu nhánh đích vẫn thiếu một file kế thừa, Sade tiếp tục tích hợp. Nếu Git không còn gì để tích hợp nhưng nội dung đã duyệt cũng không còn ở nhánh đích, task chờ người dùng kiểm tra lại. Các project dùng AEGIS tiếp tục áp dụng quy trình duyệt tích hợp chính xác.

Tích hợp qua Shared Groups đối chiếu nội dung và mode Git của các file chịu tác động sau khi gộp. Nếu nhánh đích đã thay đổi cùng file và kết quả Git gộp khác bản đã review, Sade giữ task ở trạng thái review và trả nhánh đích về trước lần tích hợp. Worktree vẫn giữ bản đề xuất. Bài hồi quy dùng Git thật để xác nhận hai sửa đổi ở hai đoạn tách biệt trong một file bị giữ lại khi tổ hợp của chúng chưa được duyệt. Khi commit mới sửa file khác, Sade tích hợp bình thường và giữ cả commit đó.

Nếu một tác vụ ghi hoàn tất với worktree nguyên trạng, Sade dùng revision Git gốc của lần chạy làm điều kiện bàn giao cho các tác vụ phụ thuộc. Máy nhận kiểm tra nhánh đã liên kết và chờ nếu commit chưa có trong lịch sử nhánh đó. Chỉ tải object Git về vẫn chưa đủ. Sau khi chủ máy đồng bộ nhánh, Sade tiếp tục cùng tác vụ, từ một worktree ghim vào revision vừa kiểm tra. Khâu chờ giữ một lượt cấp quyền đã đặt trước và chưa khởi động provider. Revision đi trong gói bàn giao đến desktop đã được cấp quyền. Desktop cũ cần cập nhật để báo revision cho công việc có bước phụ thuộc.

Nếu kế hoạch đã giao review cho một chủ tài khoản khác, với đúng phạm vi và chỉ phụ thuộc vào một tác vụ sửa, chính tác vụ review đó nhận diff khi bản sửa sẵn sàng. Sade giữ người được giao và tiêu chí review. Reviewer nhận tên, mô tả, tiêu chí nghiệm thu của tác vụ sửa và câu trả lời gần nhất của người gửi nếu có. Nếu cùng một diff có nhiều lượt review, mỗi lượt phải chấp thuận trước khi tích hợp. Nhiệm vụ phụ thuộc vẫn chờ kết quả tích hợp. Nếu tác vụ sửa kết thúc với worktree nguyên trạng, phần review đã yêu cầu tiếp tục dưới dạng kiểm tra chỉ đọc trên file hiện có.

Khi workflow có grant của nhiều chủ tài khoản, Sade giữ một lượt review độc lập trước khi giao mỗi tác vụ ghi mà kế hoạch chưa có reviewer. Lượt được giữ trong ngân sách của nhóm và chỉ tính đã dùng khi giao review. Tác vụ ghi khác chờ nếu chưa có lượt review trống. Nếu tác vụ trước kết thúc với worktree nguyên trạng, lượt review trở lại ngân sách. Nếu lượt đã dành cho review thực tế, tác vụ đang review vẫn có thể hoàn thành và tích hợp trước khi Sade báo thiếu lượt cho việc tiếp theo. Với kế hoạch đã dành hết lượt của bên review cho công việc khác, Sade báo thiếu lượt trước khi mở harness sửa file.

Trong project được AEGIS bảo vệ, approval vẫn xác minh chính xác tập file và byte trên nhánh đích. AEGIS có thể chặn tích hợp nhiệm vụ phụ thuộc nếu nhánh đích còn thiếu patch đầu vào.

## Kết quả A–D

| Tình huống                                | Phần đã kiểm tra                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Một tin nhắn giao việc cho hai harness | Hai workspace độc lập dùng Gemini và Codex protocol fixture, với Git thật. Kiến trúc được review và tích hợp cục bộ rồi được chuyển sang worktree frontend. Frontend hỏi về phong cách, tiếp tục sau câu trả lời và được review riêng. SHA của nhánh từ xa giữ nguyên trong suốt lần chạy.      |
| B. Công việc hoặc commit trùng            | Phạm vi ghi chồng nhau được xếp hàng. Tin nhắn lặp chỉ tạo một workflow. Hai workspace Git thật đã dùng lại commit có sẵn, chờ nhánh bên nhận đồng bộ rồi tiếp tục cùng tác vụ, và giữ một lượt đã cấp. Fixture kiểm tra chỉ đạo giữa lượt cho bốn adapter. Tương đương ngữ nghĩa chưa được đo. |
| C. Review độc lập                         | Tích hợp chờ verdict của reviewer độc lập và kiểm lại digest. Qwen cục bộ chặn đúng 8/9 bản có lỗi và duyệt đúng 6/9 bản đúng trong phép đo riêng. Chính sách desktop vẫn chọn model theo catalog của reviewer. Phiên review với tài khoản provider đã đăng nhập còn cần kiểm chứng.            |
| D. Windows nhờ Mac kiểm tra               | Windows thật dùng cầu nối Kivuno đến runner macOS arm64 thật trong CI. Công cụ trên Mac tái hiện lỗi đường dẫn, áp dụng bản sửa theo yêu cầu fixture, chạy lại thành công và gửi một file đúng scope về Windows. Mac chạy ở chế độ chỉ dùng công cụ.                                            |

Nếu máy Mac chỉ chạy công cụ, chủ máy ghép máy với project qua **Machines** và xác nhận quyền chạy lệnh. Trong nhóm, người dùng Windows chọn cùng project, bật **Allow local file changes**, chọn máy trong **Paired machine** rồi xác nhận quyền cho harness của mình. Khi **Ask Sade** nhận yêu cầu chạy trên macOS, harness dùng tài khoản trên Windows, kiểm tra hệ điều hành của máy ghép cặp trước khi chuyển worktree, chạy thao tác kiểm thử trên máy Mac và chuyển về các thay đổi trong scope để review. Kết quả nhóm ghi mã thoát hoặc timeout do máy trả về. Chủ máy Mac cần Kivuno để cấp và thu hồi quyền, còn phiên AI chạy ở máy Windows.

Fixture D dùng hai workspace và một runner công cụ trên máy kiểm thử. Runner thực sự chuẩn bị worktree và chạy Node. Bài kiểm thử trước hết để runner trả hệ điều hành thực tế và xác nhận yêu cầu bị từ chối nếu hệ điều hành khác với quyền đã ghép. Sau đó bài kiểm thử mô phỏng phản hồi đúng hệ điều hành để xác minh luồng cấp việc, chuyển file và báo kết quả. Một runner ngoài quyền và một grant đã đổi ID đều bị chặn. Các bài `machine-execution.test.ts` kiểm tra riêng việc giữ credential trên máy nguồn, phạm vi pull, hết hạn và thu hồi khi lệnh đang chạy.

Runner hỗ trợ truyền từng phần giới hạn mỗi gói dữ liệu ở 768 KiB trước khi mã hóa, mỗi file ở 4 MiB và mỗi snapshot ở 8 MiB hoặc 2.000 file. Receiver kiểm tra thứ tự, độ dài, SHA-256 và trạng thái worktree trước khi áp dụng. Runner đời cũ tiếp tục dùng định dạng một gói với giới hạn 512 KiB mỗi file và 2 MiB mỗi snapshot.

Thử thực tế trên Windows đã chuyển đủ 267 file của repo Kivuno sang một runner cục bộ biệt lập, xuất trở lại và so khớp từng byte. Snapshot chứa khoảng 5,5 MiB file gốc, dùng 10 gói mỗi chiều. Node đọc thành công `package.json` trong worktree đích. Bài hồi quy `machine-execution.test.ts` còn đi qua broker và runner agent với asset 3 MiB, đồng thời kiểm tra rằng huỷ khi đang gửi một phần không áp dụng file.

CI trên macOS arm64 với Node 24.22.1 đã chạy commit `3fc1d2f`. `npm run check` đạt 308 bài và bỏ qua 6 bài theo nền tảng. Electron Desktop và giao diện Shared Groups đều đạt. Audit dependency runtime đạt ngưỡng high và báo 20 mục moderate. Cùng commit, Windows đạt 313 bài, bỏ qua một bài theo nền tảng, và giao diện Shared Groups đạt. Bộ 1.000 tin dùng planner mô phỏng đạt trên cả hai hệ điều hành. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44471124584)

CI dùng máy ảo macOS và fixture provider. Bài kiểm thử riêng bên dưới bổ sung bằng chứng kết nối giữa hai máy qua mạng. Phiên dùng tài khoản provider đăng nhập thật và máy Mac của thành viên vẫn cần xác minh riêng.

### Bàn giao giữa Claude và Antigravity

Bài kiểm thử dùng hai desktop có hồ sơ và worktree Git riêng. Một tin tiếng Việt mở một lượt lập kế hoạch qua adapter Claude. Máy này ghi đúng một file sau khi người dùng duyệt. Antigravity dùng quyền chỉ đọc để review diff và kiểm tra đầu ra khi bản sửa đã được tích hợp cục bộ. Worktree kiểm tra nhận bản vá đã duyệt, còn nhánh Git của máy Antigravity giữ nội dung gốc. Mỗi bên dùng đúng hai lượt theo quyền đã cấp. Catalog thử nghiệm có biến thể Flash, nên bài test xác nhận Sade chọn Flash với reasoning cao cho review và model mặc định với reasoning trung bình cho bước kiểm tra đầu ra.

Hai adapter mở tiến trình fixture qua giao thức tương ứng và gọi công cụ Kivuno qua MCP. Phép thử dùng hồ sơ đăng nhập giả và không gọi dịch vụ model. Hướng dẫn đọc phòng chat và gửi tiến độ của Claude chỉ xuất hiện khi phiên có công cụ tương ứng.

```powershell
node --import tsx --test --test-name-pattern 'one group message hands off' tests/shared-sade.test.ts
```

### Chạy lại tình huống D qua mạng

Chế độ tùy chọn `paired-macos` đã có trong workflow **Verify RELAY**. Phép thử dùng project Git tổng hợp trên Windows, một runner công cụ macOS arm64 và cầu nối desktop Kivuno cô lập. Cấu hình runner chỉ cấp khi danh tính GitHub Actions khớp origin, workflow và commit. Phép thử có một lỗi xử lý đường dẫn qua dấu gạch chéo, đi qua thứ tự chạy trên Windows, tái hiện lỗi trên macOS, sửa trên máy đích, kéo thay đổi trong scope về Windows, review độc lập và tích hợp cục bộ. Quick Tunnel chỉ mở trong lúc thử. [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Commit `62f9aa2` đã qua bài kiểm thử ở cả hai đầu. Lượt chạy đầu trên macOS trả mã thoát 1, lượt sau khi sửa trả 0. File `.env.local` trên Windows không vào snapshot. Tiến trình Node trên Mac không nhận biến môi trường provider giả của runner. Windows kéo đúng `path-label.cjs`, chạy lại thành công rồi dùng review độc lập trước khi tích hợp. SHA trên Git remote của project thử giữ nguyên. Cùng commit, `npm run check` trên Windows đạt 300 bài và bỏ qua một bài theo nền tảng, còn giao diện Shared Groups đạt. [GitHub Actions macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44450379635)

Commit `bc04550` của nhánh `codex/sade-shared-groups-verification` chứa các đầu PR #5–#10 tại lúc kiểm chứng. Cùng commit đó chạy trên Windows và macOS arm64. Windows qua bài kiểm tra ban đầu, macOS trả mã 1 vì lỗi tách đường dẫn, rồi trả mã 0 sau khi sửa. Bài kiểm thử xác nhận `.env.local` ở Windows nằm ngoài dữ liệu gửi, kéo đúng `path-label.cjs` vào worktree và chỉ tích hợp sau review độc lập. SHA của Git remote thử nghiệm giữ nguyên. Bên Mac xác nhận giao nhận hai chiều. Kịch bản model dùng fixture giao thức, còn lệnh Node và việc chuyển bản vá chạy trên hai hệ điều hành thật. [Lượt kiểm thử macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44499579242)

Trên cùng mã nguồn, Windows đạt 340 bài khi chạy tuần tự và bỏ qua một bài theo nền tảng. macOS arm64 đạt 335 bài và bỏ qua sáu bài theo nền tảng. Hai bên đều build thành công và qua kiểm thử Electron, giao diện Shared Groups cùng bộ 1.000 tin dùng kế hoạch mô phỏng. [Bộ kiểm tra đầy đủ trên macOS](https://github.com/dakiemdarktharr/WWW/actions/runs/44500123122)

Trên Windows, checkout nhánh cần thử và cài dependency bằng `npm ci`. Mở `cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:58173` trong một shell riêng và lấy HTTPS origin từ đầu ra. Dùng cùng nhánh và commit trên GitHub.

```powershell
$env:KIVUNO_CROSS_HOST_ORIGIN = '<HTTPS origin từ cloudflared>'
$env:KIVUNO_CROSS_HOST_PORT = '58173'
$branch = (git branch --show-current).Trim()
$env:KIVUNO_CROSS_HOST_WORKFLOW = "dakiemdarktharr/WWW/.github/workflows/ci.yml@refs/heads/$branch"
$env:KIVUNO_CROSS_HOST_SHA = (git rev-parse HEAD).Trim()
$remote = (git ls-remote --heads origin "refs/heads/$branch").Split()[0]
if ($remote -ne $env:KIVUNO_CROSS_HOST_SHA) { throw 'Windows và GitHub phải dùng cùng commit.' }
$run = gh workflow run ci.yml --repo dakiemdarktharr/WWW --ref $branch `
  -f platform=paired-macos -f "paired_origin=$env:KIVUNO_CROSS_HOST_ORIGIN"
if ($LASTEXITCODE -ne 0 -or $run -notmatch '/actions/runs/(\d+)') { throw 'Không tìm thấy lượt chạy Mac.' }
$env:KIVUNO_MAC_RUN_ID = $Matches[1]
node --import tsx --test --test-name-pattern 'two desktop workspaces' tests/shared-sade.test.ts
```

Đối chiếu kết quả trên Windows và ở lượt GitHub Actions đã lưu. Máy Mac nhận quyền thử nghiệm khi token OIDC khớp nhánh, commit, origin và ID lượt chạy. Dừng tunnel khi hai đầu đã kết thúc.

## Kiểm thử 1.000 tin nhắn

`npm run test:shared-sade` chạy 20 tình huống × 10 cặp provider/gói × 5 cách diễn đạt. Có tiếng Việt có dấu, không dấu, người mới, kỹ thuật và chuyên gia song ngữ. Bài test đi qua Shared Groups, database, grant và bộ điều phối thật. Kế hoạch do fixture cung cấp để kiểm tra điều kiện giao việc, review, budget và phục hồi cả khi đầu ra model bị sai. Fixture cấp từ một đến năm lượt Kivuno tùy cặp và tình huống. Nhãn gói dịch vụ và quota của provider được mô phỏng.

Trong 200 tin về review, 80 ca có reviewer được chỉ định trong kế hoạch, còn 120 ca dùng reviewer do Sade chọn. Mỗi ca xác nhận có đúng một lượt review cho diff, chủ thay đổi không gửi được verdict thay reviewer và không có lượt review phát sinh sau khi tích hợp.

850 kế hoạch hợp lệ về cấu trúc đi qua bộ phân giải mã teammate trước khi đến bộ điều phối. Thêm 50 ca chỉ định teammate chưa cấp quyền, xác nhận cả bước phân giải ở desktop và bước kiểm quyền ở bộ điều phối đều từ chối. Các ca chat thường và mất lease giữ cách kiểm thử riêng.

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

### Qwen lập kế hoạch A–D qua công cụ thật

Dùng Qwen3 4B Instruct 2507 Q4_K_M qua Ollama cục bộ và 18 tin tổng hợp. Mỗi tình huống có ba cách nhắn thường, không dấu và kỹ thuật song ngữ. Model nhận prompt và schema của planner. Kế hoạch đi qua bộ kiểm tra của Shared Groups với grant thử nghiệm. Bài chấm đo đúng người, phạm vi file, dependency, số việc review và yêu cầu macOS. Phần thực thi provider, sửa code và quyền trên máy của người dùng được kiểm tra riêng.

| Tình huống                              | Công cụ cũ | Công cụ và prompt mới |
| --------------------------------------- | ---------- | --------------------- |
| A. Đúng hai người và thứ tự bàn giao    | 0/3        | 1/3                   |
| B. Một người ghi vào file được nêu      | 0/3        | 3/3                   |
| C. Review độc lập trong một lượt review | 0/3        | 0/3                   |
| D. Chọn Mac ghép cặp                    | 0/3        | 3/3                   |
| D. Báo thiếu Mac và giữ đúng yêu cầu OS | 0/3        | 3/3                   |
| Chỉ báo tình hình trong Ask Sade        | 3/3        | 2/3                   |
| Tổng số ca đúng                         | 3/18       | 12/18                 |

Công cụ cũ tạo danh sách việc rỗng cho cả 18 tin. Kết quả này lặp lại qua cả chế độ ép JSON và gọi công cụ trực tiếp. Công cụ mới yêu cầu danh sách việc có ít nhất một mục, dành riêng một công cụ để đóng tin không giao việc và xác thực các trường người được chỉ định cùng hệ điều hành. Kết quả mới có 16/18 phản hồi qua được kiểm tra cấu trúc. Các ca còn lại gồm chọn sai người, dependency thiếu, hai kế hoạch thêm bước review dư, một lỗi HTTP 500 từ Ollama và một tin cập nhật bị phân loại thành yêu cầu rồi bị chặn. Điểm số này dùng để cải thiện hợp đồng lập kế hoạch. Cấu hình sản phẩm tiếp tục dùng tài khoản harness đã được cấp quyền.

Chạy Ollama trên `127.0.0.1:11565` với model `qwen3:4b-instruct-2507-q4_K_M`, digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`. Kết quả JSON ghi digest model, hash schema và prompt, từng kế hoạch, trạng thái, lỗi và thời gian. Commit `dfb8edc` giữ phiên bản đối chứng. Chạy cùng lệnh thêm `--native` ở commit đó để kiểm tra lại chế độ gọi công cụ cũ.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-native.json
```

Ở commit `b91a40b`, khi chấm lại cùng 18 đầu ra đã lưu, với cùng digest model, hash prompt và hash bộ công cụ, bộ điều phối mới đạt 14/18. Hai kế hoạch C có review khớp phạm vi đều chạy đúng một lượt review rồi hoàn tất. Ca C gặp HTTP 500 vẫn giữ kết quả lỗi. Bước chấm lại dùng diff tổng hợp và verdict thử nghiệm. Kết quả đo việc dùng lại tác vụ review ở bộ điều phối. Chất lượng tìm lỗi bằng model đăng nhập thật vẫn cần đo riêng. Với bản hiện tại, tạo lại tệp đầu ra khi prompt hoặc schema đã đổi.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-review-replay.json `
  --replay .local/shared-sade-planner-native.json
```

### Tên teammate và sửa lỗi dependency trong lượt lập kế hoạch

Qwen nhận mã teammate ngắn và tên không dấu, sau đó chạy lại đủ 18 ca. Kết quả là 15/18, gồm A 1/3, B 3/3, C 3/3, D 6/6 và tin chỉ báo tình hình 2/3. Ca A có dependency thiếu vẫn lỗi sau khi gửi lại phản hồi công cụ. Ba câu bàn giao giữ riêng đạt 0/3, với hai kế hoạch xếp việc sửa tài liệu vào loại chỉ đọc và một kế hoạch giao sai người. Một biến thể prompt thử đánh số task và nhấn mạnh đường dẫn đạt cả ba ca A của bộ chính, đồng thời chỉ đạt 12/18 do điểm B, C và D giảm. Qwen tiếp tục dùng để đánh giá offline.

Bài hồi quy desktop dùng phiên Gemini mô phỏng để nộp kế hoạch thiếu dependency, nhận lỗi có khóa hợp lệ, rồi nộp lại trong cùng lượt. Chỉ có một lần `turn/start`. Người được giao vẫn phải có quyền trong roster. Phép đo Ollama gửi thông báo lỗi qua `role: tool` trong cùng hội thoại và thử nhiều nhất một lần nếu nhận được lời gọi kế hoạch sai schema hoặc dependency. [Gọi công cụ trên Ollama](https://docs.ollama.com/capabilities/tool-calling)

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-roster-final.json
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-roster-handoff-holdout.json --handoff-holdout
```

### Lập kế hoạch theo hành động

Biểu mẫu mới yêu cầu lập riêng việc tạo đầu ra và việc dùng đầu ra đó. Planner ghi rõ ai làm mỗi việc, file nào được sửa và task nào phải hoàn tất trước. Với yêu cầu tránh hai người sửa cùng một file, prompt yêu cầu một người kiểm tra commit cũ rồi chỉ sửa phần còn thiếu. Với tin chỉ báo tình hình, planner kết thúc mà không cấp lượt thực thi.

| Tập tin nhắn                            | Prompt trước | Prompt và biểu mẫu theo hành động |
| --------------------------------------- | ------------ | --------------------------------- |
| 18 tin tình huống A–D và chat           | 15/18        | 16/18                             |
| 3 câu bàn giao viết riêng               | 0/3          | 2/3                               |
| 6 câu bàn giao có file và assignee khác | 2/6          | 2/6                               |

Qwen đạt B và C 3/3 mỗi tình huống, D 6/6 và chat 3/3. Điểm A trong tập chính vẫn là 1/3. Một câu tạo tác vụ sửa tài liệu ở phạm vi cả project, một câu giao bước frontend như review chỉ đọc. Trong tập sáu câu, còn có kế hoạch thiếu người tạo đầu ra, đảo dependency hoặc gộp hai file vào cùng một việc. Các biến thể ẩn vai trò hoặc nhận tên trực tiếp có ba điểm đúng ở tập sáu câu, đồng thời giảm kết quả ở B và D. Sade giữ mã teammate và chính sách cấp quyền hiện tại. Qwen vẫn dùng offline.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-main.json
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-handoff.json --handoff-holdout
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-action-varied.json --handoff-varied
```

### Tình huống A có đủ năm đầu việc

Bốn câu mới dùng nhóm mô phỏng có Gemini, Astra, Claude và Antigravity. Mỗi câu giao Gemini viết tài liệu hợp đồng, Astra làm giao diện, rồi để Sade tự chia backend, kiểm thử và review phòng thủ việc lộ email trong thông báo lỗi. Bài chấm kiểm tra đủ năm tác vụ, file được yêu cầu, hai assignee đã chỉ định, các dependency, quyền sửa và reviewer độc lập.

Qwen3 4B cục bộ đạt 0/4. Ba câu cho kế hoạch đã qua schema nhưng sai yêu cầu, gồm thiếu tác vụ, khóa cứng người dùng đã giao Sade tự quyết, hoặc đọc tài liệu thay vì tạo tài liệu. Câu còn lại không sửa được dependency trong lần thử lại. Biểu mẫu thử rút gọn đạt 12/18 ở bộ chính và có một lỗi bộ nhớ Ollama trong bốn câu mới. Một biến thể prompt nhấn mạnh thứ tự và review nhiều file cũng đạt 0/4 ở bộ mới. Sade giữ biểu mẫu hiện tại và dùng Qwen cho đánh giá offline.

Bài hồi quy bộ phân công cho thấy một tác vụ backend chưa chỉ định có thể dùng Claude đang rảnh sau khi giữ việc kiến trúc cho Gemini và frontend cho Astra. Một bài Shared Groups xác nhận profile Claude của chính người đã viết bản sửa không nhận review, dù profile đó có vai trò reviewer.

Trên commit `3fc1d2f`, tôi chấm lại các phản hồi Qwen đã lưu với cùng hash prompt và schema. Tập chính giữ 16/18 và tập năm đầu việc giữ 0/4. Lần chấm lại đi qua bộ điều phối mới bằng dữ liệu đã ghi từ trước.

Sau khi sửa phân công để giữ lượt Windows và reviewer độc lập, chấm lại cùng đầu ra vẫn đạt 16/18 và 0/4. Hai bài hồi quy phân công dùng kế hoạch có đủ tác vụ. Các ca Qwen bỏ sót đầu việc, chọn sai người hoặc khai dependency sai vẫn được tính lỗi.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/shared-sade-planner-full-handoff.json --full-handoff
```

### Kiểm tra một kế hoạch bằng Codex đăng nhập

Chạy hai lượt Codex CLI trên Windows bằng phiên ChatGPT có sẵn và cùng tin nhắn tổng hợp `full-handoff/1`. Cả hai lượt xuất kế hoạch JSON trong thư mục chỉ đọc. Lượt đầu có đủ năm tác vụ nhưng gắn kiểm tra dữ liệu lỗi là nghiên cứu. Vì vậy nó không qua điều kiện review độc lập. Sau khi prompt và schema mô tả rõ mục đích của từng loại việc, lượt thứ hai đạt 1/1. Kế hoạch giữ Gemini làm hợp đồng, Astra hỏi phong cách hoặc đề nghị tự chọn, Sade tự giao backend và test theo dependency, rồi chọn Antigravity mô phỏng cho review độc lập trên hai file nguồn.

Codex nhận prompt và schema hiện hành qua CLI. Kivuno chấm kết quả bằng parser, Shared Groups và grant mô phỏng. Hai lượt chỉ lập kế hoạch và không chạy hành động nhóm. Phần chạy nhiều provider trên tài khoản thật vẫn cần được kiểm chứng.

```powershell
node --import tsx scripts/eval-shared-sade-planner.ts .local/codex-plan-prompt.json --full-handoff --case full-handoff/1 --export-prompt
$bundle = Get-Content .local/codex-plan-prompt.json -Raw -Encoding UTF8 | ConvertFrom-Json
$schema = Join-Path (Get-Location).Path '.local/codex-plan-schema.json'
$answer = Join-Path (Get-Location).Path '.local/codex-plan-answer.json'
[IO.File]::WriteAllText($schema, ($bundle.tool.inputSchema | ConvertTo-Json -Depth 35))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only benchmark. Do not execute work, run commands, use tools, or read files. Return the argument object for relay_submit_plan as the final structured response.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema $schema --output-last-message $answer --json -
node --import tsx scripts/eval-shared-sade-planner.ts .local/codex-plan-score.json --full-handoff --case full-handoff/1 --external-plan $answer
```

### Phân biệt chủ tài khoản khi harness trùng tên

Codex CLI đã đăng nhập chạy bốn tin tổng hợp trước và sau khi sửa prompt. Bản cũ đạt 3/4. Khi Gemini của Bình đã được chia sẻ trong nhóm nhưng chưa có quyền cho project, model nhầm thành thiếu thành viên. Bản mới đạt 4/4. Hai câu có đủ thông tin tạo đúng việc viết hợp đồng rồi bàn giao giao diện. Câu có hai Astra hỏi người gửi chọn Bình hay Chi. Câu thiếu quyền yêu cầu Bình cấp quyền cho đúng project. Phần chấm chạy qua Shared Groups với các chủ quyền mô phỏng.

Bài hồi quy xác nhận chỉ người gửi được trả lời câu hỏi và chưa có tác vụ nào được giao trước đó. Khi Bình cấp quyền rồi người gửi trả lời, Sade tiếp tục cùng workflow và giao đúng công việc. Quyền mà Bình cấp cho project khác bị loại khỏi danh sách của lượt lập kế hoạch. Bài kiểm thử hai cửa sổ Shared Groups xác nhận cả hai người nhìn thấy câu hỏi, người gửi có ô trả lời và việc được giao hiển thị tên chủ harness.

```powershell
$case = 'owner/ungranted'
node --import tsx scripts/eval-shared-sade-planner.ts .local/owner-prompt.json --owner-handoff --case $case --export-prompt
$bundle = Get-Content .local/owner-prompt.json -Raw -Encoding UTF8 | ConvertFrom-Json
$schema = Join-Path (Get-Location).Path '.local/owner-schema.json'
$answer = Join-Path (Get-Location).Path '.local/owner-answer.json'
[IO.File]::WriteAllText($schema, ($bundle.decisionSchema | ConvertTo-Json -Depth 45))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only benchmark. Do not execute work, run commands, use tools, or read files. Return the action you would take and its arguments as the final structured decision.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema $schema --output-last-message $answer --json -
node --import tsx scripts/eval-shared-sade-planner.ts .local/owner-score.json --owner-handoff --case $case --external-decision $answer
```

### Phân biệt tin báo tình hình và yêu cầu làm việc

GPT-6-Luna với reasoning `high` qua Codex CLI đã đăng nhập đạt 8/8 trên bốn cặp tin nhắn tổng hợp. Trong mỗi cặp, hai câu dùng cùng tên harness và file. Câu chỉ trích lại yêu cầu cũ, chờ người gửi xác nhận, báo tiến độ hoặc nhắc ví dụ chạy Mac đều kết thúc với 0 tác vụ. Câu giao việc tương ứng chọn đúng người và file. Ca chỉ đọc giữ quyền chỉ đọc. Ca chạy Mac giữ yêu cầu macOS và máy ghép cặp. Shared Groups chấm đầu ra với grant mô phỏng.

Bài thử desktop cũng tái hiện việc lời gọi lập kế hoạch đến sau có thể ghi đè kết quả báo tình hình trong cùng lượt. Sau bản sửa, lời gọi đó bị từ chối và nhóm vẫn thấy workflow kết thúc với 0 tác vụ. Các ca nộp lại cùng kết quả, nộp kế hoạch hợp lệ sau lỗi cấu trúc và đổi verdict sau khi reviewer đã nộp đều có bài hồi quy.

Dùng lệnh xuất và chấm cấu trúc `decisionSchema` ở mục trên với `--intent-contrasts` thay cho `--owner-handoff`. Chọn một trong các ca `intent/quoted-update`, `intent/quoted-request`, `intent/deferred`, `intent/confirmed`, `intent/status`, `intent/read-only`, `intent/mac-status`, `intent/mac-request`. Lệnh Codex trong phép thử dùng `-m gpt-6-luna -c "model_reasoning_effort='high'"`.

### Qwen review bản vá chức năng

Phép đo dùng Qwen3 4B Instruct 2507 Q4_K_M qua Ollama cục bộ, temperature 0 và seed 7013. Sáu cặp chính và ba cặp bổ sung đều có một bản đúng và một bản lỗi. Script chạy input mẫu trên các hàm có sẵn để xác nhận đáp án, rồi gửi diff qua prompt và schema review của Sade. Model đọc diff. Shared Groups ghi verdict bằng hai chủ quyền mô phỏng và kiểm tra trạng thái tích hợp trong SQLite. Luồng Git thật được kiểm tra riêng trong các bài workspace.

| Prompt và tập bản vá                  | Phát hiện bản lỗi | Duyệt bản đúng | Trạng thái tích hợp khớp verdict |
| ------------------------------------- | ----------------- | -------------- | -------------------------------- |
| Chỉ gửi diff, sáu cặp chính           | 6/6               | 1/6            | 12/12                            |
| Có yêu cầu và tiêu chí, sáu cặp chính | 5/6               | 6/6            | 12/12                            |
| Cùng prompt mới, ba cặp bổ sung       | 3/3               | 0/3            | 6/6                              |

Qwen bỏ sót điều kiện giảm giá tại đúng ngưỡng trên tập chính. Ở ba cặp bổ sung, Qwen chặn cả ba bản đúng vì suy diễn thêm yêu cầu hoặc đọc sai tác dụng của hàm. Có lượt yêu cầu sửa đúng nhưng giải thích một phần sai, như nêu kết quả làm tròn về 0 của `-1.7` là `-2`. Điểm trong bảng tính theo quyết định duyệt hoặc yêu cầu sửa. Phép đo trạng thái xác nhận Sade thi hành quyết định model đã gửi, kể cả quyết định sai. Sade giữ chính sách chọn reviewer theo quyền và catalog. Qwen dùng để đo offline.

Chạy từ hai commit khác nhau để so sánh prompt. Bản chỉ gửi diff nằm ở commit `28eb3e7`. Dùng `--holdout` ở bản mới để chạy ba cặp bổ sung. Cả hai dùng Ollama cục bộ tại `127.0.0.1:11565` với model `qwen3:4b-instruct-2507-q4_K_M`. Báo cáo JSON lưu digest model và hash prompt của từng ca.

```powershell
node --import tsx scripts/eval-shared-sade-review.ts .local/shared-sade-review-main.json
node --import tsx scripts/eval-shared-sade-review.ts .local/shared-sade-review-holdout.json --holdout
```

### Tình huống C với Codex đã đăng nhập

Catalog của tài khoản ChatGPT trên Windows có GPT-6-Luna và mức reasoning `high`. Chính sách Sade chọn cấu hình đó cho ca review logic tính giảm giá. Hai lượt chỉ đọc qua Codex CLI dùng cùng yêu cầu và hai bản vá tổng hợp. Bản lỗi dùng `>` và trả 0 ngay tại ngưỡng chi tiêu. Model chỉ đúng trường hợp đó và yêu cầu sửa. Model duyệt bản dùng `>=` trả 10. Shared Groups nhận hai verdict qua grant thử nghiệm, giữ bản lỗi ở trạng thái chặn và chỉ cấp digest để tích hợp bản đúng. Cả hai lượt đều đọc diff mà không chạy mã.

Một bài hồi quy desktop tái hiện việc tiêu chí bảo mật của tác vụ gốc bị bỏ khỏi khâu chọn model cho review. Desktop giờ đưa yêu cầu đã gửi đến reviewer vào thông tin chọn model và đặt scope của review theo danh sách file trong diff. Review thường vẫn dùng model nhẹ có reasoning cao. Khi yêu cầu có tiêu chí bảo mật, chính sách dùng model mặc định của catalog với reasoning cao nếu hỗ trợ.

Chạy từ repo bằng tài khoản ChatGPT đã đăng nhập. Chọn một variant mỗi lần để tái lập đúng bản vá. Tệp điểm ghi hash prompt và digest bản vá dùng để đối chiếu với bản xuất.

```powershell
$variant = 'defect'
$base = Join-Path (Get-Location).Path ".local/codex-review-$variant"
node --import tsx scripts/eval-shared-sade-review.ts "$base-prompt.json" --case discount --variant $variant --export-prompt
$bundle = Get-Content "$base-prompt.json" -Raw -Encoding UTF8 | ConvertFrom-Json
[IO.File]::WriteAllText("$base-schema.json", ($bundle.tool.inputSchema | ConvertTo-Json -Depth 35))
$sandbox = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$instruction = 'This is a synthetic, read-only review benchmark. Inspect only the supplied data. Do not run commands, use tools, read project files, or make changes. Return the argument object for relay_submit_shared_review as the final structured response.'
($bundle.prompt + "`n`n" + $instruction) | codex exec --ephemeral --ignore-user-config --skip-git-repo-check --sandbox read-only -C $sandbox.FullName -m gpt-6-luna -c "model_reasoning_effort='high'" -c "forced_login_method='chatgpt'" -c "approval_policy='never'" -c 'analytics.enabled=false' --output-schema "$base-schema.json" --output-last-message "$base-verdict.json" --json -
node --import tsx scripts/eval-shared-sade-review.ts "$base-score.json" --case discount --variant $variant --external-verdict "$base-verdict.json"
```

### Reasoning cho tin nhắn có nhiều đầu việc

Đo `gpt-6-luna` qua Codex CLI đã đăng nhập ChatGPT trên bốn biến thể bàn giao đủ năm đầu việc và hai ca về quyền. Mỗi prompt được gửi một lần ở `low` và một lần ở `high`, xen kẽ thứ tự. Prompt mới yêu cầu tách bước thêm test khi người gửi đặt nó sau triển khai, ghi cả hai lựa chọn phong cách và để Sade phân công mọi việc chưa chỉ định người.

| Prompt | Reasoning | Ca đúng | Trung vị thời gian CLI | Trung vị output token |
| ------ | --------- | ------: | ---------------------: | --------------------: |
| Trước  | `low`     |     1/6 |              12,6 giây |                 490,5 |
| Trước  | `high`    |     3/6 |              22,1 giây |                 972,5 |
| Mới    | `low`     |     4/6 |              12,6 giây |                 489,5 |
| Mới    | `high`    |     6/6 |              21,4 giây |                 982,5 |

Ba ca chưa dùng để sửa prompt cũng đạt với `high`. `Low` vẫn tự chọn một người khi hai harness cùng tên phù hợp và bỏ sót lựa chọn để người gửi cung cấp phong cách ở một ca. Bộ chấm nhận cách mời người gửi chọn giữa hai phương án. Toàn bộ đầu ra cũ và mới được chấm lại bằng cùng quy tắc, với hash prompt và bộ công cụ đối chiếu cho mỗi ca.

Dùng lệnh xuất và chấm bên trên với `--full-handoff --case full-handoff/1` đến `full-handoff/4`, rồi `--owner-handoff --case owner/ambiguous` và `owner/ungranted`. Đổi cấu hình Codex giữa `model_reasoning_effort='low'` và `model_reasoning_effort='high'`. Kiểm tra bổ sung dùng `--handoff-varied` với `handoff/varied-1` và `handoff/varied-5`, cùng `--owner-handoff --case owner/named`. Đọc `turn.completed` trong JSONL để lấy số token. Các lượt chỉ lập kế hoạch trên dữ liệu tổng hợp. Thời gian gồm khởi chạy CLI và có cả lượt dùng cache. [OpenAI Reasoning](https://developers.openai.com/api/docs/guides/reasoning)

Bài hồi quy desktop gửi tin 8.000 ký tự cùng danh sách 32 harness và xác nhận planner nhận đủ nội dung. Nội dung do Sade ghép đi qua giới hạn dành cho phiên đã có quyền thực thi. Giới hạn nhập chat thường vẫn là 16.000 ký tự.

## Cấu hình dùng trong Shared Groups

Dùng một lượt lập kế hoạch từ harness đã cấp quyền của người gửi. Schema yêu cầu nhiệm vụ, scope, phụ thuộc và điều kiện hoàn tất. Bộ điều phối quyết định quyền, hệ điều hành, số lượt và thứ tự thực thi. Chính sách chọn model đọc loại tác vụ, mô tả và effort từ kế hoạch. Lượt lập kế hoạch ưu tiên reasoning cao trong catalog của tài khoản. Tác vụ thường có thể dùng reasoning trung bình, và review thường ưu tiên model nhỏ hỗ trợ reasoning cao. Bài kiểm thử giao thức xác nhận ba lựa chọn này khi catalog cung cấp đủ mức. Có thể xem model và reasoning được chọn trên desktop. Qwen dùng để đánh giá offline.

## Huấn luyện Qwen trên máy

Bài thử LoRA chỉ học phân loại một trong sáu ý định. Dữ liệu huấn luyện được lấy mẫu cân bằng từ bộ 1.000 tin nhắn tổng hợp. Tập chấm có 144 tin nhắn từ 48 câu gốc viết riêng. Script giữ nguyên trọng số nền và so sánh model trước và sau train trên cùng prompt, cùng tập chấm. Quyền, quota và lịch của Sade vẫn do bộ điều phối quyết định. [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) · [PEFT LoRA](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)

Chạy bằng Python 3.11, PyTorch 2.10.0 CUDA 12.8, Transformers 4.57.6, Accelerate 1.12.0 và PEFT 0.18.1. Lưu bản Qwen3-1.7B revision `70d244cc86ccca08cf5af4e1e306ecf908b1ad5e` ở `.local/sade-qwen/base`. Các lần train dùng thư mục đầu ra khác nhau. [Bản PyTorch cho Windows](https://pytorch.org/get-started/previous-versions/)

```powershell
node --import tsx scripts/sade-qwen-dataset.ts
python scripts/train-sade-qwen.py --root .local/sade-qwen --output .local/sade-qwen/experiment-1
```

Checkpoint dùng định dạng Safetensors. `metrics.json` ghi phiên bản model, seed, dấu vân tay dữ liệu, đỉnh VRAM, kết quả theo nhãn và ID mẫu dự đoán sai. Trọng số và log nằm trong `.local` trên máy thử.

Trên RTX 5050 Laptop 8 GB, lần chạy thành công dùng LoRA rank 8, 350 mẫu, hai epoch và 176 bước. Tổng thời gian là 82,9 giây, tính cả nạp model và chấm. Bộ cấp phát PyTorch giữ đỉnh 3.916 MiB VRAM (`max_memory_reserved`). Trình nạp đọc từng tensor để tránh lỗi truy cập bộ nhớ khi nạp shard trên Windows.

| Cùng tập chấm 144 mẫu            | Kết quả         |
| -------------------------------- | --------------- |
| Qwen3 1.7B trước train           | 45/144 (31,25%) |
| Qwen3 1.7B + LoRA                | 108/144 (75%)   |
| Nạp adapter từ file rồi chấm lại | 108/144 (75%)   |

Điểm theo ý định gồm chạy trên Mac 23/24, bàn giao 22/24, review 21/24, tránh sửa trùng 17/24, yêu cầu chung 16/24 và chat không giao việc 9/24. Điểm tiếng Việt không dấu là 30/48. Hạn chế lớn nhất là nhận ra yêu cầu không chạy AI. Cấu hình chạy hiện tại dùng lựa chọn **Ask Sade** của người gửi và các kiểm tra quyền của bộ điều phối. Adapter hiện dùng cho đánh giá offline.

```powershell
python scripts/train-sade-qwen.py --root .local/sade-qwen --adapter .local/sade-qwen/experiment-3/epoch-2 --output .local/sade-qwen/recheck-epoch-2
```

### Phân biệt trò chuyện với yêu cầu làm việc

Thử nghiệm thứ hai tăng độ đa dạng bằng 20 cặp bối cảnh giống nhau nhưng khác ý định. Một tin trong mỗi cặp yêu cầu hành động, tin còn lại là cập nhật cho người trong nhóm. Mỗi cặp được diễn đạt theo ba kiểu. Tập chấm cũ giữ nguyên từng byte. Tập mới gồm 15 cặp viết riêng theo cùng ba kiểu, tổng cộng 90 tin. Mỗi lần chấm tính đúng cả cặp khi model nhận đúng loại việc và nhận đúng tin chat trong cùng kiểu diễn đạt.

| Phép đo                                   | LoRA cũ | LoRA với dữ liệu theo cặp |
| ----------------------------------------- | ------- | ------------------------- |
| Phân loại đúng trên tập 144 tin cũ        | 108/144 | 98/144                    |
| Nhận đúng chat trên tập cũ                | 9/24    | 22/24                     |
| Yêu cầu bị nhận nhầm là chat trên tập cũ  | 0/120   | 28/120                    |
| Phân loại đúng trên tập 90 tin mới        | 38/90   | 64/90                     |
| Nhận đúng chat trên tập mới               | 4/45    | 35/45                     |
| Yêu cầu bị nhận nhầm là chat trên tập mới | 2/45    | 6/45                      |
| Đúng cả hai tin trong mỗi cặp mới         | 3/45    | 23/45                     |

Lượt train dùng cùng model nền, prompt và seed. Dữ liệu đầu vào gồm 1.120 dòng, trong đó script lấy 360 dòng cân bằng theo nhãn để train hai epoch. Tổng thời gian 85,6 giây, gồm nạp model và chấm cả hai tập. Bộ cấp phát PyTorch giữ đỉnh 3.916 MiB VRAM. Do số yêu cầu bị bỏ sót tăng, hai adapter tiếp tục dùng để đánh giá offline. Shared Groups dùng thao tác **Ask Sade** để xác nhận ý định.

Nạp lại checkpoint epoch 2 cho cùng dự đoán trên cả 234 tin của hai tập chấm. Kết quả từng tập được ghi vào `metrics.json`, `reloaded.json` và `challenge.json` trong các thư mục đầu ra tương ứng.

```powershell
node --import tsx scripts/sade-qwen-dataset.ts .local/sade-qwen/contrastive --contrastive
$data = '.local/sade-qwen/contrastive'
python scripts/train-sade-qwen.py --root .local/sade-qwen --data-dir $data `
  --challenge "$data/challenge.jsonl" --adapter .local/sade-qwen/experiment-3/epoch-2 `
  --output .local/sade-qwen/contrastive-prior-recheck
python scripts/train-sade-qwen.py --root .local/sade-qwen --data-dir $data `
  --challenge "$data/challenge.jsonl" --output .local/sade-qwen/contrastive-trial-recheck
```
