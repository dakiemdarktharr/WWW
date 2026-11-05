// Tests an official standalone Antigravity CLI without logging in or calling a model.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import type { Project } from '../shared/types.ts';

const binary = process.env.KIVUNO_TEST_ANTIGRAVITY_BINARY;
assert.ok(
  binary && path.isAbsolute(binary),
  'Set KIVUNO_TEST_ANTIGRAVITY_BINARY to the official absolute executable path.',
);
await access(binary);
const temp = await realpath(process.env.KIVUNO_TEST_TMP_DIR || os.tmpdir());
const root = await realpath(await mkdtemp(path.join(temp, 'kivuno-antigravity-native-')));
for (const name of ['state', 'home', 'local', 'roaming', 'temp'])
  await mkdir(path.join(root, name));
const store = new Store(path.join(root, 'state/workspace.db'));
const workspace = new Workspace(store, path.join(root, 'state'), root);
const member = store.addMember({
  name: 'Antigravity verification',
  role: 'reviewer',
  provider: 'antigravity',
  integration: 'external',
});
const project = store.put('project', {
  id: randomUUID(),
  name: 'Antigravity handshake',
  path: root,
  goal: 'Verify local MCP config',
  memberIds: [member.id],
  createdAt: new Date().toISOString(),
} satisfies Project);
const reservation = createServer();
await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const desktopSecret = randomUUID();
const app = await buildApp(workspace, { port, desktopSecret });
const seen = new Set<string>();
app.addHook('preHandler', async (request) => {
  if (request.url === '/api/external-agent/rpc') {
    const message = request.body as { method?: string };
    if (message?.method) seen.add(message.method);
  }
});
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: path.join(root, 'home'),
  USERPROFILE: path.join(root, 'home'),
  GEMINI_CLI_HOME: path.join(root, 'home'),
  LOCALAPPDATA: path.join(root, 'local'),
  APPDATA: path.join(root, 'roaming'),
  TEMP: path.join(root, 'temp'),
  TMP: path.join(root, 'temp'),
  NO_BROWSER: '1',
};
for (const key of Object.keys(env))
  if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH|AWS_|GOOGLE_|GEMINI_API_KEY|VERTEX_)/i.test(key))
    delete env[key];
const run = (args: string[]) =>
  promisify(execFile)(binary, args, {
    cwd: root,
    env,
    windowsHide: true,
    timeout: 45000,
    maxBuffer: 2 * 1024 * 1024,
  });
try {
  await app.listen({ port, host: '127.0.0.1' });
  const headers = { host: `127.0.0.1:${port}`, 'x-relay-desktop': desktopSecret };
  const session = await app.inject({ method: 'GET', url: '/api/session', headers });
  const ownerHeaders = {
    ...headers,
    cookie: session.headers['set-cookie']!.toString().split(';')[0],
    'x-relay-token': session.json().token,
    'content-type': 'application/json',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/external-connections',
    headers: ownerHeaders,
    payload: { memberId: member.id, projectId: project.id },
  });
  assert.equal(created.statusCode, 200);
  const [name, config] = Object.entries(created.json().config.mcpServers)[0] as [
    string,
    { command: string; args: string[]; env: Record<string, string> },
  ];
  const version = (await run(['--version'])).stdout.trim();
  const flags = Object.entries(config.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  await run(['mcp', 'add', ...flags, name, config.command, ...config.args]);
  const listed = await run(['mcp', 'list']);
  assert.ok(
    listed.stdout.includes(name),
    'Official CLI must recognize its isolated MCP registration.',
  );
  const acp = spawn(binary, ['acp'], { cwd: root, env, windowsHide: true, stdio: 'pipe' });
  let stderr = '';
  acp.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const lines = createInterface({ input: acp.stdout });
  let initialized = false;
  const result = await new Promise<{
    initialized: boolean;
    needsLogin: boolean;
    sessionCreated: boolean;
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      acp.kill();
      reject(new Error('Antigravity ACP handshake timed out.'));
    }, 30000);
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.id === 1 && message.result?.protocolVersion) {
        initialized = true;
        acp.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: {
              cwd: root,
              mcpServers: [
                {
                  name,
                  command: config.command,
                  args: config.args,
                  env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
                },
              ],
            },
          }) + '\n',
        );
        return;
      }
      clearTimeout(timeout);
      if (message.id === 2 && message.result?.sessionId) {
        resolve({ initialized, needsLogin: false, sessionCreated: true });
      } else if (/auth|sign.?in|login/i.test(JSON.stringify(message.error)))
        resolve({ initialized, needsLogin: true, sessionCreated: false });
      else reject(new Error('Unexpected Antigravity initialize response.'));
    });
    acp.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    acp.once('exit', () => {
      clearTimeout(timeout);
      if (/auth|sign.?in|login/i.test(stderr))
        resolve({ initialized, needsLogin: true, sessionCreated: false });
      else reject(new Error('Antigravity ACP exited before initialize.'));
    });
    acp.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'kivuno-verification', version: '1' },
        },
      }) + '\n',
    );
  }).finally(() => {
    lines.close();
    acp.stdin.end();
    acp.kill();
  });
  console.log(
    JSON.stringify({
      officialAntigravity: version,
      realCliConfigAccepted: true,
      realMcpInitializeObserved: seen.has('initialize'),
      acpInitialize: result.initialized,
      acpNeedsLogin: result.needsLogin,
      acpSessionCreated: result.sessionCreated,
      isolatedTemporaryConfig: true,
      modelTurns: 0,
      accountLogins: 0,
    }),
  );
} finally {
  await app.close();
  await workspace.close();
  store.close();
  assert.equal(path.dirname(root), temp);
  assert.ok(path.basename(root).startsWith('kivuno-antigravity-native-'));
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}
