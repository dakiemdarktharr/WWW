// Official Claude Code performs the MCP health check; no provider/model request.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Store } from '../server/store.ts';
import { Workspace } from '../server/service.ts';
import { buildApp } from '../server/app.ts';
import type { Project } from '../shared/types.ts';

const run = promisify(execFile);
const binary =
  process.env.KIVUNO_TEST_CLAUDE_BINARY || path.join(os.homedir(), '.local/bin/claude.exe');
assert.ok(path.isAbsolute(binary), 'Provide an absolute path to the official Claude executable.');
await access(binary);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kivuno-claude-native-')));
const data = path.join(root, 'state');
const home = path.join(root, 'private-claude');
await mkdir(data);
await mkdir(home);
const store = new Store(path.join(data, 'workspace.db'));
const workspace = new Workspace(store, data, root);
const raw = store.addMember({ name: 'Claude native verification', role: 'reviewer' });
const member = store.updateMember(raw.id, { provider: 'claude', integration: 'external' });
const project = store.put('project', {
  id: randomUUID(),
  name: 'Native MCP verification',
  path: root,
  goal: 'Verify MCP connection without model usage',
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
    const body = request.body as { method?: string };
    if (body?.method) seen.add(body.method);
  }
});
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: home,
  HOME: home,
  USERPROFILE: home,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1',
};
for (const key of Object.keys(env))
  if (
    /^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_|AWS_|GOOGLE_|GEMINI_API_KEY|VERTEX_)/i.test(
      key,
    )
  )
    delete env[key];
const execute = (args: string[]) =>
  run(binary, args, {
    cwd: root,
    env,
    windowsHide: true,
    timeout: 45000,
    maxBuffer: 2 * 1024 * 1024,
  });
try {
  await app.listen({ port, host: '127.0.0.1' });
  const headers = { host: `127.0.0.1:${port}`, 'x-relay-desktop': desktopSecret };
  const login = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.equal(login.statusCode, 200);
  const ownerHeaders = {
    ...headers,
    cookie: login.headers['set-cookie']!.toString().split(';')[0],
    'x-relay-token': login.json().token,
    'content-type': 'application/json',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/external-connections',
    headers: ownerHeaders,
    payload: { memberId: member.id, projectId: project.id },
  });
  assert.equal(created.statusCode, 200);
  const connection = created.json();
  const [name, config] = Object.entries(connection.config.mcpServers)[0];
  const version = (await execute(['--version'])).stdout.trim();
  assert.match(version, /Claude Code/);
  await execute(['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(config)]);
  const health = await execute(['mcp', 'list']);
  assert.match(
    health.stdout,
    /Connected/i,
    'The real Claude client must complete its MCP health check.',
  );
  assert.ok(seen.has('initialize'), 'The official client must reach the actual Kivuno endpoint.');
  const listed = await app.inject({
    method: 'GET',
    url: '/api/external-connections',
    headers: ownerHeaders,
  });
  assert.ok(
    listed
      .json()
      .some((c: { id: string; lastSeen: string | null }) => c.id === connection.id && c.lastSeen),
  );
  const revoke = await app.inject({
    method: 'POST',
    url: `/api/external-connections/${connection.id}/revoke`,
    headers: ownerHeaders,
    payload: {},
  });
  assert.equal(revoke.statusCode, 200);
  const revoked = await execute(['mcp', 'list']);
  assert.doesNotMatch(revoked.stdout, /✓ Connected/);
  assert.match(revoked.stdout, /Failed|expired|error|disconnected/i);
  console.log(
    JSON.stringify({
      officialClaude: version,
      realMcpHealthCheck: true,
      initializeObserved: true,
      revokedConnectionDenied: true,
      isolatedTemporaryConfig: true,
      modelTurns: 0,
      accountLogins: 0,
    }),
  );
} finally {
  await app.close();
  await workspace.close();
  store.close();
  assert.equal(path.dirname(root), await realpath(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('kivuno-claude-native-'));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
