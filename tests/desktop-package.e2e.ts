// Smoke-test the distributable executable, not the development Electron runtime.
// No identity login, Codex authentication or model turn is started by this test.
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
const root = path.resolve('release/win-unpacked');
const env = { ...process.env } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
delete env.RELAY_DESKTOP_TESTING;
delete env.RELAY_DESKTOP_DATA_DIR;
delete env.RELAY_CLOUD_ORIGIN;
delete env.RELAY_NODE_BINARY;
for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
env.PATH = [
  systemRoot,
  path.join(systemRoot, 'System32'),
  path.join(systemRoot, 'System32/WindowsPowerShell/v1.0'),
].join(path.delimiter);
const runtime = path.join(root, 'resources/runtime');
const node = await execute(path.join(root, 'resources/runtime/node.exe'), ['--version'], {
  windowsHide: true,
  env,
});
assert.equal(node.stdout.trim(), 'v24.22.1');
const gitEnvironment = {
  ...env,
  PATH: [runtime, path.join(runtime, 'git/cmd'), env.PATH].join(path.delimiter),
};
const git = await execute(
  path.join(runtime, 'node.exe'),
  [
    '-e',
    "process.stdout.write(require('node:child_process').execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }))",
  ],
  { windowsHide: true, env: gitEnvironment },
);
assert.equal(git.stdout.trim(), 'git version 2.56.0.windows.4');
const gitProbe = await mkdtemp(path.join(os.tmpdir(), 'relay-packaged-git-'));
try {
  await writeFile(path.join(gitProbe, 'smoke.txt'), 'Bundled Kivuno Git smoke test.\n');
  await writeFile(path.join(gitProbe, 'empty.gitconfig'), '');
  const commit = await execute(
    path.join(runtime, 'node.exe'),
    [
      '-e',
      `
    const { execFileSync } = require('node:child_process');
    const run = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true });
    run('init', '--initial-branch=smoke');
    run('add', 'smoke.txt');
    run('-c', 'user.name=Kivuno smoke test', '-c', 'user.email=relay-smoke@example.invalid', 'commit', '-m', 'Verify bundled Git');
    process.stdout.write(run('rev-parse', 'HEAD'));
  `,
    ],
    {
      windowsHide: true,
      cwd: gitProbe,
      env: {
        ...gitEnvironment,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(gitProbe, 'empty.gitconfig'),
      },
    },
  );
  assert.match(commit.stdout.trim(), /^[a-f0-9]{40}$/);
} finally {
  if (
    path.dirname(path.resolve(gitProbe)) !== path.resolve(os.tmpdir()) ||
    !path.basename(gitProbe).startsWith('relay-packaged-git-')
  )
    throw new Error('Unexpected Git smoke directory.');
  await rm(gitProbe, { recursive: true, force: true });
}
const codex = await execute(
  path.join(root, 'resources/runtime/node.exe'),
  [path.join(root, 'resources/workspace/node_modules/@openai/codex/bin/codex.js'), '--version'],
  { windowsHide: true, env: gitEnvironment },
);
assert.match(codex.stdout, /codex-cli\s+0\.166\.0/);
let desktop;
const pageErrors: string[] = [];
const rendererDiagnostics: string[] = [];
try {
  desktop = await electron.launch({
    executablePath: path.join(root, 'Kivuno.exe'),
    env,
    timeout: 60000,
  });
  const metadata = await desktop.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.deepEqual(metadata, { name: 'Kivuno', version: '0.4.0', packaged: true });
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const resourceName = (value: string) => {
    try {
      return new URL(value).pathname;
    } catch {
      return 'invalid-url';
    }
  };
  page.on('requestfailed', (request) =>
    rendererDiagnostics.push(
      `failed ${resourceName(request.url())}: ${request.failure()?.errorText}`,
    ),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      rendererDiagnostics.push(`${response.status()} ${resourceName(response.url())}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') rendererDiagnostics.push(`console: ${message.text()}`);
  });
  // firstWindow can precede Electron's initial loadURL; do not reload about:blank.
  await page.waitForURL((url) => url.protocol === 'http:' && url.hostname === '127.0.0.1', {
    timeout: 30000,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean((window as any).relayDesktop), { timeout: 30000 });
  const status = await page.evaluate(() => (window as any).relayDesktop.getStatus());
  assert.equal(await page.evaluate(() => (window as any).relayDesktop.version), metadata.version);
  assert.equal(status.runtime, 'ready');
  assert.equal(status.cloudOrigin, 'https://nosleepclub-relay.vercel.app');
  if (status.signedIn) {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
      timeout: 30000,
    });
  } else {
    await expect(page.getByRole('heading', { name: 'Kivuno', exact: true })).toBeVisible({
      timeout: 30000,
    });
    const signIn = page.getByRole('button', { name: 'Đăng nhập trên web', exact: true });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeEnabled();
    await expect(page.locator('footer')).toContainText(`Kivuno ${metadata.version} · Windows`);
  }
  assert.deepEqual(pageErrors, [], 'The packaged renderer must load without page errors.');
  assert.deepEqual(rendererDiagnostics, [], 'The packaged renderer must load all UI resources.');
  assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
  assert.equal(
    await page.evaluate(() => typeof (window as any).relayDesktop.joinMachine),
    'function',
  );
  assert.equal(
    await page.evaluate(() => typeof (window as any).relayDesktop.openPreview),
    'function',
  );
  const response = await fetch(new URL('/api/session', page.url()));
  assert.equal(response.status, 403);
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/relay-windows-packaged.png' });
  const release = JSON.parse(await readFile('dist/downloads/release.json', 'utf8'));
  assert.equal(release.available, true);
  assert.equal(release.signed, false);
  const installerHash = createHash('sha256');
  let installerBytes = 0;
  for await (const chunk of createReadStream(path.resolve('release', path.basename(release.url)))) {
    installerHash.update(chunk);
    installerBytes += chunk.length;
  }
  assert.equal(installerBytes, release.size);
  assert.equal(installerHash.digest('hex'), release.sha256);
  console.log(
    JSON.stringify({
      packaged: true,
      version: metadata.version,
      bundledNode: node.stdout.trim(),
      bundledCodex: codex.stdout.trim(),
      bundledGit: git.stdout.trim(),
      bundledGitCommit: true,
      inheritedPath: 'Windows system directories only',
      runtime: status.runtime,
      rendererIsolated: true,
      localApiProtected: true,
      renderedUi: status.signedIn ? 'workspace-navigation' : 'Kivuno-sign-in',
      rendererPageErrors: pageErrors.length,
      installerBytes: release.size,
      sha256: release.sha256,
      modelTurns: 0,
    }),
  );
} catch (error) {
  if (desktop) {
    await mkdir('.local', { recursive: true });
    const page = await desktop.firstWindow();
    await page
      .screenshot({ path: '.local/kivuno-packaged-failure.png', timeout: 5000 })
      .catch(() => {});
  }
  if (pageErrors.length) console.error('Packaged renderer errors:', pageErrors);
  if (rendererDiagnostics.length)
    console.error('Packaged renderer diagnostics:', rendererDiagnostics);
  throw error;
} finally {
  if (desktop) await desktop.close();
}
