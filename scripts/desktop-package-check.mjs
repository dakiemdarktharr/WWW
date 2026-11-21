import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFile } from '@electron/asar';

export async function verifyDesktopModules(desktopDirectory, archive, helpers = []) {
  for (const filename of await readdir(desktopDirectory)) {
    if (!filename.endsWith('.cjs')) continue;
    const source = await readFile(path.join(desktopDirectory, filename));
    const packaged = extractFile(archive, filename);
    if (!packaged.equals(source))
      throw new Error(`Packaged desktop module does not match source: ${filename}`);
  }
  for (const filename of helpers) {
    const source = await readFile(path.join(desktopDirectory, filename));
    if (!extractFile(archive, filename).equals(source))
      throw new Error(`Packaged update helper does not match source: ${filename}`);
  }
}

export async function verifyDesktopWorkspace(buildRoot, packagedWorkspace) {
  for (const directory of ['server', 'shared', 'contracts', 'dist']) {
    const sourceDirectory = path.join(buildRoot, directory);
    const entries = await readdir(sourceDirectory, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const source = path.join(entry.parentPath, entry.name);
      const relative = path.relative(buildRoot, source);
      // Installers and their download manifest are served by the portal only.
      if (relative.startsWith(path.join('dist', 'downloads') + path.sep)) continue;
      const expected = await readFile(source);
      const actual = await readFile(path.join(packagedWorkspace, relative)).catch((cause) => {
        throw new Error(`Cannot read packaged workspace file: ${relative}`, { cause });
      });
      if (!actual.equals(expected))
        throw new Error(`Packaged workspace file does not match the build: ${relative}`);
    }
  }
}
