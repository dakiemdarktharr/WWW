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
import { configureDestinationStaging } from './nsis-destination-staging.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = path.join(root, '.desktop-build');
const manifest = JSON.parse(await readFile(path.join(staged, 'manifest.json'), 'utf8'));
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const releases = JSON.parse(await readFile(path.join(root, 'release-history.json'), 'utf8'));
if (
  !Array.isArray(releases) ||
  releases[0] !== manifest.version ||
  releases.some((version) => typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) ||
  new Set(releases).size !== releases.length
)
  throw new Error('Put each published Kivuno version in release-history.json, newest first.');
const output = path.join(root, 'release');
const macosUrl = process.env.KIVUNO_MACOS_URL?.trim() || '';
const macosSha256 = process.env.KIVUNO_MACOS_SHA256?.trim() || '';
const macosSizeValue = process.env.KIVUNO_MACOS_SIZE?.trim() || '';
const hasMacosOverride = Boolean(macosUrl || macosSha256 || macosSizeValue);
const macosUpdateUrl = process.env.KIVUNO_MACOS_UPDATE_URL?.trim() || '';
const macosUpdateSha256 = process.env.KIVUNO_MACOS_UPDATE_SHA256?.trim() || '';
const macosUpdateSizeValue = process.env.KIVUNO_MACOS_UPDATE_SIZE?.trim() || '';
const hasMacosUpdateOverride = Boolean(macosUpdateUrl || macosUpdateSha256 || macosUpdateSizeValue);
if (hasMacosUpdateOverride && (!macosUpdateUrl || !macosUpdateSha256 || !macosUpdateSizeValue))
  throw new Error('Configure the macOS update ZIP URL, SHA256 and byte size together.');
/** @type {{ available: boolean; version?: string; url?: string; sha256?: string; size?: number; platform: string; signed: boolean; notarized: boolean }} */
let macosRelease = {
  available: false,
  platform: 'darwin-arm64',
  signed: false,
  notarized: false,
};
let macosAutoUpdate;
let macosArtifact;
if (hasMacosOverride) {
  if (!macosUrl || !macosSha256 || !macosSizeValue)
    throw new Error('Configure the macOS public URL, SHA256 and byte size together.');
  macosArtifact = {
    version: manifest.version,
    url: macosUrl,
    sha256: macosSha256,
    size: Number(macosSizeValue),
  };
} else {
  const stable = JSON.parse(
    await readFile(path.join(root, 'release-artifacts', 'macos-stable.json'), 'utf8'),
  );
  if (!/^\d+\.\d+\.\d+$/.test(stable.version)) throw new Error('Invalid stable macOS version.');
  macosArtifact = JSON.parse(
    await readFile(path.join(root, 'release-artifacts', `macos-${stable.version}.json`), 'utf8'),
  );
  if (macosArtifact.version !== stable.version)
    throw new Error('The stable macOS metadata version does not match its pointer.');
}
if (hasMacosUpdateOverride) {
  macosArtifact.autoUpdate = {
    version: macosArtifact.version,
    url: macosUpdateUrl,
    sha256: macosUpdateSha256,
    size: Number(macosUpdateSizeValue),
    platform: 'darwin-arm64',
    format: 'zip',
  };
}
if (macosArtifact) {
  if (
    !/^\d+\.\d+\.\d+$/.test(macosArtifact.version) ||
    (hasMacosOverride && macosArtifact.version !== manifest.version) ||
    !/^[a-f0-9]{64}$/i.test(macosArtifact.sha256) ||
    typeof macosArtifact.url !== 'string'
  )
    throw new Error('The macOS release metadata is incomplete or does not match this version.');
  const url = new URL(macosArtifact.url);
  const size = Number(macosArtifact.size);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    throw new Error('Configure macOS with a stable HTTPS URL and a positive byte size.');
  macosRelease = {
    available: true,
    version: macosArtifact.version,
    url: url.href,
    sha256: macosArtifact.sha256.toLowerCase(),
    size,
    platform: 'darwin-arm64',
    signed: false,
    notarized: false,
  };
  if (macosArtifact.autoUpdate !== undefined) {
    const update = macosArtifact.autoUpdate;
    if (!update || typeof update.url !== 'string')
      throw new Error('The macOS in-app update metadata is incomplete.');
    const updateUrl = new URL(update.url);
    const updateSize = Number(update.size);
    const expectedGitHubUpdateUrl =
      `https://github.com/dakiemdarktharr/WWW/releases/download/v${update.version}/` +
      `Kivuno-${update.version}-macOS-arm64.zip`;
    const isGitHubUpdate = updateUrl.href === expectedGitHubUpdateUrl;
    const validUpdatePath =
      /^\/downloads\/Kivuno-[a-zA-Z0-9._-]+\.zip$/i.test(updateUrl.pathname) || isGitHubUpdate;
    const trustedUpdateOrigin =
      updateUrl.origin === 'https://kivuno.vercel.app' ||
      updateUrl.hostname.endsWith('.public.blob.vercel-storage.com') ||
      isGitHubUpdate;
    if (
      update.version !== macosArtifact.version ||
      update.platform !== 'darwin-arm64' ||
      update.format !== 'zip' ||
      !/^[a-f0-9]{64}$/i.test(update.sha256 || '') ||
      !validUpdatePath ||
      updateUrl.protocol !== 'https:' ||
      updateUrl.port ||
      updateUrl.username ||
      updateUrl.password ||
      updateUrl.search ||
      updateUrl.hash ||
      !trustedUpdateOrigin ||
      !Number.isSafeInteger(updateSize) ||
      updateSize <= 0 ||
      updateSize > 4 * 1024 * 1024 * 1024
    )
      throw new Error('The macOS in-app update metadata is invalid.');
    macosAutoUpdate = {
      version: update.version,
      url: updateUrl.href,
      sha256: update.sha256.toLowerCase(),
      size: updateSize,
      platform: update.platform,
      format: update.format,
    };
  }
}
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
const artifactName = `Kivuno-${manifest.version}-Setup.exe`;
console.log('Packaging the Windows desktop installer…');
await build({
  projectDir: path.join(root, 'desktop'),
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'club.nosleep.relay',
    productName: 'Kivuno',
    toolsets,
    electronVersion: rootPackage.devDependencies.electron,
    directories: { app: path.join(root, 'desktop'), output },
    extraMetadata: { version: manifest.version },
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
      { from: path.join(staged, 'workspace'), to: 'workspace' },
      // electron-builder always excludes a mapping's root node_modules directory.
      // Map its contents explicitly so the separate Node runtime has all prod deps.
      { from: path.join(staged, 'workspace', 'node_modules'), to: 'workspace/node_modules' },
      { from: path.join(staged, 'runtime'), to: 'runtime' },
    ],
    async afterPack(context) {
      const { appOutDir } = context;
      configureLinuxNsisExtraction(context);
      await configureDestinationStaging(context);
      // Fail the build before producing a downloadable installer with missing deps.
      for (const required of [
        'runtime/node.exe',
        'runtime/git/cmd/git.exe',
        'app.asar',
        'workspace/node_modules/tsx/dist/loader.mjs',
        'workspace/node_modules/fastify/fastify.js',
        'workspace/node_modules/npm/bin/npm-cli.js',
        'workspace/node_modules/@esbuild/win32-x64/esbuild.exe',
        'workspace/node_modules/@openai/codex/bin/codex.js',
        'workspace/node_modules/@google/gemini-cli/bundle/gemini.js',
        'workspace/scripts/mesh-mcp.mjs',
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
      executableName: 'Kivuno',
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
      releases,
      available: true,
      url: `/downloads/${artifactName}`,
      sha256,
      size: info.size,
      platform: 'win32-x64',
      signed: false,
      platforms: {
        windows: {
          available: true,
          version: manifest.version,
          url: `/downloads/${artifactName}`,
          sha256,
          size: info.size,
          platform: 'win32-x64',
          signed: false,
        },
        linux: { available: false, platform: 'linux-x64', signed: false },
        macos: {
          ...macosRelease,
          ...(macosAutoUpdate ? { autoUpdate: macosAutoUpdate } : {}),
        },
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Windows installer ready: ${artifactName} (${Math.round(info.size / 1024 / 1024)} MB). SHA256 manifest written.`,
);
