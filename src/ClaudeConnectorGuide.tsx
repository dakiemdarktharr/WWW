import { useEffect, useState } from 'react';
import { claudeMcpPath, claudeConnectorInstallUrl } from '../shared/claude-web';
import { claudeConnectorsUrl } from './ClaudeAccount';
import { PortalLanguage, PortalLocaleProvider, usePortalLocale } from './PortalLocale';
import { PortalThemeProvider, PortalThemeToggle } from './PortalTheme';
import './billing.css';
import './ClaudeConnectorGuide.css';

const address = 'https://kivuno.vercel.app' + claudeMcpPath;
const support = 'khoadao29082007@gmail.com';

function Guide({ vi }: { vi: boolean }) {
  const [copy, setCopy] = useState<'copied' | 'select'>();

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopy('copied');
    } catch {
      setCopy('select');
    }
  }

  return (
    <>
      <p>
        {vi
          ? 'Dùng Claude để tóm tắt tiến độ, tìm vướng mắc hoặc xem nội dung bàn giao từ nhóm dự án bạn chủ động chia sẻ trong Kivuno.'
          : 'Use Claude to summarize progress, find blockers, or review handoffs from a project group you choose to share in Kivuno.'}
      </p>

      <section aria-labelledby="claude-guide-connect">
        <h2 id="claude-guide-connect">
          {vi ? 'Lần đầu thêm Kivuno vào Claude' : 'Add Kivuno to Claude for the first time'}
        </h2>
        <p>
          {vi
            ? 'Nếu chưa tìm thấy Kivuno trong danh mục Claude, hãy thêm connector tùy chỉnh theo các bước dưới đây. Bạn chỉ cần thêm một lần cho mỗi tài khoản Claude. Giữ ứng dụng Kivuno mở trong lúc kết nối.'
            : 'If Kivuno is not in your Claude directory yet, add a custom connector using these steps. Add it once per Claude account. Keep the Kivuno desktop app open while connecting.'}
        </p>
        <ol>
          <li>
            {vi
              ? 'Trong Kivuno: đăng nhập → Team → thêm hoặc chọn hồ sơ Claude → Connect. Chọn Claude trong trình duyệt hoặc Claude Desktop, rồi bấm Link Kivuno to Claude hoặc Add Kivuno to Claude.'
              : 'In Kivuno: sign in → Team → add or select a Claude profile → Connect. Choose Claude in browser or Claude Desktop, then Link Kivuno to Claude or Add Kivuno to Claude.'}
          </li>
          <li>
            {vi ? 'Mở ' : 'Open '}
            <a href={claudeConnectorInstallUrl(address)}>
              {vi ? 'biểu mẫu thêm Kivuno trong Claude' : 'the Kivuno setup in Claude'}
            </a>
            {vi
              ? '. Đăng nhập Claude nếu được hỏi. Chờ biểu mẫu có tên Kivuno và địa chỉ điền sẵn, rồi bấm Tiếp tục (Continue). Nếu chỉ thấy danh sách plugin, dùng phần hướng dẫn thêm thủ công bên dưới.'
              : '. Sign in to Claude if asked. Wait for the form with Kivuno and its address filled in, then choose Continue. If you only see the plugin list, follow the manual steps below.'}
          </li>
          <li>
            {vi
              ? 'Claude kiểm tra cách đăng nhập. Giữ nguyên cấu hình đã phát hiện, bấm Thêm (Add). Chưa cần nhập mã hay tạo khóa API.'
              : 'Claude detects the sign-in settings. Keep those settings and choose Add. You do not need to enter a code or create an API key.'}
          </li>
          <li>
            {vi
              ? 'Mở mục Kivuno vừa thêm trong Claude, bấm Kết nối (Connect / Connecter). Chỉ bấm Thêm chưa hoàn tất liên kết tài khoản.'
              : 'Open the Kivuno entry you just added in Claude and choose Connect (Connecter). Adding the connector alone does not finish linking your account.'}
          </li>
          <li>
            {vi
              ? 'Trang Kivuno mở ra: nếu cần, đăng nhập cùng tài khoản Kivuno đang dùng trong ứng dụng. Chọn hồ sơ có dòng “Vừa yêu cầu kết nối từ Kivuno”, kiểm tra đúng tên rồi bấm Liên kết tài khoản trước khi đồng hồ đếm ngược kết thúc.'
              : 'On the Kivuno page, sign in with the same Kivuno account as the desktop app if asked. Select the profile marked as just requested, check its name, and choose Link account before the countdown ends.'}
          </li>
          <li>
            {vi
              ? 'Chờ trình duyệt quay lại Claude. Quay lại ứng dụng Kivuno: hồ sơ phải hiện Claude connected. Nếu chưa đổi, bấm Check connection. Tới đây tài khoản đã liên kết; chưa có dự án nào được chia sẻ.'
              : 'Wait for the browser to return to Claude. Back in Kivuno, the profile should show Claude connected. If it has not updated, choose Check connection. Your account is now linked; no project has been shared yet.'}
          </li>
        </ol>
      </section>

      <section aria-labelledby="claude-guide-existing">
        <h2 id="claude-guide-existing">
          {vi ? 'Đã có Kivuno trong Claude?' : 'Already have Kivuno in Claude?'}
        </h2>
        <p>
          <a href={claudeConnectorsUrl}>
            {vi ? 'Mở danh sách connector của bạn' : 'Open your connectors'}
          </a>
          {vi
            ? ' → Kivuno → Kết nối (Connect). Bỏ qua bước thêm; dùng cùng tài khoản Claude trong trình duyệt và Desktop.'
            : ' → Kivuno → Connect. Skip adding it again; use the same Claude account in your browser and Desktop.'}
        </p>
        <p>
          {vi
            ? 'Nếu Claude đã ghi Đã kết nối nhưng Kivuno chưa cập nhật: quay lại Kivuno và bấm Check connection. Nếu có nút Use existing Claude connection, dùng nút đó để xác nhận chuyển liên kết sang hồ sơ đang chọn. Việc chuyển sẽ ngắt hồ sơ cũ và thu hồi quyền chia sẻ dự án cũ.'
            : 'If Claude says Connected but Kivuno has not updated, choose Check connection in Kivuno. If Use existing Claude connection appears, use it to confirm moving the link to the selected profile. Moving it disconnects the old profile and revokes its project shares.'}
        </p>
        <p>
          {vi
            ? 'Nếu vẫn chưa nối được hồ sơ này: trong Claude, bấm menu ⋯ của Kivuno → Ngắt kết nối (Disconnect) → Kết nối (Connect), rồi duyệt đúng hồ sơ trên trang Kivuno. Cách này làm gián đoạn liên kết cũ; không cần xóa hoặc thêm lại plugin.'
            : 'If this profile still cannot connect: in Claude, use Kivuno’s ⋯ menu → Disconnect → Connect, then approve the correct profile on Kivuno. This interrupts the old link; you do not need to delete or add the plugin again.'}
        </p>
      </section>

      <section aria-labelledby="claude-guide-manual">
        <h2 id="claude-guide-manual">
          {vi ? 'Biểu mẫu điền sẵn không mở?' : 'The prefilled form did not open?'}
        </h2>
        <ol>
          <li>
            {vi
              ? 'Trong Claude, mở Plugin → Plugin của bạn (Your plugins) → Trình kết nối (Connectors).'
              : 'In Claude, open Plugins → Your plugins → Connectors.'}
          </li>
          <li>
            {vi
              ? 'Bấm Thêm (Add) → Tùy chỉnh (Custom) → Web. Một số giao diện ghi Thêm connector tùy chỉnh (Add custom connector).'
              : 'Choose Add → Custom → Web. Some versions show Add custom connector instead.'}
          </li>
          <li>
            {vi
              ? 'Điền tên Kivuno. Sao chép địa chỉ dưới đây và dán vào ô URL máy chủ / Remote MCP server URL.'
              : 'Enter Kivuno as the name. Copy the address below into Server URL / Remote MCP server URL.'}
          </li>
          <li>
            {vi
              ? 'Bấm Tiếp tục (Continue), giữ cấu hình được phát hiện → Thêm (Add) → Kết nối (Connect). Sau đó bấm Liên kết tài khoản trên trang Kivuno như bước 5 phía trên.'
              : 'Choose Continue, keep the detected settings → Add → Connect. Then choose Link account on Kivuno as in step 5 above.'}
          </li>
        </ol>
        <div className="claude-guide-address">
          <code>{address}</code>
          <button className="billing-secondary" onClick={() => void copyAddress()}>
            {vi ? 'Sao chép địa chỉ' : 'Copy address'}
          </button>
        </div>
        {copy && (
          <p role="status">
            {copy === 'copied'
              ? vi
                ? 'Đã sao chép địa chỉ.'
                : 'Address copied.'
              : vi
                ? 'Hãy bôi chọn và sao chép địa chỉ.'
                : 'Select and copy the address.'}
          </p>
        )}
      </section>

      <section aria-labelledby="claude-guide-share">
        <h2 id="claude-guide-share">{vi ? 'Chia sẻ một dự án' : 'Share one project'}</h2>
        <p>
          {vi
            ? 'Liên kết hồ sơ chỉ xác nhận kết nối. Để Claude đọc tin nhắn, mở dự án trong Chat → Group team, thêm hồ sơ Claude, rồi chọn Share project messages. Kiểm tra đúng dự án, chọn thời hạn và xác nhận quyền chỉ đọc.'
            : 'Linking a profile establishes the connection. To let Claude read messages, open the project in Chat → Group team, add the Claude profile, and select Share project messages. Check the project, choose a duration, and confirm read-only access.'}
        </p>
        <p>
          {vi
            ? 'Mỗi kết nối chia sẻ một dự án trong tối đa tám giờ mỗi lần. Giữ Kivuno mở và có mạng. Nếu Claude chưa hiện công cụ sau khi chia sẻ, làm mới danh sách công cụ hoặc mở cuộc trò chuyện mới.'
            : 'Each connection shares one project for up to eight hours per grant. Keep Kivuno open and online. If the tool is missing after sharing, refresh Claude’s tools or start a new conversation.'}
        </p>
        <blockquote>
          {vi
            ? 'Dùng Kivuno để tóm tắt tiến độ và liệt kê các vướng mắc trong dự án tôi vừa chia sẻ.'
            : 'Use Kivuno to summarize progress and list blockers in the project I just shared.'}
        </blockquote>
      </section>

      <section aria-labelledby="claude-guide-access">
        <h2 id="claude-guide-access">{vi ? 'Dữ liệu và quyền truy cập' : 'Data and access'}</h2>
        <p>
          {vi
            ? 'Claude chỉ có quyền đọc tên dự án và các đoạn tin nhắn từ đúng nhóm đã chia sẻ, tối đa 12 tin mỗi trang.'
            : 'Claude has read-only access to the project name and message excerpts from the shared group, up to 12 messages per page.'}
        </p>
        <p>
          {vi
            ? 'Thu hồi quyền chia sẻ trong Kivuno để dừng lượt đọc mới, hoặc chọn Disconnect Claude để ngắt liên kết và quyền chia sẻ đi kèm. Đoạn tin nhắn đã gửi có thể vẫn còn trong cuộc trò chuyện Claude.'
            : 'Revoke the project share in Kivuno to stop new reads, or choose Disconnect Claude to remove the link and its project access. Excerpts already delivered may remain in the Claude conversation.'}
        </p>
        <a href="/claude/privacy">
          {vi ? 'Thông báo quyền riêng tư của connector' : 'Connector privacy notice'}
        </a>
      </section>

      <section aria-labelledby="claude-guide-help">
        <h2 id="claude-guide-help">{vi ? 'Kiểm tra kết nối' : 'Troubleshoot the connection'}</h2>
        <p>
          {vi
            ? 'Nếu không thấy hồ sơ trên trang cấp quyền, mở đúng workspace trong Kivuno, bấm Connect trên hồ sơ cần dùng, rồi bắt đầu lại từ Claude. Nếu trạng thái chưa cập nhật, chọn Check connection trong Kivuno.'
            : 'If your profile is missing on the consent page, open the correct Kivuno workspace, choose Connect on that profile, and restart the connection from Claude. If the status is delayed, choose Check connection in Kivuno.'}
        </p>
        <p>
          {vi
            ? 'Nếu lời mời đã hết hạn: không bấm lại trang cũ. Quay về Claude → Kivuno → Kết nối để mở lời mời mới, rồi xác nhận trong 5 phút. “Liên kết có hiệu lực đến” là thời hạn của liên kết tài khoản, khác với thời gian xác nhận lời mời.'
            : 'If the request expired, do not reuse the old page. Return to Claude → Kivuno → Connect for a fresh request and confirm within five minutes. “Link valid until” is the account link’s expiry, separate from the confirmation countdown.'}
        </p>
        <p>
          {vi ? 'Hỗ trợ qua ' : 'Contact support at '}
          <a href={`mailto:${support}`}>{support}</a>
          {vi
            ? '. Gửi phiên bản Kivuno và mô tả lỗi, giữ thông tin đăng nhập và tin nhắn dự án riêng tư.'
            : '. Include your Kivuno version and describe the issue. Keep credentials and project messages private.'}
        </p>
      </section>
    </>
  );
}

function Privacy({ vi }: { vi: boolean }) {
  return (
    <>
      <p>
        {vi ? 'Có hiệu lực từ ' : 'Effective '}
        <time dateTime="2026-11-22">{vi ? '22/11/2026' : '22 November 2026'}</time>.
      </p>
      <p>
        {vi
          ? 'Đào Tiến Khoa là nhà phát triển cá nhân vận hành Kivuno. Thông báo này áp dụng cho connector từ xa của Kivuno dùng với Claude.'
          : 'Đào Tiến Khoa is the individual developer operating Kivuno. This notice covers the Kivuno remote connector for Claude.'}
      </p>
      <section aria-labelledby="claude-privacy-use">
        <h2 id="claude-privacy-use">{vi ? 'Dữ liệu và mục đích sử dụng' : 'Data and purposes'}</h2>
        <p>
          {vi
            ? 'Kivuno xử lý mã tài khoản và thiết bị, tên và mã hồ sơ Claude bạn chọn, mã liên kết, quyền truy cập, thời điểm tạo, xác minh, hết hạn và giá trị băm của token. Kivuno dùng dữ liệu này để xác thực, kiểm tra trạng thái, bảo mật và thu hồi quyền.'
            : 'Kivuno processes account and device identifiers, the selected Claude profile name and ID, connection identifiers, scopes, creation, verification and expiry times, and token hashes. Kivuno uses these records for authorization, status checks, security, and revocation.'}
        </p>
        <p>
          {vi
            ? 'Khi bạn chia sẻ một dự án, Kivuno lưu dự án đã chọn và thời hạn chia sẻ. Mỗi lượt đọc có thể kèm số thứ tự dùng để phân trang. Kivuno trả về tên dự án và các đoạn tin nhắn của nhóm đã chia sẻ, gồm số thứ tự, loại và nội dung. Hãy chia sẻ dự án mà bạn có quyền cung cấp nội dung cho Claude.'
            : 'When you share a project, Kivuno records the selected project and share expiry. Each read can include a message cursor. Kivuno returns the project name and excerpts from the shared group, including their sequence, kind and content. Share projects whose content you are authorized to disclose to Claude.'}
        </p>
      </section>
      <section aria-labelledby="claude-privacy-recipients">
        <h2 id="claude-privacy-recipients">
          {vi ? 'Bên xử lý và nhận dữ liệu' : 'Processing and recipients'}
        </h2>
        <p>
          {vi
            ? 'Yêu cầu đi qua hạ tầng web và gateway do Vercel lưu trữ, sau đó tới ứng dụng Kivuno đã kết nối. Khi Claude dùng công cụ đọc, các đoạn tin nhắn được gửi tới Anthropic để dùng trong cuộc trò chuyện. Anthropic xử lý bản sao theo chính sách và cài đặt tương ứng với tài khoản Claude.'
            : 'Requests pass through Kivuno’s Vercel-hosted website and gateway to the connected desktop. When Claude uses the read tool, message excerpts are sent to Anthropic for the conversation. Anthropic handles its copy under the policies and settings for your Claude account.'}
        </p>
        <a href="https://www.anthropic.com/legal/privacy">
          {vi ? 'Chính sách quyền riêng tư của Anthropic' : 'Anthropic Privacy Policy'}
        </a>
      </section>
      <section aria-labelledby="claude-privacy-retention">
        <h2 id="claude-privacy-retention">
          {vi ? 'Lưu trữ và thời hạn truy cập' : 'Storage and access periods'}
        </h2>
        <p>
          {vi
            ? 'Tin nhắn dự án được giữ trong workspace trên thiết bị. Hệ thống chuyển tiếp giữ yêu cầu và phản hồi tạm thời để giao hoặc thử lại. Hồ sơ liên kết và thu hồi quyền phục vụ vận hành và bảo mật. Hồ sơ hết hạn có thể còn tồn tại cho đến khi được dọn. Nhật ký hạ tầng và bản sao phục hồi có thời hạn riêng theo cấu hình vận hành.'
            : 'Project messages remain in the desktop workspace. The relay temporarily holds requests and responses for delivery or retry. Connection and revocation records support operation and security. Expired records may remain until cleanup. Hosting logs and recovery snapshots follow separate operational settings.'}
        </p>
        <p>
          {vi
            ? 'Token truy cập có hiệu lực tối đa một giờ. Liên kết và token làm mới có thể kéo dài tối đa 30 ngày, tùy thời hạn và trạng thái của thiết bị. Mỗi quyền chia sẻ dự án kéo dài tối đa tám giờ. Đây là thời hạn truy cập. Hồ sơ, nhật ký và bản sao có thể tồn tại lâu hơn.'
            : 'Access tokens expire within one hour. Links and refresh tokens last up to 30 days, subject to the device’s validity. Project sharing lasts up to eight hours per grant. These periods govern access. Records, logs and snapshots may remain longer.'}
        </p>
      </section>
      <section aria-labelledby="claude-privacy-controls">
        <h2 id="claude-privacy-controls">
          {vi ? 'Kiểm soát và yêu cầu dữ liệu' : 'Controls and data requests'}
        </h2>
        <p>
          {vi
            ? 'Kivuno dùng HTTPS, OAuth với PKCE, token lưu dưới dạng băm, và kiểm tra tài khoản, thiết bị, dự án trước khi đọc. Hệ thống che một số mẫu bí mật trong tin nhắn. Hãy kiểm tra tin nhắn trước khi xác nhận chia sẻ.'
            : 'Kivuno uses HTTPS, OAuth with PKCE, hashed tokens, and account, device and project checks before reads. It masks some secret patterns in messages. Review your project messages before sharing.'}
        </p>
        <p>
          {vi
            ? 'Thu hồi quyền chia sẻ hoặc ngắt kết nối Claude trong Kivuno để dừng lượt đọc mới. Dùng các chức năng của Claude để quản lý đoạn tin nhắn đã gửi tới cuộc trò chuyện.'
            : 'Revoke the project share or disconnect Claude in Kivuno to stop new reads. Use Claude’s controls to manage excerpts already sent to a conversation.'}
        </p>
        <p>
          {vi
            ? 'Để yêu cầu truy cập, sửa hoặc xóa dữ liệu Kivuno giữ, liên hệ '
            : 'For access, correction, or deletion requests for data held by Kivuno, contact '}
          <a href={`mailto:${support}`}>{support}</a>
          {vi
            ? '. Kivuno có thể xác minh chủ tài khoản trước khi xử lý. Chỉ gửi thông tin cần để xác định tài khoản.'
            : '. Kivuno may verify account ownership before responding. Provide only what is needed to identify your account.'}
        </p>
        <a href="/claude/guide">{vi ? 'Hướng dẫn kết nối' : 'Connector setup guide'}</a>
      </section>
    </>
  );
}

function ConnectorPage() {
  const vi = usePortalLocale().locale === 'vi';
  const privacy = location.pathname === '/claude/privacy';
  const title = privacy
    ? vi
      ? 'Quyền riêng tư của Kivuno Claude connector'
      : 'Kivuno Claude Connector Privacy Notice'
    : vi
      ? 'Kết nối Kivuno với Claude'
      : 'Connect Kivuno to Claude';
  useEffect(() => {
    document.title = title + ' · Kivuno';
  }, [title]);
  return (
    <div className="billing-page">
      <header className="billing-header">
        <a className="billing-brand" href="/">
          <img src="/kivuno.svg" width="30" height="30" alt="" />
          Kivuno
        </a>
        <div className="billing-header-actions">
          <PortalLanguage />
          <PortalThemeToggle />
        </div>
      </header>
      <main className="claude-guide">
        <h1>{title}</h1>
        {privacy ? <Privacy vi={vi} /> : <Guide vi={vi} />}
      </main>
    </div>
  );
}

export default function ClaudeConnectorGuide() {
  const lang = new URLSearchParams(location.search).get('lang');
  return (
    <PortalLocaleProvider initialLocale={lang === 'en' || lang === 'vi' ? lang : undefined}>
      <PortalThemeProvider>
        <ConnectorPage />
      </PortalThemeProvider>
    </PortalLocaleProvider>
  );
}
