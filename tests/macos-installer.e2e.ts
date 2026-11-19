import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';

assert.equal(process.platform, 'darwin', 'The installer smoke test requires macOS.');
assert.equal(process.arch, 'arm64', 'Run the smoke test on Apple Silicon.');
const exec = promisify(execFile);
const release = JSON.parse(await readFile('release/macos-arm64.json', 'utf8'));
const installer = path.resolve(process.argv[2] || path.join('release', release.filename));
const digest = createHash('sha256');
for await (const chunk of createReadStream(installer)) digest.update(chunk);
assert.equal((await stat(installer)).size, release.bytes);
assert.equal(digest.digest('hex'), release.sha256);

const temp = await mkdtemp(path.join(os.tmpdir(), 'kivuno-macos-smoke-'));
const mount = path.join(temp, 'Mounted DMG');
const app = path.join(temp, 'Test Applications', 'Kivuno.app');
const profile = path.join(temp, 'Fresh profile');
const resources = path.join(app, 'Contents', 'Resources');
const runtime = path.join(resources, 'runtime');
const modules = path.join(resources, 'workspace', 'node_modules');
const gitRoot = path.join(runtime, 'git');
const gitBin = path.join(gitRoot, 'bin');
const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
delete env.RELAY_NODE_BINARY;
delete env.RELAY_DESKTOP_TESTING;
delete env.RELAY_DESKTOP_DATA_DIR;
delete env.RELAY_CLOUD_ORIGIN;

let mounted = false;
try {
  await mkdir(mount);
  await mkdir(profile);
  await mkdir(path.dirname(app));
  await exec('/usr/bin/hdiutil', ['verify', installer], { timeout: 120000 });
  await exec('/usr/bin/hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mount,
    installer,
  ]);
  mounted = true;
  await exec('/usr/bin/ditto', [path.join(mount, 'Kivuno.app'), app]);
  await exec('/usr/bin/hdiutil', ['detach', mount]);
  mounted = false;
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 120000 });

  const node = path.join(runtime, 'node');
  assert.equal((await exec(node, ['--version'], { env })).stdout.trim(), 'v24.22.1');
  const codex = await exec(node, [path.join(modules, '@openai/codex/bin/codex.js'), '--version'], {
    env,
    timeout: 30000,
  });
  assert.match(codex.stdout, /codex-cli\s+0\.166\.0/);
  const gemini = await exec(
    node,
    [path.join(modules, '@google/gemini-cli/bundle/gemini.js'), '--version'],
    {
      env: { ...env, GEMINI_CLI_NO_RELAUNCH: '1', NO_BROWSER: '1' },
      timeout: 30000,
    },
  );
  assert.match(gemini.stdout, /0\.66\.0/);

  const project = path.join(temp, 'Git project');
  await mkdir(project);
  const git = (...args: string[]) =>
    exec(path.join(gitBin, 'git'), args, {
      cwd: project,
      env: {
        ...env,
        GIT_EXEC_PATH: path.join(gitRoot, 'libexec', 'git-core'),
        GIT_TEMPLATE_DIR: path.join(gitRoot, 'share', 'git-core', 'templates'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    });
  assert.equal((await git('--version')).stdout.trim(), 'git version 2.56.1');
  await git('init');
  await writeFile(path.join(project, 'probe.txt'), 'Kivuno installer smoke test\n');
  await git('add', 'probe.txt');
  await git(
    '-c',
    'user.name=Kivuno QA',
    '-c',
    'user.email=qa@example.invalid',
    'commit',
    '-m',
    'Smoke test',
  );
  await git('worktree', 'add', '--detach', path.join(temp, 'Git worktree'), 'HEAD');

  const desktop = await electron.launch({
    executablePath: path.join(app, 'Contents', 'MacOS', 'Kivuno'),
    args: [`--user-data-dir=${profile}`],
    env,
    timeout: 60000,
  });
  try {
    const metadata = await desktop.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
    }));
    assert.deepEqual(metadata, { version: release.version, packaged: true });
    const page = await desktop.firstWindow();
    await page.waitForURL((url) => url.protocol === 'http:' && url.hostname === '127.0.0.1', {
      timeout: 30000,
    });
    await expect(page.getByRole('heading', { name: 'Kivuno', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng nhập Kivuno', exact: true })).toBeEnabled();
    const status = await page.evaluate(() => (window as any).relayDesktop.getStatus());
    assert.equal(status.runtime, 'ready');
    assert.equal((await fetch(new URL('/api/session', page.url()))).status, 403);
  } finally {
    await desktop.close();
  }
  console.log(
    `Kivuno ${release.version} DMG verified. Packaged app, Git worktree, Node, Codex and Gemini passed.`,
  );
} finally {
  if (mounted) await exec('/usr/bin/hdiutil', ['detach', mount]);
  await rm(temp, { recursive: true, force: true });
}
