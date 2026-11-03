import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run build:release through npm.');
for (const script of ['build', 'desktop:stage', 'desktop:package']) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, 'run', script], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${script} failed (${code}). No release published.`)),
    );
  });
}
await mkdir(path.join(root, '.cloud'), { recursive: true });
await copyFile(
  path.join(root, 'dist', 'downloads', 'release.json'),
  path.join(root, '.cloud', 'release.json'),
);
