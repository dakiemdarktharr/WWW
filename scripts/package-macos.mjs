import {
  chmod,
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build, Platform, Arch } from 'electron-builder';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Build the Apple Silicon macOS installer on a macOS arm64 host.');

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(root, '.desktop-build');
const staging = path.join(buildRoot, 'macos');
const workspace = path.join(staging, 'workspace');
const runtime = path.join(staging, 'runtime');
const output = path.join(root, 'release');
const nodeVersion = '24.22.1';
const nodeArchive = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
const nodeDirectory = `node-v${nodeVersion}-darwin-arm64`;
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}`;
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;

if (!npmCli || !existsSync(npmCli)) throw new Error('Run macos:installer through npm.');
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number);
if (nodeMajor !== 24 || nodeMinor < 22 || (nodeMinor === 22 && nodePatch < 1))
  throw new Error('Use Node.js 24.22.1 through 24.x to build the macOS installer.');
if (!existsSync(path.join(root, 'dist', 'index.html')))
  throw new Error('The web app build is missing. Run npm run macos:installer.');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

async function download(url, maxBytes) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Node.js download failed (${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Node.js download exceeds its size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function replaceIcon() {
  const iconset = path.join(staging, 'Kivuno.iconset');
  const source = path.join(root, 'desktop', 'icon.png');
  const outputIcon = path.join(staging, 'Kivuno.icns');
  await mkdir(iconset, { recursive: true });
  for (const [size, filename] of [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]) {
    await execute('/usr/bin/sips', [
      '-s',
      'format',
      'png',
      '-z',
      String(size),
      String(size),
      source,
      '--out',
      path.join(iconset, filename),
    ]);
  }
  await execute('/usr/bin/iconutil', ['-c', 'icns', '-o', outputIcon, iconset]);
  return outputIcon;
}

await mkdir(buildRoot, { recursive: true });
if ((await lstat(buildRoot)).isSymbolicLink())
  throw new Error('The desktop staging directory cannot be a symlink.');
if (existsSync(staging)) {
  if ((await lstat(staging)).isSymbolicLink())
    throw new Error('The macOS staging directory cannot be a symlink.');
  await rm(staging, { recursive: true });
}
await mkdir(staging, { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(runtime, { recursive: true });

for (const source of ['server', 'shared', 'dist', 'package.json', 'package-lock.json']) {
  await cp(path.join(root, source), path.join(workspace, source), {
    recursive: true,
    filter: (entry) =>
      !path.relative(path.join(root, 'dist'), entry).split(path.sep).includes('downloads'),
  });
}
await cp(path.join(root, 'contracts'), path.join(workspace, 'contracts'), { recursive: true });
await mkdir(path.join(workspace, 'scripts'), { recursive: true });
for (const script of ['check-runtime.mjs', 'mesh-mcp.mjs'])
  await copyFile(path.join(root, 'scripts', script), path.join(workspace, 'scripts', script));

console.log(`Preparing verified Node ${nodeVersion} for macOS arm64…`);
const checksums = (await download(`${nodeBase}/SHASUMS256.txt`, 256 * 1024)).toString('utf8');
const checksum = checksums
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith(` ${nodeArchive}`))
  ?.split(/\s+/)[0];
if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
  throw new Error('No macOS arm64 Node.js checksum was published.');
const archivePath = path.join(staging, nodeArchive);
const archive = await download(`${nodeBase}/${nodeArchive}`, 100 * 1024 * 1024);
if (createHash('sha256').update(archive).digest('hex') !== checksum)
  throw new Error('The downloaded macOS Node.js archive failed SHA256 verification.');
await writeFile(archivePath, archive);
await execute('/usr/bin/tar', [
  '-xzf',
  archivePath,
  '-C',
  runtime,
  '--strip-components=2',
  `${nodeDirectory}/bin/node`,
  `${nodeDirectory}/LICENSE`,
]);
const node = path.join(runtime, 'node');
await chmod(node, 0o755);
await writeFile(
  path.join(runtime, 'node-provenance.json'),
  JSON.stringify(
    { version: nodeVersion, archive: `${nodeBase}/${nodeArchive}`, sha256: checksum },
    null,
    2,
  ) + '\n',
);

console.log('Installing production dependencies for macOS arm64…');
await execute(
  process.execPath,
  [
    npmCli,
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--os=darwin',
    '--cpu=arm64',
    '--no-audit',
    '--no-fund',
  ],
  {
    cwd: workspace,
    env: {
      ...process.env,
      npm_config_os: 'darwin',
      npm_config_cpu: 'arm64',
      npm_config_platform: 'darwin',
      npm_config_arch: 'arm64',
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    },
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  },
);

const codexVendor = path.join(workspace, 'node_modules', '@openai', 'codex-darwin-arm64', 'vendor');
const codexEntries = existsSync(codexVendor) ? await readdir(codexVendor) : [];
const codex = codexEntries
  .map((entry) => path.join(codexVendor, entry, 'bin', 'codex'))
  .find((candidate) => existsSync(candidate));
const esbuild = path.join(workspace, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild');
if (!codex || !(await stat(codex)).isFile())
  throw new Error('The macOS Codex App Server executable is missing.');
if (!(await stat(esbuild)).isFile()) throw new Error('The macOS esbuild executable is missing.');
const nodeProbe = (await execute(node, ['--version'])).stdout.trim();
const codexProbe = (await execute(codex, ['--version'], { timeout: 30000 })).stdout.trim();
if (nodeProbe !== `v${nodeVersion}` || !codexProbe.startsWith('codex-cli 0.166.0'))
  throw new Error('The bundled macOS runtime versions do not match the release.');
console.log('Verified the bundled macOS Node and Codex CLI binaries.');

const icon = await replaceIcon();
const artifactName = `Kivuno-${packageJson.version}-macOS-arm64.dmg`;
await build({
  projectDir: path.join(root, 'desktop'),
  targets: Platform.MAC.createTarget(['dmg'], Arch.arm64),
  publish: 'never',
  config: {
    appId: 'club.nosleep.relay',
    productName: 'Kivuno',
    electronVersion: packageJson.devDependencies.electron,
    directories: { output },
    extraMetadata: { version: packageJson.version },
    files: [
      'main.cjs',
      'preload.cjs',
      'provider-tools.cjs',
      'security.cjs',
      'browser.cjs',
      'workspaces.cjs',
      'package.json',
      'icon.png',
      'icon.ico',
      '!node_modules/**/*',
    ],
    asar: true,
    npmRebuild: false,
    extraResources: [
      { from: workspace, to: 'workspace' },
      { from: path.join(workspace, 'node_modules'), to: 'workspace/node_modules' },
      { from: runtime, to: 'runtime' },
    ],
    mac: {
      target: ['dmg'],
      artifactName,
      category: 'public.app-category.developer-tools',
      icon,
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
    },
    dmg: {
      title: `Kivuno ${packageJson.version}`,
      window: { width: 540, height: 380 },
      contents: [
        { x: 130, y: 220, type: 'file' },
        { x: 410, y: 220, type: 'link', path: '/Applications' },
      ],
    },
    async afterPack({ appOutDir }) {
      const resources = path.join(appOutDir, 'Kivuno.app', 'Contents', 'Resources');
      for (const required of [
        'app.asar',
        'runtime/node',
        'workspace/node_modules/npm/bin/npm-cli.js',
        'workspace/node_modules/tsx/dist/loader.mjs',
        'workspace/node_modules/fastify/fastify.js',
        'workspace/node_modules/@esbuild/darwin-arm64/bin/esbuild',
        path.join('workspace', path.relative(workspace, codex)),
      ]) {
        if (!(await stat(path.join(resources, required))).isFile())
          throw new Error(`The packaged macOS app is missing ${required}.`);
      }
    },
  },
});

const artifact = path.join(output, artifactName);
const digest = createHash('sha256');
for await (const chunk of createReadStream(artifact)) digest.update(chunk);
const sha256 = digest.digest('hex');
const info = await stat(artifact);
await writeFile(`${artifact}.sha256`, `${sha256}  ${artifactName}\n`);
await writeFile(
  path.join(output, 'macos-arm64.json'),
  JSON.stringify(
    {
      version: packageJson.version,
      filename: artifactName,
      sha256,
      bytes: info.size,
      platform: 'darwin-arm64',
      signed: false,
      notarized: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `macOS installer ready: ${artifactName} (${Math.round(info.size / 1024 / 1024)} MB). SHA256 manifest written.`,
);
