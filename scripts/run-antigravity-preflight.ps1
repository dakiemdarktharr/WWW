$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (!$IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or !$env:RUNNER_TEMP) {
    throw 'Use a fresh GitHub-hosted Windows runner.'
}

$tag = [guid]::NewGuid().ToString('N')
$accountName = 'kivuno-ci-' + $tag.Substring(0, 10)
$publicProfile = (Get-Item -LiteralPath $env:PUBLIC).FullName
$fixture = (New-Item -ItemType Directory -Path (Join-Path $publicProfile "kivuno-antigravity-$tag")).FullName
$account = $null
try {
    $data = (New-Item -ItemType Directory -Path (Join-Path $fixture 'data')).FullName
    Copy-Item -LiteralPath (Get-Command node.exe -CommandType Application).Source -Destination (Join-Path $fixture 'node.exe')
    $bundle = Join-Path $fixture 'preflight.mjs'
    & ./node_modules/.bin/esbuild.cmd ./scripts/verify-antigravity-preflight.ts --bundle --platform=node --target=node24 --format=esm "--outfile=$bundle"
    if ($LASTEXITCODE -ne 0) { throw 'Could not bundle the managed adapter preflight.' }

    $uri = 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.13-5999302598852608/windows-x64/cli_windows_x64.exe'
    Invoke-WebRequest -Uri $uri -OutFile (Join-Path $fixture 'antigravity.exe') -MaximumRedirection 0 -TimeoutSec 120
    $bootstrap = Join-Path $fixture 'preflight.ps1'
    @'
param([Parameter(Mandatory)][string] $ExpectedSid)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.User.Value -ne $ExpectedSid -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    !(Test-Path -LiteralPath "Registry::HKEY_USERS\$ExpectedSid")) {
    exit 1
}
$env:GITHUB_ACTIONS = 'true'
$env:RUNNER_ENVIRONMENT = 'github-hosted'
$env:RUNNER_TEMP = Join-Path $PSScriptRoot 'data'
$evidence = & (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'preflight.mjs') (Join-Path $PSScriptRoot 'antigravity.exe')
$status = $LASTEXITCODE
$evidence | Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'result.json') -Encoding utf8
exit $status
'@ | Set-Content -LiteralPath $bootstrap -Encoding utf8

    $password = ConvertTo-SecureString ('Ac7!' + [guid]::NewGuid().ToString('N')) -AsPlainText -Force
    $account = New-LocalUser -Name $accountName -Password $password -Description 'Temporary signed CLI verification'
    $usersGroup = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
    if ($account.SID.Value -notin (Get-LocalGroupMember -SID $usersGroup).SID.Value) {
        Add-LocalGroupMember -SID $usersGroup -Member $account
    }
    $sid = $account.SID.Value
    $runnerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $fixture /grant "*${runnerSid}:(OI)(CI)F" "*${sid}:(OI)(CI)RX" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant the temporary account read access.' }
    & icacls.exe $fixture /inheritance:r /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not isolate preflight fixture permissions.' }
    & icacls.exe $data /grant "*${sid}:(OI)(CI)M" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant the temporary account scratch space.' }

    $credential = [pscredential]::new("$env:COMPUTERNAME\$accountName", $password)
    $child = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -Credential $credential `
        -LoadUserProfile -UseNewEnvironment -WindowStyle Hidden -WorkingDirectory $fixture -PassThru -Wait `
        -ArgumentList ('-NoLogo', '-NoProfile', '-NonInteractive', '-File', ('"{0}"' -f $bootstrap), $sid)
    $status = $child.ExitCode
    $child.Dispose()
    $resultFile = Join-Path $data 'result.json'
    if (!(Test-Path -LiteralPath $resultFile -PathType Leaf)) {
        throw 'The isolated Windows identity did not produce preflight evidence.'
    }
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json -AsHashtable
    if ($result.provider -ne 'antigravity' -or $result.passed -isnot [bool]) {
        throw 'Unexpected signed CLI verification result.'
    }
    $result.isolatedWindowsIdentity = $true
    $evidence = ConvertTo-Json -InputObject $result -Depth 4 -Compress
    $evidence | Write-Output
    if ($status -ne 0 -or !$result.passed) { throw 'Antigravity managed startup preflight failed.' }
    $evidence | Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'antigravity-preflight.json') -Encoding utf8
} finally {
    try {
        if ($account) {
            Remove-LocalUser -SID $account.SID
            $profile = Get-CimInstance -ClassName Win32_UserProfile -Filter "SID = '$($account.SID.Value)'"
            if ($profile -and !$profile.Special -and !$profile.Loaded) { Remove-CimInstance -InputObject $profile }
        }
    } finally {
        $folder = Get-Item -LiteralPath $fixture
        if ($folder.Parent.FullName -ne $publicProfile -or $folder.Name -ne "kivuno-antigravity-$tag" -or
            $folder.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
            throw 'Unexpected preflight fixture directory.'
        }
        Remove-Item -LiteralPath $folder.FullName -Recurse -Force
    }
}
