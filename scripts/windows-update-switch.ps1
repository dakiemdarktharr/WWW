# Called only by the per-user installer. Both directories are on the install volume.
$ErrorActionPreference = 'Stop'
$stage = Split-Path -LiteralPath $env:KIVUNO_UPDATE_FILE
$target = Split-Path -LiteralPath $env:KIVUNO_UPDATE_APP
$next = Join-Path $stage 'next'
$previous = $stage + '-previous'
$createdCandidate = $false
$live = $env:KIVUNO_UPDATE_LIVE -eq '1'

function Assert-Directory($directory) {
  $item = Get-Item -LiteralPath $directory -Force
  if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Invalid update directory.'
  }
}

function Test-DirectoryOverlap($left, $right) {
  $left = [IO.Path]::GetFullPath($left).TrimEnd('\') + '\'
  $right = [IO.Path]::GetFullPath($right).TrimEnd('\') + '\'
  return $left.StartsWith($right, [StringComparison]::OrdinalIgnoreCase) -or
    $right.StartsWith($left, [StringComparison]::OrdinalIgnoreCase)
}

try {
  Assert-Directory $stage
  Assert-Directory $target
  if ((Split-Path -LiteralPath $stage) -ne (Split-Path -LiteralPath $target) -or
      (Split-Path $stage -Leaf) -cnotmatch '^\.kivuno-update-[a-zA-Z0-9]{6}$' -or
      !(Test-Path -LiteralPath (Join-Path $target 'Uninstall Kivuno.exe') -PathType Leaf) -or
      (Test-Path -LiteralPath $next) -or (Test-Path -LiteralPath $previous)) {
    throw 'Invalid Kivuno staging layout.'
  }
  if ($live) {
    $parent = Get-Process -Id ([int]$env:KIVUNO_UPDATE_PID)
    if ($parent.Path -ne $env:KIVUNO_UPDATE_APP) { throw 'Unexpected running application.' }
  }
  $profile = $env:KIVUNO_UPDATE_PROFILE
  if (!$profile) { $profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'RELAY' }
  if (![IO.Path]::IsPathRooted($profile)) { throw 'Invalid workspace location.' }
  $profile = [IO.Path]::GetFullPath($profile)
  foreach ($directory in $target, $stage, $previous) {
    if (Test-DirectoryOverlap $profile $directory) { throw 'The installation overlaps workspace data.' }
  }
  New-Item -Path $next -ItemType Directory -ErrorAction Stop | Out-Null
  $createdCandidate = $true
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  & $tar -xf (Join-Path $PSScriptRoot 'kivuno-update.7z') -C $next
  if ($LASTEXITCODE -ne 0) { throw 'The new application could not be extracted.' }
  foreach ($file in 'Uninstall Kivuno.exe','uninstallerIcon.ico') {
    [IO.File]::Copy((Join-Path $PSScriptRoot $file),(Join-Path $next $file))
  }
  foreach ($file in 'Kivuno.exe','resources\app.asar','resources\runtime\node.exe','resources\workspace\dist\index.html') {
    if (!(Test-Path -LiteralPath (Join-Path $next $file) -PathType Leaf)) { throw 'Incomplete update.' }
  }
  $version = (Get-Item -LiteralPath (Join-Path $next 'Kivuno.exe')).VersionInfo.ProductVersion
  if ($version -ne $env:KIVUNO_UPDATE_VERSION -and $version -ne "$($env:KIVUNO_UPDATE_VERSION).0") {
    throw 'Incorrect application version.'
  }
  if ($live) {
    if ($parent.HasExited) { throw 'Update cancelled.' }
    [IO.File]::WriteAllText((Join-Path $stage 'ready'), 'ready')
    if (!$parent.WaitForExit(120000) -or !(Test-Path -LiteralPath (Join-Path $stage 'commit'))) {
      throw 'Update cancelled.'
    }
  }

  # A sharing violation leaves the existing application intact. Retry briefly for closing DLLs.
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { [IO.Directory]::Move($target,$previous); break }
    catch [IO.IOException] { if ($attempt -eq 29) { throw }; Start-Sleep -Milliseconds 300 }
  }
  $receipt = Join-Path $previous '.kivuno-replaced-by'
  $createdReceipt = $false
  try {
    $content = @{
      app = $env:KIVUNO_UPDATE_APP
      version = $env:KIVUNO_UPDATE_VERSION
      profile = $profile
    } | ConvertTo-Json -Compress
    $stream = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew)
    $createdReceipt = $true
    try {
      $data = [Text.Encoding]::UTF8.GetBytes($content)
      $stream.Write($data, 0, $data.Length)
    } finally {
      $stream.Dispose()
    }
    [IO.Directory]::Move($next,$target)
  } catch {
    if ($createdReceipt) {
      try { [IO.File]::Delete($receipt) } catch { }
    }
    [IO.Directory]::Move($previous,$target)
    throw
  }
  # The new app cleans up only after its workspace and window have started successfully.
  exit 0
} catch {
  if ($createdCandidate -and (Test-Path -LiteralPath $next)) {
    $candidatePath = [IO.Path]::GetFullPath($next)
    if ($candidatePath -eq [IO.Path]::Combine([IO.Path]::GetFullPath($stage),'next')) {
      Remove-Item -LiteralPath $candidatePath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  # Keep the previous installation for recovery if Windows prevents restoration.
  exit 1
}
