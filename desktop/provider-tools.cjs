'use strict';

const { spawn } = require('node:child_process');
const { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const definitions = Object.freeze({
  codex: {
    package: '@openai/codex',
    version: '0.166.0',
    entry: path.join('@openai', 'codex', 'bin', 'codex.js'),
    officialName: 'Codex',
  },
  claude: {
    command: 'claude',
    officialName: 'Claude Code',
    urls: {
      posix: 'https://claude.ai/install.sh',
      win32: 'https://claude.ai/install.ps1',
    },
    hosts: ['claude.ai', 'claude.com', 'downloads.claude.ai'],
  },
  antigravity: {
    command: 'agy',
    officialName: 'Antigravity CLI',
    urls: {
      posix: 'https://antigravity.google/cli/install.sh',
      win32: 'https://antigravity.google/cli/install.ps1',
    },
    hosts: ['antigravity.google', 'storage.googleapis.com'],
  },
});

const installing = new Map();
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 6 * 60 * 1000;

function configuration(provider) {
  if (typeof provider !== 'string' || !Object.hasOwn(definitions, provider))
    throw new Error('Choose a supported Kivuno provider.');
  const value = definitions[provider];
  return value;
}

function environmentPath(env = process.env) {
  const value = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  return value.split(path.delimiter).filter(Boolean);
}

function namedCandidates(provider, env = process.env) {
  const config = configuration(provider);
  if (!config.command) return [];
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const fixed =
    provider === 'antigravity'
      ? process.platform === 'win32'
        ? [
            path.join(
              env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
              'agy',
              'bin',
              'agy.exe',
            ),
          ]
        : [path.join(home, '.local', 'bin', 'agy')]
      : process.platform === 'win32'
        ? [path.join(home, '.local', 'bin', 'claude.exe')]
        : [
            path.join(home, '.local', 'bin', 'claude'),
            path.join(home, '.claude', 'local', 'claude'),
          ];
  const pathEntries = environmentPath(env).map((directory) =>
    path.join(
      directory.replace(/^"|"$/g, ''),
      process.platform === 'win32' ? `${config.command}.exe` : config.command,
    ),
  );
  return [...new Set([...fixed, ...pathEntries])];
}

async function isFile(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function findExecutable(provider, env = process.env) {
  for (const candidate of namedCandidates(provider, env))
    if (path.isAbsolute(candidate) && (await isFile(candidate))) return candidate;
  return '';
}

async function findPathExecutable(command, env = process.env) {
  const filename = process.platform === 'win32' ? `${command}.exe` : command;
  for (const directory of environmentPath(env)) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), filename);
    if (path.isAbsolute(candidate) && (await isFile(candidate))) return candidate;
  }
  return '';
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      shell: false,
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('The provider setup took too long.'));
    }, options.timeout || 20000);
    child.once('error', () =>
      finish(new Error(`Could not start ${options.label || 'provider setup'}.`)),
    );
    child.once('close', (code) =>
      code === 0
        ? finish()
        : finish(new Error(`${options.label || 'Provider setup'} did not complete successfully.`)),
    );
  });
}

async function verify(command, provider) {
  if (!(await isFile(command)))
    throw new Error(`${configuration(provider).officialName} was not installed.`);
  try {
    await run(command, ['--version'], { label: `${configuration(provider).officialName} check` });
  } catch {
    throw new Error(
      `${configuration(provider).officialName} is present but could not start. Resolve that installation, then try again.`,
    );
  }
}

async function downloadInstaller(url, hosts) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.port ||
      current.username ||
      current.password ||
      !hosts.includes(current.hostname)
    )
      throw new Error('The official provider installer used an unapproved download address.');
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { Accept: 'text/plain, application/octet-stream, */*' },
      signal: AbortSignal.timeout(45000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3)
        throw new Error('The provider installer redirected too many times.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error('Could not download the official provider installer.');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_INSTALLER_BYTES) {
      await response.body?.cancel();
      throw new Error('The provider installer exceeded its size limit.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The provider installer response was empty.');
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_INSTALLER_BYTES) {
        await reader.cancel();
        throw new Error('The provider installer exceeded its size limit.');
      }
      chunks.push(Buffer.from(part.value));
    }
    const source = Buffer.concat(chunks);
    if (!source.length || source.length > MAX_INSTALLER_BYTES)
      throw new Error('The provider installer is empty or too large.');
    const text = source.toString('utf8');
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text) || text.includes('\u0000'))
      throw new Error('The provider download was not an installer script.');
    return source;
  }
  throw new Error('Could not download the official provider installer.');
}

async function runOfficialInstaller(provider, context) {
  const config = configuration(provider);
  const platformKey = process.platform === 'win32' ? 'win32' : 'posix';
  const url = config.urls?.[platformKey];
  if (!url) throw new Error(`${config.officialName} cannot be installed on this operating system.`);
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error(`${config.officialName} requires a 64-bit x64 or ARM64 computer.`);
  const script = await downloadInstaller(url, config.hosts);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kivuno-provider-install-'));
  const filename = path.join(
    directory,
    process.platform === 'win32' ? 'install.ps1' : 'install.sh',
  );
  try {
    await writeFile(filename, script, { mode: 0o600, flag: 'wx' });
    if (process.platform === 'win32') {
      await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', filename],
        {
          cwd: os.homedir(),
          env: context.environment,
          label: `${config.officialName} installer`,
          timeout: INSTALL_TIMEOUT_MS,
        },
      );
    } else {
      await run('/bin/bash', [filename], {
        cwd: os.homedir(),
        env: context.environment,
        label: `${config.officialName} installer`,
        timeout: INSTALL_TIMEOUT_MS,
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const command = await findExecutable(provider, context.environment);
  if (!command) throw new Error(`${config.officialName} installed but is not available to Kivuno.`);
  await verify(command, provider);
}

async function safePrivateDirectory(directory) {
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
    throw new Error('Kivuno provider storage cannot use a symbolic link.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new Error('Kivuno provider storage cannot use a symbolic link.');
}

function runtimeEnvironment(env = process.env) {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'APPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key.toUpperCase())));
}

async function installBundledProvider(provider, context) {
  const config = configuration(provider);
  const target = path.join(context.providerHome, provider);
  await safePrivateDirectory(target);
  await safePrivateDirectory(path.join(context.providerHome, 'npm-cache'));
  const npmCli = path.join(context.root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!(await isFile(context.node)) || !(await isFile(npmCli)))
    throw new Error(
      `Kivuno cannot restore ${config.officialName} because its repair runtime is missing.`,
    );
  const npmConfig = path.join(target, 'kivuno.npmrc');
  const npmConfigContents =
    'registry=https://registry.npmjs.org/\nstrict-ssl=true\nignore-scripts=true\n';
  try {
    await writeFile(npmConfig, npmConfigContents, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await lstat(npmConfig);
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      (await readFile(npmConfig, 'utf8')) !== npmConfigContents
    )
      throw new Error('Kivuno provider storage contains an invalid npm configuration.');
  }
  const env = {
    ...runtimeEnvironment(context.environment),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_strict_ssl: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_userconfig: npmConfig,
    npm_config_cache: path.join(context.providerHome, 'npm-cache'),
  };
  const modules = path.join(target, 'node_modules');
  try {
    const modulesInfo = await lstat(modules);
    if (modulesInfo.isSymbolicLink() || !modulesInfo.isDirectory())
      throw new Error('Kivuno provider storage cannot use a symbolic link.');
    await rm(modules, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    const filename = path.join(target, name);
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Kivuno provider storage contains an unexpected file.');
      await rm(filename, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    await run(
      context.node,
      [
        npmCli,
        'install',
        '--prefix',
        target,
        '--no-save',
        '--package-lock=false',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--registry=https://registry.npmjs.org/',
        `${config.package}@${config.version}`,
      ],
      { cwd: target, env, label: `${config.officialName} installer`, timeout: INSTALL_TIMEOUT_MS },
    );
  } catch {
    throw new Error(
      `Kivuno could not install the official ${config.officialName} runtime. Check your internet connection and retry.`,
    );
  }
  const entry = path.join(target, 'node_modules', config.entry);
  if (!(await isFile(entry)))
    throw new Error(`The installed ${config.officialName} runtime is incomplete.`);
  try {
    await run(context.node, [entry, '--version'], {
      cwd: context.root,
      env: context.environment,
      label: `${config.officialName} check`,
    });
  } catch {
    throw new Error(`The installed ${config.officialName} runtime failed its version check.`);
  }
}

async function performPreparation(provider, context) {
  const config = configuration(provider);
  if (config.command) {
    const command = await findExecutable(provider, context.environment);
    if (command) {
      await verify(command, provider);
      return { provider, installed: false };
    }
    await runOfficialInstaller(provider, context);
    return { provider, installed: true };
  }

  const bundledEntry = path.join(context.root, 'node_modules', config.entry);
  if ((await isFile(bundledEntry)) && (await isFile(context.node))) {
    try {
      await run(context.node, [bundledEntry, '--version'], {
        cwd: context.root,
        env: context.environment,
        label: `${config.officialName} check`,
      });
      return { provider, installed: false };
    } catch {
      /* A missing or damaged packaged CLI is repaired into Kivuno's private runtime below. */
    }
  }

  if (provider === 'codex') {
    const systemCommand = await findPathExecutable('codex', context.environment);
    if (systemCommand) {
      try {
        await verify(systemCommand, provider);
        return { provider, installed: false };
      } catch {
        /* Replace a broken PATH copy with Kivuno's pinned private runtime. */
      }
    }
  }

  const privateEntry = path.join(context.providerHome, provider, 'node_modules', config.entry);
  if (await isFile(privateEntry)) {
    try {
      await run(context.node, [privateEntry, '--version'], {
        cwd: context.root,
        env: context.environment,
        label: `${config.officialName} check`,
      });
      return { provider, installed: false };
    } catch {
      /* Replace an incomplete private repair on the next npm install. */
    }
  }

  await installBundledProvider(provider, context);
  return { provider, installed: true };
}

function prepareProvider(provider, context) {
  configuration(provider);
  if (installing.has(provider)) return installing.get(provider);
  const preparation = performPreparation(provider, context).finally(() =>
    installing.delete(provider),
  );
  installing.set(provider, preparation);
  return preparation;
}

module.exports = { findExecutable, prepareProvider };
