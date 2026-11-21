import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
// @ts-expect-error The packaging scripts use this ES module directly.
import { verifyDesktopModules, verifyDesktopWorkspace } from '../scripts/desktop-package-check.mjs';

test('desktop packaging rejects missing and stale main-process modules in the actual ASAR', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-package-modules-'));
  try {
    const source = path.join(directory, 'source');
    const packaged = path.join(directory, 'packaged');
    await mkdir(source);
    await mkdir(packaged);
    const main = "require('./release-download.cjs');\n";
    const downloader = 'module.exports = {};\n';
    await writeFile(path.join(source, 'main.cjs'), main);
    await writeFile(path.join(source, 'release-download.cjs'), downloader);
    await writeFile(path.join(packaged, 'main.cjs'), main);
    const missing = path.join(directory, 'missing.asar');
    await createPackage(packaged, missing);
    await assert.rejects(verifyDesktopModules(source, missing), /release-download\.cjs/);

    await writeFile(path.join(packaged, 'release-download.cjs'), downloader);
    const complete = path.join(directory, 'complete.asar');
    await createPackage(packaged, complete);
    await verifyDesktopModules(source, complete);

    await writeFile(
      path.join(source, 'release-download.cjs'),
      'module.exports = { updated: true };\n',
    );
    await assert.rejects(verifyDesktopModules(source, complete), /does not match source/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop packaging rejects a workspace missing a Sade feature or using stale UI', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-package-workspace-'));
  try {
    const build = path.join(directory, 'build');
    const packaged = path.join(directory, 'packaged');
    const files = [
      'server/shared-sade-project.ts',
      'shared/sade-project.ts',
      'contracts/RelayAegis.sol',
      'dist/assets/workspace.js',
    ];
    for (const file of files) {
      const destination = path.join(build, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file);
    }
    await cp(build, packaged, { recursive: true });
    const downloads = path.join(build, 'dist', 'downloads');
    await mkdir(downloads);
    await writeFile(path.join(downloads, 'release.json'), '{}');
    await verifyDesktopWorkspace(build, packaged);

    await rm(path.join(packaged, files[0]));
    await assert.rejects(verifyDesktopWorkspace(build, packaged), /shared-sade-project\.ts/);
    await cp(path.join(build, files[0]), path.join(packaged, files[0]));

    await writeFile(path.join(packaged, files[3]), 'previous version');
    await assert.rejects(verifyDesktopWorkspace(build, packaged), /does not match.*workspace\.js/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
