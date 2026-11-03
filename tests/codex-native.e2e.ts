import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexClient, probeCodex } from '../server/codex.ts';

// Real official binaries and isolated empty homes. No authentication or model turn is requested.
const directory = await mkdtemp(path.join(os.tmpdir(), 'relay-native-four-'));
const clients: CodexClient[] = [];
try {
  const probe = await probeCodex();
  assert.equal(probe.available, true, probe.version);
  for (let i = 0; i < 4; i++) {
    const home = path.join(directory, `account-${i}`);
    await mkdir(home);
    clients.push(new CodexClient({ home, cwd: directory }));
  }
  const results = await Promise.all(
    clients.map(async (client) => {
      await client.start();
      return client.request('account/read', { refreshToken: false });
    }),
  );
  for (const result of results) assert.equal(result.account, null);
  console.log(
    JSON.stringify({
      officialCodex: probe.version,
      independentNativeProcesses: 4,
      isolatedEmptyHomes: 4,
      modelTurns: 0,
      accountLogins: 0,
    }),
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.stop()));
  assert.equal(path.dirname(await realpath(directory)), await realpath(os.tmpdir()));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
