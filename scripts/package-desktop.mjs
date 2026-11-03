import { readFile, writeFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build, Platform, Arch } from 'electron-builder';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';
import { configureLinuxNsisExtraction } from './nsis-uninstaller.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = path.join(root, '.desktop-build');
const manifest = JSON.parse(await readFile(path.join(staged, 'manifest.json'), 'utf8'));
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const toolsets = process.platform === 'linux' ? { nsis: '1.2.1' } : undefined;
if (toolsets) {
  // Minimal Linux builders lack a generated locale. Use the checksum-pinned
  // portable NSIS compiler; the target hook extracts its uninstaller without Wine.
  if (process.env.ELECTRON_BUILDER_NSIS_DIR || process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR)
    throw new Error('Linux packaging requires the pinned NSIS toolset, without overrides.');
  process.env.LANG = 'C.UTF-8';
  process.env.LC_ALL = 'C.UTF-8';
  const execute = promisify(execFile);
  const nsis = await getMakeNsisPath(toolsets.nsis);
  await execute(nsis.path, ['-VERSION'], {
    env: { ...process.env, ...nsis.env },
    timeout: 30000,
  });
  console.log('Portable Linux NSIS preflight passed; Wine is not required.');
}
const artifactName = `RELAY-${manifest.version}-Setup.exe`;
console.log('Packaging the Windows desktop installer…');
await build({
  projectDir: path.join(root, 'desktop'),
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'club.nosleep.relay',
    productName: 'RELAY',
    toolsets,
    electronVersion: rootPackage.devDependencies.electron,
    directories: { app: path.join(root, 'desktop'), output },
    extraMetadata: { version: manifest.version },
    files: [
      'main.cjs',
      'preload.cjs',
      'security.cjs',
      'package.json',
      'icon.png',
      'icon.ico',
      '!node_modules/**/*',
    ],
    asar: true,
    npmRebuild: false,
    extraResources: [
      { from: path.join(staged, 'workspace'), to: 'workspace' },
      // electron-builder always excludes a mapping's root node_modules directory.
      // Map its contents explicitly so the separate Node runtime has all prod deps.
      { from: path.join(staged, 'workspace', 'node_modules'), to: 'workspace/node_modules' },
      { from: path.join(staged, 'runtime'), to: 'runtime' },
    ],
    async afterPack(context) {
      const { appOutDir } = context;
      configureLinuxNsisExtraction(context);
      // Fail the build before producing a downloadable installer with missing deps.
      for (const required of [
        'runtime/node.exe',
        'runtime/git/cmd/git.exe',
        'workspace/node_modules/tsx/dist/loader.mjs',
        'workspace/node_modules/fastify/fastify.js',
        'workspace/node_modules/@esbuild/win32-x64/esbuild.exe',
        'workspace/node_modules/@openai/codex/bin/codex.js',
        'workspace/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      ]) {
        if (!(await stat(path.join(appOutDir, 'resources', required))).isFile())
          throw new Error(`Packaged runtime is missing ${required}.`);
      }
    },
    win: {
      target: ['nsis'],
      artifactName,
      icon: path.join(root, 'desktop', 'icon.ico'),
      signExecutable: false,
      executableName: 'RELAY',
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      deleteAppDataOnUninstall: false,
      installerIcon: path.join(root, 'desktop', 'icon.ico'),
      uninstallerIcon: path.join(root, 'desktop', 'icon.ico'),
    },
  },
});
const file = path.join(output, artifactName);
const digest = createHash('sha256');
for await (const chunk of createReadStream(file)) digest.update(chunk);
const sha256 = digest.digest('hex');
const info = await stat(file);
await writeFile(path.join(output, artifactName + '.sha256'), `${sha256}  ${artifactName}\n`);
await writeFile(
  path.join(output, 'downloads.json'),
  JSON.stringify(
    {
      version: manifest.version,
      publishedAt: new Date().toISOString(),
      windows: {
        architecture: 'x64',
        filename: artifactName,
        url: `/downloads/${artifactName}`,
        sha256,
        bytes: info.size,
        signed: false,
      },
    },
    null,
    2,
  ) + '\n',
);
const publicDirectory = path.join(root, 'dist', 'downloads');
await mkdir(publicDirectory, { recursive: true });
await copyFile(file, path.join(publicDirectory, artifactName));
await copyFile(
  path.join(output, artifactName + '.sha256'),
  path.join(publicDirectory, artifactName + '.sha256'),
);
await writeFile(
  path.join(publicDirectory, 'release.json'),
  JSON.stringify(
    {
      version: manifest.version,
      available: true,
      url: `/downloads/${artifactName}`,
      sha256,
      size: info.size,
      platform: 'win32-x64',
      signed: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Windows installer ready: ${artifactName} (${Math.round(info.size / 1024 / 1024)} MB). SHA256 manifest written.`,
);
