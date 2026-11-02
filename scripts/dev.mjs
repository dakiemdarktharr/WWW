import './check-runtime.mjs';
import { spawn } from 'node:child_process';
const children = [];
for (const args of [
  ['--import', 'tsx', '--watch', 'server/index.ts'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('exit', (code) => {
    if (code) for (const other of children) if (other !== child) other.kill();
  });
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill();
  });
