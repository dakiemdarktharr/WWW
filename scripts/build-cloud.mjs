import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { create } from 'tar';

await mkdir('.cloud', { recursive: true });
// Explicit source allowlist: never package local state, credentials, .env or Git.
await create({ gzip: true, file: '.cloud/runner.tar.gz', portable: true }, [
  'server',
  'shared',
  'scripts/check-runtime.mjs',
  'package.json',
  'package-lock.json',
]);
const digest = createHash('sha256')
  .update(await readFile('.cloud/runner.tar.gz'))
  .digest('hex');
await writeFile('.cloud/revision', digest);
