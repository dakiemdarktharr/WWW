let sessionToken = '';
let sessionPromise: Promise<void> | null = null;

async function session() {
  if (sessionToken) return;
  if (!sessionPromise)
    sessionPromise = fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('The local service is unavailable. Start RELAY and try again.');
        const data = await response.json();
        sessionToken = data.token;
      })
      .finally(() => {
        sessionPromise = null;
      });
  await sessionPromise;
}

export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  await session();
  const tokenUsed = sessionToken;
  const send = () =>
    fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': sessionToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let response = await send();
  // A coordinator restart expires browser cookies and in-memory CSRF tokens.
  // The rejected request has not executed; renew once instead of leaving every
  // session window stuck until the operator reloads it manually.
  if (response.status === 401) {
    if (sessionToken === tokenUsed) sessionToken = '';
    await session();
    response = await send();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
