let sessionToken = '';
let sessionPromise: Promise<void> | null = null;
let generation = 0;
export function resetApiSession() {
  generation++;
  sessionToken = '';
  sessionPromise = null;
}
function expired(data: { code?: string }) {
  if (data.code === 'CLOUD_SIGN_IN_REQUIRED') window.dispatchEvent(new Event('relay-auth-expired'));
}

async function session() {
  if (sessionToken) return;
  if (!sessionPromise) {
    const started = generation;
    sessionPromise = fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          expired(data);
          throw new Error(data.error || 'Workspace unavailable. Try again.');
        }
        if (started !== generation)
          throw new Error('Account changed. Open your current workspace.');
        sessionToken = data.token;
      })
      .finally(() => {
        if (started === generation) sessionPromise = null;
      });
  }
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
  if (response.status === 401) expired(data);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
