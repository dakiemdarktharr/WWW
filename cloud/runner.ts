import { Sandbox } from '@vercel/sandbox';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const name = 'relay-cloud-workspace';
const cwd = '/vercel/sandbox/relay';
let boot: Promise<{ origin: string; secret: string }> | null = null;
let cached: { origin: string; secret: string; checked: number } | null = null;

function configuration() {
  const gatewaySecret = process.env.RELAY_GATEWAY_SECRET || '';
  const authSecret = process.env.RELAY_AUTH_SECRET || '';
  const password = process.env.RELAY_OWNER_PASSWORD || '';
  const publicOrigin = process.env.RELAY_PUBLIC_ORIGIN || '';
  if (
    gatewaySecret.length < 32 ||
    authSecret.length < 32 ||
    password.length < 20 ||
    !publicOrigin.startsWith('https://')
  )
    throw new Error('Cloud workspace has not been configured.');
  return { gatewaySecret, authSecret, password, publicOrigin };
}

async function healthy(origin: string, secret: string) {
  try {
    return (
      await fetch(`${origin}/api/cloud/health`, {
        headers: { 'X-Relay-Gateway': secret },
        signal: AbortSignal.timeout(4000),
      })
    ).ok;
  } catch {
    return false;
  }
}

export async function cloudRunner(wake = true) {
  if (cached && Date.now() - cached.checked < 5000) return cached;
  if (!wake) {
    const config = configuration();
    const sandbox = await Sandbox.get({ name, resume: false });
    if (sandbox.status !== 'running') return null;
    const origin = sandbox.domain(4317);
    if (!(await healthy(origin, config.gatewaySecret))) return null;
    cached = { origin, secret: config.gatewaySecret, checked: Date.now() };
    return cached;
  }
  if (!boot)
    boot = start().finally(() => {
      boot = null;
    });
  return boot;
}

async function start() {
  const config = configuration();
  // Never auto-create a replacement when the persistent workspace/snapshot is
  // missing: that could silently replace the user's history and account homes.
  const sandbox = await Sandbox.get({ name, resume: true });
  const origin = sandbox.domain(4317);
  if (await healthy(origin, config.gatewaySecret)) {
    cached = { origin, secret: config.gatewaySecret, checked: Date.now() };
    return cached;
  }
  const payload = await readFile(path.join(process.cwd(), '.cloud', 'runner.tar.gz'));
  const revision = createHash('sha256').update(payload).digest('hex');
  const archive = `/vercel/sandbox/relay-${revision}.tar.gz`;
  await sandbox.writeFiles([{ path: archive, content: payload }]);
  const script = `set -e
exec 9>/vercel/sandbox/relay-bootstrap.lock
flock -n 9 || exit 75
mkdir -p /vercel/sandbox/relay /vercel/sandbox/state /vercel/sandbox/projects
chmod 700 /vercel/sandbox/state
tar -xzf "$RELAY_ARCHIVE" -C /vercel/sandbox/relay
cd /vercel/sandbox/relay
LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f .installed-lock ] || [ "$(cat .installed-lock)" != "$LOCK_HASH" ]; then
  npm ci --omit=dev --no-audit --no-fund
  printf '%s' "$LOCK_HASH" > .installed-lock
fi
exec node --import tsx server/index.ts
`;
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', script],
    cwd,
    detached: true,
    env: {
      NODE_ENV: 'production',
      RELAY_DEPLOYMENT: 'cloud',
      RELAY_PUBLIC_ORIGIN: config.publicOrigin,
      RELAY_GATEWAY_SECRET: config.gatewaySecret,
      RELAY_AUTH_SECRET: config.authSecret,
      RELAY_OWNER_PASSWORD: config.password,
      RELAY_DATA_DIR: '/vercel/sandbox/state',
      RELAY_PROJECTS_DIR: '/vercel/sandbox/projects',
      RELAY_CODEX_COMMAND: `${cwd}/node_modules/@openai/codex/bin/codex.js`,
      RELAY_CLOUD_EXPIRES_AT: (
        sandbox.expiresAt ?? new Date(Date.now() + 40 * 60 * 1000)
      ).toISOString(),
      RELAY_ARCHIVE: archive,
    },
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await healthy(origin, config.gatewaySecret)) {
      cached = { origin, secret: config.gatewaySecret, checked: Date.now() };
      return cached;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Cloud runner could not start within its startup budget.');
}

export function forgetCloudRunner() {
  cached = null;
}
