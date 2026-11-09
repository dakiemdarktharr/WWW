// Keep legacy uninstall rollback on the install volume when possible, including 0.6 uninstallers.
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
Function kivuno.tryUpgradeTemp
  Push $R9
  StrCpy $kivunoUpgradeReady "0"
  StrCpy $kivunoUpgradeTemp ""
  ClearErrors
  GetTempFileName $kivunoUpgradeTemp "$R7"
  IfErrors kivunoTryUpgradeTempFailed
  ClearErrors
  Delete "$kivunoUpgradeTemp"
  IfErrors kivunoTryUpgradeTempDeleteFailed
  ClearErrors
  CreateDirectory "$kivunoUpgradeTemp"
  IfErrors kivunoTryUpgradeTempFailed
  StrCpy $kivunoUpgradeEnvChanged "1"
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$kivunoUpgradeTemp") i .R9'
  StrCmp $R9 0 kivunoTryUpgradeTempEnvironmentFailed
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$kivunoUpgradeTemp") i .R9'
  StrCmp $R9 0 kivunoTryUpgradeTempEnvironmentFailed
  StrCpy $kivunoUpgradeReady "1"
  Goto kivunoTryUpgradeTempDone
  kivunoTryUpgradeTempEnvironmentFailed:
    Call kivuno.restoreUpgradeEnvironment
    RMDir "$kivunoUpgradeTemp"
    Goto kivunoTryUpgradeTempFailed
  kivunoTryUpgradeTempDeleteFailed:
    Delete "$kivunoUpgradeTemp"
  kivunoTryUpgradeTempFailed:
    StrCpy $kivunoUpgradeTemp ""
    StrCpy $kivunoUpgradeReady "0"
  kivunoTryUpgradeTempDone:
  ClearErrors
  Pop $R9
FunctionEnd

Function kivuno.prepareUpgradeTemp
  Push $R7
  Push $R8
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
  ReadEnvStr $kivunoUpgradeOriginalTemp TEMP
  ReadEnvStr $kivunoUpgradeOriginalTmp TMP
  StrCpy $kivunoUpgradeEnvChanged "0"
  # Avoid synced/protected install parents when user TEMP is on the same volume.
  StrCpy $R8 $kivunoUpgradeOldInstall 1
  StrCmp $R8 "\\" kivunoUpgradeTryParentFirst
  StrCpy $R8 $kivunoUpgradeOldInstall 2
  StrCpy $R9 $kivunoUpgradeOriginalTemp 2
  StrCmp $R8 $R9 kivunoUpgradeTryTempFirst kivunoUpgradeTryParentFirst

  kivunoUpgradeTryTempFirst:
    StrCmp $kivunoUpgradeOriginalTemp "" kivunoUpgradeTryParentFirst
    StrCpy $R7 $kivunoUpgradeOriginalTemp
    Call kivuno.tryUpgradeTemp
    StrCmp $kivunoUpgradeReady "1" kivunoUpgradePrepareDone
    StrCpy $R7 $kivunoUpgradeParent
    Call kivuno.tryUpgradeTemp
    StrCmp $kivunoUpgradeReady "1" kivunoUpgradePrepareDone
    Goto kivunoUpgradePrepareFailed

  kivunoUpgradeTryParentFirst:
    StrCpy $R7 $kivunoUpgradeParent
    Call kivuno.tryUpgradeTemp
    StrCmp $kivunoUpgradeReady "1" kivunoUpgradePrepareDone
    StrCmp $kivunoUpgradeOriginalTemp "" kivunoUpgradePrepareFailed
    StrCpy $R7 $kivunoUpgradeOriginalTemp
    Call kivuno.tryUpgradeTemp
    StrCmp $kivunoUpgradeReady "1" kivunoUpgradePrepareDone
    Goto kivunoUpgradePrepareFailed

  kivunoUpgradePrepareDone:
    StrCpy $kivunoUpgradeReady "1"
    Goto kivunoUpgradePreparationFinished
  kivunoUpgradePrepareFailed:
  StrCpy $kivunoUpgradeReady "-1"
  kivunoUpgradePreparationFinished:
  Pop $R9
  Pop $R8
  Pop $R7
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
    MessageBox MB_OK|MB_ICONSTOP "Kivuno could not prepare the upgrade. Check that the installation drive and Windows TEMP folder are writable and have free space, then try again." /SD IDOK
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
    `  IfFileExists "$uninstallerFileName" 0 kivunoUpgradeSkipMissingUninstaller
  Call kivuno.prepareUpgradeTemp
  StrCmp $kivunoUpgradeReady "1" +3
    StrCpy $R0 1
    Return
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"
  Goto kivunoUpgradeHasOldUninstaller
  kivunoUpgradeSkipMissingUninstaller:
    DetailPrint "Previous Kivuno uninstaller was not found; continuing with the installation."
    ClearErrors
    Return
  kivunoUpgradeHasOldUninstaller:`,
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
