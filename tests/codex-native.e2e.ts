import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, realpath, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import {
  CodexClient,
  codexEnvironment,
  probeCodex,
  readCapabilities,
  relayDynamicTools,
} from '../server/codex.ts';

// Official binary with new profiles, no login or model turn. Codex allows OS TEMP
// writes by design, so use an ignored repo-local fixture for the denied-root test.
const parent = path.resolve('.local');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, 'kivuno-codex-native-'));
const command =
  process.env.RELAY_CODEX_COMMAND || path.resolve('node_modules/@openai/codex/bin/codex.js');
const previousCommand = process.env.RELAY_CODEX_COMMAND;
process.env.RELAY_CODEX_COMMAND = command;
const clients: CodexClient[] = [];
const execute = promisify(execFile);
const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Local Kivuno verification fixture only.\n---\nDo not access the network or execute commands.\n`;
try {
  const probe = await probeCodex();
  assert.equal(probe.available, true, probe.version);
  const work = path.join(directory, 'work');
  await mkdir(work);
  await writeFile(path.join(work, 'input.txt'), 'Kivuno real Codex harness');
  const sharedSkills = path.join(directory, 'machine-skills');
  await mkdir(path.join(sharedSkills, 'shared-local-skill'), { recursive: true });
  await writeFile(
    path.join(sharedSkills, 'shared-local-skill', 'SKILL.md'),
    skill('shared-local-skill'),
  );
  for (let i = 0; i < 4; i++) {
    const home = path.join(directory, `account-${i}`);
    await mkdir(path.join(home, 'skills', `native-skill-${i}`), { recursive: true });
    await writeFile(
      path.join(home, 'skills', `native-skill-${i}`, 'SKILL.md'),
      skill(`native-skill-${i}`),
    );
    clients.push(new CodexClient({ home, cwd: work, command, skillRoots: [sharedSkills] }));
  }
  const marketplace = path.join(directory, 'marketplace');
  const plugin = path.join(marketplace, 'plugins', 'harness-plugin');
  await mkdir(path.join(marketplace, '.agents', 'plugins'), { recursive: true });
  await mkdir(path.join(plugin, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(plugin, 'skills', 'plugin-skill'), { recursive: true });
  await writeFile(
    path.join(marketplace, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({
      name: 'kivuno-native-test',
      plugins: [
        {
          name: 'harness-plugin',
          source: { source: 'local', path: './plugins/harness-plugin' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
        },
      ],
    }),
  );
  await writeFile(
    path.join(plugin, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness-plugin', version: '1.0.0', skills: './skills' }),
  );
  await writeFile(path.join(plugin, 'skills', 'plugin-skill', 'SKILL.md'), skill('plugin-skill'));
  const cli = async (args: string[]) => {
    const js = /\.[cm]?js$/i.test(command);
    const result = await execute(js ? process.execPath : command, js ? [command, ...args] : args, {
      cwd: directory,
      env: codexEnvironment(path.join(directory, 'account-0')),
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 256 * 1024,
    });
    return JSON.parse(result.stdout);
  };
  assert.equal(
    (await cli(['plugin', 'marketplace', 'add', marketplace, '--json'])).marketplaceName,
    'kivuno-native-test',
  );
  assert.equal(
    (await cli(['plugin', 'add', 'harness-plugin@kivuno-native-test', '--json'])).name,
    'harness-plugin',
  );
  const results = await Promise.all(
    clients.map(async (client) => {
      await client.start();
      return client.request('account/read', { refreshToken: false });
    }),
  );
  for (const result of results) assert.equal(result.account, null);
  assert.equal(new Set(clients.map((client) => client.pid)).size, 4);
  const caps = await Promise.all(clients.map((client) => readCapabilities(client, work)));
  for (let i = 0; i < 4; i++) {
    assert.ok(caps[i].skills.includes(`native-skill-${i}`));
    assert.ok(caps[i].skills.includes('shared-local-skill'));
    for (let other = 0; other < 4; other++)
      if (other !== i) assert.ok(!caps[i].skills.includes(`native-skill-${other}`));
  }
  assert.ok(caps[0].plugins.includes('harness-plugin'));
  assert.ok(caps[0].skills.includes('harness-plugin:plugin-skill'));
  assert.ok(!caps[1].plugins.includes('harness-plugin'));
  const client = clients[0];
  if (process.platform === 'win32')
    assert.equal((await client.request('windowsSandbox/readiness', {})).status, 'ready');
  const thread = await client.request('thread/start', {
    cwd: work,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    dynamicTools: relayDynamicTools,
    ephemeral: true,
  });
  assert.equal(thread.sandbox.type, 'workspaceWrite');
  assert.equal(thread.approvalPolicy, 'on-request');
  assert.equal(thread.approvalsReviewer, 'user');
  assert.equal(path.resolve(thread.cwd), work);
  const run = (code: string, sandboxPolicy = thread.sandbox) =>
    client.request('command/exec', {
      command: [process.execPath, '-e', code],
      cwd: work,
      sandboxPolicy,
      timeoutMs: 10000,
    });
  const copied = await run(
    "const fs=require('node:fs');fs.writeFileSync('output.txt',fs.readFileSync('input.txt'));console.log('local-read-write-ok');",
  );
  assert.equal(copied.exitCode, 0);
  assert.match(copied.stdout, /local-read-write-ok/);
  assert.equal(await readFile(path.join(work, 'output.txt'), 'utf8'), 'Kivuno real Codex harness');
  const forbidden = path.join(directory, 'outside-worktree.txt');
  const outside = await run(
    `require('node:fs').writeFileSync(${JSON.stringify(forbidden)},'must not be written')`,
  ).catch((error: Error) => ({ exitCode: -1, stderr: error.message }));
  assert.notEqual(outside.exitCode, 0, 'a sibling outside the granted worktree must be denied');
  await assert.rejects(access(forbidden));
  const readOnlyThread = await client.request('thread/start', {
    cwd: work,
    sandbox: 'read-only',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    ephemeral: true,
  });
  assert.equal(readOnlyThread.sandbox.type, 'readOnly');
  const readOnly = await run(
    "require('node:fs').writeFileSync('readonly-denied.txt','no')",
    readOnlyThread.sandbox,
  ).catch((error: Error) => ({ exitCode: -1, stderr: error.message }));
  assert.notEqual(readOnly.exitCode, 0);
  await assert.rejects(access(path.join(work, 'readonly-denied.txt')));
  console.log(
    JSON.stringify({
      officialCodex: probe.version,
      independentNativeProcesses: 4,
      isolatedSignedOutHomes: 4,
      accountSkillIsolation: true,
      realLocalPluginInstallAndInventory: true,
      nativeWorktreeReadWrite: true,
      nativeOutsideWriteDenied: true,
      nativeReadOnlyWriteDenied: true,
      humanApprovalPolicy: true,
      dynamicToolRegistration: true,
      modelTurns: 0,
      accountLogins: 0,
    }),
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.stop()));
  if (previousCommand === undefined) delete process.env.RELAY_CODEX_COMMAND;
  else process.env.RELAY_CODEX_COMMAND = previousCommand;
  assert.equal(path.dirname(await realpath(directory)), await realpath(parent));
  assert.ok(path.basename(directory).startsWith('kivuno-codex-native-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
