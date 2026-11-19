# Thiết kế thanh toán Kivuno Plus/Max trên Avalanche

**Trạng thái:** contract, compiler script, verifier/API, giao diện và quota profile/group đã được triển khai, kiểm tra local và push trực tiếp lên GitHub `main`. Ví deployer hiện có 20 Fuji test USDC nhưng chưa có test AVAX; contract chưa deploy và chưa chạy payment end-to-end.
**Ngày kiểm tra nguồn:** 19/11/2026.
**Phạm vi hiện tại:** Fuji C-Chain, USDC testnet, demo cuộc thi. Mainnet và nhận tiền thật chưa được chốt hoặc cho phép.

## Tóm tắt đề xuất

Dùng mẫu Stripe để học các ranh giới tin cậy và xử lý vòng đời thanh toán: máy chủ tạo yêu cầu giá có kiểm soát; xác nhận từ trình duyệt không tự cấp quyền; xác thực nguồn sự kiện; xử lý lặp an toàn; entitlement là trạng thái riêng được cập nhật sau khi giao dịch đã được xác minh. Stripe Billing tự thu tiền định kỳ nên không bê nguyên luồng subscription của Stripe: Kivuno yêu cầu người dùng ký/xác nhận riêng cho mỗi tháng và không tự gia hạn.

Đề xuất dùng ví ngoài do người dùng kiểm soát, liên kết ví với tài khoản Kivuno bằng nonce ký một lần, và triển khai hợp đồng/luồng thanh toán trên Fuji. Không lưu private key trong Kivuno hoặc localStorage. Mỗi lần thanh toán phải hiện rõ Fuji, token, số USDC, người nhận, gói và phí; không cấp allowance vô hạn. Backend chỉ cấp quyền sau khi xác minh chain, token, contract, payer, amount, plan, receipt và event.

Fuji C-Chain dùng chain ID `43113`; Circle Fuji USDC là `0x5425890298aed601595a70AB815c96711a31Bc65`, 6 decimals. Người dùng chốt 2 USDC test cho Plus và 6 USDC test cho Max; đây là testnet units, không phải giá trị quy đổi từ 50.000/150.000 VND. Người mua tự trả gas bằng test AVAX.

## Yêu cầu và quyết định hiện có

| Nội dung                       | Trạng thái hiện tại                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Mua gói theo tháng             | Đã chốt; thanh toán thủ công từng tháng                                                                         |
| Tự gia hạn / agent tự chi tiền | Không; mỗi khoản chi cần người dùng xác nhận                                                                    |
| Giới hạn Free                  | 3 provider profile/người; 3 người/group                                                                         |
| Gói Plus                       | Thay tên Pro; 10 profile/người; 10 người/group                                                                  |
| Gói Max                        | Không giới hạn profile và thành viên group                                                                      |
| Giá VND                        | Người dùng chốt Plus 50.000 VND/tháng, Max 150.000 VND/tháng                                                    |
| Tên gói                        | Đã chốt Plus thay Pro, giữ hạn mức 10/10                                                                        |
| Tài sản demo                   | Fuji test USDC                                                                                                  |
| Lượng USDC test                | Plus 2 USDC; Max 6 USDC; Fuji test token only                                                                   |
| Người trả gas                  | Người mua trả gas bằng test AVAX                                                                                |
| Custody                        | Ví Core tự quản lý; Kivuno không nắm khóa hay seed phrase                                                       |
| Group                          | Chủ group mua gói; hạn mức theo gói của chủ group                                                               |
| Hạ gói/quá hạn                 | Giữ dữ liệu; khóa các profile/member vượt hạn mức đến khi giảm số lượng; chủ tài khoản chọn mục còn hoạt động   |
| Hết hạn/hoàn tiền              | Fuji testnet: hết hạn là về Free, không hoàn tiền; gia hạn thủ công, không tự gia hạn                           |
| Gia hạn cùng gói               | Cộng 30 ngày từ `max(now, paidUntil)`                                                                           |
| Đổi Plus/Max giữa kỳ           | Tier đổi ngay; kỳ mới 30 ngày từ thời điểm mua; không hoàn/bù thời gian còn lại                                 |
| Offline desktop                | Khi kết nối lại, đồng bộ entitlement hiện tại; không thể thu hồi ngay khi offline                               |
| Đổi ví                         | Cần chữ ký từ ví cũ và ví mới; mất ví cũ thì không có cơ chế khôi phục tự động                                  |
| Ví deployer/treasury           | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`; dùng cùng ví cho deployer và treasury Fuji theo giả định hiện tại |
| Mainnet, tiền thật             | Chưa có quyết định; không triển khai trong phạm vi demo                                                         |

Các lựa chọn sản phẩm trên đã được người dùng chốt cho demo. Còn thiếu địa chỉ contract sau deploy và cấu hình môi trường cloud để mở luồng thanh toán trên Fuji. Không có private key/seed trong repo hay chat.

## Cuộc thi Avalanche

Các nguồn Team1 và Builder Hub được xem đến 19/11/2026. Theo rules/FAQ Team1, dự án web2 có thể tham gia nếu tích hợp Avalanche thật; Fuji/C-Chain là lựa chọn phù hợp cho demo, không nhận tiền thật hay bán token trong khuôn khổ cuộc thi, không ghi PII lên chain. Rubric công bố: kỹ thuật 25, tích hợp Avalanche 25, sáng tạo 15, tác động 15, pitch 10, UI/demo 10. Đây là các yêu cầu chung; Topic 12 có yêu cầu riêng về SmartAccount/PolicyModule cho agent treasury, Topic 17 yêu cầu x402. Payment subscription của Kivuno không tự động trở thành Topic 12 hoặc 17.

Nguồn hiện công bố deadline/cổng nộp chưa nhất quán: Team1 ghi 21/11/2026 23:59 giờ Việt Nam và nộp qua profile Team1; Builder Hub ghi 25/11/2026 05:59 Asia/Bangkok, agenda có Final Submission 24/11. Chưa có xác nhận trực tiếp từ BTC. Lập kế hoạch theo hạn sớm nhất 21/11 và cần đội xác minh cổng nộp/hạn trước khi gửi. Không tự nộp.

Để chứng minh tích hợp thật, demo cần cho thấy: ví Fuji; số USDC test chính xác; giao dịch/receipt/event tra được trên explorer; entitlement trong Kivuno đổi sau xác minh; Free bị chặn đúng hạn mức và Plus/Max mở đúng quyền. Không gọi testnet USDC là tiền thật.

Nguồn: [Team1 Vietnam UniHack](https://team1vn.xyz/), [topics.json](https://team1vn.xyz/topics.json), [Topic 12](https://team1vn.xyz/topic.html#12), [Topic 17](https://team1vn.xyz/topic.html#17), [Builder Hub event](https://build.avax.network/events/596c0b2d-63aa-4cf0-a0ad-a7e34ddbfdc0).

## Hiện trạng Kivuno liên quan đến hạn mức

| Hiện trạng được đọc trong source                                                                                                                                                  | Ý nghĩa với thiết kế                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Provider profile lưu trong SQLite của workspace; API hiện có các đường thêm profile và giới hạn cục bộ 16 (`server/store.ts:163-175`, `server/app.ts:491-555`).                   | Đây không phải giới hạn thống nhất theo một người trên nhiều máy. Không thể chỉ đổi số 16 thành 3/10 để đạt yêu cầu.                |
| Mỗi người dùng có workspace theo thiết bị; provider profiles được lưu riêng trên thiết bị (`desktop/workspaces.cjs:5-12`, `desktop/main.cjs:1278-1294`, `server/index.ts:13-17`). | Hạn mức xuyên thiết bị cần một dịch vụ/ledger trung tâm hoặc cơ chế reservation có kiểm soát.                                       |
| Shared Groups là mô hình cloud riêng; giới hạn hiện tại là 50 group do owner tạo và 32 người/group (`server/collaboration.ts:104-119`, `:162-174`).                               | Có thể đặt hạn mức group ở cloud API; cần tính cả lời mời đang pending để không lách hạn mức.                                       |
| Better Auth có user ID cloud; cloud bootstrap gắn với workspace owner (`server/cloud-auth.ts:34-75`).                                                                             | Đây là khóa phù hợp hơn địa chỉ ví để biểu diễn entitlement Kivuno; wallet chỉ là phương tiện thanh toán.                           |
| AEGIS là policy/evidence trên Fuji, không phải cổng thu tiền hay entitlement (`contracts/RelayAegis.sol`, `docs/AEGIS.md`).                                                       | Tạo module/payment contract độc lập; không tái dùng nhầm contract/key AEGIS.                                                        |
| `contracts/KivunoPlans.sol` và `server/billing.ts` đã được triển khai, có kiểm thử local; chưa deploy/kiểm thử tích hợp Fuji.                                                     | Chỉ dùng làm demo sau khi deploy Fuji, xác minh receipt/entitlement và kiểm thử luồng quota đầu-cuối.                               |
| `docs/SECURITY.md:11` nói public signup bị tắt, trong khi `server/cloud-auth.ts:82-127` và `tests/cloud-signup.test.ts:81-115` cho phép public email signup.                      | Cần sửa tài liệu hoặc quyết định sản phẩm trước khi dùng email identity làm nền cho thanh toán. Đây là bất nhất hiện hữu, chưa sửa. |

Lưu ý thực thi: local client có thể bị sửa hoặc chạy offline. Backend phải là authority cho reservation account-wide và group quota; desktop chỉ áp dụng entitlement mới sau khi kết nối lại. Quá hạn/hạ gói không xóa dữ liệu; giữ các profile/member vượt hạn mức ở trạng thái khóa đến khi người dùng giảm số lượng.

## Stripe: nghiên cứu repo chính thức và phần có thể học

### Repo đã kiểm tra

| Repo/tài liệu                                                                                                 | Bằng chứng và giấy phép                                                                                                                                                                                                                                                                 | Phần áp dụng / giới hạn                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [stripe-samples/subscription-use-cases](https://github.com/stripe-samples/subscription-use-cases)             | Repo Stripe Samples, có LICENSE MIT. README nói rõ đây là mẫu giáo dục để trình bày API và khái niệm; có hướng dẫn chạy test mode/Stripe CLI. Node sample dùng Price lookup keys, tạo subscription server-side, xác thực webhook trên raw body và xử lý các event invoice/subscription. | Học tách giá/checkout/lifecycle và cách xác thực event. Không chứng minh đây là một hệ thống production đã kiểm toán; auto-billing của Stripe trái với yêu cầu gia hạn thủ công. |
| [stripe-samples/checkout-single-subscription](https://github.com/stripe-samples/checkout-single-subscription) | Mẫu chính thức đa ngôn ngữ; có LICENSE trong repo. Node/Next route tạo Checkout Session phía server; webhook kiểm chữ ký và xem event `checkout.session.completed`.                                                                                                                     | Học server tạo payment session và không tin trang success để cấp quyền. Checkout Session, customer portal và Stripe webhook không chuyển thành Avalanche contract/API trực tiếp. |
| [Stripe webhook guide](https://docs.stripe.com/billing/subscriptions/webhooks)                                | Tài liệu chính thức: vòng đời subscription bất đồng bộ; cần webhook, xác thực nguồn event, xử lý payment failure và thay đổi trạng thái.                                                                                                                                                | Chuyển nguyên tắc thành verifier/indexer cho chain, không dùng webhook Stripe.                                                                                                   |
| [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)                                 | API mutation có thể dùng idempotency key; không đưa email/PII vào key; retry cùng thao tác an toàn trong thời hạn Stripe lưu.                                                                                                                                                           | Dùng khóa duy nhất cho payment event và API attempt; Kivuno cần lưu ledger lâu dài vì thời gian/thực thể khác Stripe.                                                            |
| [Stripe entitlements](https://docs.stripe.com/billing/entitlements)                                           | Stripe mô hình hóa feature access tách khỏi checkout/payment UI.                                                                                                                                                                                                                        | Tạo entitlement projection Kivuno tách biệt khỏi giao dịch; quyền vẫn phải được kiểm tra ở API/service.                                                                          |

Repo Stripe mẫu có thể dùng như tài liệu tham khảo; chưa chép code. Nếu sau này sao chép đoạn MIT, giữ copyright/license notice và rà đúng file, dependency, quyền tương thích với license của repo Kivuno. Không thêm Stripe SDK hoặc gọi Stripe làm payment provider.

### Ánh xạ Stripe → Avalanche

| Stripe pattern                                    | Kivuno/Avalanche tương đương                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Server lấy plan/price hợp lệ và tạo checkout      | Backend tạo `bytes32` PaymentIntent một lần, gắn user, wallet, plan, chain, token, amount, expiry                                  |
| Stripe Checkout redirect/success URL              | Ví ngoài hiển thị chain, token, số tiền, recipient, plan và yêu cầu người dùng xác nhận                                            |
| Webhook có chữ ký raw body                        | Backend đọc receipt/log từ Fuji RPC đã cấu hình; explorer chỉ hiển thị transaction cho người dùng, không làm nguồn xác thực        |
| `invoice.payment_succeeded` / subscription events | Event contract `PlanPaid` + state `paidUntil`, xác minh từ receipt thành công                                                      |
| Webhook retry/duplicate                           | Unique key `(chainId, txHash, logIndex)` cộng unique `paymentIntentId`; contract đánh dấu intent đã dùng để chặn giao dịch thứ hai |
| Entitlement service/feature access                | Kivuno account entitlement và profile/group reservation; nguồn gốc gắn với payment record đã xác minh                              |
| Stripe auto-renewal/failure recovery              | Không áp dụng; hết hạn về Free, người dùng chủ động trả cho tháng kế tiếp                                                          |
| Idempotency cho API create                        | `bytes32` ngẫu nhiên không chứa PII cho payment intent; uniqueness trong DB và replay-safe writes                                  |

**Không coi redirect thành công, transaction hash do trình duyệt gửi, token transfer bất kỳ, hay event từ contract không đúng địa chỉ là bằng chứng đủ.** Kivuno phải tự xác minh receipt status, chain ID, contract address, token, payer binding, plan, amount và event fields.

## Custody và trả gas

Đã chốt dùng Core Extension tự quản lý: Kivuno không nắm khóa, không giữ recovery key, và không lưu private key/seed phrase. Địa chỉ deployer/treasury công khai được cung cấp là `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`; giả định dùng cùng ví làm treasury testnet. Người mua trả gas bằng test AVAX. Liên kết ví với tài khoản Kivuno bằng nonce dùng một lần; đổi ví cần chữ ký của ví hiện tại và ví mới. Chữ ký liên kết không tự cấp quyền thanh toán.

| Cách trả gas                   | Ưu                                                                                              | Chi phí/rủi ro                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Người mua trả bằng test AVAX   | Ít hạ tầng, ít trust trung gian, dễ chứng minh self-custody                                     | Người dùng cần test AVAX và xác nhận giao dịch trên Fuji                                                                                                                                |
| Kivuno/facilitator tài trợ gas | Ít ma sát; Avalanche x402 tutorial có ví dụ facilitator trả gas với USDC EIP-3009 authorization | Thêm relayer/facilitator, quota/abuse control, availability, phí và một trust boundary; cần ràng buộc authorization chính xác, one-use, nonce và deadline; plan intent cần chữ ký riêng |

Avalanche Academy hướng dẫn Fuji USDC và x402 gas sponsorship bằng authorization riêng cho token/amount/recipient/nonce/time. Tuy nhiên Topic 17 là x402; x402 phục vụ payment theo HTTP 402 và facilitator, không phải mặc định cho subscription của Kivuno. Dùng nó chỉ nếu mục tiêu topic/gas sponsorship đã được chốt.

**Ràng buộc plan/payment intent:** EIP-3009 token signature ràng buộc token transfer, nhưng không ràng buộc gói Kivuno. Contract bind `paymentIntentId`, payer=`msg.sender`, planId, exact amount, token recipient, nonce và thời gian. Contract không hỗ trợ relayer; người mua gửi giao dịch và trả gas.

Đã kiểm tra chỉ đọc Fuji ngày 19/11/2026: RPC trả chainId `0xa869` (43113); implementation của USDC proxy là `0x6f3c4787bab4eeebf62efb8c35dc9259fdc9d9f4`. ABI/source đã xác minh trên Routescan cho implementation `FiatTokenV2_2` có `receiveWithAuthorization` (cả overload bytes và v/r/s); source Circle kế thừa EIP-3009 và kiểm tra `to == msg.sender` để ngăn gọi thẳng token trước contract nhận. Đây là bằng chứng ABI/source, chưa phải test tích hợp Kivuno và chưa có giao dịch thanh toán. Dùng `receiveWithAuthorization` là ứng viên tốt để tránh allowance rộng; paymentIntent/plan vẫn phải được bind riêng như trên. Nếu dùng exact approve fallback, allowance còn lại sau giao dịch fail phải được hiển thị/thu hồi, không dùng allowance vô hạn.

## Luồng giao dịch triển khai

```mermaid
sequenceDiagram
  actor U as Kivuno user
  participant A as Kivuno app
  participant B as Kivuno billing API
  participant W as External wallet
  participant C as Payment contract (Fuji)
  participant R as Configured Fuji RPC/verifier
  participant E as Entitlement + reservation store

  U->>A: Chọn gói và xác nhận mua tháng này
  A->>B: Tạo payment intent
  B-->>A: plan, amount, chain, token, recipient, expiry
  A->>W: Yêu cầu ký/gửi giao dịch chính xác
  W->>C: Payment giao dịch trên Fuji
  C-->>R: Receipt + PlanPaid event
  R->>R: Kiểm chain, status, contract, payer, plan, token, amount
  R->>E: Ghi intent/event một lần, cập nhật entitlement
  E-->>A: Trạng thái đã xác minh; mở đúng hạn mức
  A-->>U: Hiển thị explorer link và thời điểm hết hạn
```

Contract đã được viết Fuji-only: Plus/Max là 2,000,000/6,000,000 đơn vị USDC, kỳ 30 ngày, exact `receiveWithAuthorization`, immutable USDC/treasury, intent one-time, không có owner/admin, auto-renew, allowance hay refund. Cùng tier gia hạn từ `max(now, paidUntil)`; đổi tier bắt đầu 30 ngày từ thời điểm mua.

Verifier/API đã được triển khai để kiểm transaction sender/input, Fuji chain, receipt success, contract, `PlanPaid`, exact USDC transfer logs, server intent, payer, plan, token, amount và expiry. Pending không cấp quyền; lỗi RPC có thể retry. Entitlement chỉ được ghi sau khi on-chain evidence được xác minh. Local tests đã qua; chưa có giao dịch Kivuno trên Fuji. Explorer chỉ là đường dẫn kiểm chứng cho người dùng, không phải authority.

Avalanche C-Chain là EVM, Fuji chain ID 43113; tài liệu Avalanche ghi block được consensus chấp nhận có finality khoảng một giây, nhưng receipt/log chỉ có sau khi block execution hoàn tất. Vì vậy cần phân biệt tx đã gửi, block accepted và receipt đã thực thi. Không cần đợi nhiều confirmation như Ethereum, nhưng vẫn phải chờ receipt và xử lý RPC/indexer lag.

## Dữ liệu và nguồn sự thật

- `WalletBinding`: `userId`, địa chỉ checksum, thời điểm liên kết. Không đưa email/userId lên chain. Đổi ví cần chữ ký từ ví cũ và ví mới.
- `PaymentIntent`: `bytes32` ngẫu nhiên; `userId`, wallet, plan, expected amount/token/contract/chain, expiry, status. ID không chứa PII và bị contract tiêu thụ một lần.
- `OnchainPayment`: `chainId`, `txHash`, `logIndex`, `blockNumber`, contract, token, payer, `paymentIntentId`, plan, amount, paidUntil, verify time. Unique `(chainId, txHash, logIndex)` và unique `paymentIntentId`; ghi event + entitlement trong cùng DB transaction.
- `Entitlement`: user, tier, activeUntil, source payment, block đã đồng bộ. Chain payment là bằng chứng; entitlement là projection có thể rebuild/reconcile.
- `ProfileReservation`: user, workspace/device, profile ID, state; reserve/release phải nguyên tử theo account-wide quota.
- `GroupSeat`: group, owner user, member identity, invite state; group capacity lấy từ owner entitlement, active + pending invitations cùng tính.

Chain là nguồn sự thật về khoản thanh toán và thời hạn đã ghi trong contract. Kivuno Cloud là nguồn sự thật về identity, wallet binding, profile reservations, group membership và quyền truy cập được suy ra. Khi lệch nhau: không nâng quyền từ dữ liệu local/browser; đối soát từ receipt/state contract rồi rebuild entitlement. Không ghi email, nội dung chat, provider token, project name hay dữ liệu cá nhân lên chain.

## Threat model và kiểm soát đề xuất

| Mối đe dọa                                  | Kiểm soát thiết kế                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ví bị đổi sang attacker                     | Nonce one-time; domain/chain-bound signature; cần re-auth và quy trình đổi ví riêng; không cho bind lại chỉ bằng session cookie                                      |
| Một ví được bind vào nhiều tài khoản Kivuno | Unique constraint trên normalized wallet address; đổi ví cần re-auth/recovery và giữ audit trail                                                                     |
| Sai chain/token/contract                    | Backend và contract allowlist cố định Fuji/token; UI đọc chain id; verifier kiểm mọi địa chỉ/amount                                                                  |
| Fake tx hash / success page                 | Chỉ receipt/event được verifier kiểm mới cập nhật paid                                                                                                               |
| Duplicate event/retry                       | DB uniqueness + transaction nguyên tử; replay trả lại cùng entitlement                                                                                               |
| Hai transaction dùng cùng payment intent    | Contract đánh dấu `paymentIntentId` đã tiêu thụ; DB đặt unique constraint trên intent ngoài unique tx/log                                                            |
| Pending/RPC/indexer outage                  | Pending không cấp quyền; retry/reconcile theo tx và payment intent                                                                                                   |
| Phishing/extension độc/XSS                  | Không giữ key; CSP/XSS hardening; không yêu cầu ký message mơ hồ; UI hiển thị recipient/amount/chain                                                                 |
| Allowance rộng                              | Không approve unlimited; ưu tiên Fuji USDC `receiveWithAuthorization` exact authorization đã xác minh ở ABI/source; fallback exact amount và xử lý allowance còn lại |
| Front-run authorization                     | Dùng recipient-bound receive path nếu đúng contract hỗ trợ; bind intent/plan; không dùng transferWithAuthorization “mù” vào contract                                 |
| Abuse relayer/gas sponsor                   | Giới hạn domain/chain/token/amount/deadline/nonce, quota theo user, replay protection, budget cap và kill switch                                                     |
| Sai token/treasury/giá                      | Contract Fuji-only, token/treasury immutable, giá on-chain cố định; backend xác minh địa chỉ/token/số lượng                                                          |
| Lách profile quota bằng nhiều máy           | Reservation cloud atomic; local limit chỉ là UX, không phải authority                                                                                                |
| Max abuse / entitlement giả                 | Max gắn với user/owner được xác minh; enforcement trên API; rate/resource controls riêng                                                                             |

Đây là threat model thiết kế, chưa phải audit Solidity hoặc pentest.

## Product brief và mức chắc chắn của nghiên cứu

Người dùng mục tiêu giả định: người dùng Kivuno kết nối nhiều profile AI provider và nhóm cần cộng tác. Vấn đề “profile Kivuno” khác với quota/token của provider; thanh toán Kivuno chỉ thay đổi giới hạn tính năng Kivuno, không bán thêm quota Codex/Gemini/Claude.

Bằng chứng thị trường hiện chỉ là khảo sát rộng, không phải nghiên cứu người dùng Kivuno hay khảo sát Việt Nam: Stack Overflow 2025 có 49.009 phản hồi từ 177 quốc gia; HackerRank 2025 có 13.732 người trả lời từ 102 quốc gia, gồm vai trò/seniority khác nhau. Hai báo cáo giúp hiểu bối cảnh dùng công cụ AI nhưng không chứng minh người dùng Kivuno sẵn sàng trả 50.000/150.000 VND. Chưa có phỏng vấn, usability test hay dữ liệu tỷ lệ gia hạn. Mức giá là quyết định của người dùng, không phải WTP đã kiểm chứng.

Nghiên cứu nên làm sau demo: phỏng vấn 5–8 người dùng hiện hữu; xem họ có cần nhiều profile/group không; đo thời gian hoàn tất connect-wallet→paid→feature; kiểm thử đọc hiểu phí/chain; ghi tỷ lệ bỏ ở wallet/gas; hỏi lý do gia hạn/hủy. Theo dõi: task success, thời gian đến profile đầu tiên, invite success, entitlement mismatch, payment completion/pending/error, renew rate và lý do không gia hạn.

## Kế hoạch triển khai và cổng nghiệm thu

| Mốc                     | Nội dung                                                                                             | Điều kiện/kiểm thử                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0. Yêu cầu sản phẩm     | Đã chốt Plus/Max, giá, USDC, gas, gia hạn, đổi ví, offline, group owner, downgrade                   | Không cần hỏi lại các lựa chọn đã xác nhận                                       |
| 1. Wallet identity      | Implemented: one-time nonce, unique binding, wallet change requires two signatures                   | Browser connection and signed wallet bind still need Fuji verification           |
| 2. Fuji contract        | Implemented and compiled Fuji-only; local EVM tests pass                                             | Independent review and deployment remain                                         |
| 3. Billing verifier     | Implemented PaymentIntent, receipt/event verifier and idempotent ledger                              | Fuji pending/revert/wrong-chain, RPC outage and live intent reconciliation       |
| 4. Entitlement + quotas | Implemented account entitlement, group owner quotas, desktop profile reservations and lock selection | Fuji end-to-end and manual downgrade/device-sync checks                          |
| 5. UI/wallet flow       | Implemented Plus/Max selection, wallet binding, exact amount/recipient and payment confirmation      | Manual responsive, keyboard and screen-reader review                             |
| 6. Security review      | Solidity, authorization, key storage, API, event processing, UX                                      | Independent reviewer; address all findings and record remaining risk             |
| 7. Fuji demo            | Deploy/test only after values and wallet configured; no real funds                                   | Verify published address/receipt/event; test complete purchase→entitlement→quota |
| 8. Handoff              | Setup, architecture, limitations, video script, rubric evidence                                      | Reproducible setup; label inherited vs new work; do not submit externally        |
| 9. Release              | Local typecheck, build and focused tests pass; Git identity verified; source pushed to `main`        | Cloud deploy and on-chain Fuji demo remain separate gates                        |

Contract và app chưa deploy. Người dùng chốt giai đoạn hiện tại chỉ push GitHub, chưa deploy app. Để tiếp tục demo on-chain cần có test AVAX tại đúng ví deployer; sau đó người dùng phải xem và ký giao dịch deploy bằng Core. Vercel CLI không cần cho phạm vi GitHub-only hiện tại. Không dùng tài sản mainnet hoặc giá trị thật để lấy test token.

## Kịch bản demo 2–3 phút (sau khi hệ thống thật chạy)

1. Mở Kivuno, chỉ Free và minh họa giới hạn 3 profile/3 người.
2. Chọn Plus; màn hình hiện Fuji, USDC contract, số USDC chính xác, recipient, thời hạn và gas payer.
3. Người dùng xác nhận trong ví; không bật auto-renew hay allowance rộng.
4. Hiện pending cho đến khi receipt/event Fuji được backend xác minh; mở transaction trên explorer.
5. Kivuno cập nhật tier và cho tạo profile/group member thứ 4 trong đúng hạn mức.
6. Mở entitlement record/contract event và test tự động tương ứng; kết thúc bằng giới hạn hiện biết và nhấn mạnh đây là Fuji test USDC, không phải thanh toán thật.

Không quay/đưa private key, seed phrase, email hoặc nội dung cá nhân vào video/slides.

## Pháp lý và giới hạn vận hành

Nghị quyết 05/2025/NQ-CP về thí điểm thị trường tài sản mã hóa có điều khoản về tài sản mã hóa dùng thanh toán bằng VND và giới hạn dịch vụ cho tổ chức được cấp phép. Việc áp dụng cụ thể cho SaaS Kivuno nhận USDC đổi quyền truy cập phần mềm chưa được xác định; không diễn giải đây là cho phép hay cấm trong tài liệu này. Cần luật sư Việt Nam rà soát bằng văn bản trước mainnet/thu tiền thật. Wallet address gắn với tài khoản có thể là dữ liệu cá nhân theo ngữ cảnh; giữ mapping off-chain, giảm thiểu và công khai mục đích xử lý. Chính sách testnet “không hoàn tiền” không được tự động đưa thành điều khoản cho production.

Vercel Sandbox/SQLite hiện có thể ngủ hoặc phụ thuộc snapshot; không xem cấu hình hiện tại là hạ tầng production billing SLA. Payment records cần durable storage, retry/reconciliation và backup trước khi vận hành thật.

## Nguồn chính

### Stripe

- [Official subscription sample](https://github.com/stripe-samples/subscription-use-cases)
- [Node fixed-price server source](https://github.com/stripe-samples/subscription-use-cases/blob/main/fixed-price-subscriptions/server/node/server.js)
- [Single subscription sample](https://github.com/stripe-samples/checkout-single-subscription)
- [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Entitlements](https://docs.stripe.com/billing/entitlements)

### Avalanche / chuẩn liên quan

- [Primary Network / C-Chain](https://build.avax.network/docs/primary-network)
- [C-Chain exchange integration and receipt/finality](https://build.avax.network/docs/primary-network/exchange-integration)
- [Fuji setup and test USDC address](https://build.avax.network/academy/blockchain/x402-payment-infrastructure/04-x402-on-avalanche/02-network-setup)
- [Avalanche x402 payment flow](https://build.avax.network/academy/blockchain/x402-payment-infrastructure/03-technical-architecture/01-payment-flow)
- [Fuji USDC proxy ABI](https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api?module=contract&action=getabi&address=0x5425890298aed601595a70AB815c96711a31Bc65) and [implementation source](https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api?module=contract&action=getsourcecode&address=0x6f3c4787bab4eeebf62efb8c35dc9259fdc9d9f4)
- [Circle EIP-3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol)
- [EIP-2612](https://eips.ethereum.org/EIPS/eip-2612), [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009), [SIWE / EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)

### Quy định, thị trường và repo học hỏi

- [Nghị quyết 05/2025/NQ-CP](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-5-2025-nq-cp-ve-trien-khai-thi-diem-thi-truong-tai-san-ma-hoa-tai-viet-nam-119250909184045221.htm)
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/ai)
- [HackerRank Developer Skills Report 2025](https://www.hackerrank.com/reports/developer-skills-report-2025)
- [Mentor repo](https://github.com/tuantqse90/team1vn-socialonchain) — dùng để học thiết kế contract/indexer; hạn chế và trạng thái test/deploy được ghi riêng trong nghiên cứu ban đầu; không sao chép ví nhúng/localStorage.
- [Circle stablecoin-evm license/source](https://github.com/circlefin/stablecoin-evm) — xem ABI/implementation đúng token trước khi chọn EIP-3009 path.

## Trạng thái bàn giao hiện tại

- Repo làm việc là `D:\ChatGPT\Kivuno-research`, branch `main`, đã fast-forward từ origin/main; `D:\ChatGPT\Kivuno` là clone khác và đang cũ hơn.
- Stripe repo và docs đã được nghiên cứu để học idempotency, event verification và entitlement; không chép mã Stripe.
- Fuji USDC/chain ID đã xác định; live RPC trả `USD Coin`, version `2`, decimals `6`. Contract Fuji-only, compiler, backend payment API, UI Plus/Max và quota profile/group đã có trong source.
- Kiểm tra local ngày 19/11/2026: typecheck, Prettier trên file hỗ trợ, build Vite/cloud, compile Solidity Cancun/Shanghai và 10 kiểm thử billing/contract/collaboration đều qua. Toàn bộ suite trước đó có 328 pass, 1 skip; sau thay đổi UI gần nhất đã chạy lại các nhóm liên quan.
- Ví deployer/treasury công khai do người dùng cung cấp là `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`; Core Extension đã kết nối và UI hiển thị đúng địa chỉ này. Không có private key/seed trong repo hay chat.
- Circle faucet đã gửi 20 test USDC đến ví trên; receipt Fuji thành công ở tx `0x70ecab7c60105a54f6a17c8803c411a77505b5cab5cb1be85cc915dcdbed7139`. Số dư AVAX test vẫn bằng 0 tại lần kiểm tra đã ghi nhận.
- Builder Hub từng báo nhận 0.5 AVAX nhưng vào Console Wallet nội bộ (đuôi `073F`), không phải ví deployer; không dùng số dư đó. Builder Hub báo cooldown. QuickNode Fuji faucet hiện không cho tiếp tục vì ví không đạt yêu cầu số dư AVAX mainnet nhỏ; trang FAQ nói faucet không cần tài khoản QuickNode nhưng có điều kiện số dư mainnet. Không nạp tài sản mainnet chỉ để vượt điều kiện này.
- Source đã được push trực tiếp lên GitHub `main`: `3b57594` (implementation) và `3161ac6` (status docs), dưới tài khoản `Tienkhoaa2908`. Người dùng chốt chưa deploy app Vercel. Còn lại cho demo on-chain: nhận test AVAX tại đúng ví, người dùng xem/ký giao dịch deploy bằng Core, kiểm tra độc lập cấu hình contract, rồi chạy luồng payment/receipt/entitlement đầu-cuối.
- Chưa có contract/app deployment, payment đầu-cuối, audit độc lập, mainnet transaction, thu tiền thật hoặc contest submission. Vercel CLI không cần cho yêu cầu GitHub-only hiện tại.

### Cập nhật faucet — 19/11/2026

- RPC Fuji vừa kiểm tra vẫn trả `0x0` AVAX cho ví deployer. Builder Hub đã đăng nhập nhưng C-Chain faucet còn cooldown khoảng 23 giờ 14 phút; claim 0.5 AVAX trước đó vẫn ở Console Wallet nội bộ, không phải ví deployer.
- QuickNode chặn faucet vì ví không có số dư AVAX mainnet nhỏ ([faucet](https://faucet.quicknode.com/avalanche/fuji)); không nạp tài sản mainnet chỉ để vượt điều kiện. Triangle báo dịch vụ bị tạm ngưng. AllThatNode giữ dòng Fuji ở trạng thái disabled/loading và không hiện biên nhận; chưa có bằng chứng token được gửi.
- Avalanche Academy vẫn công bố coupon qua Guild/External Faucet ([hướng dẫn](https://build.avax.network/academy/avalanche-l1/avalanche-fundamentals/04-creating-an-l1/02a-claim-testnet-tokens)), nhưng role [Get Testnet AVAX](https://guild.xyz/avalanche/role/1d96ffbf-6fb0-48f4-b1da-606536838014) đang yêu cầu snapshot role cũ chưa đạt. Email được đánh dấu đạt; Discord đã liên kết theo xác nhận của người dùng, nhưng invite Avalanche báo không thể chấp nhận và Guild chưa thấy role/member. Chưa lấy được coupon; không gửi tin nhắn nào.
- Hướng tiếp theo: đợi Builder Hub cooldown rồi claim C-Chain AVAX khi Core đang trỏ đúng ví deployer; sau khi số dư xác minh được, người dùng xem/ký giao dịch deploy contract trong Core. Vẫn không deploy app Vercel theo quyết định hiện tại.
