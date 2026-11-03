// Compiles a harmless WriteUninstaller-only intermediate with the pinned NSIS.
// Native Windows output must match the Linux build-only extraction byte-for-byte.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';
import { extractNsisUninstaller } from '../scripts/nsis-uninstaller.mjs';

if (process.platform !== 'win32') throw new Error('Native NSIS parity test requires Windows.');
const execute = promisify(execFile);
const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-nsis-parity-'));
try {
  const tool = await getMakeNsisPath('1.2.1');
  const nsisDirectory = path.join(path.dirname(tool.path), 'windows');
  const compiler = path.join(nsisDirectory, 'makensis.exe');
  const intermediate = path.join(directory, 'intermediate.exe');
  const native = path.join(directory, 'native.exe');
  const extracted = path.join(directory, 'extracted.exe');
  const icon = path.resolve('desktop/icon.ico');
  const script = path.join(directory, 'fixture.nsi');
  await writeFile(
    script,
    `
Unicode true
Name "RELAY packaging parity"
OutFile "${intermediate}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor zlib
Icon "${icon}"
UninstallIcon "${icon}"
Function .onInit
  WriteUninstaller "${native}"
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
Section "Uninstall"
  DetailPrint "RELAY test uninstaller; never executed by this test."
SectionEnd
`,
  );
  await execute(compiler, ['-V2', script], {
    env: { ...process.env, NSISDIR: nsisDirectory },
    windowsHide: true,
    timeout: 30000,
  });
  await execute(intermediate, [], { windowsHide: true, timeout: 30000 });
  await extractNsisUninstaller(intermediate, extracted);
  const expected = await readFile(native);
  const actual = await readFile(extracted);
  assert.deepEqual(actual, expected);
  await assert.rejects(extractNsisUninstaller(intermediate, extracted), /must not exist/);
  const invalid = path.join(directory, 'invalid.exe');
  await writeFile(invalid, Buffer.alloc(2048));
  await assert.rejects(
    extractNsisUninstaller(invalid, path.join(directory, 'rejected.exe')),
    /signature/,
  );
  console.log(
    JSON.stringify({
      nsis: '1.2.1 / 3.12',
      nativeByteParity: true,
      bytes: actual.length,
      sha256: createHash('sha256').update(actual).digest('hex'),
    }),
  );
} finally {
  if (
    path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
    !path.basename(directory).startsWith('relay-nsis-parity-')
  )
    throw new Error('Unexpected NSIS parity directory.');
  await rm(directory, { recursive: true, force: true });
}
