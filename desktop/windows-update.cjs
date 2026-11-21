'use strict';

// The old and new app.asar archives are files on disk, not Electron virtual directories.
const { lstat, readdir, readFile, realpath, rmdir, unlink, writeFile } = (
  process.versions.electron ? require('original-fs') : require('node:fs')
).promises;
const path = require('node:path');
const { validIdentity } = require('./security.cjs');

const receiptName = '.kivuno-replaced-by';
const claimedName = '.kivuno-resume-used';
const generatedAssets = path.join('resources', 'workspace', 'dist', 'assets');

function samePath(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    path.isAbsolute(left) &&
    path.isAbsolute(right) &&
    !path.relative(left, right)
  );
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}

async function ordinaryFile(file) {
  const item = await lstat(file).catch(() => null);
  return item?.isFile() && !item.isSymbolicLink() && samePath(await realpath(file), file);
}

async function ordinaryDirectory(directory) {
  const item = await lstat(directory).catch(() => null);
  return (
    item?.isDirectory() && !item.isSymbolicLink() && samePath(await realpath(directory), directory)
  );
}

async function inspectWindowsUpdate(environment, executable, dataDirectory, version) {
  const {
    KIVUNO_UPDATE_APP: installedApp,
    KIVUNO_UPDATE_FILE: installer,
    KIVUNO_UPDATE_VERSION: updateVersion,
  } = environment;
  if (
    !samePath(executable, installedApp) ||
    updateVersion !== version ||
    !installer ||
    !path.isAbsolute(installer) ||
    path.basename(installer) !== 'Kivuno-Setup.exe' ||
    path.basename(executable).toLowerCase() !== 'kivuno.exe'
  )
    return null;
  const installed = path.dirname(executable);
  const stage = path.dirname(installer);
  if (
    !/^\.kivuno-update-[A-Za-z0-9]{6}$/.test(path.basename(stage)) ||
    !samePath(path.dirname(installed), path.dirname(stage))
  )
    return null;
  const backup = stage + '-previous';
  const profile = await realpath(dataDirectory);
  if (
    [installed, stage, backup].some(
      (directory) => contains(directory, profile) || contains(profile, directory),
    )
  ) {
    return null;
  }
  if (
    !(await ordinaryDirectory(installed)) ||
    !(await ordinaryDirectory(backup)) ||
    !(await ordinaryFile(path.join(backup, 'Kivuno.exe'))) ||
    !(await ordinaryFile(path.join(backup, 'Uninstall Kivuno.exe')))
  )
    return null;

  const receipt = path.join(backup, receiptName);
  if (!(await ordinaryFile(receipt)) || (await lstat(receipt)).size > 8192) return null;
  const text = await readFile(receipt, 'utf8');
  // A pre-continuation installer used only the executable path as its cleanup receipt.
  if (samePath(text, executable)) return { installed, backup, mayResume: false };
  let marker;
  try {
    marker = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !samePath(marker?.app, executable) ||
    marker?.version !== version ||
    typeof marker?.profile !== 'string' ||
    !path.isAbsolute(marker.profile) ||
    !samePath(await realpath(marker.profile).catch(() => null), profile)
  )
    return null;
  return { installed, backup, mayResume: true };
}

async function resumeWindowsUpdateIdentity(update, saved, verify) {
  if (!update?.mayResume || !(await ordinaryDirectory(update.backup))) return null;
  const previous = validIdentity(saved);
  try {
    await writeFile(path.join(update.backup, claimedName), '', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
  const device = await verify(previous.accessToken);
  if (!device?.deviceId || (previous.deviceId && previous.deviceId !== device.deviceId))
    return null;
  return validIdentity(
    {
      ...previous,
      ...device,
      accessToken: previous.accessToken,
      bridgeKey: previous.bridgeKey,
    },
    previous.owner.id,
  );
}

function obsoleteGeneratedAsset(relative) {
  return (
    samePath(path.resolve(path.dirname(relative)), path.resolve(generatedAssets)) &&
    /-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|png|jpe?g|webp|avif|svg|gif|wasm|glb|mp4|webm|mp3|ogg|wav)$/i.test(
      path.basename(relative),
    )
  );
}

async function cleanPreviousWindowsInstall(update) {
  if (
    !update ||
    !(await ordinaryDirectory(update.backup)) ||
    !(await ordinaryDirectory(update.installed))
  )
    return;
  const { backup, installed } = update;
  // Use leaf-by-leaf removal so an extra or newly-created file never makes us delete
  // the whole directory. Only immutable packaged paths and old Vite assets qualify.
  async function removePackageFiles(relative) {
    const directory = path.join(backup, relative);
    if (!(await ordinaryDirectory(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (name === receiptName || name === claimedName || entry.isSymbolicLink()) continue;
      const old = path.join(backup, name);
      const current = path.join(installed, name);
      if (entry.isDirectory() && (await ordinaryDirectory(current))) {
        await removePackageFiles(name);
        await rmdir(old).catch(() => {});
      } else if (
        entry.isFile() &&
        (await ordinaryFile(old)) &&
        (obsoleteGeneratedAsset(name) || (await ordinaryFile(current)))
      ) {
        await unlink(old).catch(() => {});
      }
    }
  }
  await removePackageFiles('');
  // Any unexpected application files, user files, or links remain with the recovery receipt.
  if ((await readdir(backup)).some((entry) => entry !== receiptName && entry !== claimedName))
    return;
  for (const name of [claimedName, receiptName]) {
    const file = path.join(backup, name);
    if (await ordinaryFile(file)) await unlink(file);
  }
  await rmdir(backup);
}

module.exports = { inspectWindowsUpdate, resumeWindowsUpdateIdentity, cleanPreviousWindowsInstall };
