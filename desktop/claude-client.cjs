'use strict';

const { execFile, spawn } = require('node:child_process');
const { access, mkdir, writeFile } = require('node:fs/promises');
const { promisify } = require('node:util');
const path = require('node:path');
const os = require('node:os');
const { findExecutable, prepareProvider } = require('./provider-tools.cjs');
const execute = promisify(execFile);
const quote = (text) => "'" + text.replaceAll("'", "''") + "'";
const shQuote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'";

// Only public status fields cross IPC. Never read the client's credential files.
function publicStatus(value) {
  if (value?.loggedIn !== true) return { installed: true, signedIn: false };
  return {
    installed: true,
    signedIn: true,
    subscription: value.authMethod === 'claude.ai',
    ...(typeof value.email === 'string' ? { email: value.email.slice(0, 254) } : {}),
    ...(typeof value.subscriptionType === 'string'
      ? { plan: value.subscriptionType.slice(0, 80) }
      : {}),
  };
}

async function codeStatus(environment = process.env, timeout = 15000) {
  const command = await findExecutable('claude', environment);
  if (!command) return { installed: false, signedIn: false };
  try {
    const { stdout } = await execute(command, ['auth', 'status'], {
      env: environment,
      windowsHide: true,
      timeout,
      maxBuffer: 64000,
    });
    return publicStatus(JSON.parse(stdout));
  } catch (error) {
    if (error.code === 1) return { installed: true, signedIn: false };
    throw new Error('Claude Code could not verify its sign-in. Open Claude Code and try again.');
  }
}

async function launch(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.unref();
}

async function openDesktop(shell, platform = process.platform, env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const candidates =
    platform === 'win32'
      ? [
          path.join(
            env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
            'AnthropicClaude',
            'claude.exe',
          ),
        ]
      : platform === 'darwin'
        ? ['/Applications/Claude.app', path.join(home, 'Applications', 'Claude.app')]
        : [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
    } catch {
      continue;
    }
    const error = await shell.openPath(candidate);
    if (error)
      throw new Error('Claude Desktop could not open. Try opening it from your applications.');
    return { opened: true };
  }
  throw new Error(
    'Claude Desktop is not installed in its usual location. Install it from claude.com/download, or choose Claude in browser.',
  );
}

async function openCode(context, signIn = false) {
  await prepareProvider('claude', context);
  const command = await findExecutable('claude', context.environment);
  if (!command) throw new Error('Claude Code installation did not finish. Try again.');
  // A visible official terminal preserves all built-in authentication choices and
  // the CLI's manual callback fallback. No model prompt is sent by this launcher.
  const directory = path.join(context.providerHome, 'claude-launcher');
  await mkdir(directory, { recursive: true });
  const args = signIn ? ['auth', 'login'] : [];
  if (process.platform === 'win32') {
    const script = path.join(directory, signIn ? 'sign-in.ps1' : 'open.ps1');
    await writeFile(
      script,
      `Set-Location -LiteralPath ${quote(directory)}\n& ${quote(command)} ${args.map(quote).join(' ')}\n`,
      { mode: 0o600 },
    );
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Start-Process powershell.exe -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',${quote('"' + script + '"')})`,
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096 },
    );
  } else if (process.platform === 'darwin') {
    const script = path.join(directory, signIn ? 'Sign in.command' : 'Claude Code.command');
    await writeFile(
      script,
      `#!/bin/sh\ncd ${shQuote(directory)}\n${[command, ...args].map(shQuote).join(' ')}\n`,
      { mode: 0o700 },
    );
    await execute('open', ['-a', 'Terminal', script], { timeout: 15000 });
  } else {
    for (const terminal of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      try {
        await launch(terminal, [terminal === 'gnome-terminal' ? '--' : '-e', command, ...args]);
        return { opened: true };
      } catch {
        /* Try the next installed terminal. */
      }
    }
    throw new Error('No terminal app was found. Install a terminal to open Claude Code.');
  }
  return { opened: true };
}

module.exports = { publicStatus, codeStatus, openDesktop, openCode };
