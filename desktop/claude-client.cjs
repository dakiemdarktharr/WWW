'use strict';

const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { access, mkdir, writeFile } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const path = require('node:path');
const os = require('node:os');
const { findExecutable, prepareProvider } = require('./provider-tools.cjs');
const execute = promisify(execFile);
const quote = (text) => "'" + text.replaceAll("'", "''") + "'";
const shQuote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
const modelId = /^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,159}$/;

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

async function codeModels(context) {
  const command = await findExecutable('claude', context.environment);
  if (!command) throw new Error('Open Claude Code to install it before choosing a model.');
  if (!(await codeStatus(context.environment)).signedIn)
    throw new Error('Sign in in Claude Code to see this account’s models.');
  const directory = path.join(context.providerHome, 'claude-model-catalog');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Only ask the installed CLI for initialization metadata. A visible user
  // terminal owns any later conversation and keeps the client's auth choices.
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [
        '--print',
        '--verbose',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--no-session-persistence',
        '--tools',
        '',
        '--setting-sources',
        '',
        '--settings',
        '{"disableAllHooks":true}',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
      ],
      {
        cwd: directory,
        env: context.environment,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    const requestId = randomUUID();
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let settled = false;
    let bytes = 0;
    const unavailable = () =>
      new Error(
        'Claude Code could not read its model list. Update or reopen Claude Code and try again.',
      );
    function finish(error, models) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output.close();
      child.kill();
      if (error) reject(error);
      else resolve(models);
    }
    const timer = setTimeout(() => finish(unavailable()), 15000);
    child.once('error', () => finish(unavailable()));
    child.once('close', () => finish(unavailable()));
    child.stdin.on('error', () => finish(unavailable()));
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) finish(unavailable());
    });
    output.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message?.type !== 'control_response' || message.response?.request_id !== requestId)
        return;
      const models = message.response.response?.models;
      if (message.response.subtype !== 'success' || !Array.isArray(models)) {
        finish(unavailable());
        return;
      }
      finish(
        null,
        models
          .filter(
            (model) =>
              typeof model?.value === 'string' &&
              modelId.test(model.value) &&
              model.value !== 'default',
          )
          .map(({ value, displayName }) => ({
            model: value,
            displayName:
              typeof displayName === 'string' ? displayName.slice(0, 200) || value : value,
          })),
      );
    });
    child.stdin.write(
      JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'initialize', hooks: {} },
      }) + '\n',
    );
  });
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

async function openCode(context, signIn = false, model) {
  if (model === undefined) await prepareProvider('claude', context);
  const command = await findExecutable('claude', context.environment);
  if (!command) throw new Error('Claude Code installation did not finish. Try again.');
  // A visible official terminal preserves all built-in authentication choices and
  // the CLI's manual callback fallback. No model prompt is sent by this launcher.
  const directory = path.join(context.providerHome, 'claude-launcher');
  await mkdir(directory, { recursive: true });
  const args = signIn ? ['auth', 'login'] : model ? ['--model', model] : [];
  const modelLaunchId = model ? randomUUID() : '';
  if (process.platform === 'win32') {
    const script = path.join(
      directory,
      modelLaunchId ? `model-${modelLaunchId}.ps1` : signIn ? 'sign-in.ps1' : 'open.ps1',
    );
    await writeFile(
      script,
      `Set-Location -LiteralPath ${quote(directory)}\n${modelLaunchId ? 'Remove-Item -LiteralPath $PSCommandPath\n' : ''}& ${quote(command)} ${args.map(quote).join(' ')}\n`,
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
    const script = path.join(
      directory,
      modelLaunchId
        ? `Claude Code ${modelLaunchId}.command`
        : signIn
          ? 'Sign in.command'
          : 'Claude Code.command',
    );
    await writeFile(
      script,
      `#!/bin/sh\ncd ${shQuote(directory)} || exit 1\n${modelLaunchId ? '/usr/bin/unlink "$0"\n' : ''}${[command, ...args].map(shQuote).join(' ')}\n`,
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

async function openCodeModel(context, model) {
  if (model !== null && (typeof model !== 'string' || !modelId.test(model)))
    throw new Error('Choose a Claude Code model from the list.');
  const models = await codeModels(context);
  if (model !== null && !models.some((entry) => entry.model === model))
    throw new Error('This model is no longer available in Claude Code.');
  return openCode(context, false, model);
}

module.exports = { publicStatus, codeStatus, codeModels, openDesktop, openCode, openCodeModel };
