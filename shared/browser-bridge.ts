import { z } from 'zod';

export const hostedOrigin = 'https://nosleepclub-relay.vercel.app';
export const localHostname = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

export function runnerOrigin(port: string) {
  const number = Number(port);
  if (!/^\d{4,5}$/.test(port) || number < 1024 || number > 65535)
    throw new Error('Cổng phải nằm trong khoảng 1024–65535.');
  return `http://127.0.0.1:${number}`;
}

// A bridge can call workspace routes only. It never accepts URLs, headers,
// bootstrap tokens, event streams or credentials from its peer.
export const bridgeRequest = z
  .object({
    type: z.literal('request'),
    id: z.string().uuid(),
    path: z
      .string()
      .max(500)
      .regex(/^\/[a-zA-Z0-9/-]+$/)
      .refine((value) => !value.includes('//') && !['/session', '/events'].includes(value)),
    method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']),
    body: z.unknown().optional(),
  })
  .strict();
export type BridgeRequest = z.infer<typeof bridgeRequest>;
