import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile, realpath } from 'node:fs/promises';
import {
  AbiCoder,
  Contract,
  ContractFactory,
  FetchRequest,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  getCreateAddress,
  keccak256,
  parseEther,
  toUtf8Bytes,
  verifyTypedData,
  type TransactionRequest,
  type TransactionReceipt,
} from 'ethers';
import artifact from '../shared/aegis-artifact.json' with { type: 'json' };
import {
  FUJI_CHAIN_ID,
  FUJI_RPC_URL,
  FUJI_FAUCET_URL,
  FUJI_EXPLORER_URL,
  type AegisStatus,
  type AegisAction,
  type AegisGrant,
  type AegisProjectPolicy,
  type AegisReceipt,
  type AegisReceiptBundle,
  type AegisVerification,
} from '../shared/aegis.ts';
import { Store, DomainError } from './store.ts';
import { privateDirectory, inside } from './security.ts';
import { git, taskDiff } from './git.ts';
import type { Handoff, Member, Project, Task, TaskDiff } from '../shared/types.ts';

type Identity = { version: 1; ownerKey: string; executorKey: string; salt: string };
type Config = { id: 'workspace'; contractAddress: string | null };
type Effect = { kind: string; value: { id: string; [key: string]: unknown } };
type Operation = {
  id: string;
  label: string;
  hash: string;
  status: 'pending' | 'confirmed' | 'reverted';
  effects: Effect[];
  createdAt: string;
};
const receiptTypes = {
  Receipt: [
    { name: 'projectId', type: 'bytes32' },
    { name: 'receiptId', type: 'bytes32' },
    { name: 'digest', type: 'bytes32' },
  ],
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`)
    .join(',')}}`;
}
export function evidenceDigest(value: unknown) {
  return keccak256(toUtf8Bytes(canonical(value)));
}
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);
export type AegisDiffContext = {
  root: string;
  phase: 'preview' | 'worker' | 'staged' | 'committed';
};
type FileProof = { file: string; digest: string; oid: string; mode: string };

/** Fuji-only, single trusted owner alpha. Keys are never sent to Codex or the renderer. */
export class Aegis {
  private identity: Identity | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly provider: JsonRpcProvider;
  constructor(
    readonly store: Store,
    readonly directory: string,
    options: { testRpcUrl?: string } = {},
  ) {
    if (options.testRpcUrl && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(options.testRpcUrl))
      throw new Error('Test RPC must be loopback. Production AEGIS only uses Avalanche Fuji.');
    const request = new FetchRequest(options.testRpcUrl || FUJI_RPC_URL);
    request.timeout = 12000;
    this.provider = new JsonRpcProvider(request, undefined, {
      cacheTimeout: -1,
      pollingInterval: 300,
    });
    this.provider.on('error', () => {});
    this.provider.pollingInterval = 300;
  }
  private config(): Config {
    return this.store.all<Config>('aegisConfig')[0] || { id: 'workspace', contractAddress: null };
  }
  async initialize() {
    try {
      const file = path.join(this.directory, 'aegis', 'identity.private.json');
      if ((await lstat(file)).isSymbolicLink())
        throw new Error('AEGIS identity must not be a symlink.');
      const identity = JSON.parse(await readFile(file, 'utf8')) as Identity;
      if (identity.version !== 1 || !/^0x[0-9a-f]{64}$/i.test(identity.salt))
        throw new Error('Invalid AEGIS identity.');
      try {
        new Wallet(identity.ownerKey);
        new Wallet(identity.executorKey);
      } catch {
        throw new Error('Invalid AEGIS identity keys. Restore a private backup.');
      }
      this.identity = identity;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async setup() {
    return this.exclusive(async () => {
      if (!this.identity) {
        const directory = path.join(this.directory, 'aegis');
        await privateDirectory(directory);
        const identity: Identity = {
          version: 1,
          ownerKey: Wallet.createRandom().privateKey,
          executorKey: Wallet.createRandom().privateKey,
          salt: `0x${randomBytes(32).toString('hex')}`,
        };
        await writeFile(path.join(directory, 'identity.private.json'), JSON.stringify(identity), {
          mode: 0o600,
          flag: 'wx',
        });
        this.identity = identity;
      }
      return this.status();
    });
  }
  private owner() {
    if (!this.identity) throw new DomainError('Set up AEGIS first.');
    return new Wallet(this.identity.ownerKey, this.provider);
  }
  private executor() {
    if (!this.identity) throw new DomainError('Set up AEGIS first.');
    return new Wallet(this.identity.executorKey, this.provider);
  }
  private async chain() {
    // Do not pin/static-cache network detection: every operation verifies the live RPC.
    if (BigInt(await this.provider.send('eth_chainId', [])) !== BigInt(FUJI_CHAIN_ID))
      throw new DomainError(
        'AEGIS refuses this network. Only Avalanche Fuji (43113) is permitted.',
      );
  }
  private key(kind: string, id: string) {
    if (!this.identity) throw new DomainError('Set up AEGIS first.');
    return evidenceDigest({ salt: this.identity.salt, kind, id });
  }
  private contract(signer: 'owner' | 'executor' = 'executor') {
    const address = this.config().contractAddress;
    if (!address) throw new DomainError('Deploy AEGIS to Avalanche Fuji first.');
    return new Contract(address, artifact.abi, signer === 'owner' ? this.owner() : this.executor());
  }
  private async validatedContract(signer: 'owner' | 'executor' = 'executor') {
    await this.chain();
    const contract = this.contract(signer);
    if (
      getAddress(await contract.owner()) !== this.owner().address ||
      getAddress(await contract.executor()) !== this.executor().address
    )
      throw new DomainError('AEGIS registry identity does not match this workspace.');
    return contract;
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }
  private apply(operation: Operation, receipt: TransactionReceipt) {
    if (receipt.status === 1)
      for (const effect of operation.effects)
        this.store.put(effect.kind, { ...effect.value, transactionHash: operation.hash });
    this.store.put('aegisOperation', {
      ...operation,
      status: receipt.status === 1 ? 'confirmed' : 'reverted',
    });
  }
  private async reconcile() {
    for (const operation of this.store
      .all<Operation>('aegisOperation')
      .filter((op) => op.status === 'pending')) {
      const receipt = await this.provider.getTransactionReceipt(operation.hash);
      if (receipt) this.store.transaction(() => this.apply(operation, receipt));
    }
  }
  private async transact(
    label: string,
    signer: Wallet,
    transaction: TransactionRequest,
    effects: Effect[],
  ) {
    await this.chain();
    await this.reconcile();
    if (
      this.store
        .all<Operation>('aegisOperation')
        .some((operation) => operation.status === 'pending')
    )
      throw new DomainError(
        'An AEGIS transaction has an uncertain outcome. Recover before sending another.',
      );
    const prepared = await signer.populateTransaction({ ...transaction, chainId: FUJI_CHAIN_ID });
    const maximum =
      BigInt(prepared.gasLimit || 0) * BigInt(prepared.maxFeePerGas || prepared.gasPrice || 0) +
      BigInt(prepared.value || 0);
    if (maximum > parseEther('0.1'))
      throw new DomainError('Fuji transaction exceeds the 0.1 test AVAX safety limit.');
    if ((await this.provider.getBalance(signer.address)) < maximum)
      throw new DomainError(
        `Fund ${signer.address} with free Fuji test AVAX. No mainnet AVAX is accepted.`,
      );
    const signed = await signer.signTransaction(prepared);
    const operation: Operation = {
      id: randomUUID(),
      label,
      hash: keccak256(signed),
      status: 'pending',
      effects,
      createdAt: new Date().toISOString(),
    };
    // Store hash before broadcast: uncertain delivery can be reconciled without resending.
    this.store.put('aegisOperation', operation);
    try {
      await this.provider.broadcastTransaction(signed);
      const receipt = await this.provider.waitForTransaction(operation.hash, 1, 30000);
      if (!receipt) throw new Error('Awaiting Fuji confirmation.');
      this.store.transaction(() => this.apply(operation, receipt));
      if (receipt.status !== 1) throw new DomainError('The Fuji transaction reverted.');
      return operation.hash;
    } catch (error) {
      const receipt = await this.provider.getTransactionReceipt(operation.hash).catch(() => null);
      if (receipt) this.store.transaction(() => this.apply(operation, receipt));
      throw new DomainError(
        `AEGIS transaction ${operation.hash} needs review/recovery: ${(error as Error).message.slice(0, 180)}`,
      );
    }
  }
  async recover() {
    return this.exclusive(async () => {
      await this.chain();
      await this.reconcile();
      return this.status();
    });
  }
  async status(): Promise<AegisStatus> {
    let online = false,
      error: string | null = null,
      balance = '0',
      executorBalance = '0';
    if (this.identity)
      try {
        await this.chain();
        online = true;
        [balance, executorBalance] = await Promise.all(
          [this.owner(), this.executor()].map(async (wallet) =>
            formatEther(await this.provider.getBalance(wallet.address)),
          ),
        );
        if (this.config().contractAddress) await this.validatedContract();
        if (this.store.all<Operation>('aegisOperation').some((op) => op.status === 'pending'))
          error =
            'An AEGIS transaction is pending or uncertain. Use Recover; it will not be sent again.';
      } catch (e) {
        online = false;
        error = (e as Error).message.slice(0, 240);
      }
    return {
      chainId: 43113,
      network: 'Avalanche Fuji',
      setup: !!this.identity,
      contractAddress: this.config().contractAddress,
      ownerAddress: this.identity ? this.owner().address : null,
      executorAddress: this.identity ? this.executor().address : null,
      balance,
      executorBalance,
      online,
      error,
      faucetUrl: FUJI_FAUCET_URL,
      explorerUrl: FUJI_EXPLORER_URL,
      projects: this.store.all<AegisProjectPolicy>('aegisProject'),
      grants: this.store.all<AegisGrant>('aegisGrant'),
      actions: this.store.all<AegisAction>('aegisAction'),
      receipts: this.store.all<AegisReceipt>('aegisReceipt'),
    };
  }
  async deploy() {
    return this.exclusive(async () => {
      await this.chain();
      if (!this.config().contractAddress) {
        const owner = this.owner(),
          executor = this.executor();
        const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
        const nonce = await owner.getNonce('pending');
        const contractAddress = getCreateAddress({ from: owner.address, nonce });
        const transaction = await factory.getDeployTransaction(owner.address, executor.address);
        transaction.nonce = nonce;
        await this.transact('Deploy Fuji registry', owner, transaction, [
          { kind: 'aegisConfig', value: { id: 'workspace', contractAddress } },
        ]);
      }
      if ((await this.provider.getBalance(this.executor().address)) < parseEther('0.002'))
        await this.transact(
          'Fund Fuji receipt executor',
          this.owner(),
          { to: this.executor().address, value: parseEther('0.01') },
          [],
        );
      return this.status();
    });
  }
  isProtected(projectId: string) {
    // An uncertain enable transaction must already fail closed, including across restart.
    return (
      this.store
        .all<AegisProjectPolicy>('aegisProject')
        .some((p) => p.projectId === projectId && p.enabled) ||
      this.store
        .all<Operation>('aegisOperation')
        .some(
          (operation) =>
            operation.status === 'pending' &&
            operation.effects.some(
              (effect) =>
                effect.kind === 'aegisProject' &&
                effect.value.projectId === projectId &&
                effect.value.enabled,
            ),
        )
    );
  }
  async setProject(projectId: string, enabled: boolean) {
    this.store.get<Project>('project', projectId);
    return this.exclusive(async () => {
      const contract = await this.validatedContract('owner');
      const value = { id: projectId, projectId, enabled, updatedAt: new Date().toISOString() };
      await this.transact(
        'Project policy',
        this.owner(),
        await contract.setProject.populateTransaction(this.key('project', projectId), enabled),
        [{ kind: 'aegisProject', value }],
      );
      if (enabled) await this.setGrantInner(projectId, 'local', 3, nowSeconds() + 7 * 86400);
      return this.status();
    });
  }
  private async setGrantInner(
    projectId: string,
    machineId: string,
    permissions: number,
    expiresAt: number,
  ) {
    const contract = await this.validatedContract('owner');
    const projectKey = this.key('project', projectId),
      machineKey = this.key('machine', machineId);
    const previous = await contract.grants(projectKey, machineKey);
    const value = {
      id: `${projectId}:${machineId}`,
      projectId,
      machineId,
      permissions,
      expiresAt: permissions ? expiresAt : 0,
      epoch: Number(previous.epoch) + 1,
    };
    await this.transact(
      permissions ? 'Grant machine' : 'Revoke machine',
      this.owner(),
      await contract.setGrant.populateTransaction(
        projectKey,
        machineKey,
        permissions,
        permissions ? expiresAt : 0,
      ),
      [{ kind: 'aegisGrant', value }],
    );
  }
  async setGrant(projectId: string, machineId: string, permissions: number, expiresAt: number) {
    this.store.get<Project>('project', projectId);
    if (machineId !== 'local') this.store.get('runner', machineId);
    if (![0, 1, 3].includes(permissions) || !Number.isInteger(expiresAt))
      throw new DomainError('Invalid machine grant.', 400);
    if (permissions && (expiresAt <= nowSeconds() || expiresAt > nowSeconds() + 30 * 86400))
      throw new DomainError('A grant must expire within 30 days.', 400);
    return this.exclusive(async () => {
      await this.setGrantInner(projectId, machineId, permissions, expiresAt);
      return this.status();
    });
  }
  async assertCanRun(projectId: string, machineId = 'local') {
    if (!this.isProtected(projectId)) return;
    if (
      this.store
        .all<Operation>('aegisOperation')
        .some((operation) => operation.status === 'pending')
    )
      throw new DomainError(
        'AEGIS has an uncertain transaction. Recover before executing protected work.',
      );
    const contract = await this.validatedContract();
    if (!(await contract.canRun(this.key('project', projectId), this.key('machine', machineId))))
      throw new DomainError('AEGIS: this machine has no active run grant for the project.');
  }
  private async fileProof(
    root: string,
    selected?: string[],
    normalizeGitBlobs = false,
  ): Promise<FileProof[]> {
    const listing =
      selected ||
      (await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
        .split('\0')
        .filter(Boolean);
    const files = [...new Set(listing)].sort();
    if (files.length > 12000)
      throw new DomainError('AEGIS review exceeds the 12,000 file verification limit.');
    const objectFormat = (await git(root, ['rev-parse', '--show-object-format'])).trim();
    if (!['sha1', 'sha256'].includes(objectFormat))
      throw new DomainError('Unsupported Git object format.');
    const fileMode = await git(root, ['config', '--bool', 'core.filemode']).catch(() => 'false');
    const indexedModes = new Map(
      (await git(root, ['ls-files', '--stage', '-z']))
        .split('\0')
        .filter(Boolean)
        .map((entry) => {
          const tab = entry.indexOf('\t');
          return [entry.slice(tab + 1), entry.slice(0, 6)];
        }),
    );
    let total = 0;
    const manifest: FileProof[] = [];
    for (const file of files) {
      const filename = path.resolve(root, file);
      if (!inside(root, filename)) throw new DomainError('AEGIS source path escapes the worktree.');
      try {
        const info = await lstat(filename);
        if (!info.isFile() || !inside(await realpath(root), await realpath(filename)))
          throw new DomainError(
            'AEGIS review requires regular in-worktree files; inspect symlinks separately.',
          );
        total += info.size;
        if (total > 64 * 1024 * 1024)
          throw new DomainError('AEGIS review exceeds the 64 MB verification limit.');
        const bytes = await readFile(filename);
        // Selected integration files use Git's own clean/line-ending rules, exactly as git add does.
        // Repositories and their configured filters remain trusted code in this alpha.
        const oid = normalizeGitBlobs
          ? (await git(root, ['hash-object', `--path=${file}`, '--', file])).trim()
          : createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        const mode =
          fileMode === 'true'
            ? info.mode & 0o111
              ? '100755'
              : '100644'
            : indexedModes.get(file) || '100644';
        manifest.push({ file, digest: sha256(bytes), oid, mode });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          manifest.push({ file, digest: 'deleted', oid: '', mode: '' });
        else throw error;
      }
    }
    return manifest;
  }
  private async sourceDigest(task: Task) {
    if (!task.worktree) throw new DomainError('Task has no reviewable worktree.');
    const current = (
      await git(task.worktree, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    )
      .split('\0')
      .filter(Boolean);
    const baseline = (
      await git(task.worktree, ['ls-tree', '-r', '--name-only', '-z', task.baseCommit || 'HEAD'])
    )
      .split('\0')
      .filter(Boolean);
    const manifest = await this.fileProof(task.worktree, [...current, ...baseline]);
    return evidenceDigest({ files: manifest, scope: task.scope, baseCommit: task.baseCommit });
  }
  private async mergePayload(taskId: string) {
    const task = this.store.get<Task>('task', taskId);
    if (task.status !== 'review' || !task.worktree || !task.branch)
      throw new DomainError('Only completed tasks in review can be approved.');
    const project = this.store.get<Project>('project', task.projectId);
    const sourceDigest = await this.sourceDigest(task);
    const targetHead = (await git(project.path, ['rev-parse', 'HEAD'])).trim();
    return {
      task,
      sourceDigest,
      targetHead,
      payloadDigest: evidenceDigest({
        taskId,
        projectId: task.projectId,
        action: 'merge',
        targetHead,
        branch: task.branch,
        sourceDigest,
      }),
    };
  }
  async mergePreview(taskId: string) {
    const { task, sourceDigest, payloadDigest } = await this.mergePayload(taskId);
    const diff = await taskDiff(task.worktree!, task.baseCommit || 'HEAD');
    // Check again after reading the preview: never attach a prior digest to a later diff.
    const after = await this.mergePayload(taskId);
    if (after.payloadDigest !== payloadDigest)
      throw new DomainError('The source changed while reading its review. Refresh.');
    return { taskId, sourceDigest, payloadDigest, diff };
  }
  async approveMerge(taskId: string, expectedPayloadDigest: string) {
    return this.exclusive(async () => {
      const preview = await this.mergePreview(taskId);
      if (preview.payloadDigest !== expectedPayloadDigest)
        throw new DomainError('The diff or target branch changed after preview. Review again.');
      if (preview.diff.truncated)
        throw new DomainError(
          'This diff is too large for an AEGIS preview. Split it into smaller reviews.',
        );
      const { sourceDigest, payloadDigest } = preview;
      const task = this.store.get<Task>('task', taskId);
      if (!this.isProtected(task.projectId))
        throw new DomainError('Enable AEGIS for this project first.');
      const contract = await this.validatedContract('owner');
      const projectKey = this.key('project', task.projectId),
        machineKey = this.key('machine', 'local');
      const grant = await contract.grants(projectKey, machineKey);
      const expiresAt = Math.min(nowSeconds() + 600, Number(grant.expiresAt));
      const nonce = `0x${randomBytes(32).toString('hex')}`;
      const projectEpoch = await contract.projectEpochs(projectKey);
      const actionId = keccak256(
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
            FUJI_CHAIN_ID,
            this.config().contractAddress,
            projectKey,
            machineKey,
            grant.epoch,
            projectEpoch,
            payloadDigest,
            expiresAt,
            nonce,
          ],
        ),
      );
      const value = {
        id: randomUUID(),
        taskId,
        projectId: task.projectId,
        actionId,
        payloadDigest,
        sourceDigest,
        expiresAt,
        status: 'approved',
      };
      await this.transact(
        'Approve exact merge',
        this.owner(),
        await contract.approveMerge.populateTransaction(
          projectKey,
          machineKey,
          payloadDigest,
          expiresAt,
          nonce,
        ),
        [{ kind: 'aegisAction', value }],
      );
      return this.store.get<AegisAction>('aegisAction', value.id);
    });
  }
  async consumeMerge(
    taskId: string,
  ): Promise<(diff?: TaskDiff, context?: AegisDiffContext) => Promise<void>> {
    const initial = this.store.get<Task>('task', taskId);
    if (!this.isProtected(initial.projectId)) return async () => {};
    return this.exclusive(async () => {
      const { task, payloadDigest, sourceDigest, targetHead } = await this.mergePayload(taskId);
      const targetRoot = this.store.get<Project>('project', task.projectId).path;
      const sourceDiff = await taskDiff(task.worktree!, task.baseCommit || 'HEAD');
      const expectedFiles = [...new Set(sourceDiff.files)].sort();
      const expectedProof = await this.fileProof(task.worktree!, expectedFiles, true);
      const action = this.store
        .all<AegisAction>('aegisAction')
        .find(
          (entry) =>
            entry.taskId === taskId &&
            entry.status === 'approved' &&
            entry.payloadDigest === payloadDigest &&
            entry.expiresAt > nowSeconds(),
        );
      if (!action) throw new DomainError('AEGIS: approve this exact diff in AEGIS before merging.');
      const contract = await this.validatedContract();
      await this.transact(
        'Consume merge approval',
        this.executor(),
        await contract.consumeMerge.populateTransaction(action.actionId, payloadDigest),
        [{ kind: 'aegisAction', value: { ...action, status: 'consumed' } }],
      );
      return async (diff, context) => {
        const currentTargetHead = (await git(targetRoot, ['rev-parse', 'HEAD'])).trim();
        if (context?.phase === 'committed' && currentTargetHead !== targetHead) {
          const parent = (await git(targetRoot, ['rev-parse', 'HEAD^'])).trim();
          if (parent !== targetHead)
            throw new DomainError('AEGIS: target branch changed after approval. Review again.');
        } else if (currentTargetHead !== targetHead) {
          throw new DomainError('AEGIS: target branch changed after approval. Review again.');
        }
        if ((await this.sourceDigest(task)) !== sourceDigest)
          throw new DomainError(
            'AEGIS: source changed after approval. Request a new review and approval.',
          );
        if (diff && canonical([...new Set(diff.files)].sort()) !== canonical(expectedFiles))
          throw new DomainError('AEGIS: integration changed the approved file set.');
        if (context) {
          const gitContent = (proofs: FileProof[]) =>
            proofs.map(({ file, oid, mode }) => ({ file, oid, mode }));
          if (
            canonical(gitContent(await this.fileProof(context.root, expectedFiles, true))) !==
            canonical(gitContent(expectedProof))
          )
            throw new DomainError('AEGIS: integration bytes differ from the approved source.');
          if (context.phase !== 'preview') {
            const entries =
              context.phase === 'staged'
                ? await git(context.root, ['ls-files', '--stage', '-z'])
                : await git(context.root, ['ls-tree', '-r', '-z', 'HEAD']);
            const tree = new Map(
              entries
                .split('\0')
                .filter(Boolean)
                .map((entry) => {
                  const tab = entry.indexOf('\t'),
                    fields = entry.slice(0, tab).split(' ');
                  return [
                    entry.slice(tab + 1),
                    { mode: fields[0], oid: context.phase === 'staged' ? fields[1] : fields[2] },
                  ];
                }),
            );
            for (const proof of expectedProof) {
              const actual = tree.get(proof.file);
              if (
                proof.digest === 'deleted'
                  ? !!actual
                  : !actual || actual.oid !== proof.oid || actual.mode !== proof.mode
              )
                throw new DomainError(
                  'AEGIS: staged or committed content differs from the approved source.',
                );
            }
          }
        }
      };
    });
  }
  async recordHandoff(handoff: Handoff) {
    if (!this.isProtected(handoff.projectId)) return null;
    if (!['awaiting_ack', 'accepted'].includes(handoff.status))
      throw new DomainError('Only completed checkpoints can have an AEGIS receipt.');
    if (!this.config().contractAddress) throw new DomainError('AEGIS registry is not deployed.');
    const existing = this.store
      .all<AegisReceipt>('aegisReceipt')
      .filter((receipt) => receipt.handoffId === handoff.id)
      .at(-1);
    if (
      existing &&
      evidenceDigest({ ...this.handoffPayload(handoff), receiptId: existing.id }) ===
        existing.digest
    )
      return existing;
    // A recovered checkpoint can legitimately change evidence or its commit. Preserve the old
    // commitment and sign a new receipt; never overwrite an already-exported/anchored receipt.
    const id = randomUUID(),
      payload = { ...this.handoffPayload(handoff), receiptId: id },
      digest = evidenceDigest(payload);
    const projectKey = this.key('project', handoff.projectId),
      receiptKey = this.key('receipt', id);
    const contractAddress = this.config().contractAddress!;
    const signature = await this.executor().signTypedData(
      this.receiptDomain(contractAddress),
      receiptTypes,
      { projectId: projectKey, receiptId: receiptKey, digest },
    );
    const receipt: AegisReceipt = {
      id,
      projectId: handoff.projectId,
      handoffId: handoff.id,
      digest,
      signer: this.executor().address,
      signature,
      contractAddress,
      projectKey,
      receiptKey,
      chainId: 43113,
      status: 'signed',
      transactionHash: null,
      createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      this.store.put('aegisReceipt', receipt);
      this.store.put('aegisReceiptPayload', { id, payload });
    });
    return receipt;
  }
  private handoffPayload(handoff: Handoff): Record<string, unknown> {
    return {
      version: 1,
      projectId: handoff.projectId,
      handoffId: handoff.id,
      taskId: handoff.taskId,
      fromSessionId: handoff.fromSessionId,
      toMemberId: handoff.toMemberId,
      commitSha: handoff.commitSha,
      branch: handoff.branch,
      remote: handoff.remote,
      summary: handoff.summary,
      nextSteps: handoff.nextSteps,
      testEvidence: handoff.testEvidence,
      quota: handoff.quota,
      createdAt: handoff.createdAt,
    };
  }
  private receiptDomain(contractAddress: string) {
    return {
      name: 'RELAY AEGIS Receipt',
      version: '1',
      chainId: FUJI_CHAIN_ID,
      verifyingContract: contractAddress,
    };
  }
  exportReceipt(id: string): AegisReceiptBundle {
    const receipt = this.store.get<AegisReceipt>('aegisReceipt', id);
    const { payload } = this.store.get<{ id: string; payload: Record<string, unknown> }>(
      'aegisReceiptPayload',
      id,
    );
    return { version: 1, receipt, payload };
  }
  async anchorReceipt(id: string) {
    return this.exclusive(async () => {
      const receipt = this.store.get<AegisReceipt>('aegisReceipt', id);
      if (receipt.status !== 'signed')
        throw new DomainError('This receipt is already anchored or needs recovery.');
      const contract = await this.validatedContract();
      const verified = await this.verify(this.exportReceipt(id));
      if (!verified.integrity || !verified.signature || !verified.trustedRegistry)
        throw new DomainError('Receipt verification failed.');
      await this.transact(
        'Anchor handoff receipt',
        this.executor(),
        await contract.anchorReceipt.populateTransaction(
          receipt.projectKey,
          receipt.receiptKey,
          receipt.digest,
        ),
        [{ kind: 'aegisReceipt', value: { ...receipt, status: 'anchored' } }],
      );
      return this.store.get<AegisReceipt>('aegisReceipt', id);
    });
  }
  async verify(bundle: AegisReceiptBundle): Promise<AegisVerification> {
    const result: AegisVerification = {
      integrity: false,
      signature: false,
      anchored: false,
      trustedRegistry: false,
      signer: null,
      error: null,
    };
    try {
      if (bundle.version !== 1 || bundle.receipt.chainId !== FUJI_CHAIN_ID)
        throw new Error('Unsupported receipt or network.');
      const receipt = bundle.receipt;
      result.integrity =
        evidenceDigest(bundle.payload) === receipt.digest &&
        bundle.payload.receiptId === receipt.id &&
        bundle.payload.projectId === receipt.projectId &&
        bundle.payload.handoffId === receipt.handoffId;
      result.signer = verifyTypedData(
        this.receiptDomain(receipt.contractAddress),
        receiptTypes,
        { projectId: receipt.projectKey, receiptId: receipt.receiptKey, digest: receipt.digest },
        receipt.signature,
      );
      result.signature = getAddress(result.signer) === getAddress(receipt.signer);
      await this.chain();
      // Verify against the configured registry, not a registry selected by an untrusted bundle.
      if (
        !this.config().contractAddress ||
        getAddress(receipt.contractAddress) !== getAddress(this.config().contractAddress!)
      )
        throw new Error('Receipt is from a different registry.');
      const contract = await this.validatedContract();
      result.trustedRegistry = getAddress(await contract.executor()) === result.signer;
      result.anchored =
        result.integrity &&
        result.signature &&
        result.trustedRegistry &&
        (await contract.receipts(receipt.projectKey, receipt.receiptKey)) === receipt.digest;
    } catch (error) {
      result.error = (error as Error).message.slice(0, 240);
    }
    return result;
  }
  async assertHandoff(handoff: Handoff) {
    if (!this.isProtected(handoff.projectId)) return;
    const receipt = this.store
      .all<AegisReceipt>('aegisReceipt')
      .filter((entry) => entry.handoffId === handoff.id)
      .at(-1);
    if (!receipt) throw new DomainError('AEGIS handoff receipt is missing.');
    if (
      evidenceDigest({ ...this.handoffPayload(handoff), receiptId: receipt.id }) !== receipt.digest
    )
      throw new DomainError('AEGIS: handoff content changed after it was signed.');
    const verified = await this.verify(this.exportReceipt(receipt.id));
    if (!verified.anchored)
      throw new DomainError('Anchor and verify this handoff receipt on Fuji before accepting it.');
    const member = this.store.get<Member>('member', handoff.toMemberId);
    await this.assertCanRun(handoff.projectId, member.runnerId || 'local');
  }
  close() {
    this.provider.destroy();
  }
}
