// Windows PowerShell exits without running its command in a detached console.
// The GUI script host starts it hidden and survives the original desktop process.
var shell = new ActiveXObject('WScript.Shell');
var environment = shell.Environment('Process');
var command =
  '"' +
  environment('KIVUNO_UPDATE_POWERSHELL') +
  '" -NoProfile -NonInteractive -EncodedCommand ' +
  environment('KIVUNO_UPDATE_COMMAND');
WScript.Quit(shell.Run(command, 0, true));
