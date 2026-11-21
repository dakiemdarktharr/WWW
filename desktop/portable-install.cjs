'use strict';

const { createHash } = require('node:crypto');
const { lstat, readFile, readdir } = require('node:fs/promises');
const path = require('node:path');

const portableManifest = 'kivuno-portable.json';

// Reject mixed directories before replacing the bundle. Configuration and workspaces
// live outside the bundle, but users can also extract the archive over existing files.
async function portableTree(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const inventory = entries
    .map((entry) => [
      path.relative(directory, path.join(entry.parentPath, entry.name)),
      entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file',
    ])
    .filter(([name]) => name !== portableManifest)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

async function verifyPortableInstall(directory, version) {
  const marker = path.join(directory, portableManifest);
  if (!(await lstat(directory)).isDirectory() || !(await lstat(marker)).isFile())
    throw new Error('Không nhận diện được thư mục cài Kivuno.');
  const manifest = JSON.parse(await readFile(marker, 'utf8'));
  if (
    manifest.version !== version ||
    manifest.tree !== (await portableTree(directory)) ||
    !(await lstat(path.join(directory, 'kivuno'))).isFile() ||
    !(await lstat(path.join(directory, 'resources', 'app.asar'))).isFile()
  )
    throw new Error('Thư mục Kivuno đã thay đổi. Hãy cài vào một thư mục riêng để cập nhật.');
}

module.exports = { portableManifest, portableTree, verifyPortableInstall };
