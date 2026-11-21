import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';
import portableInstall from '../desktop/portable-install.cjs';
import { verifyDesktopModules } from '../scripts/desktop-package-check.mjs';
import {
  desktopReleaseFiles,
  readDesktopReleaseSource,
} from '../scripts/desktop-release-assets.mjs';

const execute = promisify(execFile);
const { version } = await readDesktopReleaseSource(process.cwd());
const artifacts = desktopReleaseFiles(version);
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kivuno-release-qa-')));
try {
  if (process.platform === 'darwin') {
    assert.equal(process.arch, 'arm64');
    await execute('/usr/bin/ditto', [
      '-x',
      '-k',
      path.resolve('release', artifacts.macosUpdate.filename),
      temp,
    ]);
    const bundle = path.join(temp, 'Kivuno.app');
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    for (const [field, expected] of [
      ['CFBundleIdentifier', 'club.nosleep.relay'],
      ['CFBundleShortVersionString', version],
    ]) {
      const { stdout } = await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, plist]);
      assert.equal(stdout.trim(), expected);
    }
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    await verifyDesktopModules('desktop', path.join(bundle, 'Contents/Resources/app.asar'));
  } else {
    assert.equal(process.platform, 'linux');
    assert.equal(process.arch, 'x64');
    await execute('/usr/bin/tar', [
      '-xzf',
      path.resolve('release', artifacts.linux.filename),
      '-C',
      temp,
    ]);
    const bundle = path.join(temp, 'Kivuno');
    await portableInstall.verifyPortableInstall(bundle, version);
    const profile = path.join(temp, 'profile');
    // Hosted Ubuntu restricts unprivileged namespaces. This disposable smoke profile never signs in.
    const app = await electron.launch({
      executablePath: path.join(bundle, 'kivuno'),
      args: ['--no-sandbox', `--user-data-dir=${profile}`],
      timeout: 60_000,
    });
    try {
      assert.deepEqual(
        await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged })),
        { version, packaged: true },
      );
      const page = await app.firstWindow();
      await page.waitForURL((url) => url.protocol === 'http:' && url.hostname === '127.0.0.1');
      await page.getByRole('heading', { name: 'Kivuno', exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.relayDesktop.getStatus())).runtime, 'ready');
    } finally {
      await app.close();
    }
  }
  console.log(`Verified the archived ${process.platform} Kivuno ${version} package.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
