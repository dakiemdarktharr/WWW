import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import releaseDownload from '../desktop/release-download.cjs';
import desktopSecurity from '../desktop/security.cjs';
import {
  isAutomatedRelease,
  mirrorDesktopRelease,
  readDesktopReleaseSource,
  waitForPublishedDesktopRelease,
} from './desktop-release-assets.mjs';
import { verifyPublishedDesktopFeed, verifyReleaseParity } from './verify-release-parity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run build:release through npm.');
const { version, history } = await readDesktopReleaseSource(root);
const automated = isAutomatedRelease(version);
const parity = automated ? null : await verifyReleaseParity(root);
if (parity && !parity.existingRelease && process.platform !== 'linux')
  throw new Error('Run the full release build on Linux to package both Windows and Linux.');
if (automated) console.log(`Waiting for the verified GitHub Release v${version}…`);
const published = automated
  ? await waitForPublishedDesktopRelease(version, {
      timeout: process.env.VERCEL_ENV === 'production' ? 25 * 60_000 : 0,
    })
  : null;
const buildEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete buildEnv.SADE_OPENAI_API_KEY;
delete buildEnv.OPENAI_API_KEY;
delete buildEnv.SADE_QWEN_API_KEY;
delete buildEnv.SADE_QWEN_WORKSPACE_HOST;
const steps = [
  ['build', [npmCli, 'run', 'build']],
  // Verify gateway startup under the module rules used by the deployed function.
  [
    'gateway:startup',
    [
      '--no-experimental-detect-module',
      '--no-experimental-require-module',
      '--experimental-transform-types',
      '--input-type=module',
      '-e',
      "await import('./api/gateway.ts')",
    ],
  ],
];
if (parity) {
  steps.push(['desktop:stage', [npmCli, 'run', 'desktop:stage']]);
  steps.push(['desktop:package', [npmCli, 'run', 'desktop:package']]);
  if (process.platform === 'linux')
    steps.push(['desktop:linux', [path.join(root, 'scripts', 'package-linux.mjs')]]);
}
for (const [script, args] of steps) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: buildEnv,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${script} failed (${code}). No release published.`)),
    );
  });
}
const downloads = path.join(root, 'dist', 'downloads');
const releaseFile = path.join(downloads, 'release.json');
if (published) {
  await mirrorDesktopRelease(downloads, published, history);
} else {
  const release = JSON.parse(await readFile(releaseFile, 'utf8'));
  verifyPublishedDesktopFeed(release, parity);
  const macos = release.platforms?.macos;
  if (
    macos?.autoUpdate &&
    (!parity.existingRelease ||
      (!buildEnv.KIVUNO_MACOS_URL?.trim() && !buildEnv.KIVUNO_MACOS_UPDATE_URL?.trim()))
  ) {
    const source = parity.metadata.autoUpdate?.assetSource;
    const filename = `Kivuno-${macos.version}-macOS-arm64.zip`;
    if (source && macos.autoUpdate.url === `https://kivuno.vercel.app/downloads/${filename}`) {
      if (
        !desktopSecurity.githubMacReleaseAsset(source, '.zip') ||
        !new URL(source).pathname.endsWith(`/${filename}`)
      )
        throw new Error('Invalid mirror for the macOS in-app update.');
      await releaseDownload.downloadUpdate(
        { ...macos.autoUpdate, url: source },
        path.join(downloads, filename),
        () => {},
      );
      console.log(`Mirrored the verified macOS update ZIP: ${filename}`);
    }
  }
}
await mkdir(path.join(root, '.cloud'), { recursive: true });
await copyFile(releaseFile, path.join(root, '.cloud', 'release.json'));
