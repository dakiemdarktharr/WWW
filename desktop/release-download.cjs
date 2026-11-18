'use strict';

const { githubMacReleaseAsset, trustedMacUpdateRedirect } = require('./security.cjs');

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

module.exports = { fetchMacUpdate };
