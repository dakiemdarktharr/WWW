import type { Member, Task } from '../shared/types.ts';
import { git, taskDiff } from './git.ts';
import { DomainError } from './store.ts';

function validateFiles(task: Task, files: string[]) {
  if (
    files.some((file) =>
      /(^|\/)(?:auth\.json|\.env(?:\.|$)|\.(?:git|relay|aws|ssh|codex)(?:\/|$))/i.test(file),
    )
  )
    throw new DomainError('Private account/configuration files cannot be checkpointed.');
  if (
    files.some(
      (file) =>
        !task.scope.some(
          (scope) =>
            scope === '.' ||
            file.toLowerCase() === scope.toLowerCase() ||
            file.toLowerCase().startsWith(scope.toLowerCase() + '/'),
        ),
    )
  )
    throw new DomainError('Checkpoint contains changes outside the task scope.');
}
/** Push only to the operator-configured origin. Hooks and owner attribution remain enabled. */
export async function checkpointProgress(task: Task, owner: Member['owner']) {
  if (!task.worktree || !task.branch || !task.baseCommit)
    throw new DomainError('This task has no worktree checkpoint to push.');
  if (
    !owner ||
    !owner.login ||
    !owner.name ||
    !owner.email ||
    /[\r\n<>\x00]/.test(owner.name + owner.email) ||
    !/^[^\s@]+@[^\s@]+$/.test(owner.email)
  )
    throw new DomainError(
      'Configure this account’s GitHub owner name and author email in Team before handoff.',
    );
  if ((await git(task.worktree, ['branch', '--show-current'])) !== task.branch)
    throw new DomainError('The session branch changed. Inspect it before checkpointing.');
  await git(task.worktree, ['remote', 'get-url', 'origin']);
  validateFiles(task, (await taskDiff(task.worktree, task.baseCommit)).files);
  await git(task.worktree, ['diff', '--check']);
  await git(task.worktree, ['add', '--all']);
  if (await git(task.worktree, ['diff', '--cached', '--name-only']))
    await git(task.worktree, [
      '-c',
      'user.name=RELAY',
      '-c',
      'user.email=relay@localhost',
      'commit',
      `--author=${owner.name} <${owner.email}>`,
      '-m',
      `checkpoint: ${task.title}`,
    ]);
  // Validate every outgoing commit, including hook edits and reverted private files.
  const commits = (await git(task.worktree, ['rev-list', `${task.baseCommit}..HEAD`]))
    .split('\n')
    .filter(Boolean);
  if (commits.length > 100)
    throw new DomainError(
      'Checkpoint history is too large for automatic validation. Inspect the branch.',
    );
  for (const commit of commits) {
    const names = await git(task.worktree, [
      'diff-tree',
      '--root',
      '-m',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      commit,
    ]);
    validateFiles(task, names.split('\0').filter(Boolean));
    const patch = await git(task.worktree, ['show', '--format=', '--no-ext-diff', commit]);
    if (
      /\b(?:sk-|gh[opsu]_)[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
        patch,
      )
    )
      throw new DomainError(
        'Potential credentials in outgoing history. Inspect the checkpoint before pushing.',
      );
  }
  if (await git(task.worktree, ['status', '--porcelain']))
    throw new DomainError('A hook left additional changes. Inspect them before retrying handoff.');
  const sha = await git(task.worktree, ['rev-parse', 'HEAD']);
  await git(task.worktree, ['push', 'origin', `HEAD:refs/heads/${task.branch}`]);
  const remote = await git(task.worktree, ['ls-remote', 'origin', `refs/heads/${task.branch}`]);
  if (remote.split(/\s+/)[0] !== sha)
    throw new DomainError('Remote did not confirm the checkpoint SHA. Ownership was retained.');
  return {
    branch: task.branch,
    commitSha: sha,
    remote: 'origin',
    testEvidence: 'git diff --check passed; outgoing commit scope and private-path checks passed.',
  };
}
