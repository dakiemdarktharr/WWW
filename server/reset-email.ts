const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function verifiedLink(url: string, origin: string) {
  const target = new URL(url),
    site = new URL(origin);
  if (
    site.protocol !== 'https:' ||
    site.origin !== origin ||
    target.origin !== site.origin ||
    target.username ||
    target.password
  )
    throw new Error('Password recovery must use the verified HTTPS application origin.');
  return target.href;
}

/** Email-safe tables and inline styles, with no external images or tracking. */
function banner(title: string, body: string, action: string, link: string, note: string) {
  const href = escape(link);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#101014;color:#f9f7ff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td style="padding:0 0 24px;color:#d0ff4a;font-size:28px;font-weight:800;letter-spacing:-1.5px">kivuno.</td></tr><tr><td style="background:#a77bfa;border-radius:24px 24px 0 0;padding:32px;color:#181124"><h1 style="font-size:36px;line-height:1.15;letter-spacing:-1.5px;margin:0">${escape(title)}</h1></td></tr><tr><td style="background:#1d1826;border:1px solid #514163;border-top:0;border-radius:0 0 24px 24px;padding:32px"><p style="margin:0;color:#f5efff;font-size:16px;line-height:1.7">${escape(body)}</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#d0ff4a" style="border-radius:12px"><a href="${href}" style="display:inline-block;padding:17px 26px;color:#171c08;font-weight:700;text-decoration:none">${escape(action)} ↗</a></td></tr></table><p style="font-size:14px;line-height:1.7;color:#cfc2e0">${escape(note)}</p><hr style="border:0;border-top:1px solid #514163;margin:24px 0"><p style="font-size:12px;line-height:1.8;color:#cfc2e0">Kivuno không yêu cầu bạn gửi mật khẩu qua email.</p><a href="${href}" style="font-size:12px;line-height:1.8;color:#d0ff4a;word-break:break-all">${href}</a></td></tr><tr><td style="padding:24px 0;font-size:12px;color:#cfc2e0;line-height:1.8">© ${new Date().getUTCFullYear()} Kivuno</td></tr></table></td></tr></table></body></html>`;
}

export function resetEmail(url: string, origin: string) {
  const link = verifiedLink(url, origin),
    title = 'Tạo mật khẩu mới.';
  const body = 'Liên kết này có hiệu lực trong 15 phút và chỉ dùng một lần.';
  const note =
    'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Không chia sẻ liên kết với bất kỳ ai. Hỗ trợ: daethphate@gmail.com';
  return {
    subject: 'Đặt lại mật khẩu Kivuno',
    text: `${title}\n${body}\n${link}\n${note}\nKivuno không yêu cầu bạn gửi mật khẩu qua email.`,
    html: banner(title, body, 'Đặt lại mật khẩu', link, note),
  };
}

export function passwordChangedEmail(origin: string) {
  const link = verifiedLink(`${origin}/?login`, origin),
    title = 'Mật khẩu đã đổi.';
  const body =
    'Các phiên đăng nhập và kết nối desktop trước đó đã được thu hồi. Đăng nhập lại bằng mật khẩu mới của bạn.';
  const note =
    'Nếu bạn không thực hiện thay đổi này, hãy vào Kivuno và dùng Quên mật khẩu để bảo vệ tài khoản. Hỗ trợ: daethphate@gmail.com';
  return {
    subject: 'Mật khẩu Kivuno đã được cập nhật',
    text: `${title}\n${body}\n${link}\n${note}`,
    html: banner(title, body, 'Đăng nhập Kivuno', link, note),
  };
}
