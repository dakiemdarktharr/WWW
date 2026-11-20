import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, realpath, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskDiff } from '../shared/types.ts';
import { DomainError } from './store.ts';
import { inside } from './security.ts';
const exec = promisify(execFile);
const MAX_INITIAL_PROJECT_FILES = 20_000;
const MAX_INITIAL_PROJECT_BYTES = 512 * 1024 * 1024;
export async function git(
  cwd: string,
  args: string[],
  maxBuffer = 4 * 1024 * 1024,
  options: { preserveOutput?: boolean } = {},
): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args,
      {
        cwd,
        windowsHide: true,
        timeout: 30000,
        maxBuffer,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no',
        },
      },
    );
    return options.preserveOutput ? stdout : stdout.trimEnd();
  } catch (error) {
    const e = error as Error & { stderr?: string };
    throw new DomainError((e.stderr || e.message).slice(0, 2000));
  }
}
export async function validateRepo(input: string): Promise<string> {
  return prepareProjectRepo(input);
}
const projectInitializations = new Map<
  string,
  { promise: Promise<string>; initializeGit: boolean }
>();
export async function prepareProjectRepo(input: string, initializeGit = false): Promise<string> {
  if (!path.isAbsolute(input))
    throw new DomainError('Choose an absolute path to a project folder.', 400);
  let resolved: string;
  try {
    resolved = await realpath(input);
  } catch {
    throw new DomainError('Choose a folder that exists on this computer.', 400);
  }
  if (!(await lstat(resolved)).isDirectory())
    throw new DomainError('Choose a folder, not a file.', 400);
  const key =
    process.platform === 'win32'
      ? path.normalize(resolved).toLowerCase()
      : path.normalize(resolved);
  const pending = projectInitializations.get(key);
  if (pending) {
    if (!initializeGit && pending.initializeGit)
      return pending.promise.then(() => {
        throw new DomainError(
          'This folder is being initialized. Retry connecting when it finishes.',
        );
      });
    if (!initializeGit || pending.initializeGit) return pending.promise;
    return pending.promise.catch(() => undefined).then(() => prepareProjectRepo(input, true));
  }
  const operation = prepareResolvedProjectRepo(resolved, initializeGit).finally(() => {
    if (projectInitializations.get(key)?.promise === operation) projectInitializations.delete(key);
  });
  projectInitializations.set(key, { promise: operation, initializeGit });
  return operation;
}
async function prepareResolvedProjectRepo(input: string, initializeGit: boolean): Promise<string> {
  let root: string;
  try {
    root = await git(input, ['rev-parse', '--show-toplevel']);
  } catch (error) {
    if (!/not a git repository/i.test((error as Error).message)) throw error;
    if (!initializeGit)
      throw new DomainError(
        'This folder is not a Git repository. Choose “Start from a folder” to prepare it.',
        400,
      );
    await git(input, ['init', '--initial-branch=main']);
    root = await git(input, ['rev-parse', '--show-toplevel']);
  }
  const actual = await realpath(root);
  if (path.normalize(input).toLowerCase() !== path.normalize(actual).toLowerCase())
    throw new DomainError('Select the repository root, not a subfolder.', 400);
  try {
    await git(actual, ['rev-parse', '--verify', 'HEAD']);
  } catch (error) {
    if (!/needed a single revision|ambiguous argument ['"]HEAD['"]/i.test((error as Error).message))
      throw error;
    if (!initializeGit)
      throw new DomainError(
        'This Git repository has no commits yet. Choose “Start from a folder” to create its starting commit.',
        400,
      );
    await createInitialProjectCommit(actual);
    await git(actual, ['rev-parse', '--verify', 'HEAD']);
  }
  return actual;
}
async function createInitialProjectCommit(root: string) {
  const excludePath = path.resolve(
    root,
    await git(root, ['rev-parse', '--git-path', 'info/exclude']),
  );
  await mkdir(path.dirname(excludePath), { recursive: true });
  let exclusions = '';
  try {
    const info = await lstat(excludePath);
    if (!info.isFile() || info.isSymbolicLink())
      throw new DomainError('Git’s local exclude file must be a regular file.', 400);
    exclusions = await readFile(excludePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const marker = '# Kivuno initial project snapshot safety rules';
  if (!exclusions.includes(marker)) {
    const privatePatterns = [
      marker,
      '**/.env',
      '**/.env.*',
      '**/auth.json',
      '**/oauth_creds.json',
      '**/google_accounts.json',
      '**/mcp_config.json',
      '**/.mcp.json',
      '**/.claude.json',
      '**/credentials',
      '**/credentials.*',
      '**/.credentials',
      '**/.credentials.*',
      '**/credentials/',
      '**/.relay/',
      '**/.aws/',
      '**/.ssh/',
      '**/.codex/',
      '**/.gemini/',
      '**/.claude/',
      '**/.antigravity/',
      '**/id_rsa',
      '**/id_ed25519',
      '**/*.pem',
      '**/*.p12',
      '**/*.pfx',
      '**/*.key',
    ].join('\n');
    await writeFile(
      excludePath,
      exclusions + (exclusions && !exclusions.endsWith('\n') ? '\n' : '') + privatePatterns + '\n',
      'utf8',
    );
  }
  const stagedPaths = (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
  const untrackedPaths = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  const privatePaths = stagedPaths.filter(isPrivateInitialPath);
  for (let index = 0; index < privatePaths.length; index += 100)
    await git(root, [
      '--literal-pathspecs',
      'rm',
      '--cached',
      '--force',
      '--ignore-unmatch',
      '-r',
      '--',
      ...privatePaths.slice(index, index + 100),
    ]);
  const safePaths = [
    ...new Set([...stagedPaths, ...untrackedPaths].filter((file) => !isPrivateInitialPath(file))),
  ];
  if (safePaths.length > MAX_INITIAL_PROJECT_FILES)
    throw new DomainError(
      'This folder has more than 20,000 files to snapshot. Add generated files or datasets to .gitignore, then try again.',
      400,
    );
  let totalBytes = 0;
  for (const file of safePaths) {
    try {
      const info = await lstat(path.resolve(root, file));
      if (info.isFile() && !info.isSymbolicLink()) totalBytes += info.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (totalBytes > MAX_INITIAL_PROJECT_BYTES)
      throw new DomainError(
        'This folder has more than 512 MB to snapshot. Add generated files or datasets to .gitignore, then try again.',
        400,
      );
  }
  for (let index = 0; index < safePaths.length; index += 100)
    await git(root, [
      '--literal-pathspecs',
      'add',
      '--all',
      '--',
      ...safePaths.slice(index, index + 100),
    ]);
  await git(root, [
    '-c',
    'user.name=Kivuno',
    '-c',
    'user.email=kivuno@localhost',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Initial project snapshot for Kivuno',
  ]);
}
function isPrivateInitialPath(file: string) {
  const parts = file.replaceAll('\\', '/').split('/');
  const basename = parts.at(-1) || '';
  return (
    parts.some((part) =>
      /^(?:\.relay|\.aws|\.ssh|\.codex|\.gemini|\.claude|\.antigravity|\.credentials|credentials)$/i.test(
        part,
      ),
    ) ||
    /^\.env(?:\.|$)/i.test(basename) ||
    /^(?:auth\.json|oauth_creds\.json|google_accounts\.json|mcp_config\.json|\.mcp\.json|\.claude\.json|\.?credentials(?:\.[^/]+)?|id_rsa|id_ed25519)$/i.test(
      basename,
    ) ||
    /\.(?:pem|p12|pfx|key)$/i.test(basename)
  );
}
const worktreeCreations = new Map<string, Promise<unknown>>();

export async function createWorktree(
  repo: string,
  storage: string,
  taskId: string,
  revision?: string,
) {
  const target = path.resolve(storage, 'worktrees', taskId);
  if (!inside(storage, target)) throw new Error('Invalid worktree target.');
  await mkdir(path.dirname(target), { recursive: true });
  const commonDir = await realpath(
    path.resolve(repo, await git(repo, ['rev-parse', '--git-common-dir'])),
  );
  const key = process.platform === 'win32' ? commonDir.toLowerCase() : commonDir;
  const previous = worktreeCreations.get(key);
  const branch = `relay/${taskId.slice(0, 8)}`;
  // Git reads sibling worktree metadata while creating a new entry.
  const creation = (async () => {
    await previous?.catch(() => {});
    const baseCommit = revision ?? (await git(repo, ['rev-parse', 'HEAD']));
    await git(repo, ['worktree', 'add', '-b', branch, '--', target, baseCommit]);
    return { branch, worktree: target, baseCommit };
  })();
  worktreeCreations.set(key, creation);
  try {
    return await creation;
  } finally {
    if (worktreeCreations.get(key) === creation) worktreeCreations.delete(key);
  }
}
export async function taskDiff(worktree: string, baseCommit = 'HEAD'): Promise<TaskDiff> {
  if (baseCommit !== 'HEAD' && !/^[a-f0-9]{40,64}$/i.test(baseCommit))
    throw new DomainError('Invalid task base commit.');
  const stat = await git(worktree, ['diff', '--stat', baseCommit]);
  const tracked = (await git(worktree, ['diff', '--name-only', '--no-renames', '-z', baseCommit]))
    .split('\0')
    .filter(Boolean);
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  const diff = await git(
    worktree,
    ['diff', '--no-ext-diff', '--no-textconv', baseCommit],
    8 * 1024 * 1024,
    { preserveOutput: true },
  );
  let note = '';
  for (const file of untracked.slice(0, 100)) {
    note += `\n\ndiff --git a/${file} b/${file}\nnew file\n`;
    const target = path.resolve(worktree, file);
    if (!inside(worktree, target) || /(^|\/)(?:\.env(?:\.|$)|auth\.json)/i.test(file)) {
      note += '[Private path omitted]\n';
      continue;
    }
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100000) {
      note += '[Binary, symlink or large file: inspect locally]\n';
      continue;
    }
    const bytes = await readFile(target);
    note += bytes.includes(0)
      ? '[Binary file]\n'
      : bytes
          .toString('utf8')
          .split('\n')
          .map((l) => '+' + l)
          .join('\n');
    if (note.length > 250000) break;
  }
  return {
    diff: (diff + note).slice(0, 250000),
    files: [...tracked, ...untracked],
    stat: stat || `${untracked.length} new files`,
    truncated: untracked.length > 100 || diff.length + note.length > 250000,
  };
}
async function reviewedFiles(root: string, files: string[]) {
  return JSON.stringify(
    await Promise.all(
      [...new Set(files)].sort().map(async (file) => {
        try {
          const location = path.join(root, file);
          const info = await lstat(location);
          if (!info.isFile() || info.size > 100000)
            throw new DomainError('Review the non-text change locally.');
          return [
            file,
            info.mode,
            createHash('sha256')
              .update(await readFile(location))
              .digest('hex'),
          ];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return [file, 'deleted'];
        }
      }),
    ),
  );
}

/** Check the reviewed working files across Git's untracked → staged representation change. */
export async function stageReviewedTree(
  root: string,
  baseCommit: string,
  verifyReview?: (diff: TaskDiff) => Promise<void>,
) {
  if (!verifyReview) {
    await git(root, ['add', '--all']);
    return undefined;
  }
  const diff = await taskDiff(root, baseCommit);
  await verifyReview(diff);
  const reviewed = await reviewedFiles(root, diff.files);
  await verifyReview(await taskDiff(root, baseCommit));
  await git(root, ['add', '--all']);
  const staged = (
    await git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z', baseCommit])
  )
    .split('\0')
    .filter(Boolean);
  if (reviewed !== (await reviewedFiles(root, staged)))
    throw new DomainError(
      'Files changed after independent review. Inspect the staged files and review again.',
    );
  await git(root, ['diff', '--quiet']);
  return git(root, ['write-tree']);
}

export interface IntegrationOptions {
  baseCommit?: string;
  skipAlreadyPresent?: boolean;
  requireReviewedFiles?: boolean;
  verifyMachineInput?: () => Promise<void>;
  verifyReview?: (diff: TaskDiff) => Promise<void>;
  validateDiff?: (
    diff: TaskDiff,
    context?: { root: string; phase: 'worker' | 'staged' | 'committed' },
  ) => void | Promise<void>;
}
export async function changedTreeFiles(
  repo: string,
  from: string,
  to: string,
  files: string[] = [],
) {
  return (
    await git(repo, [
      '--literal-pathspecs',
      'diff',
      '--name-only',
      '--no-renames',
      '--no-ext-diff',
      '--ignore-submodules=none',
      '-z',
      from,
      to,
      '--',
      ...files,
    ])
  )
    .split('\0')
    .filter(Boolean);
}

export async function integrate(
  repo: string,
  worktree: string,
  branch: string,
  title: string,
  options: IntegrationOptions = {},
) {
  if (await git(repo, ['status', '--porcelain']))
    throw new DomainError(
      'The project has uncommitted changes. Commit or stash them before integration.',
    );
  const projectBranch = await git(repo, ['branch', '--show-current']);
  if (!projectBranch) throw new DomainError('Check out a named project branch before integration.');
  const startingHead = await git(repo, ['rev-parse', 'HEAD']);
  const assertProjectUnchanged = async () => {
    if (
      (await git(repo, ['rev-parse', 'HEAD'])) !== startingHead ||
      (await git(repo, ['branch', '--show-current'])) !== projectBranch ||
      (await git(repo, ['status', '--porcelain']))
    )
      throw new DomainError(
        'The project changed while preparing integration. Review it before retrying.',
      );
  };
  const workerBranch = await git(worktree, ['branch', '--show-current']);
  if (workerBranch !== branch)
    throw new DomainError('The worktree branch changed. Inspect it before integrating.');
  const baseCommit =
    options.baseCommit || (await git(worktree, ['merge-base', 'HEAD', startingHead]));
  let reviewedTree = await stageReviewedTree(worktree, baseCommit, options.verifyReview);
  if (options.verifyMachineInput) {
    reviewedTree ??= await git(worktree, ['write-tree']);
    await options.verifyMachineInput();
    await git(worktree, ['diff', '--quiet']);
    if (
      (await git(worktree, ['write-tree'])) !== reviewedTree ||
      (await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']))
    )
      throw new DomainError('The staged patch changed during paired-machine verification.');
  }
  const checkTargetTree = (tree: string) => {
    if (options.verifyMachineInput && tree !== reviewedTree)
      throw new DomainError(
        'The integration tree differs from the paired-machine check. Update the worktree to the target branch and rerun the check.',
      );
  };
  let affectedPaths = new Set<string>();
  if (reviewedTree && (options.skipAlreadyPresent || options.requireReviewedFiles)) {
    const workerHead = await git(worktree, ['rev-parse', 'HEAD']);
    // Include inherited prerequisite changes, even though the worker's review omits them.
    const mergeBase = await git(worktree, ['merge-base', workerHead, startingHead]);
    const [different, ...affected] = await Promise.all([
      options.skipAlreadyPresent ? changedTreeFiles(worktree, startingHead, reviewedTree) : [],
      ...[...new Set([baseCommit, mergeBase])].map((base) =>
        changedTreeFiles(worktree, base, reviewedTree!),
      ),
    ]);
    affectedPaths = new Set(affected.flat());
    const alreadyPresent =
      options.skipAlreadyPresent &&
      affectedPaths.size > 0 &&
      !different.some((file) => affectedPaths.has(file));
    if (alreadyPresent) {
      await options.validateDiff?.(await taskDiff(worktree, baseCommit), {
        root: worktree,
        phase: 'worker',
      });
      if (
        (await git(worktree, ['rev-parse', 'HEAD'])) !== workerHead ||
        (await git(worktree, ['branch', '--show-current'])) !== branch ||
        (await git(worktree, ['write-tree'])) !== reviewedTree ||
        (await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']))
      )
        throw new DomainError('The reviewed worktree changed while checking the project branch.');
      await git(worktree, ['diff', '--quiet']);
      await assertProjectUnchanged();
      if (options.verifyMachineInput)
        checkTargetTree(await git(repo, ['rev-parse', 'HEAD^{tree}']));
      return { revision: startingHead, alreadyPresent: true };
    }
  }
  if (await git(worktree, ['diff', '--cached', '--name-only']))
    await git(worktree, [
      '-c',
      'user.name=RELAY',
      '-c',
      'user.email=relay@localhost',
      'commit',
      '-m',
      `RELAY: ${title}`,
    ]);
  // Hooks are intentionally honored. Revalidate their changes before the project
  // is touched instead of assuming the earlier UI review still describes them.
  if (options.validateDiff)
    await options.validateDiff(await taskDiff(worktree, baseCommit), {
      root: worktree,
      phase: 'worker',
    });
  const workerHead = await git(worktree, ['rev-parse', 'HEAD']);
  if (reviewedTree && (await git(worktree, ['rev-parse', `${workerHead}^{tree}`])) !== reviewedTree)
    throw new DomainError(
      'A worker hook changed the reviewed files. Review the resulting diff before integration.',
    );
  await assertProjectUnchanged();
  try {
    // Import the final proposal only. Worker commits can contain reverted private
    // or out-of-scope files and must not become ancestors of the project branch.
    await git(repo, [
      '-c',
      'user.name=RELAY',
      '-c',
      'user.email=relay@localhost',
      'merge',
      '--squash',
      '--',
      workerHead,
    ]);
    if (options.validateDiff)
      await options.validateDiff(await taskDiff(repo, startingHead), {
        root: repo,
        phase: 'staged',
      });
    const stagedTree = reviewedTree ? await git(repo, ['write-tree']) : undefined;
    if (stagedTree) checkTargetTree(stagedTree);
    if (
      options.requireReviewedFiles &&
      reviewedTree &&
      stagedTree &&
      stagedTree !== reviewedTree &&
      (await changedTreeFiles(repo, reviewedTree, stagedTree)).some((file) =>
        affectedPaths.has(file),
      )
    )
      throw new DomainError(
        'The merged files differ from the independent review. Reconcile the changes and request another review.',
        409,
      );
    const stagedChanges = await git(repo, ['diff', '--cached', '--name-only']);
    if (options.skipAlreadyPresent && reviewedTree && !stagedChanges)
      throw new DomainError(
        'The project branch differs from the reviewed result and there is no change to integrate. Review the current branch before retrying.',
      );
    if (stagedChanges)
      await git(repo, [
        '-c',
        'user.name=RELAY',
        '-c',
        'user.email=relay@localhost',
        'commit',
        '-m',
        `RELAY: ${title}`,
      ]);
    if (stagedTree && (await git(repo, ['rev-parse', 'HEAD^{tree}'])) !== stagedTree)
      throw new DomainError(
        'A project hook changed the reviewed integration. Inspect the project before retrying.',
      );
    if (options.validateDiff)
      await options.validateDiff(await taskDiff(repo, startingHead), {
        root: repo,
        phase: 'committed',
      });
    return { revision: await git(repo, ['rev-parse', 'HEAD']), alreadyPresent: false };
  } catch (error) {
    // --squash does not create MERGE_HEAD, so merge --abort cannot clean up its
    // conflicts. --merge restores the initial index/tree without a hard reset.
    try {
      await git(repo, ['reset', '--merge', startingHead]);
    } catch (rollbackError) {
      throw new DomainError(
        `${(error as Error).message}\nAutomatic rollback could not finish; inspect the project before retrying: ${(rollbackError as Error).message}`,
      );
    }
    throw error;
  }
}
