// Run with node --import tsx scripts/kivuno-sponsored-deploy.ts [--coordinator] [--deploy].
// Default is a read-only quote. --deploy uses the existing sponsor's durable nonce lane.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Contract,
  ContractFactory,
  FetchRequest,
  JsonRpcProvider,
  Wallet,
  getCreateAddress,
  getAddress,
  keccak256,
} from 'ethers';
import { Store } from '../server/store.ts';
import artifact from '../shared/kivuno-plans-sponsored-artifact.json' with { type: 'json' };

const settings: Record<string, string | undefined> = { ...process.env };
if (process.argv.includes('--coordinator')) {
  const pid = Number(readFileSync('/vercel/sandbox/state/coordinator.lock', 'utf8'));
  assert(Number.isSafeInteger(pid) && pid > 1, 'Invalid coordinator PID');
  assert.equal(realpathSync(`/proc/${pid}/cwd`), '/vercel/sandbox/relay');
  assert(readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('server/index.ts'));
  const entries = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
  for (const key of [
    'KIVUNO_FUJI_RECEIPT_KEY',
    'KIVUNO_FUJI_RPC_URL',
    'KIVUNO_FUJI_USDC_ADDRESS',
    'KIVUNO_FUJI_TREASURY_ADDRESS',
    'RELAY_DATA_DIR',
  ]) {
    settings[key] = entries.find((v) => v.startsWith(key + '='))?.slice(key.length + 1);
  }
}
assert(/^0x[\da-f]{64}$/i.test(settings.KIVUNO_FUJI_RECEIPT_KEY || ''), 'Sponsor key missing');
assert(settings.RELAY_DATA_DIR, 'An existing coordinator state directory is required');
const request = new FetchRequest(
  settings.KIVUNO_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
);
request.timeout = 10000;
const provider = new JsonRpcProvider(request, 43113, {
  staticNetwork: true,
  cacheTimeout: -1,
  pollingInterval: 1000,
});
const signer = new Wallet(settings.KIVUNO_FUJI_RECEIPT_KEY!, provider);
const token = getAddress(settings.KIVUNO_FUJI_USDC_ADDRESS!);
const treasury = getAddress(settings.KIVUNO_FUJI_TREASURY_ADDRESS!);
type Deployment = {
  id: string;
  hash: string;
  raw: string;
  address: string;
  bytecodeHash: string;
  status: 'pending' | 'confirmed';
  token: string;
  treasury: string;
  sponsor: string;
};
type Lane = {
  id: string;
  holder?: string;
  until?: number;
  orderId?: string;
  deploymentStartedAt?: number;
};
const holder = 'deploy-v3:' + randomUUID();
let store: Store | undefined;
let locked = false;
let unresolved = false;
try {
  assert.equal(BigInt(await provider.send('eth_chainId', [])), 43113n, 'Fuji only');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const deploy = await factory.getDeployTransaction(token, treasury, signer.address);
  const estimate = await provider.estimateGas({ ...deploy, from: signer.address });
  const gasLimit = (estimate * 12n) / 10n;
  const gasPrice = (await provider.getFeeData()).gasPrice;
  assert(
    gasPrice && gasPrice * gasLimit <= 2_000_000_000_000_000n,
    'Deployment exceeds 0.002 test AVAX budget',
  );
  const quote = {
    chainId: 43113,
    sponsor: signer.address,
    token,
    treasury,
    gasLimit: gasLimit.toString(),
    maxTestAvaxWei: (gasPrice * gasLimit).toString(),
    bytecodeHash: keccak256(artifact.bytecode),
  };
  if (!process.argv.includes('--deploy'))
    console.log(JSON.stringify({ action: 'quote', ...quote }));
  else {
    assert(
      (await provider.getBalance(signer.address)) >= gasLimit * gasPrice,
      'Not enough test gas',
    );
    const database = path.join(settings.RELAY_DATA_DIR!, 'workspace.db');
    // Never silently create an empty coordinator database.
    assert(statSync(database).isFile());
    store = new Store(database);
    store.transaction(() => {
      const lane = store!.lookup<Lane>('sponsoredLane', signer.address);
      const recovery =
        lane?.holder?.startsWith('deploy-v3:') &&
        !!lane.deploymentStartedAt &&
        lane.deploymentStartedAt < Date.now() - 120000;
      assert(
        recovery || !lane?.holder || (lane.until || 0) <= Date.now(),
        'Another sponsor operation is active',
      );
      if (lane?.orderId) {
        const order = store!.get<{ status: string }>('sponsoredOrder', lane.orderId);
        assert(
          ['confirmed', 'failed'].includes(order.status),
          'Finish pending purchase before deployment',
        );
      }
      // Purchases stay blocked after a crash until this exact deployment is reconciled.
      store!.put('sponsoredLane', {
        ...lane,
        id: signer.address,
        holder,
        until: Number.MAX_SAFE_INTEGER,
        deploymentStartedAt: Date.now(),
      });
      locked = true;
    });
    const id = 'fuji-kivuno-plans-sponsored-v3';
    let record = store.lookup<Deployment>('sponsoredContractDeployment', id);
    if (record) {
      unresolved = record.status === 'pending';
      assert.equal(
        record.bytecodeHash,
        quote.bytecodeHash,
        'Existing deployment has different code',
      );
      assert.equal(record.token, token);
      assert.equal(record.treasury, treasury);
      assert.equal(record.sponsor, signer.address);
    } else {
      const nonce = await provider.getTransactionCount(signer.address, 'pending');
      const raw = await signer.signTransaction({
        ...deploy,
        chainId: 43113,
        gasPrice,
        gasLimit,
        nonce,
        value: 0,
        type: 0,
      });
      record = {
        id,
        hash: keccak256(raw),
        raw,
        address: getCreateAddress({ from: signer.address, nonce }),
        bytecodeHash: quote.bytecodeHash,
        status: 'pending',
        token,
        treasury,
        sponsor: signer.address,
      };
      store.put('sponsoredContractDeployment', record);
      unresolved = true;
    }
    assert.equal(store.get<Lane>('sponsoredLane', signer.address).holder, holder);
    if (!(await provider.getTransaction(record.hash)))
      await provider.broadcastTransaction(record.raw);
    const receipt = await provider.waitForTransaction(record.hash, 1, 60000);
    assert.equal(
      receipt?.status,
      1,
      'Deployment not confirmed; rerun to reconcile the same transaction',
    );
    assert.equal(receipt.contractAddress, record.address);
    const deployed = new Contract(record.address, artifact.abi, provider);
    assert.equal(await deployed.protocol(), 'kivuno-plans-sponsored-v3');
    assert.equal(await deployed.ACTUAL_PRICE(), 0n);
    assert.equal(await deployed.usdc(), token);
    assert.equal(await deployed.treasury(), treasury);
    assert.equal(await deployed.relayer(), signer.address);
    store.put('sponsoredContractDeployment', { ...record, status: 'confirmed' });
    unresolved = false;
    console.log(
      JSON.stringify({
        action: 'deployed',
        ...quote,
        address: record.address,
        txHash: record.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      }),
    );
  }
} finally {
  if (store && locked && !unresolved)
    store.transaction(() => {
      const lane = store!.get<Lane>('sponsoredLane', signer.address);
      if (lane.holder === holder)
        store!.put('sponsoredLane', {
          ...lane,
          holder: undefined,
          until: 0,
          deploymentStartedAt: undefined,
        });
    });
  if (unresolved)
    console.error(
      'Deployment pending: sponsor lane remains paused. Rerun this command after two minutes to reconcile the same signed transaction.',
    );
  store?.close();
  provider.destroy();
}
