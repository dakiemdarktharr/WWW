// Keep legacy uninstall rollback on the old installation drive, including 0.6 uninstallers.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nsisTemplatesDir } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('The pinned NSIS upgrade template changed.');
  return source.replace(from, to);
}

const declarations = String.raw`
Var /GLOBAL kivunoUpgradeTemp
Var /GLOBAL kivunoUpgradeParent
Var /GLOBAL kivunoUpgradeOldInstall
Var /GLOBAL kivunoUpgradeOriginalTemp
Var /GLOBAL kivunoUpgradeOriginalTmp
Var /GLOBAL kivunoUpgradeEnvChanged
Var /GLOBAL kivunoUpgradeReady
Var /GLOBAL kivunoUpgradeHadErrors
Var /GLOBAL kivunoUpgradeResult
`;

const helpers = String.raw`
Function kivuno.prepareUpgradeTemp
  Push $R9
  StrCpy $kivunoUpgradeReady "-1"
  GetFullPathName $kivunoUpgradeOldInstall "$installationDir"
  StrLen $R9 $kivunoUpgradeOldInstall
  IntCmp $R9 3 kivunoUpgradePrepareFailed kivunoUpgradePrepareFailed 0
  StrCpy $R9 $kivunoUpgradeOldInstall 1 -1
  StrCmp $R9 "\" 0 +2
    StrCpy $kivunoUpgradeOldInstall $kivunoUpgradeOldInstall -1
  Push $kivunoUpgradeOldInstall
  Call GetFileParent
  Pop $kivunoUpgradeParent
  StrCmp $kivunoUpgradeParent "" kivunoUpgradePrepareFailed
  # GetFileParent returns D: for D:\Kivuno; append slash to avoid drive-relative paths.
  GetFullPathName $kivunoUpgradeParent "$kivunoUpgradeParent\"
  ClearErrors
  GetTempFileName $kivunoUpgradeTemp "$kivunoUpgradeParent"
  IfErrors kivunoUpgradePrepareFailed
  Delete "$kivunoUpgradeTemp"
  CreateDirectory "$kivunoUpgradeTemp"
  IfErrors kivunoUpgradePrepareFailed
  ReadEnvStr $kivunoUpgradeOriginalTemp TEMP
  ReadEnvStr $kivunoUpgradeOriginalTmp TMP
  StrCpy $kivunoUpgradeEnvChanged "1"
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$kivunoUpgradeTemp") i .R9'
  StrCmp $R9 0 kivunoUpgradePrepareFailed
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$kivunoUpgradeTemp") i .R9'
  StrCmp $R9 0 kivunoUpgradePrepareFailed
  StrCpy $kivunoUpgradeReady "1"
  kivunoUpgradePrepareFailed:
  Pop $R9
FunctionEnd

Function kivuno.restoreUpgradeEnvironment
  Push $R9
  StrCmp $kivunoUpgradeEnvChanged "1" 0 kivunoUpgradeEnvironmentDone
  StrCmp $kivunoUpgradeOriginalTemp "" 0 kivunoUpgradeRestoreTempValue
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", p 0) i .R9'
    Goto kivunoUpgradeRestoreTmp
  kivunoUpgradeRestoreTempValue:
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$kivunoUpgradeOriginalTemp") i .R9'
  kivunoUpgradeRestoreTmp:
  StrCmp $kivunoUpgradeOriginalTmp "" 0 kivunoUpgradeRestoreTmpValue
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", p 0) i .R9'
    Goto kivunoUpgradeEnvironmentDone
  kivunoUpgradeRestoreTmpValue:
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$kivunoUpgradeOriginalTmp") i .R9'
  kivunoUpgradeEnvironmentDone:
  StrCpy $kivunoUpgradeEnvChanged "0"
  Pop $R9
FunctionEnd

Function uninstallOldVersion
  StrCpy $kivunoUpgradeTemp ""
  StrCpy $kivunoUpgradeEnvChanged "0"
  StrCpy $kivunoUpgradeReady "0"
  Call kivuno.uninstallOldVersionInner
  # Preserve upstream's error/exit result across environment restoration and cleanup.
  StrCpy $kivunoUpgradeHadErrors "0"
  IfErrors 0 +2
    StrCpy $kivunoUpgradeHadErrors "1"
  StrCpy $kivunoUpgradeResult $R0
  Call kivuno.restoreUpgradeEnvironment
  StrCmp $kivunoUpgradeReady "-1" kivunoUpgradePreparationError
  StrCmp $kivunoUpgradeReady "1" 0 kivunoUpgradeFinished
  StrCmp $kivunoUpgradeHadErrors "0" 0 kivunoUpgradeKeepRecovery
  StrCmp $kivunoUpgradeResult "0" 0 kivunoUpgradeKeepRecovery
    # Only the unique sibling created by GetTempFileName; never the parent/installation.
    RMDir /r "$kivunoUpgradeTemp"
    Goto kivunoUpgradeFinished
  kivunoUpgradeKeepRecovery:
    DetailPrint "Upgrade recovery directory: $kivunoUpgradeTemp"
    Goto kivunoUpgradeFinished
  kivunoUpgradePreparationError:
    # No uninstaller was executed. Remove only our empty temporary directory, if any.
    StrCmp $kivunoUpgradeTemp "" +3
      Delete "$kivunoUpgradeTemp"
      RMDir "$kivunoUpgradeTemp"
    MessageBox MB_OK|MB_ICONSTOP "Kivuno cannot prepare the upgrade on the existing installation drive. Check that its parent folder is writable and has free space, then try again." /SD IDOK
    SetErrorLevel 2
    Quit
  kivunoUpgradeFinished:
  StrCpy $R0 $kivunoUpgradeResult
  StrCmp $kivunoUpgradeHadErrors "1" 0 +3
    SetErrors
    Return
  ClearErrors
FunctionEnd
`;

export function patchUpgradeStaging(source) {
  source = replaceOnce(
    source,
    'Function uninstallOldVersion\n',
    'Function kivuno.uninstallOldVersionInner\n',
  );
  source = replaceOnce(
    source,
    '  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"',
    `  Call kivuno.prepareUpgradeTemp
  StrCmp $kivunoUpgradeReady "1" +3
    StrCpy $R0 1
    Return
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"`,
  );
  // Forward references allow these helpers to use globals declared by upstream's inner function.
  return declarations + '\n' + source + '\n' + helpers;
}

export async function writeUpgradeStaging(directory) {
  const source = await readFile(path.join(nsisTemplatesDir, 'include/installUtil.nsh'), 'utf8');
  const target = path.join(directory, 'kivuno-install-util.nsh');
  await writeFile(target, patchUpgradeStaging(source.replaceAll('\r\n', '\n')));
  return target;
}
