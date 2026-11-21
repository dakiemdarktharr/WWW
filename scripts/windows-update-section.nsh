# Only the desktop updater supplies a verified installer in its own staging directory.
# Manual installs still use the stock install section.
${If} ${Silent}
${AndIf} ${isUpdated}
  ReadEnvStr $0 KIVUNO_UPDATE_FILE
  StrCmp $0 "" kivunoNormalInstall
  StrCmp $0 "$EXEPATH" 0 kivunoUpdateFailed
  StrCmp $installMode "CurrentUser" 0 kivunoUpdateFailed
  ${If} ${UAC_IsAdmin}
    Goto kivunoUpdateFailed
  ${EndIf}
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  GetFullPathName $1 "$INSTDIR"
  StrCmp $0 "$1" 0 kivunoUpdateFailed
  ReadEnvStr $0 KIVUNO_UPDATE_APP
  StrCmp $0 "$1\Kivuno.exe" 0 kivunoUpdateFailed
  # Release any working-directory handle on the existing installation.
  SetOutPath "$PLUGINSDIR"
  ReadEnvStr $0 KIVUNO_UPDATE_LIVE
  StrCmp $0 "1" +2
    Banner::show /NOUNLOAD "Kivuno" "Updating Kivuno. The app will reopen automatically."
  !ifdef COMPRESS
    SetCompress off
  !endif
  File "/oname=kivuno-update.7z" "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif
  File "/oname=Uninstall Kivuno.exe" "${UNINSTALLER_OUT_FILE}"
  File "/oname=uninstallerIcon.ico" "${UNINSTALLER_ICON}"
  File "/oname=switch-kivuno.ps1" "${KIVUNO_SWITCH_SCRIPT}"
  StrCpy $1 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  nsExec::Exec '"$1" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "$PLUGINSDIR\switch-kivuno.ps1"'
  Pop $0
  StrCmp $0 "0" 0 kivunoUpdateFailed
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion "${VERSION}"
  SetErrorLevel 0
  Quit
  kivunoUpdateFailed:
    SetErrorLevel 1
    Quit
${EndIf}
kivunoNormalInstall:
