import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  RELAY_DEPLOYMENT: 'cloud',
  RELAY_LOCAL_CLOUD_DEMO: '1',
  RELAY_PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
  RELAY_GATEWAY_SECRET: randomBytes(32).toString('hex'),
  RELAY_AUTH_SECRET: randomBytes(32).toString('hex'),
  RELAY_OWNER_PASSWORD: randomBytes(24).toString('base64url'),
  RELAY_DATA_DIR: path.join(root, '.relay-fuji-demo'),
  RELAY_PORT: '4317',
  KIVUNO_FUJI_PAYMENT_CONTRACT: '0xBA7321C1F3107b95Acec6C3490e3130aFaE7a220',
  KIVUNO_FUJI_USDC_ADDRESS: '0x5425890298aed601595a70AB815c96711a31Bc65',
  KIVUNO_FUJI_TREASURY_ADDRESS: '0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805',
};

const children = [];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill();
};

for (const args of [
  ['--import', 'tsx', '--watch', 'server/index.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
]) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

console.log('Local Fuji billing demo: http://127.0.0.1:5173/billing');
console.log('Local demo data: .relay-fuji-demo (ignored by Git)');
