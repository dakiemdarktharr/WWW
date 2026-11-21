import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GeminiClient } from '../server/gemini.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-gemini-native-'));
const client = new GeminiClient({ home: root, cwd: root });
try {
  await client.start();
  const result = await client.request('account/read');
  assert.equal(
    result.account,
    null,
    'an isolated unsigned profile cannot reuse the machine account',
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'kivuno-system-settings.json'), 'utf8')).tools.core,
    [],
  );
  console.log(
    'Official Gemini CLI 0.66.0: ACP initialize and isolated signed-out account passed; no authentication or model prompt sent.',
  );
} finally {
  await client.stop();
  const actual = await realpath(root),
    temp = await realpath(os.tmpdir());
  assert.equal(path.dirname(actual), temp);
  assert.ok(path.basename(actual).startsWith('kivuno-gemini-native-'));
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
