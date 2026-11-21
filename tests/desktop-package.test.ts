import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
// @ts-expect-error The packaging scripts use this ES module directly.
import { verifyDesktopModules } from '../scripts/desktop-package-check.mjs';

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
