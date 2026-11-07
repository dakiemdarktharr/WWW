import { Sandbox } from '@vercel/sandbox';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const name = 'relay-cloud-workspace';
const cwd = '/vercel/sandbox/relay';
let boot: Promise<{ origin: string; secret: string }> | null = null;
let cached: { origin: string; secret: string; checked: number } | null = null;
let expectedRevision: Promise<string> | null = null;
const revisionForBuild = () =>
  (expectedRevision ||= readFile(path.join(process.cwd(), '.cloud', 'revision'), 'utf8').then(
    (value) => value.trim(),
  ));

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
    const response = await fetch(`${origin}/api/cloud/health`, {
      headers: { 'X-Relay-Gateway': secret },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return false;
    const state = await response.json();
    return state.revision === (await revisionForBuild());
  } catch {
    return false;
  }
}

type UpgradeHealth = { revision?: string | null; version?: string } | null;
type UpgradeHooks = {
  health(): Promise<UpgradeHealth>;
  coordinator(): number | null;
  drain(): Promise<boolean>;
  legacyBusy(): boolean;
  stop(pid: number): Promise<void>;
};

// Standalone so the identical decision runs inside the sandbox upgrade lock and
// can be tested without a cloud account. false means another caller already won.
export async function prepareCloudUpgrade(revision: string, hooks: UpgradeHooks) {
  const health = await hooks.health();
  if (health?.revision === revision) return false;
  const pid = hooks.coordinator();
  if (!pid) {
    if (health) throw new Error('Coordinator identity is unknown; manual recovery required.');
    return true;
  }
  if (!health) throw new Error('Coordinator is unresponsive; manual recovery required.');
  if (/^0\.2\./.test(health.version || '')) {
    if (hooks.legacyBusy())
      throw new Error('Finish or pause active cloud work before upgrading RELAY.');
  } else if (!(await hooks.drain())) {
    throw new Error('Coordinator did not drain safely; try again after active work finishes.');
  }
  await hooks.stop(pid);
  return true;
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
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')
    throw new Error('Preview deployments cannot change the shared RELAY identity service.');
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
  // One lock covers the decision, drain, extraction, installation and health
  // check. The server closes FD9, keeping only its separate lifetime lock.
  const script = `set -e
exec 9>/vercel/sandbox/relay-upgrade.lock
flock -w 90 9 || exit 75
if node --input-type=module <<'RELAY_UPGRADE'
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const lock='/vercel/sandbox/state/coordinator.lock';
async function health() {
 try {
  const response=await fetch('http://127.0.0.1:4317/api/cloud/health',{headers:{'X-Relay-Gateway':process.env.RELAY_GATEWAY_SECRET},signal:AbortSignal.timeout(4000)});
  return response.ok?await response.json():null;
 } catch { return null; }
}
function coordinator() {
 if(!fs.existsSync(lock)) return null;
 const pid=Number(fs.readFileSync(lock,'utf8'));
 if(Number.isInteger(pid)&&pid>1&&fs.existsSync('/proc/'+pid+'/cmdline')) {
  const command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
  if(!command.includes('server/index.ts')||fs.realpathSync('/proc/'+pid+'/cwd')!=='/vercel/sandbox/relay') throw Error('Unrecognized coordinator process; manual recovery required.');
  return pid;
 }
 return null;
}
const start=await (${prepareCloudUpgrade.toString()})(process.env.RELAY_REVISION,{
 health,
 coordinator,
 async drain() {
  try {
   const runningPid=coordinator();
   const originEntry=runningPid?fs.readFileSync('/proc/'+runningPid+'/environ','utf8').split('\\0').find(value=>value.startsWith('RELAY_PUBLIC_ORIGIN=')):null;
   const runningOrigin=originEntry?originEntry.slice('RELAY_PUBLIC_ORIGIN='.length):process.env.RELAY_PUBLIC_ORIGIN;
   const response=await fetch('http://127.0.0.1:4317/api/cloud/prepare-upgrade',{method:'POST',headers:{'X-Relay-Gateway':process.env.RELAY_GATEWAY_SECRET,'Origin':runningOrigin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});
   return response.ok&&(await response.json()).ready===true;
  } catch { return false; }
 },
 legacyBusy() {
  const file='/vercel/sandbox/state/workspace.db';
  if(fs.existsSync(file)) {
   const db=new DatabaseSync(file,{readOnly:true});
   const busy=db.prepare("SELECT count(*) AS count FROM records WHERE (kind='task' AND json_extract(data,'$.status')='running') OR (kind='session' AND json_extract(data,'$.status') IN ('starting','running','awaiting_approval')) OR (kind='handoff' AND json_extract(data,'$.status')='checkpointing')").get().count;
   db.close();
   return Number(busy)>0;
  }
  throw Error('Legacy coordinator has no workspace database; manual recovery required.');
 },
 async stop(pid) {
  if(coordinator()!==pid) throw Error('Coordinator changed while preparing upgrade.');
  process.kill(pid,'SIGTERM');
  for(let i=0;i<200&&fs.existsSync('/proc/'+pid);i++) await new Promise(r=>setTimeout(r,100));
  if(fs.existsSync('/proc/'+pid)) throw Error('Coordinator did not stop safely; manual recovery required.');
 }
});
if(!start) process.exit(10);
RELAY_UPGRADE
then :
else
 status=$?
 if [ "$status" -eq 10 ]; then exit 0; fi
 exit "$status"
fi
mkdir -p /vercel/sandbox/relay /vercel/sandbox/state /vercel/sandbox/projects
chmod 700 /vercel/sandbox/state
tar -xzf "$RELAY_ARCHIVE" -C /vercel/sandbox/relay
cd /vercel/sandbox/relay
LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f .installed-lock ] || [ "$(cat .installed-lock)" != "$LOCK_HASH" ]; then
  npm ci --omit=dev --no-audit --no-fund
  printf '%s' "$LOCK_HASH" > .installed-lock
fi
nohup bash -c 'exec 8>/vercel/sandbox/relay-bootstrap.lock; flock -n 8 || exit 75; exec node --import tsx server/index.ts' 9>&- > /vercel/sandbox/state/coordinator.log 2>&1 < /dev/null &
node --input-type=module <<'RELAY_HEALTH'
for(let attempt=0;attempt<60;attempt++) {
 try {
  const response=await fetch('http://127.0.0.1:4317/api/cloud/health',{headers:{'X-Relay-Gateway':process.env.RELAY_GATEWAY_SECRET},signal:AbortSignal.timeout(2000)});
  if(response.ok&&(await response.json()).revision===process.env.RELAY_REVISION) process.exit(0);
 } catch {}
 await new Promise(resolve=>setTimeout(resolve,1500));
}
throw Error('Replacement coordinator did not become ready; no forced termination was attempted.');
RELAY_HEALTH
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
      RELAY_REVISION: revision,
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
