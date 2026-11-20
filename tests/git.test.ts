import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Workspace } from '../server/service.ts';
import { reviewDigest } from '../server/sade.ts';
import { canonicalSharedRepository } from '../server/shared-sade-worker.ts';
import { Store } from '../server/store.ts';
import type { Task, TaskDiff } from '../shared/types.ts';
import {
  createWorktree,
  git,
  integrate,
  prepareProjectRepo,
  taskDiff,
  validateRepo,
} from '../server/git.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-git-test-'));
  const repo = path.join(root, 'repo with spaces');
  const storage = path.join(root, 'private runtime');
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'RELAY test']);
  await git(repo, ['config', 'user.email', 'relay-test@example.test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(repo, 'shared.txt'), 'original\n');
  await writeFile(path.join(repo, '.gitignore'), '.env\n');
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '-m', 'Initial fixture']);
  t.after(async () => {
    const actual = await realpath(root);
    const tempRoot = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), tempRoot);
    assert.ok(path.basename(actual).startsWith('relay-git-test-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { root, repo, storage };
}

test('repository validation accepts a root with spaces and rejects a subdirectory', async (t) => {
  const f = await fixture(t);
  assert.equal(await validateRepo(f.repo), await realpath(f.repo));
  const subdirectory = path.join(f.repo, 'nested');
  await mkdir(subdirectory);
  await assert.rejects(validateRepo(subdirectory), /repository root/);
  await assert.rejects(validateRepo('relative/repo'), /absolute path/);
});

test('a preview with omitted untracked files is marked incomplete', async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      writeFile(path.join(f.repo, `file-${index}.txt`), ''),
    ),
  );
  const diff = await taskDiff(f.repo);
  assert.equal(diff.files.length, 101);
  assert.equal(diff.truncated, true);
});

test('ordinary folders and unborn repositories can be prepared safely for project worktrees', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kivuno-project-folder-'));
  const plain = path.join(root, 'plain folder');
  const unborn = path.join(root, 'unborn repo');
  await mkdir(path.join(plain, 'src'), { recursive: true });
  await mkdir(path.join(plain, '.gemini'), { recursive: true });
  await mkdir(unborn);
  await git(unborn, ['init', '--initial-branch=main']);
  await writeFile(path.join(plain, 'src', 'main.ts'), 'export const ready = true;\n');
  await writeFile(path.join(plain, '.env'), 'TOKEN=not-for-git\n');
  await writeFile(path.join(plain, '.env.example'), 'TOKEN=\n');
  await writeFile(path.join(plain, 'auth.json'), '{"access_token":"private"}\n');
  await writeFile(path.join(plain, '.gemini', 'oauth_creds.json'), '{"refresh_token":"private"}\n');
  await writeFile(path.join(unborn, 'README.md'), 'An empty repository still has no HEAD.\n');
  t.after(async () => {
    const actual = await realpath(root);
    const tempRoot = await realpath(os.tmpdir());
    assert.equal(path.dirname(actual), tempRoot);
    assert.ok(path.basename(actual).startsWith('kivuno-project-folder-'));
    await rm(actual, { recursive: true, force: true });
  });

  const [existingOnly, initialize] = await Promise.allSettled([
    prepareProjectRepo(plain),
    prepareProjectRepo(plain, true),
  ]);
  assert.equal(existingOnly.status, 'rejected');
  assert.match(
    String(existingOnly.status === 'rejected' && existingOnly.reason),
    /not a Git repository.*Start from a folder|folder is being initialized/,
  );
  assert.equal(initialize.status, 'fulfilled');
  await assert.rejects(prepareProjectRepo(unborn), /no commits yet.*Start from a folder/);

  assert.equal(initialize.status === 'fulfilled' && initialize.value, await realpath(plain));
  assert.equal(await prepareProjectRepo(unborn, true), await realpath(unborn));
  assert.deepEqual(
    (await git(plain, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n'),
    ['src/main.ts'],
    'credentials and env files are excluded from the initial snapshot',
  );
  assert.deepEqual((await git(unborn, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n'), [
    'README.md',
  ]);
  assert.equal(await git(plain, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(plain, '.env'), 'utf8'), 'TOKEN=not-for-git\n');
  assert.equal(
    await readFile(path.join(plain, '.gemini', 'oauth_creds.json'), 'utf8'),
    '{"refresh_token":"private"}\n',
  );
  assert.equal(await prepareProjectRepo(plain), await realpath(plain));
});

test('two real worktrees isolate edits to the same file and leave the project untouched', async (t) => {
  const f = await fixture(t);
  const origin = await createWorktree(f.repo, f.storage, 'linked-origin-0000');
  const [a, b] = await Promise.all([
    createWorktree(f.repo, f.storage, 'task-alpha-1111'),
    createWorktree(origin.worktree, f.storage, 'task-bravo-2222'),
  ]);
  await writeFile(path.join(a.worktree, 'shared.txt'), 'engineer A\n');
  await writeFile(path.join(b.worktree, 'shared.txt'), 'engineer B\n');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(path.join(a.worktree, 'shared.txt'), 'utf8'), 'engineer A\n');
  assert.equal(await readFile(path.join(b.worktree, 'shared.txt'), 'utf8'), 'engineer B\n');
  assert.equal(await git(a.worktree, ['branch', '--show-current']), a.branch);
  assert.equal(await git(b.worktree, ['branch', '--show-current']), b.branch);
  assert.notEqual(a.branch, b.branch);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
});

test('review diff shows modified and new files without including ignored secrets', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'diff-task-3333');
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'changed\n');
  await writeFile(path.join(worker.worktree, 'report.md'), 'A research result\n');
  await writeFile(path.join(worker.worktree, '.env'), 'SECRET=not-for-review\n');
  const result = await taskDiff(worker.worktree);
  assert.deepEqual([...result.files].sort(), ['report.md', 'shared.txt']);
  assert.match(result.diff, /\+changed/);
  assert.match(result.diff, /report\.md/);
  assert.doesNotMatch(result.diff, /SECRET|not-for-review/);
  assert.equal(result.truncated, false);
});

test('review against the recorded base includes agent commits as well as subsequent edits', async (t) => {
  const f = await fixture(t);
  const baseCommit = await git(f.repo, ['rev-parse', 'HEAD']);
  const worker = await createWorktree(f.repo, f.storage, 'commit-diff-7777');
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'committed by agent\n');
  await git(worker.worktree, ['add', '--all']);
  await git(worker.worktree, ['commit', '-m', 'Agent checkpoint']);
  await writeFile(path.join(worker.worktree, 'second.txt'), 'not committed yet\n');
  const result = await taskDiff(worker.worktree, baseCommit);
  assert.deepEqual([...result.files].sort(), ['second.txt', 'shared.txt']);
  assert.match(result.diff, /\+committed by agent/);
});

test('review supports Unicode artifact names without treating Git-quoted paths as filenames', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'unicode-artifact-8888');
  await writeFile(path.join(worker.worktree, 'báo cáo.md'), 'Research findings in Vietnamese.\n');
  const result = await taskDiff(worker.worktree);
  assert.deepEqual(result.files, ['báo cáo.md']);
  assert.match(result.diff, /Research findings in Vietnamese/);
});

test('integration commits an approved worktree and merges it into a clean project branch', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'merge-task-4444');
  const before = await git(f.repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'approved implementation\n');
  await writeFile(path.join(worker.worktree, 'new.txt'), 'new artifact\n');
  await integrate(f.repo, worker.worktree, worker.branch, 'Approved task');
  assert.equal(
    await readFile(path.join(f.repo, 'shared.txt'), 'utf8'),
    'approved implementation\n',
  );
  assert.equal(await readFile(path.join(f.repo, 'new.txt'), 'utf8'), 'new artifact\n');
  assert.notEqual(await git(f.repo, ['rev-parse', 'HEAD']), before);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  assert.equal(await git(worker.worktree, ['status', '--porcelain']), '');
  assert.equal(await git(f.repo, ['branch', '--show-current']), 'main');
  assert.equal(
    (await git(f.repo, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(' ').length,
    2,
  );
});

test('squash integration never imports reverted private or out-of-scope worker commit history', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'history-test-9999');
  const startingHead = await git(f.repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(worker.worktree, 'auth.json'), '{"fixture":"not-a-real-secret"}\n');
  await writeFile(
    path.join(worker.worktree, 'outside-owned-scope.txt'),
    'Should not enter the accepted history.\n',
  );
  await git(worker.worktree, ['add', '--all']);
  await git(worker.worktree, ['commit', '-m', 'Unapproved intermediate checkpoint']);
  const unapprovedCommit = await git(worker.worktree, ['rev-parse', 'HEAD']);
  await rm(path.join(worker.worktree, 'auth.json'));
  await rm(path.join(worker.worktree, 'outside-owned-scope.txt'));
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'approved final result\n');
  await git(worker.worktree, ['add', '--all']);
  await git(worker.worktree, ['commit', '-m', 'Remove unapproved intermediate files']);
  assert.deepEqual((await taskDiff(worker.worktree, startingHead)).files, ['shared.txt']);
  await integrate(f.repo, worker.worktree, worker.branch, 'Accept only the final proposal');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'approved final result\n');
  assert.equal(
    await git(f.repo, ['log', '--format=%H', 'HEAD', '--', 'auth.json', 'outside-owned-scope.txt']),
    '',
  );
  await assert.rejects(git(f.repo, ['merge-base', '--is-ancestor', unapprovedCommit, 'HEAD']));
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD^']), startingHead);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
});

test('a conflicting integration aborts the merge and preserves both histories and original files', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'conflict-5555');
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'worker proposal\n');
  await writeFile(path.join(f.repo, 'shared.txt'), 'human accepted change\n');
  await git(f.repo, ['add', '--all']);
  await git(f.repo, ['commit', '-m', 'Human change while agent worked']);
  const before = await git(f.repo, ['rev-parse', 'HEAD']);
  await assert.rejects(integrate(f.repo, worker.worktree, worker.branch, 'Conflicting proposal'));
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), before);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'human accepted change\n');
  assert.equal(
    await readFile(path.join(worker.worktree, 'shared.txt'), 'utf8'),
    'worker proposal\n',
  );
  assert.equal(await git(worker.worktree, ['status', '--porcelain']), '');
  await assert.rejects(git(f.repo, ['rev-parse', '--verify', 'MERGE_HEAD']));
});

test('accepting a reviewed change already present on the project creates no duplicate commit', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'duplicate-integration');
  const update = 'accepted in another commit\n';
  await writeFile(path.join(worker.worktree, 'shared.txt'), update);
  await writeFile(path.join(f.repo, 'shared.txt'), update);
  await writeFile(path.join(f.repo, 'unrelated.txt'), 'new work from another contributor\n');
  await git(f.repo, ['add', '--all']);
  await git(f.repo, ['commit', '-m', 'Independent equivalent change']);
  const existing = await git(f.repo, ['rev-parse', 'HEAD']);
  const originalWorker = await git(worker.worktree, ['rev-parse', 'HEAD']);
  const review = await taskDiff(worker.worktree, worker.baseCommit);
  const result = await integrate(f.repo, worker.worktree, worker.branch, 'Previously completed', {
    baseCommit: worker.baseCommit,
    skipAlreadyPresent: true,
    verifyReview: async (current) => assert.deepEqual(current, review),
  });
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), existing);
  assert.equal(await git(worker.worktree, ['rev-parse', 'HEAD']), originalWorker);
  assert.deepEqual(result, { revision: existing, alreadyPresent: true });
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
});

for (const remoteChange of [
  'unrelated file',
  'reviewed file',
  'rewritten history',
  'the same change under another commit',
  'only the final reviewed file',
] as const) {
  test(`Shared Sade checks a published revision after a teammate pushes ${remoteChange}`, async (t) => {
    const f = await fixture(t);
    const remote = path.join(f.root, 'bare remote');
    const teammate = path.join(f.root, 'teammate clone');
    const origin = 'https://example.test/shared/published-review.git';
    const base = await git(f.repo, ['rev-parse', 'HEAD']);
    const copiesReviewed =
      remoteChange === 'the same change under another commit' ||
      remoteChange === 'only the final reviewed file';
    const rewrites = remoteChange === 'rewritten history';
    await writeFile(path.join(f.repo, 'shared.txt'), 'reviewed change\n');
    const diff = await taskDiff(f.repo, base);
    if (remoteChange === 'only the final reviewed file')
      await writeFile(path.join(f.repo, 'required.txt'), 'Earlier reviewed prerequisite\n');
    await git(f.repo, ['add', '--all']);
    await git(f.repo, ['commit', '-m', 'Integrate the reviewed change']);
    const revision = await git(f.repo, ['rev-parse', 'HEAD']);
    await git(f.root, ['init', '--bare', '-b', 'main', remote]);
    await git(f.repo, ['remote', 'add', 'origin', origin]);
    await git(f.repo, ['config', `url.${remote}.insteadOf`, origin]);
    await git(f.repo, ['push', 'origin', `${copiesReviewed ? base : revision}:refs/heads/main`]);
    await git(f.repo, ['fetch', '--no-tags', 'origin', 'main']);
    await git(f.root, ['clone', '--', remote, teammate]);
    if (rewrites) await git(teammate, ['switch', '-c', 'replacement', base]);
    const file = remoteChange === 'reviewed file' || copiesReviewed ? 'shared.txt' : 'team.txt';
    await writeFile(
      path.join(teammate, file),
      copiesReviewed ? 'reviewed change\n' : 'unrelated teammate update\n',
    );
    await git(teammate, ['add', file]);
    if (copiesReviewed) {
      await writeFile(path.join(teammate, 'team.txt'), 'Separate teammate change\n');
      await git(teammate, ['add', 'team.txt']);
    }
    await git(teammate, [
      '-c',
      'user.name=Team fixture',
      '-c',
      'user.email=team@example.test',
      'commit',
      '-m',
      'Teammate update',
    ]);
    const tip = await git(teammate, ['rev-parse', 'HEAD']);
    assert.notEqual(tip, revision);
    if (rewrites || copiesReviewed)
      await assert.rejects(git(teammate, ['merge-base', '--is-ancestor', revision, tip]));
    await git(teammate, [
      'push',
      ...(rewrites ? [`--force-with-lease=refs/heads/main:${revision}`] : []),
      'origin',
      'HEAD:refs/heads/main',
    ]);
    await assert.rejects(git(f.repo, ['cat-file', '-e', `${tip}^{commit}`]));
    const refs = await git(f.repo, ['show-ref']);
    const fetchHead = await git(f.repo, ['rev-parse', 'FETCH_HEAD']);

    const store = new Store(':memory:');
    const workspace = new Workspace(store, f.root, f.repo);
    t.after(async () => {
      await workspace.close();
      store.close();
    });
    const projectId = randomUUID();
    const grantId = randomUUID();
    const jobId = randomUUID();
    store.put('project', { id: projectId, path: f.repo, name: 'Publication fixture' });
    const task = store.put('task', {
      id: randomUUID(),
      projectId,
      status: 'done',
      sharedSadeJobId: jobId,
      sharedSadeNeedsPublication: true,
    });
    store.put('sharedSadeLocalGrant', {
      id: grantId,
      projectId,
      projectKey: canonicalSharedRepository(origin, 'main'),
      expiresAt: Date.now() + 60_000,
    });
    const receipt = store.put('sharedSadeLocalReceipt', {
      id: jobId,
      grantId,
      phase: 'task',
      reviewedDigest: reviewDigest(diff),
      revision,
      result: { kind: 'change', diff, summary: 'Reviewed draft.' },
    });
    t.mock.method(workspace.sharedSade, 'assertCurrent', (id: string) => assert.equal(id, jobId));
    if (
      remoteChange === 'unrelated file' ||
      remoteChange === 'the same change under another commit'
    ) {
      assert.deepEqual(await workspace.sharedSade.shareRevision(task.id), { shared: true });
      assert.deepEqual(store.get<typeof receipt>('sharedSadeLocalReceipt', jobId).result, {
        kind: 'done',
        revision: copiesReviewed ? tip : revision,
        published: true,
        summary: copiesReviewed
          ? 'The reviewed changes are already on the linked branch.'
          : 'Integrated reviewed changes.',
      });
    } else {
      const reason =
        remoteChange === 'reviewed file' ? /reviewed files/ : /Publish the integrated revision/;
      await assert.rejects(workspace.sharedSade.shareRevision(task.id), reason);
      assert.deepEqual(store.get('sharedSadeLocalReceipt', jobId), receipt);
    }
    assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), revision);
    assert.equal(await git(f.repo, ['rev-parse', 'FETCH_HEAD']), fetchHead);
    assert.equal(await git(f.repo, ['show-ref']), refs);
    assert.equal(await git(f.repo, ['status', '--porcelain']), '');
    assert.equal(await git(f.root, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']), tip);
  });
}

test('a prior merge does not prove the current branch already has the full reviewed change', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'stale-duplicate');
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'first worker change\n');
  await git(worker.worktree, ['add', 'shared.txt']);
  await git(worker.worktree, ['commit', '-m', 'First worker change']);
  await git(f.repo, ['merge', '--ff-only', worker.branch]);
  await writeFile(path.join(f.repo, 'shared.txt'), 'replacement from another contributor\n');
  await writeFile(path.join(f.repo, 'followup.txt'), 'same followup content\n');
  await git(f.repo, ['add', '--all']);
  await git(f.repo, ['commit', '-m', 'Replace first change and add followup']);
  const projectHead = await git(f.repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(worker.worktree, 'followup.txt'), 'same followup content\n');
  const review = await taskDiff(worker.worktree, worker.baseCommit);
  await assert.rejects(
    integrate(f.repo, worker.worktree, worker.branch, 'Full reviewed change', {
      baseCommit: worker.baseCommit,
      skipAlreadyPresent: true,
      verifyReview: async (current) => assert.deepEqual(current, review),
    }),
    /project branch differs from the reviewed result/,
  );
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), projectHead);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  assert.equal(
    await readFile(path.join(f.repo, 'shared.txt'), 'utf8'),
    'replacement from another contributor\n',
  );
});

for (const sameFile of [true, false]) {
  test(`Shared Sade ${sameFile ? 'stops an unreviewed clean merge within a file' : 'preserves unrelated commits during reviewed integration'}`, async (t) => {
    const f = await fixture(t);
    const base = ['header', 'one', 'two', 'three', 'four', 'five', 'six', 'footer', ''].join('\n');
    await writeFile(path.join(f.repo, 'shared.txt'), base);
    await git(f.repo, ['add', 'shared.txt']);
    await git(f.repo, ['commit', '-m', 'Add the common starting document']);
    const worker = await createWorktree(f.repo, f.storage, 'reviewed-integration');
    const reviewed = base.replace('footer', 'reviewed footer');
    await writeFile(path.join(worker.worktree, 'shared.txt'), reviewed);
    const teammate = base.replace('header', 'teammate header');
    const teammateFile = sameFile ? 'shared.txt' : 'team.txt';
    await writeFile(path.join(f.repo, teammateFile), teammate);
    await git(f.repo, ['add', teammateFile]);
    await git(f.repo, ['commit', '-m', 'Independent teammate change']);
    const projectHead = await git(f.repo, ['rev-parse', 'HEAD']);
    const preview = await taskDiff(worker.worktree, worker.baseCommit);
    const store = new Store(':memory:');
    const workspace = new Workspace(store, f.root, f.repo);
    t.after(async () => {
      await workspace.close();
      store.close();
    });
    const project = store.put('project', {
      id: randomUUID(),
      name: 'Shared project',
      path: f.repo,
      goal: '',
      createdAt: new Date().toISOString(),
    });
    const task = store.addTask({
      projectId: project.id,
      title: 'Reviewed update',
      kind: 'code',
      scope: ['shared.txt'],
      description: 'Update the footer.',
      priority: 'medium',
      dependsOn: [],
      acceptance: 'Change just the footer.',
    });
    const jobId = randomUUID();
    store.put('sharedSadeLocalReceipt', { id: jobId });
    store.updateTask(task.id, { ...worker, status: 'review', sharedSadeJobId: jobId });
    t.mock.method(workspace.sharedSade, 'assertReviewed', async (id: string, diff: TaskDiff) => {
      assert.equal(id, jobId);
      assert.deepEqual(diff, preview);
    });
    const accept = () => workspace.accept(task.id);
    if (sameFile) {
      await assert.rejects(accept, /merged files differ from the independent review/i);
      assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), projectHead);
      assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), teammate);
      assert.equal(await readFile(path.join(worker.worktree, 'shared.txt'), 'utf8'), reviewed);
      assert.equal(store.get<Task>('task', task.id).status, 'review');
      assert.equal(
        store.get<{ revision?: string }>('sharedSadeLocalReceipt', jobId).revision,
        undefined,
      );
    } else {
      assert.equal((await accept()).status, 'done');
      assert.equal(await git(f.repo, ['rev-parse', 'HEAD^']), projectHead);
      assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), reviewed);
      assert.equal(await readFile(path.join(f.repo, teammateFile), 'utf8'), teammate);
    }
    assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  });
}

test('dirty project preflight does not stage or commit the agent worktree', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'dirty-task-6666');
  await writeFile(path.join(f.repo, 'shared.txt'), 'unsaved user work\n');
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'agent proposal\n');
  const head = await git(worker.worktree, ['rev-parse', 'HEAD']);
  await assert.rejects(
    integrate(f.repo, worker.worktree, worker.branch, 'Do not overwrite user work'),
    /uncommitted changes/,
  );
  assert.equal(await git(worker.worktree, ['rev-parse', 'HEAD']), head);
  assert.equal(await git(worker.worktree, ['diff', '--cached', '--name-only']), '');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'unsaved user work\n');
});

test('worker commit hooks are honored and their out-of-scope additions are rejected before integration', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'worker-hook-1010');
  const startingHead = await git(f.repo, ['rev-parse', 'HEAD']);
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  await writeFile(
    hook,
    '#!/bin/sh\ncase "$(git branch --show-current)" in\nrelay/*)\n  printf "hook-created file\\n" > outside.txt\n  git add -- outside.txt\n  ;;\nesac\n',
  );
  await chmod(hook, 0o755);
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'approved scoped change\n');
  await assert.rejects(
    integrate(f.repo, worker.worktree, worker.branch, 'Scoped task', {
      baseCommit: startingHead,
      validateDiff(diff) {
        if (diff.files.some((file) => file !== 'shared.txt'))
          throw new Error('Outside the approved scope');
      },
    }),
    /Outside the approved scope/,
  );
  assert.equal(
    await readFile(path.join(worker.worktree, 'outside.txt'), 'utf8'),
    'hook-created file\n',
  );
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), startingHead);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'original\n');
});

test('project commit hooks are honored and a scope violation rolls back only the integration', async (t) => {
  const f = await fixture(t);
  const worker = await createWorktree(f.repo, f.storage, 'project-hook-2020');
  const startingHead = await git(f.repo, ['rev-parse', 'HEAD']);
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  await writeFile(
    hook,
    '#!/bin/sh\nif [ "$(git branch --show-current)" = "main" ]; then\n  printf "main-hook addition\\n" > outside.txt\n  git add -- outside.txt\nfi\n',
  );
  await chmod(hook, 0o755);
  await writeFile(path.join(worker.worktree, 'shared.txt'), 'approved scoped change\n');
  await assert.rejects(
    integrate(f.repo, worker.worktree, worker.branch, 'Scoped task', {
      baseCommit: startingHead,
      validateDiff(diff) {
        if (diff.files.some((file) => file !== 'shared.txt'))
          throw new Error('Outside the approved scope');
      },
    }),
    /Outside the approved scope/,
  );
  assert.equal(await git(f.repo, ['rev-parse', 'HEAD']), startingHead);
  assert.equal(await git(f.repo, ['status', '--porcelain']), '');
  assert.equal(await readFile(path.join(f.repo, 'shared.txt'), 'utf8'), 'original\n');
  assert.equal(
    await readFile(path.join(worker.worktree, 'shared.txt'), 'utf8'),
    'approved scoped change\n',
  );
  await assert.rejects(readFile(path.join(f.repo, 'outside.txt'), 'utf8'), /ENOENT/);
});
