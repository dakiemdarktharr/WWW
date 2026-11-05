import { patchUpgradeStaging } from '../scripts/nsis-upgrade-staging.mjs';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';
import { nsisTemplatesDir } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';
import { mkdtemp, mkdir, writeFile, readFile, access, realpath, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
if (process.platform !== 'win32') {
  console.log('NSIS upgrade runtime probe requires Windows; no installer was run.');
  process.exit(0);
}
await mkdir('.local', { recursive: true });
const container = await realpath('.local');
const root = await mkdtemp(path.join(container, 'nsis-upgrade-probe-'));
try {
  const old = path.join(root, 'old install');
  await mkdir(old);
  const upstream = await readFile(path.join(nsisTemplatesDir, 'include/installUtil.nsh'), 'utf8');
  const getParent = upstream.slice(
    upstream.indexOf('Function GetFileParent'),
    upstream.indexOf('FunctionEnd', upstream.indexOf('Function GetFileParent')) +
      'FunctionEnd'.length,
  );
  const childScript = path.join(root, 'child.ps1');
  await writeFile(
    childScript,
    `[IO.File]::WriteAllText('${path.join(root, 'child-temp.txt').replaceAll("'", "''")}', $env:TEMP + [Environment]::NewLine + $env:TMP)`,
  );
  const compiler = await getMakeNsisPath();
  for (const code of [0, 17, -1]) {
    const report = path.join(root, `parent-${code}.txt`),
      exe = path.join(root, `probe-${code}.exe`),
      script = path.join(root, `probe-${code}.nsi`);
    const oldDirectory = code === -1 ? path.join(root, 'missing parent', 'old install') : old;
    await rm(path.join(root, 'child-temp.txt'), { force: true });
    const source = String.raw`Unicode true
Name "Kivuno upgrade probe"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
Var /GLOBAL installationDir
Var /GLOBAL uninstallerFileNameTemp
${getParent}
Function uninstallOldVersion
  StrCpy $installationDir "${oldDirectory}"
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\old-uninstaller.exe"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -File "${childScript}"' $R0
  StrCpy $R0 ${code}
FunctionEnd
Section
  InitPluginsDir
  Call uninstallOldVersion
  ReadEnvStr $0 TEMP
  ReadEnvStr $1 TMP
  FileOpen $2 "${report}" w
  FileWrite $2 "$0$\n$1$\n$R0"
  FileClose $2
SectionEnd
`;
    await writeFile(script, patchUpgradeStaging(source));
    await run(compiler.path, ['-V2', script], {
      env: { ...process.env, ...compiler.env },
      windowsHide: true,
      timeout: 30000,
    });
    if (code === -1) {
      await assert.rejects(
        run(exe, [], { windowsHide: true, timeout: 30000 }),
        (error) => error.code === 2,
      );
      await assert.rejects(access(path.join(root, 'child-temp.txt')));
      await assert.rejects(access(report));
      console.log(
        JSON.stringify({
          preparationFailure: true,
          oldUninstallerNotStarted: true,
          exitedWithError: 2,
        }),
      );
      continue;
    }
    await run(exe, [], { windowsHide: true, timeout: 30000 });
    const restored = (await readFile(report, 'utf8')).trim().split(/\r?\n/);
    assert.equal(restored[0], process.env.TEMP);
    assert.equal(restored[1], process.env.TMP);
    assert.equal(restored[2], String(code));
    const staged = (await readFile(path.join(root, 'child-temp.txt'), 'utf8'))
      .trim()
      .split(/\r?\n/);
    assert.equal(staged[0], staged[1]);
    assert.equal(path.dirname(staged[0]), root);
    assert.notEqual(staged[0], old);
    if (code === 0) await assert.rejects(access(staged[0]));
    else await access(staged[0]);
    console.log(
      JSON.stringify({
        probeCode: code,
        compiled: true,
        childUsesOldDriveTemp: true,
        environmentRestored: true,
        exitCodePreserved: true,
        stageCleaned: code === 0,
        recoveryRetained: code !== 0,
      }),
    );
  }
} finally {
  assert.equal(path.dirname(await realpath(root)), container);
  assert.ok(path.basename(root).startsWith('nsis-upgrade-probe-'));
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
