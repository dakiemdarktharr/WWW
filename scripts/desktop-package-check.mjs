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
