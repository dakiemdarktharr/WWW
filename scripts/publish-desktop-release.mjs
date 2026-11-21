import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assembleDesktopRelease,
  releaseManifestName,
  verifyGitHubReleaseAssets,
} from './desktop-release-assets.mjs';

const repository = 'dakiemdarktharr/WWW';
const [mode, directory, commit] = process.argv.slice(2);
if (!['verify', 'publish'].includes(mode) || !directory || !/^[a-f0-9]{40}$/.test(commit ?? ''))
  throw new Error('Use verify or publish with the candidate directory and full commit SHA.');
if (
  mode === 'publish' &&
  (process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_SHA !== commit ||
    !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))
)
  throw new Error('Only a trusted release run for main can publish.');

const manifest = await assembleDesktopRelease(process.cwd(), directory, commit);
console.log(`Verified all four packages for Kivuno ${manifest.version} from ${commit}.`);
if (mode === 'verify') process.exit(0);

const run = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const tag = `v${manifest.version}`;
function view() {
  const result = spawnSync(
    'gh',
    [
      'release',
      'view',
      tag,
      '--repo',
      repository,
      '--json',
      'apiUrl,isDraft,isPrerelease,targetCommitish',
    ],
    {
      encoding: 'utf8',
    },
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/^release not found\s*$/i.test(result.stderr ?? '')) return null;
  throw new Error(result.stderr || result.error?.message || 'Cannot look up the GitHub Release.');
}

let release = view();
if (!release) {
  const existingTag = execFileSync('git', ['ls-remote', 'origin', `refs/tags/${tag}`], {
    encoding: 'utf8',
  }).trim();
  if (existingTag) throw new Error(`Tag ${tag} already exists without a release for this run.`);
  run(
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--draft',
    '--target',
    commit,
    '--title',
    `Kivuno ${manifest.version}`,
    '--generate-notes',
  );
  release = view();
}
if (!release || release.targetCommitish !== commit || release.isPrerelease)
  throw new Error(`The existing ${tag} release does not match this run.`);
const endpoint = new URL(release.apiUrl);
if (
  endpoint.origin !== 'https://api.github.com' ||
  !/^\/repos\/dakiemdarktharr\/WWW\/releases\/\d+$/.test(endpoint.pathname)
)
  throw new Error('Invalid GitHub release endpoint.');

const readRelease = () => JSON.parse(run('api', endpoint.pathname));
const files = new Map();
for (const { filename, sha256 } of Object.values(manifest.artifacts)) {
  files.set(filename, sha256);
  files.set(filename + '.sha256', null);
}
files.set(releaseManifestName, null);
for (const [filename, digest] of files) {
  if (!digest)
    files.set(
      filename,
      createHash('sha256')
        .update(await readFile(path.join(directory, filename)))
        .digest('hex'),
    );
}

const remote = readRelease();
if (!remote.draft && remote.prerelease) throw new Error(`Release ${tag} is a prerelease.`);
for (const [filename, digest] of files) {
  const existing = remote.assets.find((asset) => asset.name === filename);
  if (existing) {
    if (existing.state !== 'uploaded' || existing.digest !== `sha256:${digest}`)
      throw new Error(`The existing file ${filename} does not match this run.`);
  } else if (remote.draft) {
    run('release', 'upload', tag, '--repo', repository, path.join(directory, filename));
  } else {
    throw new Error(`The existing public release lacks ${filename}.`);
  }
}

const staged = readRelease();
verifyGitHubReleaseAssets(staged, manifest);
for (const [filename, digest] of files)
  if (staged.assets.find((asset) => asset.name === filename)?.digest !== `sha256:${digest}`)
    throw new Error(`The staged file ${filename} does not match the checked release.`);
if (staged.draft)
  run(
    'api',
    '--method',
    'PATCH',
    endpoint.pathname,
    '-F',
    'draft=false',
    '-f',
    'make_latest=legacy',
  );
const published = readRelease();
if (published.draft || published.prerelease) throw new Error(`Release ${tag} is still staged.`);
verifyGitHubReleaseAssets(published, manifest);
console.log(published.html_url);
