import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { DomainError } from './store.ts';

export function publicResearchUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
  )
    throw new DomainError(
      'Research requires a public HTTPS website without credentials or custom ports.',
      400,
    );
  url.hash = '';
  return url.href;
}
export function publicV4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

/** Anonymous, bounded, DNS-pinned GET. Redirects are checked as new destinations. */
export async function readPublicPage(
  value: string,
  redirects = 0,
): Promise<{ url: string; html: string; type: string }> {
  const url = new URL(publicResearchUrl(value));
  const resolver = new Resolver();
  const dnsTimeout = setTimeout(() => resolver.cancel(), 5000);
  let addresses: string[];
  try {
    addresses = await resolver.resolve4(url.hostname);
  } finally {
    clearTimeout(dnsTimeout);
  }
  if (!addresses.length || addresses.some((address) => !publicV4(address)))
    throw new DomainError('This site resolves to a private or reserved network.');
  const address = addresses[0];
  const response = await new Promise<{
    status: number;
    location?: string;
    type: string;
    html: string;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          'User-Agent': 'Kivuno/0.8 public competition research',
          Accept: 'text/html,text/plain',
          'Accept-Encoding': 'identity',
        },
        maxHeaderSize: 16384,
        lookup: ((_host: string, options: any, callback: any) =>
          options?.all
            ? callback(null, [{ address, family: 4 }])
            : callback(null, address, 4)) as any,
      },
      (res) => {
        const status = res.statusCode || 0,
          type = String(res.headers['content-type'] || '');
        if (status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, location: res.headers.location, type, html: '' });
          return;
        }
        if (status !== 200 || !/text\/(?:html|plain)/i.test(type)) {
          res.destroy();
          reject(
            new DomainError(
              `Page unavailable (${status}, ${type.slice(0, 80)}). Login, PDFs or interactive pages may need the shared browser.`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            res.destroy(new Error('Research page exceeds 1 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, type, html: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    const timeout = setTimeout(() => req.destroy(new Error('Research page timed out.')), 12000);
    req.on('close', () => clearTimeout(timeout));
    req.on('error', reject);
    req.end();
  });
  if (response.status >= 300 && response.status < 400) {
    if (!response.location || redirects >= 4)
      throw new DomainError('Research redirect limit reached.');
    return readPublicPage(new URL(response.location, url).href, redirects + 1);
  }
  return { url: url.href, html: response.html, type: response.type };
}
