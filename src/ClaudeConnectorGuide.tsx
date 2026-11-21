import { useEffect, useState } from 'react';
import { claudeMcpPath } from '../shared/claude-web';
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
        <h2 id="claude-guide-connect">{vi ? 'Liên kết hồ sơ' : 'Connect your profile'}</h2>
        <ol>
          <li>
            {vi
              ? 'Mở ứng dụng Kivuno, đăng nhập rồi vào Team. Thêm hoặc chọn hồ sơ Claude và bấm Connect.'
              : 'Open the Kivuno desktop app and sign in. In Team, add or select a Claude profile and choose Connect.'}
          </li>
          <li>
            {vi ? 'Mở ' : 'Open '}
            <a href={claudeConnectorsUrl}>
              {vi ? 'trang Connectors của Claude' : 'Claude’s Connectors settings'}
            </a>
            {vi
              ? '. Nếu đã có Kivuno, bấm Connect trên connector đó. Lần đầu kết nối, chọn Add custom connector, đặt tên Kivuno và dán địa chỉ bên dưới.'
              : '. If Kivuno is already listed there, choose Connect. To set it up for the first time, choose Add custom connector, name it Kivuno, and paste the address below.'}
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
          </li>
          <li>
            {vi
              ? 'Dùng luồng OAuth được Claude phát hiện. Khi Kivuno hỏi, đăng nhập bằng tài khoản đang dùng trên máy và duyệt hồ sơ được đánh dấu vừa yêu cầu. Quay lại Kivuno và đợi trạng thái Claude connected.'
              : 'Use the OAuth sign-in Claude detects. When Kivuno asks, sign in with the account you use in the desktop app and approve the profile marked as just requested. Return to Kivuno and wait for Claude connected.'}
          </li>
        </ol>
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
