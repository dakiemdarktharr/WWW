import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type PortalLocale = 'vi' | 'en';
const english: Record<string, string> = {
  Bạn: 'You',
  '@Bạn': '@You',
  '/goal Xây một trợ lý nghiên cứu cho UniHack.': '/goal Build a research assistant for UniHack.',
  'Mục tiêu': 'Goal',
  '@Nova mình nhận backend. Bạn làm giao diện nhé?':
    '@Nova I’ll take the backend. Can you build the interface?',
  'Đã nhận UI. @Sol chia sẻ giúp mình tiêu chí chấm điểm.':
    'I’ve got the UI. @Sol please share the judging criteria.',
  'Đã đọc đề và gửi nguồn vào knowledge của nhóm.':
    'I’ve read the brief and shared the sources with the team.',
  'Bạn dẫn đội. Chúng mình biến ý tưởng thành sản phẩm.':
    'You lead. We’ll help turn the idea into a product.',
  'Usage còn 49%. Mình đã dừng nhận việc mới.': '49% usage left. I’ve paused new work.',
  'Checkpoint đã push. Bàn giao schema, tests và bước tiếp theo.':
    'Checkpoint pushed. Handing over the schema, tests, and next steps.',
  '@Ari đã đọc checkpoint. Mình tiếp quản phần API.':
    '@Ari I’ve read the checkpoint. I’ll take over the API.',
  'Mình giữ phần research, không nhận trùng scope của Nova.':
    'I’ll stay on research, keeping clear of Nova’s scope.',
  'Phát hiện trong bản demo: route admin thiếu kiểm tra quyền.':
    'Demo finding: the admin route is missing an authorization check.',
  '@BOT mình phụ trách route này. Đã nhận sửa và bổ sung test.':
    '@BOT that route is mine. I’ll fix it and add a test.',
  '@Ari UI đã sẵn sàng. Mình chờ API để kiểm tra tích hợp.':
    '@Ari the UI is ready. I’m waiting for the API to test the integration.',
  'Kiểm tra lại trước khi đề nghị chủ dự án duyệt merge.':
    'Run the checks again before asking the owner to approve the merge.',
  'Đã hiểu': 'Understood',
  'Đồng ý': 'Agree',
  'Không đồng ý': 'Disagree',
  'Phản hồi demo cho': 'Demo feedback for',
  của: 'by',
  'Bốn session nối với cùng dự án; Ari có hai session':
    'Four sessions in one project; Ari has two sessions',
  'Đang làm': 'Working',
  'Đang kiểm tra': 'Testing',
  'Chờ API': 'Waiting for API',
  'Hoàn tất': 'Complete',
  'Graph session minh họa': 'Illustrative session graph',
  'Chia việc': 'Divide the work',
  'Một ý tưởng. Cả đội vào việc.': 'One idea. Everyone has a part.',
  'Bàn giao': 'Hand off',
  'Đổi người. Không mất mạch.': 'A new teammate. The same momentum.',
  'Cùng sửa. Bạn duyệt.': 'Refine together. You approve.',
  'Tin nhắn minh họa, không phải hoạt động thật': 'Illustrative messages, not real activity',
  'Chat · Chat dự án': 'Chat · Project chat',
  'Thêm Codex': 'Add Codex',
  'Cả đội ở đây.': 'Your team, together.',
  'Tạo dự án': 'Create a project',
  'Một mục tiêu chung.': 'One shared goal.',
  'Dẫn đội': 'Lead the team',
  'Bạn quyết định.': 'You make the call.',
  'Từ ý tưởng đến cùng làm.': 'From an idea to working together.',
  'Cách dùng Kivuno': 'How to use Kivuno',
  'Checkpoint sẵn sàng': 'Checkpoint ready',
  '+ Kiểm tra quyền trước khi thực thi': '+ Check authorization before execution',
  '+ Thêm test cho trường hợp bị từ chối': '+ Add a test for denied requests',
  'Chờ bạn duyệt': 'Waiting for your approval',
  'Giao diện': 'Interface',
  'Nghiên cứu': 'Research',
  'Minh họa workspace': 'Workspace illustration',
  'Chưa tải được thông tin bản cài.': 'Could not load the release information.',
  'Bản cài chưa sẵn sàng.': 'The installer is not available yet.',
  'Đường tải bản cài không hợp lệ.': 'The installer download URL is invalid.',
  'Bản cài chưa sẵn sàng': 'Installer not available yet',
  'Kivuno — về màn hình đầu': 'Kivuno — back to the start',
  'Tải app': 'Download app',
  'Đăng nhập': 'Log in',
  'Đăng ký': 'Sign up',
  'Khám phá Chat': 'Explore Chat',
  'Một đội.': 'One team.',
  'Nhiều máy.': 'Many machines.',
  'Máy của bạn': 'Your computer',
  'Máy SSH': 'SSH machine',
  'Máy đồng đội': 'Teammate’s computer',
  'Minh họa kết nối máy': 'Connected machines illustration',
  'Giữ sức cho cả đội.': 'Keep the whole team going.',
  'Công việc tiếp tục.': 'Work moves on.',
  'Context ở lại.': 'Context stays.',
  'Quyền do bạn giữ.': 'You stay in control.',
  'AEGIS · Avalanche Fuji testnet tùy chọn': 'AEGIS · Optional Avalanche Fuji testnet',
  'Cấp quyền': 'Grant access',
  'Duyệt diff': 'Approve the diff',
  'Xác minh': 'Verify',
  'Tính năng Kivuno': 'Kivuno features',
  'Tranh biểu hiện trừu tượng: những nét mint và trắng ngà vừa kết nối vừa tách rời quanh một khoảng trống, gợi nhiều cá thể cùng suy nghĩ.':
    'Abstract mint and ivory strokes connect and separate around an open space, suggesting many individuals thinking together.',
  'Đến lượt bạn': 'Your turn',
  'dẫn đội.': 'to lead.',
  'Bắt đầu': 'Get started',
  'Bản cài & checksum': 'Installers & checksums',
  'Về đầu trang': 'Back to top',
  'Tải Kivuno': 'Download Kivuno',
  'Đóng tải app': 'Close downloads',
  'Thông tin bản cài': 'Installer details',
  'Windows x64 · Chưa ký chứng chỉ': 'Windows x64 · Unsigned installer',
  'Linux x64 · Cần Git, keyring và desktop Linux hỗ trợ sandbox.':
    'Linux x64 · Requires Git, a keyring, and a Linux desktop with sandbox support.',
  'macOS Apple Silicon · Chưa ký, chưa notarize':
    'macOS Apple Silicon · Unsigned and not notarized',
  'macOS Apple Silicon · Chưa có bản tải': 'macOS Apple Silicon · Download not available yet',
  'Dịch vụ đăng nhập chưa sẵn sàng. Hãy thử lại.': 'Sign-in is unavailable. Please try again.',
  'Bạn đã thử nhiều lần. Vui lòng đợi một phút.': 'Too many attempts. Please wait a minute.',
  'Email hoặc mật khẩu không đúng.': 'The email or password is incorrect.',
  'Email này đã có tài khoản. Chọn Đăng nhập để tiếp tục.':
    'This email already has an account. Log in to continue.',
  'Chưa đăng nhập được. Hãy thử lại.': 'Could not sign in. Please try again.',
  'Chưa tạo được tài khoản. Kiểm tra thông tin và thử lại.':
    'Could not create the account. Check your details and try again.',
  'Chưa xác nhận được phiên đăng nhập. Hãy đăng nhập lại.':
    'Could not verify your session. Please sign in again.',
  'Chưa xác nhận được thiết bị. Hãy thử lại.': 'Could not approve the device. Please try again.',
  'Chưa đăng xuất được. Hãy thử lại.': 'Could not sign out. Please try again.',
  'Tạo tài khoản': 'Create account',
  'Chủ workspace cũ': 'Existing workspace owner',
  'Kết nối desktop': 'Connect desktop',
  'Đã kết nối': 'Connected',
  'Đóng đăng nhập': 'Close sign-in',
  'Tên của bạn': 'Your name',
  'Tài khoản workspace hiện tại': 'Existing workspace account',
  'Mật khẩu': 'Password',
  'Mật khẩu chủ workspace': 'Workspace owner password',
  'Tối thiểu 12 ký tự.': 'At least 12 characters.',
  'Tiếp tục': 'Continue',
  'Đổi email': 'Change email',
  'Mã từ app desktop': 'Code from the desktop app',
  'Đang tìm thiết bị': 'Finding your device',
  'Chỉ xác nhận khi mã khớp với app trên máy của bạn.':
    'Approve only when the code matches the app on your computer.',
  'Mã đã hết hạn. Tạo mã mới trong app.': 'This code has expired. Create a new code in the app.',
  'Xác nhận kết nối': 'Approve connection',
  Xong: 'Done',
  'Đang kết nối': 'Connecting',
  'Đã có tài khoản? Đăng nhập': 'Already have an account? Log in',
  'Đăng xuất': 'Sign out',
  'Tải Kivuno cho': 'Download Kivuno for',
  'chưa có bản tải': 'download not available',
};
const vietnamese = Object.fromEntries(Object.entries(english).map(([vi, en]) => [en, vi]));
interface LocaleContext {
  locale: PortalLocale;
  setLocale: (locale: PortalLocale) => void;
  t: (text: string) => string;
}
const Context = createContext<LocaleContext>({
  locale: 'vi',
  setLocale: () => {},
  t: (text) => text,
});
export function PortalLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<PortalLocale>(() => {
    try {
      return localStorage.getItem('kivuno-portal-locale') === 'en' ? 'en' : 'vi';
    } catch {
      return 'vi';
    }
  });
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    try {
      localStorage.setItem('kivuno-portal-locale', locale);
    } catch {
      /* Locale still works for this visit. */
    }
    return () => {
      document.documentElement.lang = previous;
    };
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (text: string) => {
        const key = text.replace(/\s+/g, ' ').trim();
        const original = vietnamese[key] || key;
        return locale === 'en' ? english[original] || text : vietnamese[key] || text;
      },
    }),
    [locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePortalLocale() {
  return useContext(Context);
}
export function PortalLanguage() {
  const { locale, setLocale } = usePortalLocale();
  return (
    <button
      className="kp-language"
      type="button"
      aria-label={locale === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
      title={locale === 'vi' ? 'English' : 'Tiếng Việt'}
      onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
    >
      <span aria-hidden="true">{locale === 'vi' ? 'EN' : 'VI'}</span>
    </button>
  );
}
