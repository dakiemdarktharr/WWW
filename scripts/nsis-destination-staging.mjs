// Pinned build-time adaptation: large payloads stay on the selected install drive.
// NSIS plugins still use the normal small system temp directory.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { nsisTemplatesDir } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';
import { writeUpgradeStaging } from './nsis-upgrade-staging.mjs';

const require = createRequire(import.meta.url);
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('The pinned NSIS template changed.');
  return source.replace(from, to);
}
// Native Windows makensis requires native drive paths; Linux makensis uses POSIX paths.
const include = (file) => `!include "${file}"`;

export async function configureDestinationStaging({ targets, outDir }) {
  if (require('app-builder-lib/package.json').version !== '26.18.0')
    throw new Error('Review NSIS staging before upgrading electron-builder.');
  if (targets.length !== 1 || targets[0].name !== 'nsis')
    throw new Error('Destination staging supports the embedded NSIS installer only.');
  const target = targets[0];
  if (target.options.script || target.options.differentialPackage === false)
    throw new Error('Unexpected NSIS packaging configuration.');
  const directory = path.resolve(outDir, 'nsis-staging');
  await mkdir(directory, { recursive: true });
  const extractionPath = path.join(directory, 'kivuno-extract.nsh');
  const applicationPath = path.join(directory, 'kivuno-application.nsh');
  const sectionPath = path.join(directory, 'kivuno-section.nsh');
  const upgradePath = await writeUpgradeStaging(directory);
  let extraction = await readFile(
    path.join(nsisTemplatesDir, 'include/extractAppPackage.nsh'),
    'utf8',
  );
  extraction = extraction.replaceAll('$PLUGINSDIR', '$kivunoPayloadDir');
  extraction = replaceOnce(
    extraction,
    '!macro extractEmbeddedAppPackage',
    `!macro extractEmbeddedAppPackage
  Var /GLOBAL kivunoPayloadDir
  CreateDirectory "$INSTDIR"
  ClearErrors
  GetTempFileName $kivunoPayloadDir "$INSTDIR"
  IfErrors kivunoStageFailed
  Delete "$kivunoPayloadDir"
  CreateDirectory "$kivunoPayloadDir"
  IfErrors kivunoStageFailed
  Goto kivunoStageReady
  kivunoStageFailed:
    MessageBox MB_OK|MB_ICONSTOP "Kivuno could not create temporary files on the installation drive. Choose a writable folder with enough free space."
    Abort
  kivunoStageReady:`,
  );
  extraction = replaceOnce(
    extraction,
    '!insertmacro custom_files_post_decompression',
    `!insertmacro custom_files_post_decompression
  # Only the unique directory created above, within INSTDIR, is removed.
  RMDir /r "$kivunoPayloadDir"`,
  );
  let application = await readFile(path.join(nsisTemplatesDir, 'include/installer.nsh'), 'utf8');
  application = replaceOnce(
    application,
    '!include "extractAppPackage.nsh"',
    include(extractionPath),
  );
  application = replaceOnce(
    application,
    '!insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"',
    '# Kivuno uses manual installer updates; do not cache another full installer on C:.',
  );
  let section = await readFile(path.join(nsisTemplatesDir, 'installSection.nsh'), 'utf8');
  section = replaceOnce(section, '!include installer.nsh', include(applicationPath));
  const switchScript = fileURLToPath(new URL('./windows-update-switch.ps1', import.meta.url));
  const updateSection = fileURLToPath(new URL('./windows-update-section.nsh', import.meta.url));
  section = replaceOnce(
    section,
    'InitPluginsDir',
    'InitPluginsDir\n!define KIVUNO_SWITCH_SCRIPT "' +
      switchScript +
      '"\n' +
      include(updateSection),
  );
  await writeFile(extractionPath, extraction);
  await writeFile(applicationPath, application);
  await writeFile(sectionPath, section);
  const original = target.computeFinalScript;
  target.computeFinalScript = function (script, ...args) {
    script = replaceOnce(script, '!include "installUtil.nsh"', include(upgradePath));
    script = replaceOnce(script, '!include "installSection.nsh"', include(sectionPath));
    script = replaceOnce(
      script,
      '!insertmacro setSpaceRequired ${INSTALL_SECTION_ID}',
      `!insertmacro setSpaceRequired \${INSTALL_SECTION_ID}
  # Final files + extraction staging + archive/headroom on the destination drive.
  SectionGetSize \${INSTALL_SECTION_ID} $0
  IntOp $0 $0 * 2
  IntOp $0 $0 + 524288
  SectionSetSize \${INSTALL_SECTION_ID} $0`,
    );
    return original.call(this, script, ...args);
  };
  const execute = target.executeMakensis;
  target.executeMakensis = async function (defines, commands, script, ...options) {
    const label = 'BUILD_UNINSTALLER' in defines ? 'uninstaller' : 'installer';
    await writeFile(path.join(directory, `${label}.nsi`), script);
    await writeFile(
      path.join(directory, `${label}-compiler.json`),
      JSON.stringify({ defines, commands }, null, 2),
    );
    return execute.call(this, defines, commands, script, ...options);
  };
}
