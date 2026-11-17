// Deterministic protocol peer. Never authenticates or calls a provider/model.
import { createInterface } from 'node:readline';
import { readFile, appendFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const home = process.env.HOME;
const signedIn = async () =>
  readFile(path.join(home, 'managed-fixture-account.json')).then(
    () => true,
    () => false,
  );
if (process.argv[2] === 'auth') {
  if (process.argv[3] === 'login')
    await writeFile(path.join(home, 'managed-fixture-account.json'), '{}');
  if (process.argv[3] === 'logout')
    await unlink(path.join(home, 'managed-fixture-account.json')).catch(() => {});
  const loggedIn = await signedIn();
  console.log(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' }));
  process.exit(loggedIn || process.argv[3] !== 'status' ? 0 : 1);
}
for (const key of [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'NODE_OPTIONS',
])
  assert.equal(process.env[key], undefined);
const acp = process.argv.includes('acp');
const sessions = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const configOptions = [
  {
    id: 'model',
    category: 'model',
    currentValue: 'agy-controlled',
    options: [{ value: 'agy-controlled', name: 'Controlled model' }],
  },
  {
    id: 'thinking',
    category: 'thought_level',
    currentValue: 'medium',
    options: ['low', 'medium', 'high'].map((value) => ({ value, name: value })),
  },
];
let claudeBridge;
if (!acp) {
  assert.equal(process.argv.includes('--restricted'), true);
  assert.equal(process.argv[process.argv.indexOf('--tools') + 1], '');
  assert.equal(process.argv.includes('--dangerously-skip-permissions'), false);
  claudeBridge = JSON.parse(
    await readFile(process.argv[process.argv.indexOf('--mcp-config') + 1], 'utf8'),
  ).mcpServers.kivuno;
} else {
  const policy = JSON.parse(
    await readFile(path.join(home, '.gemini/antigravity-cli/settings.json'), 'utf8'),
  );
  assert.equal(policy.useG1Credits, false);
  assert.ok(policy.permissions.deny.includes('command(*)'));
}
async function tool(bridge, name, args) {
  const headers = Array.isArray(bridge.headers)
    ? Object.fromEntries(bridge.headers.map((item) => [item.name, item.value]))
    : bridge.headers;
  const response = await fetch(bridge.url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function turn(bridge, prompt) {
  if (prompt.includes('hold-turn')) return new Promise(() => {});
  const read = await tool(bridge, 'workspace_read_file', { path: 'sample.txt' });
  if (prompt.includes('edit-file')) {
    const edit = await tool(bridge, 'workspace_write_file', {
      path: 'sample.txt',
      content: 'reviewed change',
    });
    if (edit.error) throw new Error(edit.error.message);
  }
  const report = await tool(bridge, 'relay_report', {
    kind: 'progress',
    content: 'Controlled peer inspected sample.txt.',
  });
  if (read.error || report.error) throw new Error('Scoped tool failed.');
  return 'Controlled protocol completion; not a real model evaluation.';
}
createInterface({ input: process.stdin }).on('line', async (line) => {
  const value = JSON.parse(line);
  if (acp && value.id === 'untrusted-permission') {
    assert.equal(value.result.outcome.optionId, 'reject');
    await writeFile(path.join(home, 'permission-denied'), 'true');
    return;
  }
  await appendFile(
    path.join(home, 'managed-peer-events.jsonl'),
    JSON.stringify({ type: value.type, method: value.method, subtype: value.request?.subtype }) +
      '\n',
  );
  try {
    if (!acp) {
      if (value.type === 'control_request') {
        send({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: value.request_id,
            response:
              value.request.subtype === 'initialize'
                ? {
                    models: [
                      {
                        value: 'default',
                        displayName: 'Default',
                        supportsEffort: true,
                        supportedEffortLevels: ['medium', 'high'],
                      },
                      {
                        value: 'sonnet',
                        displayName: 'Economical Sonnet',
                        supportsEffort: true,
                        supportedEffortLevels: ['medium', 'high'],
                      },
                      { value: 'haiku', displayName: 'Haiku' },
                    ],
                  }
                : {},
          },
        });
        if (value.request.subtype === 'interrupt')
          send({ type: 'result', subtype: 'interrupted', is_error: true, result: 'Interrupted' });
      } else if (value.type === 'user') {
        assert.equal(await signedIn(), true);
        const text = await turn(claudeBridge, value.message.content);
        send({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
        send({ type: 'result', subtype: 'success', is_error: false });
      }
      return;
    }
    if (value.id === undefined && value.method === 'session/cancel') return;
    let result = {};
    if (value.method === 'initialize') {
      const invalid = await readFile(path.join(home, 'invalid-initialize')).then(
        () => true,
        () => false,
      );
      result = {
        protocolVersion: invalid ? 99 : 1,
        agentInfo: { name: 'Antigravity ACP Server', version: 'fixture' },
        authMethods: [{ id: 'oauth-personal' }],
        agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
      };
    } else if (value.method === 'authenticate') {
      await writeFile(path.join(home, 'managed-fixture-account.json'), '{}');
    } else if (value.method === 'session/new' || value.method === 'session/load') {
      if (!(await signedIn())) {
        send({
          jsonrpc: '2.0',
          id: value.id,
          error: { code: -32000, message: 'Authentication required' },
        });
        return;
      }
      const sessionId = value.params.sessionId || randomUUID();
      sessions.set(sessionId, value.params.mcpServers?.[0]);
      result = { sessionId, configOptions };
    } else if (value.method === 'session/set_config_option') {
      const option = configOptions.find((option) => option.id === value.params.configId);
      option.currentValue = value.params.value;
      result = { configOptions };
    } else if (value.method === 'session/prompt') {
      send({
        jsonrpc: '2.0',
        id: 'untrusted-permission',
        method: 'session/request_permission',
        params: {
          toolCall: { title: 'mcp__kivuno__machine_use' },
          options: [
            { kind: 'allow_once', optionId: 'allow' },
            { kind: 'reject_once', optionId: 'reject' },
          ],
        },
      });
      const text = await turn(sessions.get(value.params.sessionId), value.params.prompt[0].text);
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: value.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
        },
      });
      result = { stopReason: 'end_turn' };
    }
    send({ jsonrpc: '2.0', id: value.id, result });
  } catch (error) {
    if (acp)
      send({ jsonrpc: '2.0', id: value.id, error: { code: -32001, message: error.message } });
    else send({ type: 'result', subtype: 'error', is_error: true, errors: [error.message] });
  }
});
