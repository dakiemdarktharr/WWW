import { cp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.desktop-build');
const workspace = path.join(staging, 'workspace');
const nodeVersion = '24.22.1';
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}`;
const runtime = path.join(staging, 'runtime');
const gitVersion = '2.56.0.4';
// Published by the immutable official Git for Windows release, not a third-party mirror.
const gitSha256 = 'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877';
const gitUrl = `https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-${gitVersion}-64-bit.zip`;

async function download(url, maxBytes, redirectHosts = []) {
  let current = url;
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = new URL(response.headers.get('location') || '', current);
    if (
      next.protocol !== 'https:' ||
      next.username ||
      next.password ||
      !redirectHosts.includes(next.hostname)
    )
      throw new Error('Runtime download redirected to an unapproved host.');
    await response.body?.cancel();
    current = next.href;
  }
  if (!response.ok)
    throw new Error(`Download failed (${response.status}) from ${new URL(url).hostname}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Runtime download exceeds its size limit.');
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks);
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Desktop dependency preparation failed (${code}).`)),
    );
  });
}

await mkdir(staging, { recursive: true });
// Never delete a caller-supplied path or follow a symlink out of the fixed build directory.
if (path.dirname(workspace) !== staging || path.basename(workspace) !== 'workspace')
  throw new Error('Unexpected desktop staging path.');
if (existsSync(workspace)) {
  if ((await lstat(workspace)).isSymbolicLink())
    throw new Error('Desktop staging cannot be a symlink.');
  await rm(workspace, { recursive: true });
}
await mkdir(workspace, { recursive: true });
await mkdir(runtime, { recursive: true });

if (!existsSync(path.join(root, 'dist', 'index.html')))
  throw new Error('Build the web application first.');
for (const source of ['server', 'shared', 'dist', 'package.json', 'package-lock.json']) {
  await cp(path.join(root, source), path.join(workspace, source), {
    recursive: true,
    filter: (entry) =>
      !path.relative(path.join(root, 'dist'), entry).split(path.sep).includes('downloads'),
  });
}
await mkdir(path.join(workspace, 'scripts'), { recursive: true });
await cp(
  path.join(root, 'scripts', 'check-runtime.mjs'),
  path.join(workspace, 'scripts', 'check-runtime.mjs'),
);
await cp(
  path.join(root, 'scripts', 'mesh-mcp.mjs'),
  path.join(workspace, 'scripts', 'mesh-mcp.mjs'),
);
if (existsSync(path.join(root, 'contracts')))
  await cp(path.join(root, 'contracts'), path.join(workspace, 'contracts'), { recursive: true });

console.log(`Preparing verified Node ${nodeVersion} for Windows x64…`);
const sums = (await download(`${nodeBase}/SHASUMS256.txt`, 256 * 1024)).toString('utf8');
const checksum = sums
  .split(/\r?\n/)
  .find((line) => /\s+win-x64\/node\.exe$/.test(line))
  ?.split(/\s+/)[0];
if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
  throw new Error('No Windows Node checksum was published.');
const nodeFile = path.join(runtime, 'node.exe');
let nodeBinary = existsSync(nodeFile) ? await readFile(nodeFile) : null;
if (!nodeBinary || createHash('sha256').update(nodeBinary).digest('hex') !== checksum)
  nodeBinary = await download(`${nodeBase}/win-x64/node.exe`, 150 * 1024 * 1024);
if (createHash('sha256').update(nodeBinary).digest('hex') !== checksum)
  throw new Error('Downloaded Node runtime failed SHA256 verification.');
await writeFile(nodeFile, nodeBinary);
await writeFile(path.join(runtime, 'node.sha256'), `${checksum}  node.exe\n`);
await writeFile(
  path.join(runtime, 'LICENSE'),
  await download(
    `https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`,
    1024 * 1024,
  ),
);

console.log(`Preparing verified MinGit ${gitVersion} for Windows x64…`);
const cache = path.join(staging, 'cache');
await mkdir(cache, { recursive: true });
const gitArchive = path.join(cache, `MinGit-${gitVersion}-64-bit.zip`);
let gitBinary = existsSync(gitArchive) ? await readFile(gitArchive) : null;
if (!gitBinary || createHash('sha256').update(gitBinary).digest('hex') !== gitSha256)
  gitBinary = await download(gitUrl, 100 * 1024 * 1024, [
    'github.com',
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
  ]);
if (createHash('sha256').update(gitBinary).digest('hex') !== gitSha256)
  throw new Error('Downloaded MinGit failed SHA256 verification.');
await writeFile(gitArchive, gitBinary);
const gitDirectory = path.resolve(runtime, 'git');
if (gitDirectory !== path.join(staging, 'runtime', 'git'))
  throw new Error('Unexpected Git runtime staging path.');
if (existsSync(gitDirectory)) {
  if ((await lstat(gitDirectory)).isSymbolicLink())
    throw new Error('Git runtime staging cannot be a symbolic link.');
  await rm(gitDirectory, { recursive: true });
}
await mkdir(gitDirectory, { recursive: true });
await run(await getPath7za(), ['x', '-y', '-bd', `-o${gitDirectory}`, gitArchive], root);
if (!existsSync(path.join(gitDirectory, 'cmd', 'git.exe')))
  throw new Error('The bundled Git executable is missing.');
await writeFile(
  path.join(runtime, 'git-provenance.json'),
  JSON.stringify(
    {
      version: gitVersion,
      sha256: gitSha256,
      archive: gitUrl,
      source: 'https://github.com/git-for-windows/git/tree/v2.56.0.windows.4',
      license: 'GPL-2.0; see bundled MinGit license files',
    },
    null,
    2,
  ) + '\n',
);

const npmCli =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!existsSync(npmCli))
  throw new Error('Run desktop:stage through npm so its npm CLI is available.');
console.log('Installing production dependencies for the bundled Windows workspace…');
await run(
  process.execPath,
  [
    npmCli,
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--os=win32',
    '--cpu=x64',
    '--no-audit',
    '--no-fund',
  ],
  workspace,
  {
    npm_config_os: 'win32',
    npm_config_cpu: 'x64',
    npm_config_platform: 'win32',
    npm_config_arch: 'x64',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  },
);
const codex = path.join(
  workspace,
  'node_modules',
  '@openai',
  'codex-win32-x64',
  'vendor',
  'x86_64-pc-windows-msvc',
  'bin',
  'codex.exe',
);
if (!existsSync(codex))
  throw new Error('The Windows Codex executable is missing from production dependencies.');
await writeFile(
  path.join(staging, 'manifest.json'),
  JSON.stringify(
    {
      platform: 'win32',
      arch: 'x64',
      nodeVersion,
      nodeSha256: checksum,
      gitVersion,
      gitSha256,
      version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
    },
    null,
    2,
  ) + '\n',
);
console.log('Desktop runtime is staged without local accounts, secrets or repository state.');
