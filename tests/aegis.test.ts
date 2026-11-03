import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import ganache from 'ganache';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  AbiCoder,
  keccak256,
  parseEther,
} from 'ethers';
import artifact from '../shared/aegis-artifact.json' with { type: 'json' };
import { Aegis, evidenceDigest } from '../server/aegis.ts';
import { Store } from '../server/store.ts';
import { git, createWorktree, integrate } from '../server/git.ts';
import type { Handoff, Project, Task } from '../shared/types.ts';

async function fixture(t: TestContext, chainId = 43113) {
  const server = ganache.server({
    chain: { chainId, hardfork: 'shanghai' },
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 10 },
  });
  await server.listen(0, '127.0.0.1');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test EVM address');
  const url = `http://127.0.0.1:${address.port}`;
  const provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1, pollingInterval: 10 });
  const accounts = server.provider.getInitialAccounts();
  const [owner, executor, stranger] = Object.values(accounts).map(
    (account) => new Wallet(account.secretKey, provider),
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-aegis-'));
  const store = new Store(path.join(root, 'state.db'));
  const aegis = new Aegis(store, root, { testRpcUrl: url });
  t.after(async () => {
    aegis.close();
    provider.destroy();
    store.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return { server, provider, owner, executor, stranger, root, store, aegis };
}
async function deployed(t: TestContext) {
  const f = await fixture(t);
  await f.aegis.setup();
  const status = await f.aegis.status();
  await (
    await f.owner.sendTransaction({ to: status.ownerAddress!, value: parseEther('1') })
  ).wait();
  await f.aegis.deploy();
  return f;
}
async function projectFixture(t: TestContext) {
  const f = await deployed(t);
  const repo = path.join(f.root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), 'base\n');
  await git(repo, ['add', '.']);
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'base',
  ]);
  const project = f.store.put('project', {
    id: randomUUID(),
    name: 'AEGIS test',
    path: repo,
    goal: 'Verify policy',
    createdAt: new Date().toISOString(),
  } satisfies Project);
  await f.aegis.setProject(project.id, true);
  const member = f.store.addMember({ name: 'Atlas', role: 'engineer' });
  const task = f.store.addTask({
    projectId: project.id,
    title: 'Change README',
    description: '',
    kind: 'code',
    priority: 'medium',
    scope: ['README.md'],
    dependsOn: [],
    acceptance: '',
    assignedTo: member.id,
  });
  const worktree = await createWorktree(repo, f.root, task.id);
  f.store.updateTask(task.id, { ...worktree, status: 'review' });
  await writeFile(path.join(worktree.worktree, 'README.md'), 'reviewed change\n');
  return { ...f, project, member, task: f.store.get<Task>('task', task.id) };
}

test('AEGIS refuses mainnet in both Solidity constructor and client network guard', async (t) => {
  const f = await fixture(t, 43114);
  await assert.rejects(
    new ContractFactory(artifact.abi, artifact.bytecode, f.owner).deploy(
      f.owner.address,
      f.executor.address,
    ),
  );
  await f.aegis.setup();
  await assert.rejects(f.aegis.deploy(), /Only Avalanche Fuji/);
});

test('registry enforces owner, revocation epochs, exact payload, expiry, and one-use approvals on EVM', async (t) => {
  const f = await fixture(t);
  const deployment = await new ContractFactory(artifact.abi, artifact.bytecode, f.owner).deploy(
    f.owner.address,
    f.executor.address,
  );
  await deployment.waitForDeployment();
  const address = await deployment.getAddress();
  const registry = new Contract(address, artifact.abi, f.owner);
  const executor = registry.connect(f.executor) as Contract;
  const stranger = registry.connect(f.stranger) as Contract;
  const project = evidenceDigest('project'),
    machine = evidenceDigest('machine'),
    payload = evidenceDigest('payload');
  await assert.rejects(stranger.setProject(project, true));
  await (await registry.setProject(project, true)).wait();
  const latest = await f.provider.getBlock('latest');
  const expires = latest!.timestamp + 300;
  await (await registry.setGrant(project, machine, 3, expires + 30)).wait();
  assert.equal(await registry.canRun(project, machine), true);
  const nonce = evidenceDigest('nonce');
  const epoch = (await registry.grants(project, machine)).epoch;
  const action = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      [
        'uint256',
        'address',
        'bytes32',
        'bytes32',
        'uint64',
        'uint64',
        'bytes32',
        'uint64',
        'bytes32',
      ],
      [
        43113,
        address,
        project,
        machine,
        epoch,
        await registry.projectEpochs(project),
        payload,
        expires,
        nonce,
      ],
    ),
  );
  await (await registry.approveMerge(project, machine, payload, expires, nonce)).wait();
  await assert.rejects(stranger.consumeMerge(action, payload));
  await assert.rejects(executor.consumeMerge(action, evidenceDigest('different')));
  await (await executor.consumeMerge(action, payload)).wait();
  await assert.rejects(executor.consumeMerge(action, payload));
  const action2 = await registry.approveMerge.staticCall(
    project,
    machine,
    payload,
    expires,
    evidenceDigest('nonce2'),
  );
  await (
    await registry.approveMerge(project, machine, payload, expires, evidenceDigest('nonce2'))
  ).wait();
  await (await registry.setGrant(project, machine, 0, 0)).wait();
  assert.equal(await registry.canRun(project, machine), false);
  await (await registry.setGrant(project, machine, 3, expires + 30)).wait();
  await assert.rejects(executor.consumeMerge(action2, payload));
  const action3 = await registry.approveMerge.staticCall(
    project,
    machine,
    payload,
    expires,
    evidenceDigest('nonce3'),
  );
  await (
    await registry.approveMerge(project, machine, payload, expires, evidenceDigest('nonce3'))
  ).wait();
  await (await registry.setProject(project, false)).wait();
  await (await registry.setProject(project, true)).wait();
  await assert.rejects(executor.consumeMerge(action3, payload));
  const receipt = evidenceDigest('receipt');
  await assert.rejects(stranger.anchorReceipt(project, receipt, payload));
  await (await executor.anchorReceipt(project, receipt, payload)).wait();
  await assert.rejects(executor.anchorReceipt(project, receipt, evidenceDigest('replace')));
  assert.equal(await registry.receipts(project, receipt), payload);
  await f.provider.send('evm_increaseTime', [400]);
  await f.provider.send('evm_mine', []);
  assert.equal(await registry.canRun(project, machine), false);
});

test('real source review approval rejects changed preview and binds merge to reviewed file bytes', async (t) => {
  const f = await projectFixture(t);
  await f.aegis.assertCanRun(f.project.id);
  const first = await f.aegis.mergePreview(f.task.id);
  await writeFile(path.join(f.task.worktree!, 'README.md'), 'unreviewed\n');
  await assert.rejects(
    f.aegis.approveMerge(f.task.id, first.payloadDigest),
    /changed after preview/,
  );
  const reviewed = await f.aegis.mergePreview(f.task.id);
  await f.aegis.approveMerge(f.task.id, reviewed.payloadDigest);
  const verifySource = await f.aegis.consumeMerge(f.task.id);
  await verifySource();
  await assert.rejects(f.aegis.consumeMerge(f.task.id), /approve this exact diff/);
  const targetHead = await git(f.project.path, ['rev-parse', 'HEAD']);
  await git(f.project.path, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'Concurrent target change',
  ]);
  await assert.rejects(verifySource(), /target branch changed/);
  await git(f.project.path, ['reset', '--soft', targetHead]);
  await writeFile(path.join(f.task.worktree!, 'README.md'), 'modified by hook\n');
  await assert.rejects(verifySource(), /source changed after approval/);
  await f.aegis.setGrant(f.project.id, 'local', 0, 0);
  await assert.rejects(f.aegis.assertCanRun(f.project.id), /no active run grant/);
});

test('handoff receipts verify real typed signatures and on-chain anchors; tampering and wrong registry fail', async (t) => {
  const f = await projectFixture(t);
  const receiver = f.store.addMember({ name: 'Vega', role: 'engineer' });
  const handoff: Handoff = {
    id: randomUUID(),
    projectId: f.project.id,
    taskId: f.task.id,
    fromSessionId: randomUUID(),
    toMemberId: receiver.id,
    toSessionId: null,
    status: 'awaiting_ack',
    branch: f.task.branch,
    commitSha: 'a'.repeat(40),
    remote: 'origin',
    summary: 'Checkpoint ready',
    nextSteps: 'Review reconnect',
    testEvidence: 'fixture test passed',
    quota: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const receipt = await f.aegis.recordHandoff(handoff);
  assert.ok(receipt);
  const before = await f.aegis.verify(f.aegis.exportReceipt(receipt.id));
  assert.equal(before.integrity, true);
  assert.equal(before.signature, true);
  assert.equal(before.anchored, false);
  await assert.rejects(f.aegis.assertHandoff(handoff), /Anchor and verify/);
  await f.aegis.anchorReceipt(receipt.id);
  const bundle = f.aegis.exportReceipt(receipt.id);
  assert.equal((await f.aegis.verify(bundle)).anchored, true);
  await f.aegis.assertHandoff(handoff);
  const modified = structuredClone(bundle);
  modified.payload.nextSteps = 'Send credentials';
  assert.equal((await f.aegis.verify(modified)).integrity, false);
  assert.equal((await f.aegis.verify(modified)).anchored, false);
  await assert.rejects(
    f.aegis.assertHandoff({ ...handoff, testEvidence: 'fabricated' }),
    /content changed/,
  );
  const other = structuredClone(bundle);
  other.receipt.contractAddress = f.stranger.address;
  assert.equal((await f.aegis.verify(other)).trustedRegistry, false);
  const retried = {
    ...handoff,
    testEvidence: 'Recovered checkpoint verified',
    nextSteps: 'Continue the recovered checkpoint',
  };
  const revision = await f.aegis.recordHandoff(retried);
  assert.ok(revision);
  assert.notEqual(revision.id, receipt.id);
  assert.equal((await f.aegis.recordHandoff(retried))!.id, revision.id);
  assert.equal((await f.aegis.verify(bundle)).anchored, true);
  await assert.rejects(f.aegis.assertHandoff(retried), /Anchor and verify/);
  await f.aegis.anchorReceipt(revision.id);
  await f.aegis.assertHandoff(retried);
  await assert.rejects(f.aegis.assertHandoff(handoff), /content changed/);
});

test('AEGIS identity survives restart; secrets are absent from public status', async (t) => {
  const f = await deployed(t);
  const first = await f.aegis.status();
  const next = new Aegis(f.store, f.root, { testRpcUrl: f.provider._getConnection().url });
  t.after(() => next.close());
  await next.initialize();
  const restored = await next.status();
  assert.equal(restored.ownerAddress, first.ownerAddress);
  assert.equal(restored.contractAddress, first.contractAddress);
  assert.ok(!JSON.stringify(restored).includes('ownerKey'));
  assert.ok(!JSON.stringify(restored).includes('executorKey'));
});

test('same-scope target commit hook tampering is rejected and Git integration rolls back', async (t) => {
  const f = await projectFixture(t);
  const startingHead = await git(f.project.path, ['rev-parse', 'HEAD']);
  const preview = await f.aegis.mergePreview(f.task.id);
  await f.aegis.approveMerge(f.task.id, preview.payloadDigest);
  const verify = await f.aegis.consumeMerge(f.task.id);
  const hook = path.join(f.project.path, '.git', 'hooks', 'pre-commit');
  // Only alter the primary checkout, leaving the worker's approved bytes intact.
  await writeFile(
    hook,
    '#!/bin/sh\nif [ "$(git branch --show-current)" = "main" ]; then\n  printf "unreviewed hook change\\n" > README.md\n  git add README.md\nfi\n',
    { mode: 0o755 },
  );
  await assert.rejects(
    integrate(f.project.path, f.task.worktree!, f.task.branch!, f.task.title, {
      baseCommit: f.task.baseCommit!,
      validateDiff: (diff, context) => verify(diff, context),
    }),
    /AEGIS: integration bytes differ/,
  );
  assert.equal(await git(f.project.path, ['rev-parse', 'HEAD']), startingHead);
  assert.equal(await git(f.project.path, ['status', '--porcelain']), '');
});

test('approved Git integration verifies new binary/text files and deletion through staged and committed states', async (t) => {
  const f = await projectFixture(t);
  f.store.updateTask(f.task.id, { scope: ['.'] });
  await rm(path.join(f.task.worktree!, 'README.md'));
  await writeFile(path.join(f.task.worktree!, 'new.txt'), 'Reviewed new file\n');
  await writeFile(path.join(f.task.worktree!, 'asset.bin'), Buffer.from([0, 1, 2, 255, 128]));
  const targetHead = await git(f.project.path, ['rev-parse', 'HEAD']);
  const preview = await f.aegis.mergePreview(f.task.id);
  await f.aegis.approveMerge(f.task.id, preview.payloadDigest);
  const verify = await f.aegis.consumeMerge(f.task.id);
  await integrate(f.project.path, f.task.worktree!, f.task.branch!, f.task.title, {
    baseCommit: f.task.baseCommit!,
    validateDiff: (diff, context) => verify(diff, context),
  });
  assert.equal(await git(f.project.path, ['rev-parse', 'HEAD^']), targetHead);
  assert.equal(await git(f.project.path, ['status', '--porcelain']), '');
  assert.equal(await git(f.project.path, ['show', 'HEAD:new.txt']), 'Reviewed new file');
  await assert.rejects(git(f.project.path, ['show', 'HEAD:README.md']));
  const sourceBlob = await git(f.task.worktree!, ['rev-parse', 'HEAD:asset.bin']);
  assert.equal(await git(f.project.path, ['rev-parse', 'HEAD:asset.bin']), sourceBlob);
});

test('pending policy transactions fail closed and recovery never broadcasts again', async (t) => {
  const f = await deployed(t);
  const projectId = randomUUID();
  f.store.put('aegisOperation', {
    id: randomUUID(),
    label: 'Controlled interrupted broadcast',
    hash: '0x' + '1'.repeat(64),
    status: 'pending',
    createdAt: new Date().toISOString(),
    effects: [{ kind: 'aegisProject', value: { id: projectId, projectId, enabled: true } }],
  });
  assert.equal(f.aegis.isProtected(projectId), true);
  await assert.rejects(f.aegis.assertCanRun(projectId), /uncertain transaction/);
  const before = await f.provider.getTransactionCount(
    (await f.aegis.status()).ownerAddress!,
    'pending',
  );
  await f.aegis.recover();
  assert.equal(
    await f.provider.getTransactionCount((await f.aegis.status()).ownerAddress!, 'pending'),
    before,
  );
  assert.match((await f.aegis.status()).error!, /pending or uncertain/);
});
