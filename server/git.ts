import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskDiff } from '../shared/types.ts';
import { DomainError } from './store.ts';
import { inside } from './security.ts';
const exec = promisify(execFile);
export async function git(
  cwd: string,
  args: string[],
  maxBuffer = 4 * 1024 * 1024,
): Promise<string> {
  try {
    const { stdout } = await exec('git', args, {
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
    });
    return stdout.trimEnd();
  } catch (error) {
    const e = error as Error & { stderr?: string };
    throw new DomainError((e.stderr || e.message).slice(0, 2000));
  }
}
export async function validateRepo(input: string): Promise<string> {
  if (!path.isAbsolute(input))
    throw new DomainError('Choose an absolute path to an existing Git repository.', 400);
  const resolved = await realpath(input);
  const root = await git(resolved, ['rev-parse', '--show-toplevel']);
  const actual = await realpath(root);
  if (path.normalize(resolved).toLowerCase() !== path.normalize(actual).toLowerCase())
    throw new DomainError('Select the repository root, not a subfolder.', 400);
  await git(actual, ['rev-parse', '--verify', 'HEAD']);
  return actual;
}
export async function createWorktree(repo: string, storage: string, taskId: string) {
  const target = path.resolve(storage, 'worktrees', taskId);
  if (!inside(storage, target)) throw new Error('Invalid worktree target.');
  await mkdir(path.dirname(target), { recursive: true });
  const branch = `relay/${taskId.slice(0, 8)}`;
  const baseCommit = await git(repo, ['rev-parse', 'HEAD']);
  await git(repo, ['worktree', 'add', '-b', branch, '--', target, baseCommit]);
  return { branch, worktree: target, baseCommit };
}
export async function taskDiff(worktree: string, baseCommit = 'HEAD'): Promise<TaskDiff> {
  if (baseCommit !== 'HEAD' && !/^[a-f0-9]{40,64}$/i.test(baseCommit))
    throw new DomainError('Invalid task base commit.');
  const stat = await git(worktree, ['diff', '--stat', baseCommit]);
  const tracked = (await git(worktree, ['diff', '--name-only', '-z', baseCommit]))
    .split('\0')
    .filter(Boolean);
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  const diff = await git(
    worktree,
    ['diff', '--no-ext-diff', '--no-textconv', baseCommit],
    8 * 1024 * 1024,
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
    if (stat.isSymbolicLink() || stat.size > 100000) {
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
    truncated: diff.length + note.length > 250000,
  };
}
export interface IntegrationOptions {
  baseCommit?: string;
  validateDiff?: (
    diff: TaskDiff,
    context?: { root: string; phase: 'worker' | 'staged' | 'committed' },
  ) => void | Promise<void>;
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
  if (!(await git(repo, ['branch', '--show-current'])))
    throw new DomainError('Check out a named project branch before integration.');
  const startingHead = await git(repo, ['rev-parse', 'HEAD']);
  const workerBranch = await git(worktree, ['branch', '--show-current']);
  if (workerBranch !== branch)
    throw new DomainError('The worktree branch changed. Inspect it before integrating.');
  const baseCommit =
    options.baseCommit || (await git(worktree, ['merge-base', 'HEAD', startingHead]));
  await git(worktree, ['add', '--all']);
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
  if (
    (await git(repo, ['rev-parse', 'HEAD'])) !== startingHead ||
    (await git(repo, ['status', '--porcelain']))
  )
    throw new DomainError(
      'The project changed while preparing integration. Review it before retrying.',
    );
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
    if (await git(repo, ['diff', '--cached', '--name-only']))
      await git(repo, [
        '-c',
        'user.name=RELAY',
        '-c',
        'user.email=relay@localhost',
        'commit',
        '-m',
        `RELAY: ${title}`,
      ]);
    if (options.validateDiff)
      await options.validateDiff(await taskDiff(repo, startingHead), {
        root: repo,
        phase: 'committed',
      });
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
