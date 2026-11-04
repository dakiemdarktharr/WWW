/** Human-mediated exchange: only reviewed page text; no cookies or input-value collection. */
export interface BrowserRequest {
  projectId: string;
  sessionId: string;
  url: string;
  purpose: string;
  requestedAt: string;
}
export interface BrowserSnapshot {
  projectId: string;
  sessionId: string;
  url: string;
  title: string;
  text: string;
  sharedAt: string;
}
export interface BrowserExchange {
  request: BrowserRequest | null;
  snapshot: BrowserSnapshot | null;
}

function publicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048)
    throw new Error('Use a public HTTPS address without credentials.');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.includes(':') ||
    !host.includes('.') ||
    /^\d+(?:\.\d+){3}$/.test(host)
  )
    throw new Error('Use a public website hostname.');
  return url;
}

export function safeBrowserText(value: string): string {
  return value
    .slice(0, 20000)
    .replace(/\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]');
}

export class BrowserBridge {
  private exchanges = new Map<string, BrowserExchange>();
  constructor(private readonly now = () => Date.now()) {}
  private key(projectId: string, sessionId: string) {
    if (!projectId || !sessionId || projectId.length > 128 || sessionId.length > 128)
      throw new Error('Choose a project session.');
    return JSON.stringify([projectId, sessionId]);
  }
  private prune() {
    const cutoff = this.now() - 30 * 60_000;
    for (const [key, value] of this.exchanges) {
      const at = value.snapshot?.sharedAt ?? value.request?.requestedAt;
      if (!at || Date.parse(at) < cutoff) this.exchanges.delete(key);
    }
    while (this.exchanges.size > 64) this.exchanges.delete(this.exchanges.keys().next().value!);
  }
  request(projectId: string, sessionId: string, url: string, purpose: string): BrowserRequest {
    const validated = publicUrl(url);
    this.prune();
    const request = {
      projectId,
      sessionId,
      url: validated.href,
      purpose: purpose.slice(0, 500),
      requestedAt: new Date(this.now()).toISOString(),
    };
    // A new request invalidates older snapshots, so agents cannot mistake them for this page.
    this.exchanges.set(this.key(projectId, sessionId), { request, snapshot: null });
    this.prune();
    return request;
  }
  read(projectId: string, sessionId: string): BrowserExchange {
    this.prune();
    return structuredClone(
      this.exchanges.get(this.key(projectId, sessionId)) ?? { request: null, snapshot: null },
    );
  }
  share(
    projectId: string,
    sessionId: string,
    input: { url: string; title: string; text: string },
  ): BrowserSnapshot {
    const url = publicUrl(input.url);
    url.search = '';
    url.hash = '';
    this.prune();
    const snapshot = {
      projectId,
      sessionId,
      url: url.href,
      title: safeBrowserText(input.title).slice(0, 200),
      text: safeBrowserText(input.text),
      sharedAt: new Date(this.now()).toISOString(),
    };
    this.exchanges.set(this.key(projectId, sessionId), { request: null, snapshot });
    this.prune();
    return snapshot;
  }
}
