import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type AccountMail = { to: string; subject: string; text: string; html: string };
export type AccountMailSender = (mail: AccountMail) => Promise<void>;

export function accountMailSender(
  env: NodeJS.ProcessEnv = process.env,
): AccountMailSender | undefined {
  const key = env.RELAY_RESEND_API_KEY,
    from = env.RELAY_MAIL_FROM;
  if (!key && !from) return undefined;
  if (!key || !from || !z.email().safeParse(from).success || /[\r\n]/.test(key))
    throw new Error('Configure a verified account mail sender and API key together.');
  const replyTo = env.RELAY_MAIL_REPLY_TO;
  if (replyTo && !z.email().safeParse(replyTo).success)
    throw new Error('Account mail Reply-To must be a valid email address.');
  return async (mail) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        from: `Kivuno <${from}>`,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Account email was not accepted by the delivery provider.');
    const result = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof result?.id !== 'string')
      throw new Error('Account email delivery could not be confirmed.');
  };
}
