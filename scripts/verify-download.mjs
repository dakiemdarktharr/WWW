// Reproducible release-download audit. No login, model call, or installation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const options = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const match = /^--(origin|platform|version|out)=(.+)$/.exec(value);
    if (!match) throw new Error(`Unsupported option: ${value}`);
    return [match[1], match[2]];
  }),
);
const origin = new URL(options.origin || 'https://nosleepclub-relay.vercel.app');
assert.equal(origin.protocol, 'https:');
assert.equal(origin.href, origin.origin + '/');
const platform = options.platform || 'windows';
assert.ok(['windows', 'linux'].includes(platform));
const expectedVersion =
  options.version ||
  JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;
const out = path.resolve(options.out || '.local/download-audit');
await mkdir(out, { recursive: true });
async function request(url, method = 'GET') {
  const response = await fetch(url, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(300000),
  });
  assert.equal(response.status, 200, `${method} ${new URL(url).pathname}`);
  return response;
}
const release = await (await request(new URL('/api/desktop/release', origin))).json();
assert.equal(release.version, expectedVersion);
const item = release.platforms?.[platform];
assert.equal(item?.available, true);
assert.match(item.sha256, /^[a-f0-9]{64}$/);
assert.ok(Number.isSafeInteger(item.size) && item.size > 1024 && item.size < 2 * 1024 ** 3);
const url = new URL(item.url, origin);
assert.equal(url.origin, origin.origin);
assert.match(url.pathname, /^\/downloads\/Kivuno-[a-zA-Z0-9._-]+$/);
assert.equal(url.search, '');
assert.equal(url.hash, '');
const head = await request(url, 'HEAD');
assert.equal(Number(head.headers.get('content-length')), item.size);
const sidecar = await (await request(new URL(url.href + '.sha256'))).text();
assert.equal(sidecar.trim().split(/\s+/)[0], item.sha256);
const hash = createHash('sha256');
let bytes = 0;
const file = path.join(out, path.basename(url.pathname));
await pipeline(
  Readable.fromWeb((await request(url)).body),
  new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > item.size) return callback(new Error('Download exceeds manifest size.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  }),
  createWriteStream(file, { flags: 'w' }),
);
assert.equal(bytes, item.size);
assert.equal(hash.digest('hex'), item.sha256);
const evidence = {
  version: release.version,
  platform,
  bytes,
  sha256: item.sha256,
  file,
  checkedAt: new Date().toISOString(),
};
await writeFile(
  path.join(out, `${platform}-verification.json`),
  JSON.stringify(evidence, null, 2) + '\n',
);
await writeFile(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify(evidence));
