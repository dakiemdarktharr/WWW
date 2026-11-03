// Build-only adapter for the pinned electron-builder NSIS implementation.
// Uses its upstream Catalina workaround without installing or executing Wine.
import { readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { UninstallerReader, nsisTemplatesDir } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';

const require = createRequire(import.meta.url);
const builderVersion = require('app-builder-lib/package.json').version;

export async function extractNsisUninstaller(installerPath, uninstallerPath) {
  if (
    path.dirname(path.resolve(installerPath)) !== path.dirname(path.resolve(uninstallerPath)) ||
    path.resolve(installerPath) === path.resolve(uninstallerPath)
  )
    throw new Error('NSIS intermediate and uninstaller must be distinct sibling files.');
  const input = await lstat(installerPath);
  if (
    !input.isFile() ||
    input.isSymbolicLink() ||
    input.size < 1024 ||
    input.size > 32 * 1024 * 1024
  )
    throw new Error('Unexpected NSIS intermediate file.');
  const existing = await lstat(uninstallerPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw new Error('NSIS uninstaller destination must not exist.');
  try {
    await UninstallerReader.exec(installerPath, uninstallerPath);
    const result = await readFile(uninstallerPath);
    const peOffset = result.length >= 64 ? result.readUInt32LE(60) : -1;
    if (
      result.length < 1024 ||
      result.length > input.size ||
      result.readUInt16LE(0) !== 0x5a4d ||
      peOffset < 64 ||
      peOffset + 4 > result.length ||
      result.readUInt32LE(peOffset) !== 0x4550
    )
      throw new Error('NSIS extraction did not produce a valid PE executable.');
  } catch (error) {
    await unlink(uninstallerPath).catch(() => {});
    throw error;
  }
}

export function configureLinuxNsisExtraction({ targets, packager, outDir }) {
  if (process.platform !== 'linux') return;
  // Resolve after electron-builder initializes its mutually dependent classes.
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
  if (
    builderVersion !== '26.18.0' ||
    packager.config.toolsets?.nsis !== '1.2.1' ||
    packager.platformSpecificBuildOptions.signExecutable !== false
  )
    throw new Error('NSIS extraction requires the pinned unsigned build toolchain.');
  if (targets.length !== 1 || !(targets[0] instanceof NsisTarget) || targets[0].name !== 'nsis')
    throw new Error('NSIS extraction supports only the RELAY NSIS target.');
  const target = targets[0];
  if (
    target.packager !== packager ||
    path.resolve(target.outDir) !== path.resolve(outDir) ||
    target.options.script ||
    target.options.customNsisBinary ||
    target.options.customNsisResources ||
    target.options.installerIcon !== target.options.uninstallerIcon ||
    target.computeScriptAndSignUninstaller !== NsisTarget.prototype.computeScriptAndSignUninstaller
  )
    throw new Error('Unsupported custom NSIS target configuration.');
  // Override this build target instance only; no global VM or command interception.
  target.computeScriptAndSignUninstaller = async function (
    defines,
    commands,
    installerPath,
    sharedHeader,
    archs,
  ) {
    if (
      path.dirname(path.resolve(installerPath)) !== path.resolve(outDir) ||
      commands.SetCompressor !== 'zlib' ||
      (await packager.getResource(this.options.script, 'installer.nsi'))
    )
      throw new Error('Unexpected NSIS intermediate configuration.');
    const script = await readFile(path.join(nsisTemplatesDir, 'installer.nsi'), 'utf8');
    const uninstallerPath = path.join(
      outDir,
      `${path.basename(installerPath, 'exe')}__uninstaller.exe`,
    );
    defines.BUILD_UNINSTALLER = null;
    defines.UNINSTALLER_OUT_FILE = path.win32.join('Z:', uninstallerPath);
    await this.executeMakensis(
      defines,
      commands,
      sharedHeader + (await this.computeFinalScript(script, false, archs)),
    );
    await extractNsisUninstaller(installerPath, uninstallerPath);
    await packager.signIf(uninstallerPath);
    delete defines.BUILD_UNINSTALLER;
    defines.UNINSTALLER_OUT_FILE = uninstallerPath;
    console.log('Extracted the unsigned NSIS uninstaller without Wine.');
    return { script, isCustomScript: false };
  };
}
