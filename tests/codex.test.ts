import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CodexClient,
  codexEnvironment,
  redactCodexError,
  readAccount,
  readCapabilities,
  readRateLimits,
  startTask,
  dynamicToolResult,
  relayDynamicTools,
  type DynamicTool,
} from '../server/codex.ts';

// A child process speaking the real stdio protocol. It never contacts OpenAI.
const fixture = [
  "import readline from 'node:readline';",
  "const send = x => process.stdout.write(JSON.stringify(x) + '\\n');",
  'const input = readline.createInterface({input:process.stdin});',
  "input.on('line', line => { const m=JSON.parse(line); const p=m.params??{};",
  "if(m.method==='initialized') return;",
  "if(!m.method) {send({method:'fixture/reply',params:m}); return;}",
  'let result = {};',
  'switch(m.method) {',
  "case 'initialize': result={userAgent:'fixture'}; break;",
  "case 'echo': result=p; break;",
  "case 'environment': result={keys:Object.keys(process.env),home:process.env.CODEX_HOME,args:process.argv.slice(2)}; break;",
  "case 'account/read': result={account:{type:'chatgpt',email:'fixture@example.test',planType:'plus',accessToken:'must-not-leak'}}; break;",
  "case 'account/rateLimits/read': result={rateLimits:{primary:{usedPercent:23}},rateLimitsByLimitId:null,ordinaryUsageAllowed:true,accountId:'private-id',rateLimitUpsell:{extra:'not-needed'}}; break;",
  "case 'skills/list': result={data:[{skills:[{name:'enabled-skill',enabled:true},{name:'disabled-skill',enabled:false}],errors:[]}]}; break;",
  "case 'plugin/list': result={marketplaces:[{plugins:[{name:'enabled-plugin',enabled:true,installed:true,disabledReason:null},{name:'not-installed',enabled:true,installed:false},{name:'blocked-plugin',enabled:true,installed:true,disabledReason:'policy'}]}],marketplaceLoadErrors:[]}; break;",
  "case 'thread/start': result={thread:{id:'thread-fixture'},sandbox:{type:'workspaceWrite'},approvalPolicy:'on-request',approvalsReviewer:'user'}; send({method:'fixture/threadParams',params:p}); break;",
  "case 'turn/start': result={turn:{id:'turn-fixture'}}; send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:'turn-fixture',status:'completed',error:null,items:[]}}}); break;",
  "case 'request-client': send({id:'server-1',method:'item/tool/call',params:{threadId:'thread-fixture',turnId:'turn-fixture',tool:'relay_read_room',arguments:{}}}); break;",
  "case 'fail': send({id:m.id,error:{message:'access_token=private-secret-value'}}); return;",
  "case 'malformed': process.stdout.write('{not-json}\\n'); return;",
  "case 'oversized': process.stdout.write('x'.repeat(9*1024*1024)); return;",
  '}',
  'send({id:m.id,result});',
  '});',
].join('\n');

async function clientFor(t: TestContext, source = fixture): Promise<CodexClient> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-codex-test-'));
  const command = path.join(directory, 'fixture.mjs');
  await writeFile(command, source);
  const client = new CodexClient({
    home: path.join(directory, 'profile'),
    cwd: directory,
    command,
  });
  t.after(async () => {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return client;
}

test('profile environment excludes inherited provider keys, WIF and unrelated application secrets', () => {
  const environment = codexEnvironment(path.resolve('profile'), {
    PATH: '/usr/bin',
    HOME: '/home/test',
    OPENAI_API_KEY: 'secret',
    CODEX_API_KEY: 'secret',
    OPENAI_IDENTITY_TOKEN_FILE: '/secret/wif',
    OPENAI_AUTH_MODE: 'wif',
    CODEX_HOME: '/wrong',
    GH_TOKEN: 'secret',
    DATABASE_URL: 'secret',
    NODE_OPTIONS: '--require unsafe.js',
    RANDOM_SECRET: 'secret',
  });
  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.CODEX_HOME, path.resolve('profile'));
  for (const key of [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_IDENTITY_TOKEN_FILE',
    'OPENAI_AUTH_MODE',
    'GH_TOKEN',
    'DATABASE_URL',
    'NODE_OPTIONS',
    'RANDOM_SECRET',
  ])
    assert.equal(environment[key], undefined);
});

test('error redaction strips token values and OAuth query strings', () => {
  const sanitized = redactCodexError(
    'access_token=secret-value Bearer private-token sk-1234567890ABCDEFG https://auth.openai.com/authorize?state=private&code=secret',
  );
  for (const secret of [
    'secret-value',
    'private-token',
    '1234567890ABCDEFG',
    'state=private',
    'code=secret',
  ])
    assert.equal(sanitized.includes(secret), false);
});

test('client handshakes once, correlates concurrent requests and forces isolated ChatGPT credentials', async (t) => {
  const client = await clientFor(t);
  await Promise.all([client.start(), client.start()]);
  const results = await Promise.all([
    client.request('echo', { n: 1 }),
    client.request('echo', { n: 2 }),
  ]);
  assert.deepEqual(results, [{ n: 1 }, { n: 2 }]);
  const environment = await client.request('environment');
  assert.ok(environment.home.endsWith('profile'));
  assert.ok(environment.args.includes('cli_auth_credentials_store="file"'));
  assert.ok(environment.args.includes('forced_login_method="chatgpt"'));
  assert.ok(environment.args.includes('stdio://'));
  assert.ok(client.pid);
});

test('account/capability views include only active capabilities and exclude private account fields', async (t) => {
  const client = await clientFor(t);
  const account = await readAccount(client);
  assert.deepEqual(account, { type: 'chatgpt', email: 'fixture@example.test', planType: 'plus' });
  const capabilities = await readCapabilities(client, process.cwd());
  assert.deepEqual(capabilities.skills, ['enabled-skill']);
  assert.deepEqual(capabilities.plugins, ['enabled-plugin']);
  assert.match(capabilities.errors[0], /blocked-plugin.*policy/);
  assert.deepEqual(await readRateLimits(client), {
    rateLimits: { primary: { usedPercent: 23 } },
    rateLimitsByLimitId: null,
    ordinaryUsageAllowed: true,
  });
});

test('startTask requests human approvals, workspace sandbox and room tools; early completion stays observable', async (t) => {
  const client = await clientFor(t);
  const events: { method: string; params: any }[] = [];
  let boundThread: string | undefined;
  let boundBeforeCompletion = false;
  client.on('notification', (method, params) => {
    events.push({ method, params });
    if (method === 'turn/completed') boundBeforeCompletion = boundThread === params.threadId;
  });
  const result = await startTask(client, {
    cwd: process.cwd(),
    prompt: 'Controlled fixture task',
    developerInstructions: 'Only assigned task.',
    onThread: (id) => {
      boundThread = id;
    },
  });
  assert.deepEqual(result, { threadId: 'thread-fixture', turnId: 'turn-fixture' });
  const parameters = events.find((e) => e.method === 'fixture/threadParams')?.params;
  assert.equal(parameters.sandbox, 'workspace-write');
  assert.equal(parameters.approvalPolicy, 'on-request');
  assert.equal(parameters.approvalsReviewer, 'user');
  assert.deepEqual(
    parameters.dynamicTools.map((tool: any) => tool.name),
    ['relay_read_room', 'relay_report'],
  );
  assert.ok(events.some((e) => e.method === 'turn/completed'));
  assert.equal(boundBeforeCompletion, true);
});

test('server tool calls are replied to using the exact request ID and contentItems schema', async (t) => {
  const client = await clientFor(t);
  await client.start();
  client.on('request', (request) =>
    client.respond(request.id, dynamicToolResult({ messages: [] })),
  );
  const reply = new Promise<any>((resolve) =>
    client.on('notification', (method, params) => {
      if (method === 'fixture/reply') resolve(params);
    }),
  );
  await client.request('request-client');
  assert.deepEqual(await reply, {
    id: 'server-1',
    result: { contentItems: [{ type: 'inputText', text: '{"messages":[]}' }], success: true },
  });
});

test('planning uses a read-only sandbox with its supplied tools and binds ownership before completion', async (t) => {
  const client = await clientFor(
    t,
    fixture.replace("sandbox:{type:'workspaceWrite'}", "sandbox:{type:'readOnly'}"),
  );
  const planTool: DynamicTool = {
    type: 'function',
    name: 'relay_submit_plan',
    description: 'Submit the controlled plan.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
  const events: { method: string; params: any }[] = [];
  let threadBound = false;
  let completionWasBound = false;
  client.on('notification', (method, params) => {
    events.push({ method, params });
    if (method === 'turn/completed') completionWasBound = threadBound;
  });
  await startTask(client, {
    cwd: process.cwd(),
    prompt: 'Produce a plan without changing files.',
    readOnly: true,
    dynamicTools: [...relayDynamicTools, planTool],
    onThread: () => {
      threadBound = true;
    },
  });
  const parameters = events.find((event) => event.method === 'fixture/threadParams')?.params;
  assert.equal(parameters.sandbox, 'read-only');
  assert.equal(parameters.approvalPolicy, 'on-request');
  assert.equal(parameters.approvalsReviewer, 'user');
  assert.deepEqual(parameters.dynamicTools, [...relayDynamicTools, planTool]);
  assert.equal(completionWasBound, true);
});

test('planning refuses a writable sandbox before binding ownership or starting a turn', async (t) => {
  const client = await clientFor(t);
  let bound = false;
  let completed = false;
  client.on('notification', (method) => {
    if (method === 'turn/completed') completed = true;
  });
  await assert.rejects(
    startTask(client, {
      cwd: process.cwd(),
      prompt: 'Must never run with writes enabled.',
      readOnly: true,
      onThread: () => {
        bound = true;
      },
    }),
    /did not honor/,
  );
  assert.equal(bound, false);
  assert.equal(completed, false);
});

test('planning refuses an automatic approval reviewer before starting a turn', async (t) => {
  const client = await clientFor(
    t,
    fixture
      .replace("sandbox:{type:'workspaceWrite'}", "sandbox:{type:'readOnly'}")
      .replace("approvalsReviewer:'user'", "approvalsReviewer:'guardian_subagent'"),
  );
  let bound = false;
  await assert.rejects(
    startTask(client, {
      cwd: process.cwd(),
      prompt: 'Keep human approval routing.',
      readOnly: true,
      onThread: () => {
        bound = true;
      },
    }),
    /did not honor/,
  );
  assert.equal(bound, false);
});

test('unsupported server requests receive a protocol error instead of hanging', async (t) => {
  const client = await clientFor(t);
  await client.start();
  const reply = new Promise<any>((resolve) =>
    client.on('notification', (method, params) => {
      if (method === 'fixture/reply') resolve(params);
    }),
  );
  await client.request('request-client');
  assert.equal((await reply).error.code, -32601);
});

test('provider errors are sanitized before being returned to callers', async (t) => {
  const client = await clientFor(t);
  await client.start();
  await assert.rejects(
    client.request('fail'),
    (error) =>
      error instanceof Error &&
      error.message.includes('[redacted]') &&
      !error.message.includes('private-secret-value'),
  );
});

test('invalid protocol JSON fails pending requests and closes the child', async (t) => {
  const client = await clientFor(t);
  await client.start();
  const closed = new Promise<void>((resolve) => client.once('exit', () => resolve()));
  await assert.rejects(client.request('malformed'), /invalid JSON frame/);
  await closed;
  assert.equal(client.pid, undefined);
});

test('oversized unframed data is bounded and terminates the child', async (t) => {
  const client = await clientFor(t);
  await client.start();
  const closed = new Promise<void>((resolve) => client.once('exit', () => resolve()));
  await assert.rejects(client.request('oversized'), /transport limit/);
  await closed;
  assert.equal(client.pid, undefined);
});

test('sandbox downgrades fail closed before a turn can consume account usage', async (t) => {
  const client = await clientFor(
    t,
    fixture.replace("sandbox:{type:'workspaceWrite'}", "sandbox:{type:'dangerFullAccess'}"),
  );
  await assert.rejects(
    startTask(client, { cwd: process.cwd(), prompt: 'Must not run.' }),
    /did not honor/,
  );
});
