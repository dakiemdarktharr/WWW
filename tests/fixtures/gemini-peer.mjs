import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { access, readFile, appendFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
const sessions = new Map();
let authenticated = false;
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const models = {
  availableModels: [{ modelId: 'gemini-controlled', name: 'Controlled Gemini' }],
  currentModelId: 'gemini-controlled',
};
createInterface({ input: process.stdin }).on('line', async (line) => {
  const rpc = JSON.parse(line),
    params = rpc.params || {};
  await appendFile(
    path.join(process.env.GEMINI_CLI_HOME, 'peer-calls.jsonl'),
    `${JSON.stringify({ method: rpc.method, noBrowser: process.env.NO_BROWSER })}\n`,
  );
  try {
    let result = {};
    if (rpc.method === 'initialize') {
      const policy = JSON.parse(
        await readFile(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'),
      );
      if (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        policy.tools.core.length ||
        !policy.security.auth.useExternal ||
        policy.security.auth.selectedType
      )
        throw new Error('Unsafe Gemini launch policy');
      result = {
        protocolVersion: 1,
        agentInfo: { name: 'gemini-cli', version: '0.66.0' },
        authMethods: [{ id: 'oauth-personal' }],
        agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
      };
    } else if (rpc.method === 'authenticate') {
      if (params.methodId !== 'oauth-personal') throw new Error('Paid authentication is forbidden');
      const hangOnce = path.join(process.env.GEMINI_CLI_HOME, '.gemini', 'fixture-hang-first-auth');
      try {
        await access(hangOnce);
        await unlink(hangOnce);
        await writeFile(
          path.join(process.env.GEMINI_CLI_HOME, '.gemini', 'oauth_creds.json'),
          JSON.stringify({ refresh_token: 'controlled-fixture-token' }),
        );
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      authenticated = true;
    } else if (rpc.method === 'session/new' || rpc.method === 'session/load') {
      if (!authenticated) throw new Error('Not authenticated');
      const sessionId = params.sessionId || randomUUID();
      sessions.set(sessionId, params);
      result = {
        sessionId,
        models,
        modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] },
      };
    } else if (rpc.method === 'session/set_model') {
      if (params.modelId !== 'gemini-controlled') throw new Error('Unknown model');
    } else if (rpc.method === 'session/prompt') {
      const session = sessions.get(params.sessionId);
      const prompt = params.prompt.map((item) => item.text).join('\n');
      if (prompt.includes('CONTROLLED_WRITE')) {
        const bridge = session.mcpServers.find((server) => server.name === 'kivuno');
        const headers = Object.fromEntries(bridge.headers.map(({ name, value }) => [name, value]));
        const response = await fetch(bridge.url, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'workspace_write_file',
              arguments: { path: 'src/result.txt', content: 'Controlled output' },
            },
          }),
        });
        const body = await response.json();
        if (body.error) throw new Error(body.error.message);
      }
      send({
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Controlled Gemini reply.' },
          },
        },
      });
      result = { stopReason: 'end_turn' };
    } else if (rpc.method === 'session/cancel') {
      return;
    } else throw new Error(`Unknown ACP method ${rpc.method}`);
    if (rpc.id !== undefined) send({ id: rpc.id, result });
  } catch (error) {
    if (rpc.id !== undefined) send({ id: rpc.id, error: { code: -32602, message: error.message } });
  }
});
