import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AntigravityClient } from '../server/antigravity.ts';
import type { ManagedProcess } from '../server/managed-process.ts';

const version = '1.5.13';
const sha512 =
  '6b80a17a2bc34a969ed9ba31500a8201b0b4aad3e7fe061374022d161fec8bd7de49b6dc069a6ac67a90632e8671bbe860a7e94309bc5adbc536d27a75a86b58';
const prefix = 'kivuno-antigravity-preflight-';
let phase = 'runner';
let credentialStore:
  'query-failed' | 'contains-entries' | 'unrecognized-output' | 'empty' | undefined;

async function preflight() {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('Use a fresh GitHub-hosted Windows x64 runner.');

  phase = 'artifact';
  const input = process.argv[2];
  if (!input) throw new Error('The pinned CLI artifact is required.');
  const command = await realpath(input);
  if (!command.endsWith('.exe')) throw new Error('Unexpected CLI artifact.');
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(command)) hash.update(chunk);
  if (hash.digest('hex') !== sha512) throw new Error('Unexpected CLI artifact.');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) throw new Error('Windows system root unavailable.');
  const system32 = path.join(systemRoot, 'System32');
  const run = promisify(execFile);
  phase = 'signature';
  // The workflow shell uses PowerShell 7. Let Windows PowerShell load its own built-in modules.
  const signatureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^PSModulePath$/i.test(name)),
  );
  await run(
    path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath $env:KIVUNO_PREFLIGHT_BINARY; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?i)(^|,\s*)(CN|O)=Google LLC(,|$)') { exit 1 }",
    ],
    {
      env: { ...signatureEnv, KIVUNO_PREFLIGHT_BINARY: command },
      timeout: 60_000,
      windowsHide: true,
    },
  );

  phase = 'credential-store';
  // Capture the Windows utility privately and accept only its explicit empty-store result.
  const result = await run(path.join(system32, 'cmdkey.exe'), ['/list'], {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    encoding: 'buffer',
  }).catch(() => undefined);
  if (!result) {
    credentialStore = 'query-failed';
    throw new Error('Credential Manager could not be checked.');
  }
  const utf16 = result.stdout[1] === 0 || (result.stdout[0] === 0xff && result.stdout[1] === 0xfe);
  const credentials = result.stdout.toString(utf16 ? 'utf16le' : 'utf8').trim();
  if (!/^Currently stored credentials:\s*\*\s*NONE\s*\*$/i.test(credentials)) {
    credentialStore = /^\s*Target\s*:/im.test(credentials)
      ? 'contains-entries'
      : 'unrecognized-output';
    throw new Error('Credential Manager must be empty.');
  }
  credentialStore = 'empty';

  phase = 'profile';
  if (!process.env.RUNNER_TEMP) throw new Error('The runner temporary directory is required.');
  const parent = await realpath(process.env.RUNNER_TEMP);
  const fixture = await realpath(await mkdtemp(path.join(parent, prefix)));
  const home = path.join(fixture, 'profile');
  const cwd = path.join(fixture, 'project');
  const appData = path.join(fixture, 'roaming');
  const localData = path.join(fixture, 'local');
  const scratch = path.join(fixture, 'tmp');
  let client: AntigravityClient | undefined;
  let transportError = false;
  let initialized = false;
  let httpMcp = false;
  let authRequired = false;
  const methods: string[] = [];
  let initializeId: number | undefined;
  let sessionId: number | undefined;
  try {
    await Promise.all(
      [home, cwd, appData, localData, scratch].map((directory) => mkdir(directory)),
    );
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      ComSpec: path.join(system32, 'cmd.exe'),
      Path: [system32, systemRoot].join(path.delimiter),
      APPDATA: appData,
      LOCALAPPDATA: localData,
      TEMP: scratch,
      TMP: scratch,
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    });
    client = new AntigravityClient({ home, cwd, command });
    client.on('error', () => {
      transportError = true;
    });

    // Observe the signed process on the managed adapter's actual transport. The observer
    // keeps fixed evidence fields and never emits ACP payloads or subprocess diagnostics.
    const protocol = client as unknown as {
      transport: ManagedProcess;
      message(value: unknown): void;
    };
    const write = protocol.transport.write.bind(protocol.transport);
    const receive = protocol.message.bind(client);
    protocol.transport.write = (value) => {
      const frame = value as {
        jsonrpc?: string;
        id?: number;
        method?: string;
        params?: { cwd?: string; mcpServers?: unknown[] };
      } | null;
      const expected = ['initialize', 'session/new'][methods.length];
      if (
        !expected ||
        frame?.jsonrpc !== '2.0' ||
        typeof frame.id !== 'number' ||
        frame.method !== expected
      )
        throw new Error('Unexpected ACP request during preflight.');
      if (
        expected === 'session/new' &&
        (frame.params?.cwd !== path.join(home, 'controlled-workspace') ||
          !Array.isArray(frame.params?.mcpServers) ||
          frame.params.mcpServers.length !== 0)
      )
        throw new Error('Unexpected workspace or tools during preflight.');
      methods.push(expected);
      if (expected === 'initialize') initializeId = frame.id;
      else sessionId = frame.id;
      write(value);
    };
    protocol.message = (value) => {
      const reply = value as {
        jsonrpc?: string;
        id?: number;
        result?: {
          protocolVersion?: number;
          agentInfo?: { name?: string };
          agentCapabilities?: { mcpCapabilities?: { http?: boolean } };
          authMethods?: { id?: string }[];
        };
        error?: { code?: number; message?: string };
      } | null;
      if (reply?.jsonrpc === '2.0' && reply.id !== undefined && reply.id === initializeId) {
        const result = reply.result;
        initialized =
          result?.protocolVersion === 1 &&
          /antigravity/i.test(result.agentInfo?.name || '') &&
          Array.isArray(result.authMethods) &&
          result.authMethods.some((method) => method?.id === 'oauth-personal');
        httpMcp = result?.agentCapabilities?.mcpCapabilities?.http === true;
      }
      if (reply?.jsonrpc === '2.0' && reply.id !== undefined && reply.id === sessionId)
        authRequired =
          reply.error?.code === -32000 &&
          /^authentication required\b/i.test(reply.error.message?.trim() || '');
      receive(value);
    };

    phase = 'initialize';
    await client.start();
    if (!initialized || transportError) throw new Error('Managed ACP initialization failed.');
    phase = 'account-read';
    const { account } = await client.request<{ account: unknown }>('account/read');
    if (account !== null || !authRequired || transportError || methods.length !== 2)
      throw new Error(
        'Managed account-read did not return the expected negative authentication result.',
      );
  } finally {
    const previousPhase = phase;
    phase = 'cleanup';
    await client?.stop();
    if (client?.pid !== undefined) throw new Error('The CLI did not stop.');
    if (
      path.dirname(fixture) !== parent ||
      !path.basename(fixture).startsWith(prefix) ||
      (await realpath(fixture)) !== fixture
    )
      throw new Error('Unexpected fixture directory.');
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    phase = previousPhase;
  }
  return {
    provider: 'antigravity',
    version,
    passed: true,
    credentialManagerEmpty: true,
    authenticodeGoogle: true,
    sha512,
    protocolVersion: 1,
    oauthPersonalAdvertised: true,
    httpMcpAdvertised: httpMcp,
    sessionNewError: { code: -32000, message: 'Authentication required' },
    accountFound: false,
    modelTurns: 0,
    interactiveLogins: 0,
    transportStopped: true,
    temporaryFixtureRemoved: true,
  };
}

try {
  console.log(JSON.stringify(await preflight()));
} catch {
  console.log(
    JSON.stringify({ provider: 'antigravity', version, passed: false, phase, credentialStore }),
  );
  process.exitCode = 1;
}
