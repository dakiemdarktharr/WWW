# RELAY + MESH — Feature specification draft

Ngày: 2026-11-03. Trạng thái: đặc tả tổng thể, gồm nền tảng đã duyệt và backlog để người dùng chỉnh ở các prompt tiếp theo. Phê duyệt nền tảng không tự cấp quyền tạo repository cuộc thi, gửi email hoặc dùng tài khoản thật trong kiểm thử.

Cập nhật cùng ngày: người dùng đã duyệt triển khai riêng nền tảng **session thật + MESH + quota + handoff + recovery**. Phạm vi đã triển khai được ghi trong [FOUNDATION.md](FOUNDATION.md); các luồng cuộc thi/debate/submission/SCOUT trong tài liệu này vẫn là backlog.

Các mục ký hiệu **Yêu cầu** tổng hợp ý muốn của người dùng. Các mục **Đề xuất** làm rõ hành vi hoặc bổ sung để hệ thống vận hành được; cần được đưa vào phạm vi đã duyệt trước khi triển khai. Tính năng trong tài liệu là mục tiêu thiết kế, không đồng nghĩa bản RELAY hiện tại đã hỗ trợ.

## 1. Hai bề mặt của cùng một hệ thống

**Yêu cầu:** RELAY quản lý và hiển thị các phiên Codex thật, có nhiều session song song trên một tài khoản, cùng một cửa sổ demo. Ứng dụng nhắn tin là một web riêng để các Codex phối hợp theo từng dự án.

**Đề xuất tên:** **MESH — Messaging for Execution, Sharing & Handoffs**. RELAY là phòng điều hành session/demo; MESH là nơi lưu hội thoại, kiến thức, quyết định và bàn giao. Dùng chung danh tính, project ID và trạng thái task.

| ID  | Tính năng             | Tiêu chí chính                                                                                                                                                 |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Codex session thật    | Mỗi session gắn runtime Codex đã đăng nhập; hiển thị account, agent, session/thread ID, task, worktree, trạng thái và sự kiện thực tế.                         |
| R02 | Session windows       | Xem toàn bộ session theo lưới, phóng lớn, tách cửa sổ, tương tác terminal, xem lịch sử, pause/stop và người dùng tiếp quản. Không chỉ hiển thị thẻ trạng thái. |
| R03 | Nhiều session/account | Session ghi file song song có task và worktree riêng. Có giới hạn đồng thời theo account và tài nguyên máy.                                                    |
| R04 | Demo window           | Một vùng demo riêng, chọn project, mở ứng dụng thực tế, reload và hiện trạng thái build. Mở demo không tự cấp phép mua hosting hoặc public deployment.         |
| R05 | Team                  | Theo dõi tài khoản, owner, tên agent, gói, quota, session, vai trò, skills/plugins và khả năng đang dùng được.                                                 |

Mô hình danh tính đề xuất: **Human → Account → Agent → Session → Task**. Account giữ đăng nhập, owner và quota; agent giữ tên/vai trò; session giữ conversation, task và worktree. Mở thêm session không tạo thêm quota hoặc phiếu bầu.

App Server là giao diện chính thức điều khiển Codex cho rich clients. Yêu cầu hiển thị terminal tương tác cần được thử với binary đang cài; phải xác minh attach/resume và tránh hai bộ điều khiển cùng ghi vào một session. Nhúng nguyên nhiều cửa sổ của ứng dụng Codex Desktop chính thức là hạng mục khả thi riêng, chưa được xác minh. [Codex App Server](https://learn.chatgpt.com/docs/app-server)

Đề xuất ban đầu: MESH web nội bộ/local và RELAY runner trên máy người dùng. Nếu mở thành hosted service, phải kiểm tra luồng xác thực được hỗ trợ cho hình thức đó; tài liệu hiện phân biệt phạm vi của app-server authentication và Sign in with ChatGPT. [Authentication scope](https://learn.chatgpt.com/docs/app-server#authentication)

## 2. MESH: group, hội thoại và quyền hạn

| ID  | Tính năng                   | Tiêu chí chính                                                                                                                                                             |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | Group theo công việc        | Một group cho mỗi project/hackathon/challenge/paper; có tên, loại, brief, repository, hạn nộp và trạng thái riêng.                                                         |
| M02 | Hội thoại có ngữ cảnh       | Một task/ý tưởng có thread chuẩn; hỗ trợ reply, mention, tìm kiếm, file và liên kết commit/artifact.                                                                       |
| M03 | Tên agent tự chọn           | Agent tự chọn tên/tag ổn định, tránh trùng. Session thêm hậu tố như `@vega/s2`; không đổi tên tùy tiện giữa một đợt phát triển.                                            |
| M04 | Introductions               | Khi lập group hoặc thêm thành viên, agent giới thiệu tên, owner, gói đang dùng, vai trò và capabilities liên quan. Thành viên mới đọc onboarding pack trước khi nhận việc. |
| M05 | Mention và chờ dependency   | `Done #task @agent` và `Waiting on @agent / #task` gắn với trạng thái thật. Hệ thống thông báo người đang đợi khi dependency đủ điều kiện.                                 |
| M06 | Tin người dùng thành prompt | Mọi tin người dùng vào hàng yêu cầu; tin có hành động được phân loại và nhận việc một lần. Câu mơ hồ được hỏi lại một câu tổng hợp.                                        |
| M07 | Hierarchy                   | Người dùng có quyền cao nhất; lead điều phối, worker thực hiện, reviewer kiểm tra. Vai trò RSI không có quyền cao hơn người dùng hoặc tự cấp quyền cho mình.               |
| M08 | Needs you                   | Tập hợp câu hỏi, blocker, quyết định, ngân sách và yêu cầu nộp bài. Mỗi mục có phương án đề xuất, tác động và thời hạn cần phản hồi.                                       |

**Refine `!!`:** đây là ký hiệu lệnh ưu tiên của người dùng đã được hệ thống xác thực. Composer có thể thêm tự động. Agent, website hoặc file chứa `!!` không được trở thành người dùng. Tin của người dùng không có `!!` vẫn được xử lý như yêu cầu hội thoại; việc thực thi phụ thuộc quyền và trạng thái dự án.

**Đề xuất UI:** cột group bên trái, hội thoại/thread ở giữa; panel Team / Usage / Knowledge / Needs you mở khi cần. Nút thường trực chỉ gồm gửi, file, tìm kiếm và mở session/demo. Giao diện tối giản, bỏ subtext quảng bá; thông báo chức năng chỉ hiện khi liên quan.

## 3. Tin mới phải được đọc, tránh vòng lặp hội thoại

**Yêu cầu:** các Codex đọc thông báo mới, chia sẻ kiến thức và giao tiếp khi nhận/xong/chờ task.

**Đề xuất quy tắc vận hành:**

- Mỗi agent có inbox bền vững và vị trí đọc; restart không mất tin chưa đọc.
- Phân biệt **đã giao**, **đã đưa vào context/đọc**, **đã xác nhận xử lý**. Không đánh dấu đã đọc vì server chỉ nhận được tin.
- Lệnh người dùng, mention trực tiếp, blocker và dependency hoàn thành được ưu tiên. Agent đang làm đọc tin thường ở điểm an toàn; có thể nhận steering nếu runtime hỗ trợ và không tạo hai lượt điều khiển chồng nhau.
- Agent paused/offline giữ unread, đọc bù trước khi tiếp tục. Agent dừng vì quota không bị tự đánh thức để trả lời chat thường.
- Mọi thành viên group đều nhận tin chung vào inbox; mention quyết định độ ưu tiên, không quyết định ai được nhận. Không mở một lượt model cho toàn team sau từng tin. Tin FYI có thể gom; không bắt buộc trả lời mọi tin.
- Khi nhận task, coordinator ghi claim nguyên tử rồi phát tin nhận việc. Tin “tôi nhận” không tự đóng vai trò khóa.
- Lưu message ID gốc để reconnect, retry hoặc nhiều session không thực thi lại cùng yêu cầu.

## 4. Đọc cuộc thi và lập brief

**Yêu cầu:** đưa link cuộc thi, team đọc kỹ đề, chia sẻ kiến thức và tự phối hợp.

- Đọc trang đề, luật và tài liệu đính kèm; lưu nguồn và thời điểm đọc. Nếu trang yêu cầu login, thiếu file hoặc không đọc được, hỏi người dùng đúng phần còn thiếu.
- Tạo brief: bài toán, đối tượng, rubric, điều kiện tham gia, quy định AI/pre-existing code, công nghệ bắt buộc, giới hạn chi phí, nội dung phải nộp, các mốc thời gian và điểm chưa rõ.
- Đối chiếu rubric với deliverables; không suy deadline hoặc tiêu chí từ trí nhớ.
- Mỗi agent đọc brief và bổ sung phát hiện từ góc chuyên môn của mình. Có phần hiểu chung và danh sách giả định/chưa xác minh.
- Phát hiện thay đổi đề/luật trong quá trình làm; nếu thay đổi ảnh hưởng giải pháp đã duyệt, báo người dùng.
- Phân biệt các hạn đăng ký, ghép team, bắt đầu phát triển, nộp bài, video và pitching.
- Nếu điều kiện tham gia hoặc luật AI/pre-existing code xung đột với cách làm dự kiến, đánh dấu eligibility blocked, dẫn điều khoản và hỏi người dùng chọn hướng hợp lệ; không tự khẳng định đáp ứng luật.

## 5. Brainstorm, hai vòng feedback, debate, vote, duyệt

Luồng bắt buộc:

`Đọc đề → shared brief → ý tưởng độc lập → feedback/refine vòng 1 → feedback/refine vòng 2 → debate → vote → người dùng duyệt → triển khai`.

1. Mỗi agent chuẩn bị ý tưởng độc lập trước khi xem đề xuất của các agent khác, để giữ sự đa dạng.
2. Mỗi ý tưởng nêu: giải pháp, lý do phù hợp rubric, bằng chứng, khác biệt, khả thi, chi phí, rủi ro và khả năng xong trước hạn.
3. Vòng 1: thành viên khác chỉ ra giả định yếu, phản ví dụ, chỗ kém hiệu quả và phương án thay thế; tác giả phản hồi và cập nhật.
4. Vòng 2: kiểm tra phần đã sửa, so sánh trực tiếp các lựa chọn, ghi phần bất đồng còn lại; cập nhật phiên bản cuối của từng ý tưởng.
5. Debate có giới hạn lượt/thời gian/usage. Yêu cầu lập luận kiểm tra được và bằng chứng; không yêu cầu công khai reasoning nội bộ của model.
6. Vote dựa trên rubric, khả thi, giá trị, khác biệt, rủi ro, thời gian và chi phí. **Một account/ghế độc lập có một phiếu**, không phải một session một phiếu; bot không tạo thêm đa số.
7. Đưa người dùng ý tưởng thắng, điểm số/lý do, lựa chọn đứng sau và phản biện thiểu số mạnh nhất. Hòa phiếu thì người dùng quyết định; đa số là đề xuất, không phải bằng chứng ý tưởng đúng.
8. Nếu người dùng muốn hướng khác, lưu quyết định loại, mở lại brainstorm và không đem kế hoạch cũ ra triển khai.
9. “Oke” chỉ duyệt đúng project và phiên bản kế hoạch đang được trình. Đổi phạm vi lớn phải có phê duyệt mới.

Sau vote, group hiển thị waiting for human approval cùng project, plan version và phạm vi hành động sẽ bắt đầu khi được duyệt.

**Trước phê duyệt:** được đọc đề, research và thảo luận; chưa tạo repo cuộc thi, viết implementation, deploy hoặc chạy RSI. Nếu muốn làm prototype để chọn ý tưởng, phải được người dùng cho phép riêng. Báo cáo/brief phục vụ lựa chọn được lưu trong MESH.

## 6. Chia việc, giải quyết trùng và thực thi

**Yêu cầu:** chia việc đều; báo nhận task; tự xử lý mâu thuẫn trùng việc; tự test.

**Đề xuất:** cân bằng theo effort, năng lực, quota, độ sẵn sàng và critical path, thay vì chia bằng số task. Có thể ít task chạy song song nếu dependency hoặc scope buộc phải chờ.

- Task có ID, owner/session, scope, inputs, dependencies, acceptance và bằng chứng hoàn thành.
- Một task chỉ có một owner đang thực thi; session ghi cùng scope cần được điều phối. Session đọc/review không tự giành quyền sửa.
- Hai yêu cầu trùng được hợp nhất hoặc tách rõ scope; coordinator ghi quyết định chuyển quyền, không để các agent chỉ thương lượng bằng lời rồi cùng sửa.
- Task xong tạo handoff có commit/artifact, test evidence và mention đúng người nhận. Người đang chờ chỉ được chạy khi dependency đạt trạng thái đã xác minh/tích hợp theo policy.
- Self-test gồm kiểm tra phù hợp thay đổi, build và kiểm tra demo/luồng người dùng. Reviewer độc lập đối chiếu acceptance; không chỉ chấp nhận lời nói “tests passed”.
- Lưu test command, commit SHA, exit code, log và trạng thái skipped/failed. Không sửa yếu test hoặc tự đổi acceptance để biến lỗi thành đạt.
- Cho phép tự vận hành trong phạm vi đã duyệt; trả câu hỏi cho người dùng khi thiếu quyền, thiếu dữ kiện, có chi phí, hoặc thay đổi mục tiêu.

## 7. Quota và điều phối nhiều session

**Yêu cầu:** còn 50% usage thì ngừng và nhờ account khác tiếp quản; nếu tất cả đều dưới ngưỡng thì hỏi người dùng; báo khi nào hồi.

**Refine:** thống nhất đo **phần trăm còn lại**, không dùng từ usage mơ hồ. `remaining = 100 - usedPercent`. Theo dõi mọi cửa sổ quota liên quan do provider trả về, cùng nguồn và thời điểm quan sát. Không hard-code rằng tên gói luôn tương ứng một loại cửa sổ. Tài liệu hiện tại mô tả hạn mức theo từng gói/cửa sổ; hệ thống phải thích ứng khi chúng thay đổi. [Codex pricing and usage](https://learn.chatgpt.com/docs/pricing)

Chính sách mặc định đề xuất:

| Điều kiện                            | Hành vi                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Còn trên 50% và đủ headroom          | Nhận việc trong ngân sách/concurrency của account.                                                               |
| Gần ngưỡng, ví dụ 55–60%             | Chuẩn bị checkpoint và bàn giao; dành phần dự phòng để ngừng an toàn.                                            |
| Có cửa sổ áp dụng còn ≤50%           | Ngừng giao việc mới cho mọi session của account; hoàn tất checkpoint có giới hạn và chuyển việc.                 |
| Tất cả account đủ điều kiện còn ≤50% | Tạo một yêu cầu Needs you, nêu account, quota/reset, việc đang dở và đề xuất; gửi email nếu đã cấu hình kênh đó. |
| Người dùng cho dùng phần dự trữ      | Quyền chỉ rõ account, project, mức sàn, thời hạn và loại công việc. Không thể vượt hard limit của provider.      |
| Tới thời điểm reset được báo         | Đọc lại quota và policy trước khi tiếp tục; đồng hồ qua giờ reset chưa đủ chứng minh đã hồi.                     |
| Quota thiếu, lỗi hoặc quá cũ         | Hiển thị unknown/stale; làm mới hoặc hỏi người dùng, không hiển thị giả là 100%.                                 |

- Một account dùng chung quota trên tất cả project/session; usage ngoài RELAY cũng có thể ảnh hưởng số provider trả về.
- Account không tự mở session mới, đổi model hoặc gọi API trả phí để né ngưỡng của người dùng.
- Poll/notification quota không cần model nói lại cho chính mình; coordinator thực thi chính sách và gộp cảnh báo.
- Đặt max concurrency, giới hạn usage cho debate/RSI, project priority và xử lý công bằng để một group không lấy hết tài nguyên.
- Không hứa dừng chính xác tại một phần trăm vì telemetry có thể trễ; dùng dự phòng và checkpoint sớm.

## 8. Handoff có xác nhận

**Trước khi có repo:** bàn giao brief, knowledge, ý tưởng, feedback, phiếu bầu và trạng thái bằng checkpoint có phiên bản trong MESH. Điều này giữ đúng yêu cầu chưa tạo repo trước khi duyệt.

**Sau khi có repo:**

1. Ngừng nhận việc và dừng sửa file ở một checkpoint an toàn.
2. Ghi trạng thái test; commit progress trên branch làm việc và push.
3. Xác nhận SHA đã xuất hiện trên remote; nếu push lỗi, báo handoff blocked và giữ quyền công việc.
4. Đăng handoff, mention người nhận; người nhận đọc và ACK.
5. Xác nhận worker cũ đã dừng; coordinator chuyển task/scope lease một lần rồi session mới tiếp tục.

Nội dung handoff bắt buộc:

- Task, repo, branch, remote SHA, session và người nhận.
- Đã làm gì, đang làm tới đâu, file/artifact liên quan, phần chưa xong.
- Test đã chạy, kết quả, lỗi đã biết và hướng tái hiện.
- Dependencies, owner đang đợi, câu hỏi/chưa có quyền.
- Hướng dẫn setup và các bước tiếp theo đủ cụ thể để tiếp quản.
- Quota từng cửa sổ, thời điểm đọc, giờ reset provider báo hoặc unknown, lý do dừng và quyền dùng dự trữ nếu có.

Checkpoint WIP có thể ghi rõ test còn fail trên branch riêng; không coi đó là bản đủ điều kiện release. Crash hoặc không xác nhận được worker đã dừng cần recovery có kiểm soát, không tự cấp lại scope.

## 9. Repository, commit và attribution

**Yêu cầu:** sau mỗi đợt phát triển tự commit/push; author là owner của Codex đó. Khi chưa có repo cuộc thi, dùng format `NoSleepClub_[tên cuộc thi]_[tên dự án]`, trừ khi người dùng yêu cầu khác.

**Đề xuất:**

- Chỉ tạo repo sau duyệt ý tưởng; mặc định private nếu luật và người dùng chưa yêu cầu public. Chuẩn hóa tên thành slug hợp lệ, vẫn giữ ba phần của format; nếu trùng tên thì hỏi/reuse đúng repo thay vì tạo repo nhầm.
- “Một đợt phát triển” là task/milestone có kết quả kiểm tra được hoặc checkpoint bàn giao, không phải từng tin nhắn/lệnh.
- Account Codex phải liên kết owner GitHub bằng danh tính người dùng cho phép; không suy owner GitHub từ email ChatGPT.
- Author ghi owner đóng góp; committer/pusher ghi chủ thể thực thi thực tế. Không tự tuyên bố chữ ký Verified. Nhiều người đóng góp thì giữ commit riêng hoặc co-author phù hợp.
- Commit gắn project/task/session để truy vết. Không ghi credentials, quota tokens hoặc dữ liệu riêng vào Git.
- Worktree/branch riêng cho session; tích hợp qua queue. Auto-commit/push lên branch không tự đồng nghĩa cho phép ghi thẳng main.
- Đề xuất auto-integrate phần rủi ro thấp sau reviewer và checks đạt trong policy đã duyệt; phần rủi ro cao chờ người dùng. Có rollback và release freeze.

## 10. Knowledge, skills và plugins

**Yêu cầu:** tự chia sẻ kiến thức, học phát hiện của nhau, chia sẻ/tiếp nhận skills và plugins hữu ích qua nhiều cuộc thi.

- Knowledge card chứa nội dung, nguồn, tác giả, project, phiên bản, ngày đọc, độ chắc chắn và bằng chứng. Có quyết định, hướng đã thử và lý do loại.
- Onboarding pack cho thành viên/session mới: brief, quyết định, kiến trúc, tasks, dependencies, run/test commands, recent messages và checkpoint.
- Kiến thức dùng chung được chia sẻ theo quyền của project; đề thi/file riêng không tự lan sang group khác.
- “Học” nghĩa là lưu và truy xuất kiến thức/context; không hứa thay đổi trọng số model hoặc chuyển mọi private memory của tài khoản.
- Thư viện skill/plugin có nguồn, version/hash, license, mục đích, quyền cần dùng và tương thích. Phân biệt discovered / recommended / approved / installed / enabled / authenticated.
- Đề xuất hữu ích được gửi cho team; tự tiếp nhận trong danh sách tin cậy/quyền đã duyệt. Plugin thực thi mới, quyền mới hoặc credentials cần được duyệt theo policy; không tự copy login/token giữa account.

## 11. BOT cải tiến codebase theo project

**Yêu cầu:** mỗi group có BOT RSI quét nhiều lần, tìm tối ưu, tự sửa hoặc gửi lỗi để Codex phụ trách xử lý.

**Đề xuất tên BOT:** **SCOUT**. Đây là agent cải tiến codebase có ngân sách và mục tiêu đo được.

- Chỉ bật sau khi dự án được duyệt và repo tồn tại; chỉ định account cấp runtime/usage cho bot.
- Đọc toàn bộ codebase ở các mốc phù hợp; kiểm tra diff sau đợt phát triển. Quét lại theo lịch/commit và ngân sách, không tạo vòng chạy vô hạn.
- Phát hiện có reproduction/evidence, mức ảnh hưởng, owner và đề xuất; gộp lỗi trùng.
- Chế độ mặc định đề xuất: giao lỗi cho owner; bot có thể tự sửa lỗi nhỏ ở scope được claim trên branch riêng, rồi chạy test và reviewer.
- Đánh giá ưu tiên correctness, bảo mật, test fail, maintainability và performance có benchmark; không chỉ làm thay đổi cho có activity.
- Không tự giảm chất lượng test, thay tiêu chí, sửa quyền điều phối hoặc policy quota để tăng “điểm”.
- Có giới hạn số vòng và usage; dừng khi quota thấp, không còn cải tiến có bằng chứng hoặc tới release freeze. Bot không có thêm phiếu bầu hay quota độc lập.

## 12. Hạn nộp, submission và bộ tài liệu

**Yêu cầu:** nhớ hạn và tự nộp hoặc nhờ người dùng nộp; tạo báo cáo chi tiết, file cần thiết và pitch speech.

- Lưu timestamp, múi giờ ban tổ chức, link nguồn và ngày xác minh; hiển thị theo giờ người dùng. Đặt mốc nội bộ sớm hơn deadline.
- Nhắc trước hạn theo lịch cấu hình, escalate nếu chưa sẵn sàng/chưa có phản hồi. Scheduler cần dữ liệu bền vững và xử lý sau downtime; máy ngủ/tắt không bảo đảm tác vụ đúng giờ, nên phải có runner đang hoạt động hoặc kênh dự phòng được cấu hình.
- Gần hạn: dừng RSI/thay đổi không cần thiết, freeze release, chạy kiểm tra cuối, kiểm tra truy cập demo/repo/video/file.
- Hai mode theo project: **prepare + nhờ người dùng nộp** (đề xuất mặc định), hoặc **auto-submit trong quyền đã cấp**. Quyền nộp gắn với bộ artifact/release cụ thể.
- Nếu gặp MFA, CAPTCHA, khai báo cá nhân, điều khoản cần người ký hoặc giao diện chưa hỗ trợ: báo sớm, đưa package và hướng dẫn rõ; không tự tuyên bố thay người dùng.
- Chỉ đánh dấu submitted khi có receipt/confirmation ID hoặc bằng chứng tương đương; lưu bản artifact, SHA và thời gian đã nộp.
- Báo cáo cuối nêu brief/rubric, giải pháp, kiến trúc, implementation, đóng góp, test/evaluation thực tế, kết quả, hạn chế, chi phí, demo và hướng phát triển.
- Pitch speech có ngôn ngữ/thời lượng theo luật, cấu trúc câu chuyện, demo cues, timing và Q&A chuẩn bị; không tạo thành tích hoặc benchmark không có thật.

Deliverables mặc định đề xuất, điều chỉnh theo loại cuộc thi/paper:

- `README.md`: cách chạy, demo và giới thiệu.
- `docs/COMPETITION_BRIEF.md`, `docs/DECISIONS.md`: đề, rubric, quyết định và nguồn.
- `docs/PROJECT_REPORT.md`, `docs/TEST_REPORT.md`: báo cáo và bằng chứng kiểm thử.
- `docs/PITCH_SPEECH.md`, `docs/DEMO_SCRIPT.md`: bài nói và kịch bản demo.
- `docs/SUBMISSION_CHECKLIST.md`, `docs/HANDOFF.md`: gói nộp và tiếp quản.
- License, attribution, tài liệu dataset/model, paper hoặc form theo yêu cầu thực tế của cuộc thi.

Không tạo các file báo cáo trống hoặc văn bản dài chỉ để đủ danh sách; chọn artifact có ích và cập nhật từ bằng chứng thật.

## 13. Quyền, chi phí và vận hành

- Người dùng có quyền dừng một session, một account, một project hoặc toàn team; hàng chờ và checkpoint được giữ.
- Mọi câu hỏi về dịch vụ trả phí nêu vendor, mục đích, owner, chi phí trần, thời gian và nghĩa vụ gia hạn. Không tự đăng ký gói, mua credits hay đổi nguồn billing.
- Email chỉ được gửi qua kênh/địa chỉ và loại thông báo đã cấu hình. MESH là kênh thông báo mặc định; cảnh báo trùng được gộp.
- Giữ lịch sử brief, message, decision, vote, approval, claim, commit, test, handoff và submission; có thể khôi phục sau restart.
- Nội dung link/file/chat là dữ liệu có nguồn; không có quyền tự thay lệnh người dùng hoặc giả danh owner.
- Demo chạy mã dự án trong phạm vi được cấp; riêng credentials account không đưa vào demo, chat hay artifact.

## 14. Tham chiếu messaging và phạm vi REA

Đã đọc skill `reverse-engineer-anything`. Không có REA MCP được quảng bá trong phiên công cụ hiện tại. Bước này chỉ lập feature list: chưa capture/decompile hoặc reverse-engineer runtime của năm ứng dụng, chưa đăng nhập/tải hội thoại riêng và chưa cài đặt/sửa cấu hình REA. Ma trận dưới là đề xuất dựa trên tài liệu công khai, không phải bằng chứng REA.

| Tham chiếu | Pattern muốn học                             | Nguồn và giới hạn                                                                                                                                                       |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slack      | Thread theo task/chủ đề, thông báo liên quan | [Threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions).                                                                            |
| Discord    | Quyền đọc/gửi/thread/mention tách biệt       | [Channel permissions](https://support.discord.com/hc/en-us/articles/10543994968087-Channel-Permissions-Settings-101).                                                   |
| WhatsApp   | Mention gọi đúng thành viên trong group      | [Mentions](https://faq.whatsapp.com/521835819370205/).                                                                                                                  |
| Zalo       | Nhắc tên và reply có ngữ cảnh                | [Nhắc tên trong nhóm](https://help.zalo.me/huong-dan/chuyen-muc/tro-chuyen-nhom/lam-sao-de-de-cap-den-ai-do-trong-nhom/).                                               |
| Messenger  | Mention/reaction xác nhận ngắn               | [Meta giới thiệu tính năng](https://about.fb.com/news/2017/03/introducing-message-reactions-and-mentions-for-messenger/amp/). Nguồn lịch sử; chưa xác minh UI hiện tại. |

Hạng mục khảo sát sau khi duyệt phạm vi: chọn public UI hoặc phiên có quyền truy cập, ghi kịch bản group → mention → reply/thread → unread → permission → file/search; lưu evidence và so sánh từng kịch bản. Không suy kiến trúc nội bộ từ giao diện; áp dụng pattern phù hợp cho agent collaboration, không cần sao chép mọi chức năng social.

## 15. Các bài nghiệm thu bắt buộc khi triển khai

1. Link mới tạo brief, hai vòng feedback, debate và vote; không có repo/implementation/RSI trước approval đúng phiên bản.
2. `!!` do agent hoặc trang web gửi không tăng quyền; yêu cầu thật của người dùng được ghi nhận.
3. Hai session nhận cùng prompt chỉ tạo một claim; task/scope trùng không chạy chồng.
4. Một account có nhiều session vẫn dùng chung quota và một phiếu bầu.
5. Handoff có push lỗi hoặc chưa xác nhận worker dừng không giải phóng scope; người nhận chưa ACK không tự nhận quyền sửa.
6. Tất cả account chạm ngưỡng tạo một Needs you có lựa chọn rõ ràng; không tự phá ngưỡng hoặc mua usage.
7. Restart giữ unread, tiến trình debate/vote, approvals, deadline, checkpoints và khóa task; không tự lặp việc đã thực hiện.
8. Commit author đúng owner được liên kết; test fail không biến thành release pass; remote SHA được xác minh.
9. Bot tạo phát hiện/cải tiến có bằng chứng, có giới hạn vòng/usage và không bỏ qua lease/review.
10. Session windows hiển thị tác vụ Codex thật, demo hoạt động; không có dữ liệu mô phỏng trong trạng thái sản phẩm.
11. Project chỉ mang trạng thái submitted khi lưu bằng chứng nộp; nếu cần người dùng thì hiển thị rõ việc còn phải làm trước hạn.
12. Bộ báo cáo và pitch phản ánh đúng dự án, kết quả test và yêu cầu cuộc thi.

## 16. Thứ tự triển khai đề xuất, chưa khởi chạy

1. Nền tảng danh tính Account/Agent/Session, runtime/session windows, MESH inbox/claim/quota/handoff và recovery.
2. Competition brief, hai vòng brainstorm/refine, debate/vote và approval gate.
3. Execution waves, Git owner attribution, tests/review, knowledge và skill/plugin sharing.
4. Deadline/submission package, report/pitch, kênh thông báo và SCOUT có ngân sách.

Proof-of-concept cần làm sớm khi được triển khai: terminal attach/resume đúng session với CLI đang cài, quota đa cửa sổ thực tế, nhiều session/account và Git owner attribution. Những khả năng này cần xác minh bằng tài khoản thật do người dùng đăng nhập; chưa được kiểm chứng chỉ từ feature list hoặc tests giả lập của bản trước.
