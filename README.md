<div align="center">
  <img src="public/kivuno.svg" width="72" alt="Kivuno" />
  <h1>Kivuno</h1>
</div>

Kivuno là app desktop cho nhóm nhiều tài khoản Codex, Claude và Antigravity. Bạn có thể dùng các model Gemini mà Antigravity cung cấp cho tài khoản Google trên máy. Website dành cho giới thiệu, đăng nhập và tải app, có lựa chọn Việt/Anh. **Chat là chat dự án** trong Kivuno; Team chứa các tài khoản của bạn, còn mỗi nhóm chỉ có những thành viên bạn chọn. Task có phạm vi, worktree và quyền sở hữu để phối hợp mà không nhận trùng việc.

Bản **0.8** thêm hồ sơ Research từ link cuộc thi, ghi chứng cứ và các mục chưa xác minh, Portfolio cho workload nhiều dự án, lựa chọn model theo usage chung và hàng đợi luân phiên giữa các cuộc thi. Kế hoạch cuộc thi cần Approve plan trước khi triển khai. Xem [tính năng, giới hạn và các kịch bản stress 0.8](docs/RELEASE-0.8.md).

Từ bản 0.4, RELAY mang tên Kivuno và MESH mang tên Neralu. Bản 0.6.2 đơn giản hóa Team, tạo profile riêng cho mỗi tài khoản và thêm xóa thành viên an toàn; [ghi chú kiểm chứng 0.6.2](docs/RELEASE-0.6.2.md) phân biệt kết quả runtime thật với phần hội thoại cần bạn đăng nhập thử. [Hướng dẫn desktop](docs/DESKTOP.md), [AEGIS](docs/AEGIS.md) và [nhận diện](docs/BRAND.md) mô tả cách cài, kết nối máy và giới hạn. Tên giao thức, đường dẫn dữ liệu và appId cũ được giữ để không làm mất tài khoản hay workspace khi cập nhật.

Mở [NoSleepClub Kivuno](https://kivuno.vercel.app) để tải bản Windows/Linux x64 hoặc macOS Apple Silicon. App mở trang đăng nhập trên trình duyệt; kiểm tra và xác nhận mã hiển thị rồi quay lại app. Không gửi token đăng nhập qua URL. Nút **Hướng dẫn** trong desktop có hướng dẫn tiếng Việt theo từng khu vực. Xem [bản 0.4](docs/RELEASE-0.4.md) và [nghiên cứu coin gas riêng](docs/CUSTOM-L1.md); coin hiện chưa được triển khai.

Máy cá nhân chạy coordinator và Codex bằng runtime đi kèm app. Có thể thêm máy khác qua cấu hình ghép nối riêng; cloud chuyển tiếp kết nối đi ra, không mở cổng vào máy. Cloud miễn phí có thể ngủ/hết hạn mức: công việc remote cần kết nối còn sống, và gián đoạn phải recovery rõ ràng. Localhost chỉ là kênh nội bộ có khóa của desktop, không phải đường dẫn người dùng phải mở hoặc giữ popup.

Ứng dụng dùng **Codex App Server chính thức**, với đăng nhập ChatGPT. Không yêu cầu OpenAI API key, không sao chép phiên đăng nhập của Codex desktop và không giả lập hạn mức thuê bao. Bạn tự đăng nhập từng tài khoản trong tab **Team**. Các tài khoản phải là những tài khoản bạn được phép sử dụng; từng tài khoản vẫn chịu hạn mức và điều kiện của gói tương ứng.

## Cài đặt và demo

Xem [hướng dẫn cài đặt](docs/DESKTOP.md) và [cách chạy demo QR](docs/KIVUNO-BANK-DEMO.md). Checkout QR dùng chuyển khoản mô phỏng.

## Chạy local tùy chọn

**Team → Machine → Add account** tự đặt tên tài khoản; trong từng nhóm, dùng **Members** để chọn ai tham gia. Thành viên mới giới thiệu owner, gói, skills/plugins và nguyên tắc chung. Conversation có lựa chọn model/reasoning từ catalog thật. Cloud điều phối được cả máy cá nhân và SSH lattice qua kết nối đi ra, với giới hạn riêng cho máy đang train. Xem [cài máy, chia sẻ capabilities và recovery](docs/HYBRID.md).

## Bắt đầu trong bốn bước

1. **Team → Add account:** chọn provider. Desktop kiểm tra thành phần cần thiết và cài/khôi phục nếu thiếu trước khi tạo account. Codex đăng nhập bằng ChatGPT. Với Antigravity, xác nhận tài khoản Google của máy hoặc dùng MESH MCP. Claude Free và các gói trả phí có thể dùng Claude trong trình duyệt hoặc Claude Desktop. Người có quyền Claude Code còn có thể kết nối CLI qua MCP. Xem [cách kết nối](docs/EXTERNAL-MESH.md).
2. **Neralu:** tạo dự án và chọn thành viên nhóm; bạn không cần đưa toàn bộ Team vào mỗi nhóm.
3. **Chat:** nhập yêu cầu nghiên cứu/trao đổi, hoặc dùng **Plan project** để lập kế hoạch triển khai và duyệt workflow. Chat thường tạo session read-only. `/goal`, `/model`, `/reasoning`, `/skills` và `/tên-skill` cấu hình yêu cầu; lệnh không hợp lệ được báo lỗi.
4. **Sessions / Reviews:** graph hiển thị từng conversation, kể cả nhiều conversation của cùng một Codex. Chọn node để xem tiến độ, react để phản hồi và vào Reviews để duyệt thay đổi.

♥ = đã hiểu, 👍 = đồng ý, 👎 = không đồng ý. Reaction gửi feedback cho tác giả; **không cấp quyền** chạy lệnh, chi tiền, merge hay deploy. Browser trong nhóm cho bạn mở trang/đăng nhập và chủ động chia sẻ nội dung đã kiểm tra với session. [Browser và giới hạn](docs/BROWSER-DESKTOP.md), [hướng dẫn kết nối provider](docs/PROVIDERS.md), [thiết kế hivemind](docs/HIVEMIND-ART.md).

Yêu cầu phát triển: **Node.js 24.22.1 trở lên**, Git. Bản desktop đóng gói sẵn runtime và Codex CLI `0.166.0`. Ứng dụng còn tìm Codex trên PATH và ở thư mục cài đặt Codex desktop trên Windows. Không bật fallback sang API trả phí.

```sh
npm ci
npm run build
npm start
```

Mở **http://127.0.0.1:4317**. Trên Windows, có thể chạy `start-relay.cmd` sau khi cài dependencies. Launcher dùng Node 24.22.1 qua npm nếu Node hệ thống chưa được cập nhật; nó không thay đổi Node toàn máy.

Phát triển giao diện: `npm run dev`, rồi mở http://127.0.0.1:5173. Chạy kiểm thử: `npm test`. Kiểm tra cả TypeScript, tests và build: `npm run check`.

**Gói demo trên website.** Mở [Gói & thanh toán](https://kivuno.vercel.app/billing), đăng nhập và chọn Plus hoặc Max. Ví riêng được tạo ngay khi đăng ký hoặc đăng nhập. Người dùng ký chuyển **0 USDC đến ví chủ Kivuno** bằng ví riêng, không cần nạp token; giá 2 và 6 USDC chỉ mô phỏng. Ví dự án gửi hộ giao dịch và trả gas bằng test AVAX miễn phí trên Avalanche Fuji. Sau khi xác minh biên nhận USDC, Kivuno cấp gói 30 ngày. [Kiến trúc và cấu hình thanh toán miễn phí](docs/KIVUNO-SPONSORED-BILLING.md).

**Demo QR cục bộ.** Chạy `npm run dev:fuji-demo`, mở [trang mua gói](http://127.0.0.1:5173/billing) và chọn Plus hoặc Max. Ngân hàng mô phỏng hiển thị số VND và mã đơn. Sau khi bạn xác nhận, Kivuno đối soát, cấp gói và cho phép kiểm chứng biên nhận trên EVM cục bộ. [Hướng dẫn demo QR](docs/KIVUNO-BANK-DEMO.md) · [Luồng test USDC cũ trên Avalanche Fuji](docs/KIVUNO-FUJI-DEPLOYMENT.md).

Giám khảo có thể đối chiếu gói Max của đơn QR với [giao dịch Fuji](https://build.avax.network/explorer/fuji/c-chain/tx/0xa84e75b8c8524e6c307a3121092cde377cdb4a525e7d0785422d00bc87e1eb97) bằng lệnh `node scripts/fuji-qr-receipt.mjs verify`. [Biên nhận công khai và thời hạn gói](public/kivuno-qr-fuji.json).

Nếu Node hệ thống cũ, chạy công cụ bằng runtime riêng:

```sh
npm exec --yes --package=node@24.22.1 -- node node_modules/vite/bin/vite.js build
npm exec --yes --package=node@24.22.1 -- node --import tsx server/index.ts
```

## Thử với bốn tài khoản

Để dùng nền tảng mới:

1. Trong desktop, tạo hồ sơ trong Team rồi New project: chọn Codex phụ trách, tên/link cuộc thi và deadline. Dự án có Git repository trên máy của Codex phụ trách; remote GitHub chưa được tự tạo. Có thể chọn repository có sẵn hoặc khởi tạo Git cho thư mục từ Neralu.
2. Mở **Neralu** để trò chuyện theo project. Tin người dùng được nhận việc một lần và chuyển tới session chỉ đọc khi có account/quota phù hợp; agent không tự mở vòng trả lời nhau. `!!` chỉ đánh dấu lệnh từ người dùng thật.
3. Trong **Sessions**, mở nhiều conversation theo account/project; chọn model/reasoning từ catalog thật, read-only hoặc scope ghi file. Bỏ trống prompt để lưu trước. Mỗi cửa sổ có output/tool events thật, follow-up/steering và Pause/Stop. Demo có thể dùng HTTPS hoặc địa chỉ loopback của máy đang chạy desktop. Đây là giao diện của runtime Codex thật, không phải cửa sổ native Codex Desktop hay ChatGPT Projects.
4. Trong panel Usage, refresh quota. Còn ≤50% ở một cửa sổ áp dụng sẽ ngừng giao việc và pause các session của account. Nếu cần dùng phần dự trữ, người dùng cấp quyền theo account/project, mức sàn và thời hạn. Quota chưa biết/quá cũ không được coi là còn đầy.
5. Trước code handoff, cấu hình owner GitHub/name/email trong Team và origin của project. Handoff dừng source, commit progress với author đã cấu hình, push và xác nhận remote SHA. Người nhận đọc/ACK, rồi tiếp tục từ session được chuyển quyền. Push lỗi giữ khóa và hiện Needs you.
6. Sau gián đoạn, kiểm tra PID cũ, xác nhận worker đã dừng rồi Recover; Resume là bước riêng. Database migration giữ hồ sơ, task và lịch sử cũ.

Luồng team workflow từ bản trước vẫn dùng được; các đường dẫn máy và browser callback dưới đây dành cho chế độ local, cloud dùng device code:

1. Trong Neralu, chọn **Connect project** rồi chọn thư mục gốc của Git repository đã có commit. Với thư mục chưa có Git hoặc repo chưa có commit, chọn **Initialize folder with Git**; Kivuno sẽ tạo Git cục bộ và commit khởi đầu từ các file Git không bỏ qua. Các file credential phổ biến và thư mục tài khoản riêng được loại trừ. Thao tác không push lên remote. Đặt mục tiêu chung cho dự án; nhánh chính cần sạch trước khi tích hợp.
2. Trong **Team**, tạo bốn hồ sơ, ví dụ Atlas / Vega / Echo / Nova, rồi chọn vai trò. Đây là nhãn bạn đặt, không phải tài khoản đã được tạo sẵn.
3. Đăng nhập lần lượt bằng **Sign in with ChatGPT** hoặc device code. Nếu trình duyệt đang giữ tài khoản trước, hãy chọn đúng tài khoản trên trang OpenAI. Kiểm tra email hiện trong từng thẻ. Không đăng nhập đồng thời vì callback OAuth dùng cổng cục bộ.
4. Dùng **Refresh** để đọc lại trạng thái, hạn mức và capabilities. **Import local skills** sao chép các standalone skills từ `~/.codex/skills` và `~/.agents/skills`, bỏ qua symlink, cấu hình xác thực và các file có tên nhạy cảm. Đây là thao tác bạn chủ động chọn.
5. Trong phần setup của mỗi hồ sơ, xem `CODEX_HOME` riêng để cài plugins hoặc cấu hình MCP. Plugins và quyền truy cập không được giả định tự đồng bộ qua tài khoản ChatGPT. Không chép `auth.json` hoặc credentials từ hồ sơ khác. Khởi động lại Kivuno sau khi sửa cấu hình plugin/MCP.
6. Từ chat chọn **Plan project** để vào Workroom, nhập yêu cầu rồi chọn **Run team**. Chỉ thành viên thuộc nhóm dự án được tham gia; các thành viên cần hoàn tất task/review đang giữ trước khi bắt đầu. Mỗi thành viên đọc repository và gửi đề xuất trong sandbox chỉ đọc. Lead tổng hợp thành kế hoạch có stages, dependencies, scope, acceptance và effort; không có task mẫu dựng sẵn.
7. Bộ điều phối kiểm tra DAG, loại kế hoạch trùng tên nhiệm vụ đang mở và phân công theo tổng effort. Vai trò chuyên môn được ưu tiên khi tải bằng nhau. Các task độc lập tự chạy song song; một thành viên chỉ giữ một task. Phạm vi `.` giữ toàn repository nên các task khác phải chờ.
8. Theo dõi hierarchy, nhiệm vụ và trao đổi giữa các agent ở **Workroom**. Feed có bộ lọc thành viên/loại hoạt động. **Pause** ngừng giao việc mới, cho lượt đã nhận tiếp tục; **Resume** tiếp tục hoặc thử lại task bị chặn. **Cancel** dừng các lượt đang chạy, giữ lại worktree và kết quả đang review.
9. Kiểm tra diff, handoff và bằng chứng test trong **Reviews**. **Accept & integrate** tạo squash commit trên nhánh đang checkout của dự án, rồi tự mở các task phụ thuộc. **Request revision** gửi phản hồi và tự chạy lại nếu workflow còn hoạt động. Agent tự báo hoàn thành chưa mở khóa dependency. Sau khi khởi động lại ứng dụng, workflow luôn tạm dừng đến khi bạn chọn Resume.

Bạn vẫn có thể tạo và chạy task thủ công trong **Tasks**. Dispatch thủ công chỉ nhận những task ngoài workflow; thành viên đã dành cho workflow không bị lấy sang công việc khác.

Kivuno không đăng ký tài khoản thay bạn. Hai hồ sơ đăng nhập cùng một tài khoản vẫn dùng chung hạn mức của tài khoản đó. Chạy một task thật sẽ sử dụng usage của tài khoản được chọn; các bài kiểm thử trong repository dùng client kiểm soát được và không gọi model.

## Những gì đã có

- Workroom gọn với prompt, hierarchy, tải công việc, dependency queue và feed trao đổi realtime qua SSE.
- Workflow từ một prompt: toàn team đề xuất → lead lập kế hoạch → cân bằng effort → thực thi theo DAG → review. Pause/resume/cancel có kiểm soát cạnh tranh; restart không tự tiêu usage.
- Team với nhiều hồ sơ Codex riêng, browser/device login, logout, quota và inventory skills/plugins thực tế.
- Board nhiệm vụ, priorities, dependencies, phạm vi công việc, assignment và dispatch.
- Nhận việc nguyên tử bằng SQLite; mỗi task/session có một owner, hai session ghi file không giữ phạm vi giao nhau. Account có giới hạn session và quota chung; khóa vẫn giữ khi chờ review.
- Git worktree và branch riêng, base commit được lưu, diff gồm thay đổi đã commit và chưa commit, tên file Unicode được hỗ trợ.
- Human approval cho lệnh/file changes. Không có nút “approve everything”. Sandbox hoặc approval policy bị hạ cấp thì không khởi chạy turn.
- Tích hợp squash có kiểm tra scope, phát hiện conflict và rollback; Git hooks vẫn được thực thi.
- Trạng thái bền vững, fencing token, heartbeat và khôi phục có xác nhận sau lần dừng bất thường. Không tự tái giao việc khi chưa biết worker cũ đã dừng.
- Tài liệu nghiên cứu đối chiếu năm sản phẩm và sáu paper arXiv trong repository.

## Giới hạn hiện tại

- Workspace chạy trên desktop của người dùng; máy khác tham gia bằng cấu hình ghép nối riêng. Bộ điều phối và các máy được ghép cần hoạt động để tiếp tục công việc. Đây chưa phải dịch vụ quản trị tổ chức với cách ly các tiến trình bằng hệ điều hành.
- Khóa ID, tên nhiệm vụ và phạm vi ngăn nhận trùng kỹ thuật; không chứng minh hai mô tả khác nhau không trùng ý nghĩa. Lead được yêu cầu hợp nhất việc trùng; người review vẫn cần xem kế hoạch. Effort là ước lượng của model, không phải thời gian hay usage đo được. Task DAG và scope có thể giới hạn mức chạy song song.
- Worktree cách ly checkout, **không phải container hoặc ranh giới bảo mật giữa tài khoản**. Các tiến trình cùng người dùng hệ điều hành có thể tiếp cận tài nguyên cùng quyền. Chỉ chạy repository, skills, plugins và hooks đáng tin cậy. Đọc [security model](docs/SECURITY.md).
- Scope được dùng cho điều phối và kiểm tra trước tích hợp; sandbox cấp quyền trên worktree, không tạo ACL riêng cho từng thư mục scope. Quyền đọc của Codex phụ thuộc sandbox/hệ điều hành.
- Handoff/test output của agent cần người review xác minh. Kivuno không tự coi lời khẳng định “tests passed” là kết quả test đã được server kiểm chứng.
- Chưa thực hiện phiên live với bốn tài khoản trả phí: người dùng sẽ tự đăng nhập lúc thử. OAuth, quota thực, plugin permissions và chạy đồng thời bốn model cần kiểm thử bằng các tài khoản đó.
- Các request tương tác Codex chưa được UI hỗ trợ sẽ bị từ chối, không tự chấp thuận. Một số tool có thể yêu cầu dùng Codex CLI để cấu hình trước.
- Worktree/branch được giữ lại để kiểm tra; chưa có giao diện dọn lịch sử. Không xóa `.relay` khi worker đang chạy. Squash không xóa các blob đã từng ghi vào Git object store của máy.

## Cấu hình

| Biến môi trường       | Mặc định                    | Ý nghĩa                                                                                                          |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `RELAY_PORT`          | `4317`                      | Cổng local; server luôn bind `127.0.0.1`.                                                                        |
| `RELAY_DATA_DIR`      | `.relay` ở thư mục ứng dụng | SQLite, isolated profiles và worktrees. Được bỏ qua trong Git.                                                   |
| `RELAY_CODEX_COMMAND` | Tìm trên PATH               | Đường dẫn tuyệt đối tới `codex.exe`, binary Codex hoặc `codex.js`; không chạy shell launcher do người dùng nhập. |
| `NODE_ENV`            | development                 | Đặt `production` để chỉ cho origin của server, tắt origin Vite.                                                  |

Không đưa thư mục dữ liệu lên cloud, không commit vào Git và không reverse-proxy cổng local ra Internet. Nếu cần đồng bộ backup, dừng worker trước và bảo vệ backup như dữ liệu đăng nhập.

## Cấu trúc

```text
src/              React UI, local API client, responsive styles
shared/           Contracts dùng chung
server/app.ts     API, browser session, CSRF, host/origin checks, SSE
server/service.ts Coordination, room tools, approval and recovery
server/workflows.ts Whole-team planning, hierarchy and automatic scheduling
server/workflow-plan.ts Bounded plan validation and effort allocation
server/store.ts   SQLite records, atomic claims and fencing
server/codex.ts   Official App Server stdio bridge per profile
server/git.ts     Worktree, diff and reviewed squash integration
tests/            Protocol, concurrency, service, Git and HTTP tests
docs/             Research, security, architecture and protocol notes
```

## Nghiên cứu và nguồn

Đã đối chiếu **Amoeba, CodeAgentSwarm, Nimbalyst, T3 Code và Paradev**. Không sao chép mã hoặc assets của các sản phẩm đó. [Research notebook](docs/RESEARCH.md) ghi nguồn, version paper, quyết định và phần còn chưa kiểm chứng.

Thiết kế điều phối tham khảo [CAID](https://arxiv.org/abs/2603.21489); các tình huống lỗi tham khảo [MAST](https://arxiv.org/abs/2503.13657). Giao thức và đăng nhập dựa trên [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex authentication](https://learn.chatgpt.com/docs/auth) cùng TypeScript schema xuất từ binary đang cài.

Kivuno là dự án độc lập, không phải sản phẩm chính thức của OpenAI. MIT licensed.
