import { cp, mkdir, readFile, writeFile, rm, lstat, chmod, stat, copyFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { desktopPackageFiles } from './desktop-package-files.mjs';
import { verifyDesktopModules } from './desktop-package-check.mjs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { create as createTar } from 'tar';
import { build, Platform, Arch } from 'electron-builder';

if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('Build the Linux desktop on a Linux x64 host.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.desktop-build', 'linux');
const workspace = path.join(staging, 'workspace');
const runtime = path.join(staging, 'runtime');
const output = path.join(root, 'release');
const execute = promisify(execFile);
const nodeVersion = '24.22.1';
const archiveName = `node-v${nodeVersion}-linux-x64.tar.xz`;
const base = `https://nodejs.org/dist/v${nodeVersion}`;
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error('Run the release build through npm.');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

async function download(url, maxBytes) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Linux runtime download failed (${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Linux runtime exceeds its download limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

await mkdir(staging, { recursive: true });
if (
  (await lstat(path.dirname(staging))).isSymbolicLink() ||
  (await lstat(staging)).isSymbolicLink()
)
  throw new Error('Linux staging directories cannot be symbolic links.');
if (path.dirname(workspace) !== staging || path.basename(workspace) !== 'workspace')
  throw new Error('Unexpected Linux staging path.');
if (existsSync(workspace)) {
  if ((await lstat(workspace)).isSymbolicLink())
    throw new Error('Linux staging cannot be a symlink.');
  await rm(workspace, { recursive: true });
}
await mkdir(workspace, { recursive: true });
await mkdir(runtime, { recursive: true });
if ((await lstat(runtime)).isSymbolicLink())
  throw new Error('The Linux runtime directory cannot be a symbolic link.');
for (const source of ['server', 'shared', 'dist', 'package.json', 'package-lock.json']) {
  await cp(path.join(root, source), path.join(workspace, source), {
    recursive: true,
    filter: (entry) =>
      !path.relative(path.join(root, 'dist'), entry).split(path.sep).includes('downloads'),
  });
}
await mkdir(path.join(workspace, 'scripts'), { recursive: true });
await copyFile(
  path.join(root, 'scripts/check-runtime.mjs'),
  path.join(workspace, 'scripts/check-runtime.mjs'),
);
await copyFile(
  path.join(root, 'scripts/mesh-mcp.mjs'),
  path.join(workspace, 'scripts/mesh-mcp.mjs'),
);
await cp(path.join(root, 'contracts'), path.join(workspace, 'contracts'), { recursive: true });

console.log(`Preparing verified Node ${nodeVersion} for Linux x64…`);
const sums = (await download(`${base}/SHASUMS256.txt`, 256 * 1024)).toString('utf8');
const checksum = sums
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith(` ${archiveName}`))
  ?.split(/\s+/)[0];
if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
  throw new Error('No Linux Node checksum was published.');
const archive = path.join(staging, archiveName);
let binary = existsSync(archive) ? await readFile(archive) : null;
if (!binary || createHash('sha256').update(binary).digest('hex') !== checksum)
  binary = await download(`${base}/${archiveName}`, 100 * 1024 * 1024);
if (createHash('sha256').update(binary).digest('hex') !== checksum)
  throw new Error('Linux Node archive failed SHA256 verification.');
await writeFile(archive, binary);
await execute('tar', [
  '-xJf',
  archive,
  '-C',
  runtime,
  '--strip-components=2',
  `node-v${nodeVersion}-linux-x64/bin/node`,
]);
await execute('tar', [
  '-xJf',
  archive,
  '-C',
  runtime,
  '--strip-components=1',
  `node-v${nodeVersion}-linux-x64/LICENSE`,
]);
const node = path.join(runtime, 'node');
await chmod(node, 0o755);
await writeFile(
  path.join(runtime, 'node-provenance.json'),
  JSON.stringify(
    { version: nodeVersion, archive: `${base}/${archiveName}`, sha256: checksum },
    null,
    2,
  ) + '\n',
);
console.log('Installing Linux production dependencies…');
await execute(
  process.execPath,
  [
    npmCli,
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--os=linux',
    '--cpu=x64',
    '--no-audit',
    '--no-fund',
  ],
  {
    cwd: workspace,
    env: {
      ...process.env,
      npm_config_os: 'linux',
      npm_config_cpu: 'x64',
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    },
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  },
);
const codex = path.join(
  workspace,
  'node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex',
);
if (!(await stat(codex)).isFile()) throw new Error('The Linux Codex executable is missing.');
await chmod(codex, 0o755);
const nodeProbe = await execute(node, ['--version']);
const codexProbe = await execute(codex, ['--version'], { timeout: 30000 });
if (
  nodeProbe.stdout.trim() !== `v${nodeVersion}` ||
  !codexProbe.stdout.startsWith('codex-cli 0.166.0')
)
  throw new Error('The bundled Linux CLI versions do not match the release.');
const probeHome = path.join(staging, 'probe-home');
await mkdir(probeHome, { recursive: true, mode: 0o700 });
await execute(
  node,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import { CodexClient } from './server/codex.ts';
  const client = new CodexClient({ home: process.env.KIVUNO_PROBE_HOME, cwd: process.cwd() });
  try { await client.start(); const value = await client.request('account/read', { refreshToken: false }); assert.equal(value.account, null); }
  finally { await client.stop(); }
`,
  ],
  {
    cwd: workspace,
    env: {
      PATH: `${runtime}:${process.env.PATH || ''}`,
      HOME: probeHome,
      KIVUNO_PROBE_HOME: probeHome,
      RELAY_CODEX_COMMAND: codex,
    },
    timeout: 45000,
  },
);
console.log('Linux Node and real Codex App Server probe passed; no login or model turn.');

await build({
  projectDir: path.join(root, 'desktop'),
  targets: Platform.LINUX.createTarget(['dir'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'club.nosleep.relay',
    productName: 'Kivuno',
    electronVersion: packageJson.devDependencies.electron,
    directories: { app: path.join(root, 'desktop'), output },
    extraMetadata: { version: packageJson.version },
    files: desktopPackageFiles,
    asar: true,
    npmRebuild: false,
    extraResources: [
      { from: workspace, to: 'workspace' },
      { from: path.join(workspace, 'node_modules'), to: 'workspace/node_modules' },
      { from: runtime, to: 'runtime' },
    ],
    linux: {
      target: ['dir'],
      executableName: 'kivuno',
      icon: path.join(root, 'desktop/icon.png'),
      category: 'Development',
    },
    async afterPack({ appOutDir }) {
      await verifyDesktopModules(
        path.join(root, 'desktop'),
        path.join(appOutDir, 'resources', 'app.asar'),
      );
      for (const required of [
        'kivuno',
        'resources/app.asar',
        'resources/runtime/node',
        'resources/workspace/node_modules/npm/bin/npm-cli.js',
        'resources/workspace/node_modules/tsx/dist/loader.mjs',
        'resources/workspace/node_modules/fastify/fastify.js',
        'resources/workspace/node_modules/@esbuild/linux-x64/bin/esbuild',
        'resources/workspace/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex',
      ]) {
        if (!(await stat(path.join(appOutDir, required))).isFile())
          throw new Error(`Linux package is missing ${required}.`);
      }
    },
  },
});
const unpacked = path.join(output, 'linux-unpacked');
await writeFile(
  path.join(unpacked, 'start-kivuno.sh'),
  `#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v git >/dev/null 2>&1; then
  printf '%s\\n' 'Kivuno requires Git. Install Git with your Linux distribution package manager.' >&2
  exit 1
fi
exec "$HERE/kivuno" "$@"
`,
  { mode: 0o755 },
);
await copyFile(path.join(root, 'docs/DESKTOP.md'), path.join(unpacked, 'DESKTOP.md'));
const artifactName = `Kivuno-${packageJson.version}-linux-x64.tar.gz`;
const file = path.join(output, artifactName);
await createTar({ gzip: true, file, cwd: unpacked, prefix: 'Kivuno', portable: true }, ['.']);
const digest = createHash('sha256');
for await (const chunk of createReadStream(file)) digest.update(chunk);
const sha256 = digest.digest('hex');
const info = await stat(file);
await writeFile(file + '.sha256', `${sha256}  ${artifactName}\n`);
const publicDirectory = path.join(root, 'dist/downloads');
await mkdir(publicDirectory, { recursive: true });
await copyFile(file, path.join(publicDirectory, artifactName));
await copyFile(file + '.sha256', path.join(publicDirectory, artifactName + '.sha256'));
const manifestFile = path.join(publicDirectory, 'release.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (manifest.version !== packageJson.version || !manifest.platforms?.windows?.available)
  throw new Error('Linux release must be paired with the current verified Windows artifact.');
manifest.platforms.linux = {
  available: true,
  url: `/downloads/${artifactName}`,
  size: info.size,
  sha256,
  platform: 'linux-x64',
  signed: false,
};
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Linux archive ready: ${artifactName} (${Math.round(info.size / 1024 / 1024)} MB).`);
