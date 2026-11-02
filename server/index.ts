import '../scripts/check-runtime.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { privateDirectory } from './security.ts';
import { Store } from './store.ts';
import { Workspace } from './service.ts';
import { buildApp } from './app.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.RELAY_DATA_DIR || path.join(projectRoot, '.relay'));
await privateDirectory(dataDir);
// One coordinator per state directory prevents a second instance from orphaning active leases.
const lock = path.join(dataDir, 'coordinator.lock');
try {
  const handle = openSync(lock, 'wx', 0o600);
  writeFileSync(handle, String(process.pid));
  closeSync(handle);
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
}
const store = new Store(path.join(dataDir, 'workspace.db'));
const workspace = new Workspace(store, dataDir, projectRoot);
await workspace.initialize();
const port = Number(process.env.RELAY_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('RELAY_PORT must be between 1024 and 65535.');
const app = await buildApp(workspace, {
  port,
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
try {
  await app.listen({ host: '127.0.0.1', port });
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
