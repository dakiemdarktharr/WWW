import { git } from './git.ts';
import { normalizeScope } from './security.ts';
import { DomainError } from './store.ts';

const fullObjectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const gitReadArgs = [
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '--literal-pathspecs',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'protocol.allow=never',
];

/** Read only Git metadata for a path already authorized by the caller. */
export async function inspectSharedGit(repo: string, relative: string, revision?: string) {
  if (relative === '.' || normalizeScope(relative) !== relative)
    throw new DomainError('Choose one relative project file or directory.', 400);
  if (revision !== undefined && !/^[a-f0-9]{7,64}$/i.test(revision))
    throw new DomainError('Use a Git commit ID of 7 to 64 hexadecimal characters.', 400);

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^git_/i.test(key) || key.toUpperCase() === 'GIT_EXEC_PATH',
    ),
  );
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_ALLOW_PROTOCOL = '';
  const read = (args: string[], allowNoMatch = false) =>
    git(repo, [...gitReadArgs, ...args], 512 * 1024, { timeout: 5000, allowNoMatch, env });
  const readHead = async () => {
    const [prefix, head, ...rest] = (
      await read(['rev-parse', '--show-prefix', '--verify', 'HEAD^{commit}'])
    ).split(/\r?\n/);
    if (prefix || !fullObjectId.test(head) || rest.length) throw new Error('Unexpected HEAD.');
    return head;
  };
  try {
    const head = await readHead();
    const [filterKeys, history, cited] = await Promise.all([
      read(
        [
          'config',
          '--includes',
          '--null',
          '--name-only',
          '--get-regexp',
          '^filter\\..*\\.(clean|process|required)$',
        ],
        true,
      ),
      read([
        'log',
        '--no-color',
        '--no-decorate',
        '--no-notes',
        '--no-patch',
        '--no-show-signature',
        '--format=%H',
        '--max-count=5',
        head,
        '--',
        relative,
      ]),
      revision
        ? read(
            ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`],
            true,
          )
        : '',
    ]);
    const recentCommits = history ? history.split(/\r?\n/) : [];
    if (recentCommits.length > 5 || !recentCommits.every((commit) => fullObjectId.test(commit)))
      throw new Error('Unexpected commit history.');

    // Index refresh can consult a clean filter. Disable configured drivers for this command only.
    const filterDrivers = new Set<string>();
    for (const key of filterKeys.split('\0').filter(Boolean)) {
      const driver = /^filter\.([^=\x00-\x1f\ufffd]{1,128})\.(?:clean|process|required)$/.exec(
        key,
      )?.[1];
      if (!driver) throw new Error('Unsupported filter key.');
      filterDrivers.add(driver);
      if (filterDrivers.size > 32) throw new Error('Too many filter drivers.');
    }
    const disableFilters = [...filterDrivers].flatMap((driver) => [
      '-c',
      `filter.${driver}.clean=`,
      '-c',
      `filter.${driver}.process=`,
      '-c',
      `filter.${driver}.required=false`,
    ]);
    const status = await read([
      ...disableFilters,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=normal',
      '--ignore-submodules=dirty',
      '--no-renames',
      '--',
      relative,
    ]);

    let citedRevision:
      | { found: false }
      | {
          found: true;
          commit: string;
          inHead: boolean;
          touchesScope: boolean;
          matchesHead: boolean;
        }
      | undefined;
    if (revision) {
      // A ref with a hexadecimal name is not evidence for the requested object ID.
      if (!fullObjectId.test(cited) || !cited.startsWith(revision.toLowerCase())) {
        citedRevision = { found: false };
      } else {
        const entry = (commit: string) => read(['ls-tree', '-z', commit, '--', relative]);
        const [common, changed, headEntry, citedEntry] = await Promise.all([
          read(['merge-base', cited, head], true),
          read([
            'diff-tree',
            '--root',
            '--no-commit-id',
            '--no-renames',
            '--no-ext-diff',
            '--no-textconv',
            '--ignore-submodules=none',
            '-m',
            '-r',
            '-z',
            '--name-only',
            cited,
            '--',
            relative,
          ]),
          entry(head),
          entry(cited),
        ]);
        citedRevision = {
          found: true,
          commit: cited,
          inHead: common === cited,
          touchesScope: changed.length > 0,
          matchesHead: headEntry === citedEntry,
        };
      }
    }
    if ((await readHead()) !== head) throw new Error('HEAD moved.');
    return {
      head,
      dirty: status.length > 0,
      ...(filterDrivers.size ? { statusUsesDisabledFilters: true as const } : {}),
      recentCommits,
      ...(citedRevision ? { citedRevision } : {}),
    };
  } catch {
    throw new DomainError('Git metadata for this scope is unavailable.');
  }
}
