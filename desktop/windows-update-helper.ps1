$ErrorActionPreference = 'Stop'
$installer = $env:KIVUNO_UPDATE_FILE
$staging = Split-Path -LiteralPath $installer
$app = $env:KIVUNO_UPDATE_APP
$installDirectory = Split-Path -LiteralPath $app
$failure = $env:KIVUNO_UPDATE_FAILURE
$profilePath = $env:KIVUNO_UPDATE_PROFILE
$readyFile = $env:KIVUNO_UPDATE_READY
$expectedVersion = $env:KIVUNO_UPDATE_VERSION
$parentProcess = Get-Process -Id ([int]$env:KIVUNO_UPDATE_PID) -ErrorAction SilentlyContinue

function Test-KivunoVersion($file) {
  $version = (Get-Item -LiteralPath $file).VersionInfo.ProductVersion
  return $version -eq $expectedVersion -or $version -eq "$expectedVersion.0"
}

function Get-KivunoHash($file) {
  $stream = [IO.File]::OpenRead($file)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

try {
  [IO.File]::WriteAllText($readyFile, 'ready')
  if ($parentProcess -and !$parentProcess.WaitForExit(120000)) {
    [IO.File]::WriteAllText($failure, 'failed')
    exit 1
  }
  if ((Get-KivunoHash $installer) -ne $env:KIVUNO_UPDATE_SHA -or
      !(Test-KivunoVersion $installer)) {
    throw 'Invalid Kivuno installer.'
  }
  # NSIS takes the remainder of the command line as the path after /D=.
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $installer
  $startInfo.Arguments = "/S --updated /D=$installDirectory"
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $installation = [Diagnostics.Process]::Start($startInfo)
  $installation.WaitForExit()
  if ($installation.ExitCode -ne 0 -or !(Test-KivunoVersion $app)) {
    throw 'Kivuno installation failed.'
  }
} catch {
  [IO.File]::WriteAllText($failure, 'failed')
} finally {
  Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $staging 'launch-update.js') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $staging -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $app -PathType Leaf) {
  try {
    if ($profilePath) {
      $escapedProfile = $profilePath -replace '(\\+)$', '$1$1'
      Start-Process -FilePath $app -ArgumentList "--user-data-dir=`"$escapedProfile`"" -WorkingDirectory $installDirectory
    } else {
      Start-Process -FilePath $app -WorkingDirectory $installDirectory
    }
  } catch {
    [IO.File]::WriteAllText($failure, 'failed')
  }
}
