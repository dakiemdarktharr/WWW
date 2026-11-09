import { patchUpgradeStaging } from '../scripts/nsis-upgrade-staging.mjs';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';
import { nsisTemplatesDir } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';
import { mkdtemp, mkdir, writeFile, readFile, access, realpath, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
if (process.platform !== 'win32') {
  console.log('NSIS upgrade runtime probe requires Windows; no installer was run.');
  process.exit(0);
}
await mkdir('.local', { recursive: true });
const container = await realpath('.local');
const root = await mkdtemp(path.join(container, 'kivuno-upgrade-probe-'));
const temporaryRoots = [root];
try {
  const old = path.join(root, 'old install');
  await mkdir(old);
  const oldUninstaller = path.join(old, 'Uninstall Kivuno.exe');
  await writeFile(oldUninstaller, 'probe');
  const fakeUninstaller = path.join(root, 'existing-uninstaller.exe');
  await writeFile(fakeUninstaller, 'probe');
  const sameVolumeRoot = await mkdtemp(path.join(os.tmpdir(), 'kivuno-upgrade-same-volume-'));
  temporaryRoots.push(sameVolumeRoot);
  const sameVolumeInstall = path.join(sameVolumeRoot, 'old install');
  await mkdir(sameVolumeInstall);
  const sameVolumeUninstaller = path.join(sameVolumeInstall, 'Uninstall Kivuno.exe');
  await writeFile(sameVolumeUninstaller, 'probe');
  const upstream = await readFile(path.join(nsisTemplatesDir, 'include/installUtil.nsh'), 'utf8');
  const getParent = upstream.slice(
    upstream.indexOf('Function GetFileParent'),
    upstream.indexOf('FunctionEnd', upstream.indexOf('Function GetFileParent')) +
      'FunctionEnd'.length,
  );
  const childScript = path.join(root, 'child.cjs');
  const childOutput = path.join(root, 'child-temp.txt');
  await writeFile(
    childScript,
    `require('node:fs').writeFileSync(${JSON.stringify(childOutput)}, process.env.TEMP + String.fromCharCode(10) + process.env.TMP);`,
  );
  const compiler = await getMakeNsisPath();
  for (const code of [0, 17, -1, -2, 25]) {
    const report = path.join(root, `parent-${code}.txt`),
      exe = path.join(root, `probe-${code}.exe`),
      script = path.join(root, `probe-${code}.nsi`);
    const oldDirectory =
      code === -1
        ? path.join(root, 'missing parent', 'old install')
        : code === -2
          ? path.join(root, 'orphaned install')
          : code === 25
            ? sameVolumeInstall
            : old;
    const uninstaller =
      code === -1
        ? fakeUninstaller
        : code === -2
          ? path.join(oldDirectory, 'Uninstall Kivuno.exe')
          : code === 25
            ? sameVolumeUninstaller
            : oldUninstaller;
    const returnCode = code === 25 ? 0 : code;
    await rm(path.join(root, 'child-temp.txt'), { force: true });
    const source = String.raw`Unicode true
Name "Kivuno upgrade probe"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
Var /GLOBAL installationDir
Var /GLOBAL uninstallerFileNameTemp
Var /GLOBAL uninstallerFileName
${getParent}
Function uninstallOldVersion
  StrCpy $R0 0
  StrCpy $installationDir "${oldDirectory}"
  StrCpy $uninstallerFileName "${uninstaller}"
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\old-uninstaller.exe"
  StrCpy $R1 99
  ExecWait '"${process.execPath}" "${childScript}"' $R1
  StrCpy $R0 ${returnCode}
FunctionEnd
Section
  InitPluginsDir
  Call uninstallOldVersion
  ReadEnvStr $0 TEMP
  ReadEnvStr $1 TMP
  FileOpen $2 "${report}" w
  FileWrite $2 "$0$\n$1$\n$R0$\n$kivunoUpgradeReady$\n$R1"
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
      const invalidTemp = path.join(root, 'missing-temp');
      await assert.rejects(
        run(exe, [], {
          windowsHide: true,
          timeout: 30000,
          env: { ...process.env, TEMP: invalidTemp, TMP: invalidTemp },
        }),
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
    if (code === -2) {
      await run(exe, [], { windowsHide: true, timeout: 30000 });
      const reportValues = (await readFile(report, 'utf8')).trim().split(/\r?\n/);
      assert.equal(reportValues[0], process.env.TEMP);
      assert.equal(reportValues[1], process.env.TMP);
      assert.equal(reportValues[2], '0');
      assert.equal(reportValues[3], '0');
      await assert.rejects(access(path.join(root, 'child-temp.txt')));
      console.log(JSON.stringify({ staleUninstallerSkipped: true, installationContinues: true }));
      continue;
    }
    await run(exe, [], { windowsHide: true, timeout: 30000 });
    const restored = (await readFile(report, 'utf8')).trim().split(/\r?\n/);
    assert.equal(restored[0], process.env.TEMP);
    assert.equal(restored[1], process.env.TMP);
    assert.equal(restored[2], String(returnCode));
    assert.equal(restored[3], '1');
    assert.equal(restored[4], '0', 'Child process exit code for case ' + code);
    const staged = (await readFile(path.join(root, 'child-temp.txt'), 'utf8'))
      .trim()
      .split(/\r?\n/);
    assert.equal(staged[0], staged[1]);
    const installRoot = path.parse(path.resolve(oldDirectory)).root.toLowerCase();
    const tempRoot = path.parse(path.resolve(process.env.TEMP)).root.toLowerCase();
    const expectedStageParent = installRoot === tempRoot ? process.env.TEMP : root;
    assert.equal(
      path.resolve(path.dirname(staged[0])).toLowerCase(),
      path.resolve(expectedStageParent).toLowerCase(),
    );
    assert.notEqual(staged[0], old);
    if (returnCode === 0) await assert.rejects(access(staged[0]));
    else {
      await access(staged[0]);
      const recoveryDirectory = await realpath(staged[0]);
      assert.equal(path.dirname(recoveryDirectory), await realpath(expectedStageParent));
      await rm(recoveryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
    console.log(
      JSON.stringify({
        probeCode: code,
        compiled: true,
        sameVolumeTempPreferred: installRoot === tempRoot,
        environmentRestored: true,
        exitCodePreserved: true,
        stageCleaned: returnCode === 0,
        recoveryRetained: returnCode !== 0,
      }),
    );
  }
} finally {
  for (const temporaryRoot of temporaryRoots) {
    if (temporaryRoot === root) {
      assert.equal(path.dirname(await realpath(temporaryRoot)), container);
      assert.ok(path.basename(temporaryRoot).startsWith('kivuno-upgrade-probe-'));
    } else {
      assert.equal(await realpath(path.dirname(temporaryRoot)), await realpath(os.tmpdir()));
      assert.ok(path.basename(temporaryRoot).startsWith('kivuno-upgrade-same-volume-'));
    }
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
