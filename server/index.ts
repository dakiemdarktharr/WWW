import '../scripts/check-runtime.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { privateDirectory } from './security.ts';
import { Store } from './store.ts';
import { Workspace } from './service.ts';
import { buildApp } from './app.ts';
import { createCloudIdentity, type CloudAccess } from './cloud-auth.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.RELAY_DATA_DIR || path.join(projectRoot, '.relay'));
await privateDirectory(dataDir);
// One coordinator per state directory prevents a second instance from orphaning active leases.
const lock = path.join(dataDir, 'coordinator.lock');
const bootFile = path.join(dataDir, 'coordinator.boot');
const bootId =
  process.env.RELAY_DEPLOYMENT === 'cloud'
    ? readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
    : '';
if (bootId && existsSync(lock) && existsSync(bootFile) && readFileSync(bootFile, 'utf8') !== bootId)
  unlinkSync(lock); // A different microVM boot cannot still own this process lease.
try {
  const handle = openSync(lock, 'wx', 0o600);
  writeFileSync(handle, String(process.pid));
  closeSync(handle);
  if (bootId) writeFileSync(bootFile, bootId, { mode: 0o600 });
} catch {
  const pid = Number(readFileSync(lock, 'utf8'));
  let alive = false;
  if (Number.isInteger(pid) && pid > 0)
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (e) {
      alive = (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  if (alive)
    throw new Error(
      `RELAY is already running (process ${pid}). Open http://127.0.0.1:${process.env.RELAY_PORT || 4317}.`,
    );
  unlinkSync(lock);
  const handle = openSync(lock, 'wx', 0o600);
  writeFileSync(handle, String(process.pid));
  closeSync(handle);
  if (bootId) writeFileSync(bootFile, bootId, { mode: 0o600 });
}
const store = new Store(path.join(dataDir, 'workspace.db'));
const workspace = new Workspace(store, dataDir, projectRoot);
await workspace.initialize();
let cloud: CloudAccess | undefined;
if (process.env.RELAY_DEPLOYMENT === 'cloud') {
  const origin = process.env.RELAY_PUBLIC_ORIGIN || '';
  const gatewaySecret = process.env.RELAY_GATEWAY_SECRET || '';
  if (
    !origin.startsWith('https://') ||
    new URL(origin).origin !== origin ||
    gatewaySecret.length < 32
  )
    throw new Error('Cloud startup requires an exact HTTPS origin and gateway secret.');
  cloud = {
    origin,
    gatewaySecret,
    expiresAt: process.env.RELAY_CLOUD_EXPIRES_AT,
    auth: await createCloudIdentity({
      directory: dataDir,
      origin,
      secret: process.env.RELAY_AUTH_SECRET || '',
      bootstrapPassword: process.env.RELAY_OWNER_PASSWORD || '',
    }),
  };
  workspace.runtime.deployment = 'cloud';
  workspace.runtime.expiresAt = cloud.expiresAt || null;
}
const port = Number(process.env.RELAY_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('RELAY_PORT must be between 1024 and 65535.');
const app = await buildApp(workspace, {
  port,
  cloud,
  desktopSecret: process.env.RELAY_DESKTOP_SECRET || undefined,
  development: process.env.NODE_ENV !== 'production',
  distDir: existsSync(path.join(projectRoot, 'dist', 'index.html'))
    ? path.join(projectRoot, 'dist')
    : undefined,
});
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  store.close();
  try {
    unlinkSync(lock);
  } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.send)
  process.on('message', (message) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'relay:shutdown'
    )
      void shutdown();
  });
try {
  await app.listen({ host: cloud ? '0.0.0.0' : '127.0.0.1', port });
  console.log(
    `RELAY is ready at http://127.0.0.1:${port}\nCodex: ${workspace.runtime.codexVersion}\nLocal state: ${dataDir}`,
  );
} catch (error) {
  await workspace.close();
  store.close();
  try {
    unlinkSync(lock);
  } catch {}
  throw error;
}
