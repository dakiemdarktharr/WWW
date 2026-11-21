'use strict';

const { githubMacReleaseAsset, trustedMacUpdateRedirect } = require('./security.cjs');
const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function fetchMacUpdate(url, { signal, fetchImpl = fetch } = {}) {
  if (!githubMacReleaseAsset(url, '.zip')) return fetchImpl(url, { redirect: 'error', signal });

  let currentUrl = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchImpl(currentUrl, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === 5)
      throw new Error('The Kivuno update download used an invalid redirect.');
    const target = new URL(location, currentUrl);
    if (!trustedMacUpdateRedirect(target.href))
      throw new Error('The Kivuno update redirected to an unapproved download host.');
    currentUrl = target.href;
  }
  throw new Error('The Kivuno update used too many redirects.');
}

async function downloadUpdate(artifact, destination, onProgress, { cancel, fetchImpl } = {}) {
  const deadline = AbortSignal.timeout(30 * 60 * 1000);
  const signal = cancel ? AbortSignal.any([cancel, deadline]) : deadline;
  const response = await fetchMacUpdate(artifact.url, { signal, fetchImpl });
  if (!response.ok || !response.body)
    throw new Error(`Không tải được bản cập nhật Kivuno (HTTP ${response.status}).`);
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) !== artifact.size) {
    await response.body.cancel();
    throw new Error('Kích thước gói cập nhật không khớp. Hãy thử lại sau.');
  }
  const digest = createHash('sha256');
  let bytes = 0;
  let reported = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > artifact.size)
        return callback(new Error('Gói cập nhật vượt quá kích thước đã công bố.'));
      digest.update(chunk);
      const percent = Math.floor((bytes / artifact.size) * 20) * 5;
      if (percent > reported) {
        reported = percent;
        onProgress(percent);
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    { signal },
  );
  if (bytes !== artifact.size || digest.digest('hex') !== artifact.sha256)
    throw new Error('Không xác minh được gói cập nhật. Hãy thử lại sau.');
}

module.exports = { downloadUpdate, fetchMacUpdate };
