/** Transactional email design. Delivery is configured separately after sender verification. */
export function resetEmail(url: string, origin: string) {
  const target = new URL(url);
  const site = new URL(origin);
  if (
    site.protocol !== 'https:' ||
    target.origin !== site.origin ||
    target.username ||
    target.password
  )
    throw new Error('Password recovery must use the verified HTTPS application origin.');
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const link = escape(target.href);
  return {
    subject: 'Đặt lại mật khẩu Kivuno',
    text: `Bạn đã yêu cầu đặt lại mật khẩu Kivuno. Mở liên kết này trong 15 phút: ${target.href}\nLiên kết chỉ dùng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này. Không chia sẻ liên kết hoặc mật khẩu. Hỗ trợ: daethphate@gmail.com`,
    html: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đặt lại mật khẩu Kivuno</title></head><body style="margin:0;background:#f2f4f1;color:#18342c;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Liên kết bảo mật để tạo mật khẩu mới, có hiệu lực trong 15 phút.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:48px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td style="padding:0 0 28px;font-size:26px;font-weight:700;letter-spacing:-1px">kivuno<span style="color:#63806b">.</span></td></tr><tr><td style="background:#ffffff;border:1px solid #dce3db;border-radius:20px;padding:40px 32px"><p style="margin:0 0 22px;font-size:12px;letter-spacing:2px;color:#61776c">BẢO MẬT TÀI KHOẢN</p><h1 style="font-size:30px;line-height:1.25;letter-spacing:-1px;margin:0 0 20px">Tạo mật khẩu mới.</h1><p style="color:#53635b;font-size:16px;line-height:1.7">Chúng tôi nhận được yêu cầu đặt lại mật khẩu tài khoản Kivuno của bạn. Nhấn nút bên dưới để tiếp tục.</p><table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#183e31" style="border-radius:9px"><a href="${link}" style="display:inline-block;padding:16px 26px;color:#ffffff;font-weight:600;text-decoration:none">Đặt lại mật khẩu →</a></td></tr></table><p style="font-size:14px;line-height:1.7;color:#53635b">Liên kết có hiệu lực trong <strong>15 phút</strong> và chỉ dùng một lần.</p><hr style="border:0;border-top:1px solid #e8ece7;margin:28px 0"><p style="font-size:13px;line-height:1.7;color:#67756c">Nếu bạn không yêu cầu thay đổi mật khẩu, hãy bỏ qua email này. Không chia sẻ liên kết này với bất kỳ ai. Kivuno không yêu cầu bạn gửi mật khẩu qua email.</p><p style="font-size:12px;color:#67756c;line-height:1.7">Nút không hoạt động? Sao chép liên kết này vào trình duyệt.</p><p style="font-size:12px;line-height:1.7;word-break:break-all"><a href="${link}" style="color:#345e47">${link}</a></p></td></tr><tr><td style="padding:24px 0;font-size:12px;color:#708074;line-height:1.8">Kivuno · Không gian làm việc cùng AI<br>Hỗ trợ <a href="mailto:daethphate@gmail.com" style="color:#45664e">daethphate@gmail.com</a></td></tr></table></td></tr></table></body></html>`,
  };
}
