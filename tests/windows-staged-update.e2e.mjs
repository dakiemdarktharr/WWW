// Exercise the Windows installer section and desktop handoff with disposable files and registry keys.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';

if (process.platform !== 'win32') throw new Error('Run this check on Windows.');
const run = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno staged update '));
const target = path.join(root, 'installed Kivuno');
const app = path.join(target, 'Kivuno.exe');
const key = 'Software\\KivunoUpdateTest\\' + randomUUID();
const system = process.env.SystemRoot;
const compile = path.join(system, 'Microsoft.NET/Framework/v4.0.30319/csc.exe');
const stagedFiles = path.join(root, 'source');
const archive = path.join(root, 'fixture.7z');
const setup = path.join(root, 'setup.exe');
const section = path.resolve('scripts/windows-update-section.nsh');
const script = path.resolve('scripts/windows-update-switch.ps1');
const icon = path.resolve('desktop/icon.ico');
const exists = (f) =>
  stat(f).then(
    () => true,
    () => false,
  );
const reg = (...args) => run('reg.exe', args, { windowsHide: true });
let parent;
try {
  await mkdir(target);
  for (const dir of ['resources/workspace/dist', 'resources/runtime'])
    await mkdir(path.join(stagedFiles, dir), { recursive: true });
  const source = path.join(root, 'fixture.cs');
  await writeFile(
    source,
    `using System.Reflection;
[assembly: AssemblyFileVersion("0.9.4.0")]
[assembly: AssemblyInformationalVersion("0.9.4")]
class TestApp { static void Main(string[] args) { if(args.Length > 0) System.Threading.Thread.Sleep(120000); } }`,
  );
  await run(compile, ['/nologo', '/target:winexe', '/out:' + app, source]);
  await copyFile(app, path.join(stagedFiles, 'Kivuno.exe'));
  await writeFile(path.join(target, 'Uninstall Kivuno.exe'), 'old uninstaller');
  await writeFile(path.join(target, 'old-marker'), 'original');
  for (const file of [
    'resources/app.asar',
    'resources/runtime/node.exe',
    'resources/workspace/dist/index.html',
  ])
    await writeFile(path.join(stagedFiles, file), 'new payload');
  await run('tar.exe', ['-acf', archive, '-C', stagedFiles, '.']);
  const nsis = await getMakeNsisPath();
  const nsi = path.join(root, 'setup.nsi');
  await writeFile(
    nsi,
    [
      'Unicode true',
      '!include LogicLib.nsh',
      'Name "Kivuno updater fixture"',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      'OutFile "' + setup + '"',
      'Var installMode',
      '!define isUpdated "1 == 1"',
      '!define UAC_IsAdmin "0 == 1"',
      '!define VERSION "0.9.4"',
      '!define INSTALL_REGISTRY_KEY "' + key + '"',
      '!define UNINSTALL_REGISTRY_KEY "' + key + '"',
      '!define APP_64 "' + archive + '"',
      '!define UNINSTALLER_OUT_FILE "' + app + '"',
      '!define UNINSTALLER_ICON "' + icon + '"',
      '!define KIVUNO_SWITCH_SCRIPT "' + script + '"',
      'Section',
      'SetRegView 64',
      'StrCpy $installMode CurrentUser',
      'InitPluginsDir',
      '!include "' + section + '"',
      'SetErrorLevel 3',
      'SectionEnd',
    ].join('\n'),
  );
  await run(nsis.path, ['-V2', nsi], { env: { ...process.env, ...nsis.env }, windowsHide: true });
  await reg('add', 'HKCU\\' + key, '/v', 'InstallLocation', '/d', target, '/f', '/reg:64');
  for (const mode of ['bad-version', 'cancel', 'locked', 'live', 'legacy']) {
    const stage = await mkdtemp(path.join(root, '.kivuno-update-'));
    const installer = path.join(stage, 'Kivuno-Setup.exe');
    await copyFile(setup, installer);
    const live = mode !== 'legacy' && mode !== 'locked';
    if (mode === 'locked')
      parent = spawn(path.join(stagedFiles, 'Kivuno.exe'), ['--hold'], {
        cwd: target,
        stdio: 'ignore',
        windowsHide: true,
      });
    if (live) parent = spawn(app, ['--hold'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const result = run(installer, ['/S', '--updated', '/D=' + target], {
      cwd: root,
      windowsHide: true,
      // NSIS takes the unquoted remainder of the command line after /D=.
      windowsVerbatimArguments: true,
      timeout: 45000,
      env: {
        ...process.env,
        KIVUNO_UPDATE_FILE: installer,
        KIVUNO_UPDATE_APP: app,
        KIVUNO_UPDATE_VERSION: mode === 'bad-version' ? '0.9.5' : '0.9.4',
        KIVUNO_UPDATE_PID: String(parent?.pid || 0),
        KIVUNO_UPDATE_LIVE: live ? '1' : '0',
      },
    }).then(
      () => 0,
      (error) => error.code,
    );
    if (live && mode !== 'bad-version') {
      let finished = false;
      result.then(() => {
        finished = true;
      });
      const until = Date.now() + 30000;
      while (!(await exists(path.join(stage, 'ready'))) && !finished && Date.now() < until)
        await delay(100);
      assert.ok(
        await exists(path.join(stage, 'ready')),
        mode + ' failed to prepare, installer exit ' + (finished ? await result : 'pending'),
      );
      assert.equal(await readFile(path.join(target, 'old-marker'), 'utf8'), 'original');
      assert.equal(parent.exitCode, null);
      await access(path.join(stage, 'next/resources/workspace/dist/index.html'));
      if (mode === 'live') await writeFile(path.join(stage, 'commit'), 'go');
      const exit = once(parent, 'exit');
      parent.kill();
      await exit;
      parent = undefined;
    }
    const code = await result;
    if (parent) {
      const exit = once(parent, 'exit');
      parent.kill();
      await exit;
      parent = undefined;
    }
    if (mode === 'cancel' || mode === 'bad-version' || mode === 'locked') {
      assert.notEqual(code, 0);
      assert.equal(await readFile(path.join(target, 'old-marker'), 'utf8'), 'original');
      assert.equal(await exists(stage + '-previous'), false);
    } else {
      assert.equal(code, 0, mode);
      await access(path.join(target, 'resources/workspace/dist/index.html'));
      assert.equal(
        await readFile(path.join(stage + '-previous', '.kivuno-replaced-by'), 'utf8'),
        app,
      );
    }
    console.log('Passed Windows update:', mode);
  }
} finally {
  parent?.kill();
  await reg('delete', 'HKCU\\' + key, '/f', '/reg:64').catch(() => {});
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('kivuno staged update '))
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
