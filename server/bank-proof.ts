import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserProvider, Wallet, keccak256, toUtf8Bytes, type Eip1193Provider } from 'ethers';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CloudUser } from './cloud-auth.ts';
import { DomainError, type Store } from './store.ts';

const chainId = 31337;
const orderId = z.string().min(1).max(128);
const candidateSchema = z.object({
  id: orderId,
  ownerId: z.string().min(1),
  plan: z.enum(['plus', 'max']),
  amountVnd: z.number().int().positive(),
  paidAt: z.number().int().positive(),
  paidUntil: z.number().int().positive(),
  nonce: z.string().regex(/^(?:0x)?[a-f\d]{64}$/i),
});
type Journal = { id: string; commitment: string; nonce: number; hash: string; verified: boolean };
type Issuer = { id: string; key: string };

// The signed payload never contains bank/identity data. The off-chain random salt
// prevents a third party from guessing the small set of plan amounts and dates.
function commitment(candidate: z.infer<typeof candidateSchema>) {
  return keccak256(
    toUtf8Bytes(
      JSON.stringify([
        'kivuno.bank.simulated-receipt.v1',
        chainId,
        candidate.nonce,
        candidate.id,
        candidate.ownerId,
        candidate.plan,
        candidate.amountVnd,
        candidate.paidAt,
        candidate.paidUntil,
      ]),
    ),
  );
}

async function openLedger(store: Store, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const issuer = store.transaction(
    () =>
      store.lookup<Issuer>('bankLocalIssuer', 'issuer') ??
      store.put('bankLocalIssuer', { id: 'issuer', key: '0x' + randomBytes(32).toString('hex') }),
  );
  const signer = new Wallet(issuer.key);
  // Production imports the route module, but never imports the development dependency.
  const { default: ganache } = await import('ganache');
  const chain = ganache.provider({
    database: { dbPath: directory },
    chain: { chainId, networkId: chainId, hardfork: 'shanghai' },
    wallet: { accounts: [{ secretKey: issuer.key, balance: '0x3635c9adc5dea00000' }] },
    logging: { quiet: true },
    miner: { instamine: 'eager' },
  });
  const provider = new BrowserProvider(chain as unknown as Eip1193Provider, chainId, {
    cacheTimeout: -1,
  });
  const sign = (data: string, nonce: number) =>
    signer.signTransaction({
      type: 0,
      chainId,
      nonce,
      to: signer.address,
      data,
      value: 0n,
      gasLimit: 25_000n,
      gasPrice: 2_000_000_000n,
    });
  async function verifyOrBroadcast(record: Journal) {
    if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(chainId))
      throw new DomainError('Local receipt chain does not match.', 503);
    const signed = await sign(record.commitment, record.nonce);
    if (keccak256(signed) !== record.hash)
      throw new DomainError('Local receipt journal does not match its signature.', 409);
    let receipt = await provider.getTransactionReceipt(record.hash);
    if (!receipt) {
      // A confirmed record disappearing indicates a changed or lost ledger. Do not
      // silently mint an apparent replacement. An open attempt can replay only its exact bytes.
      if (record.verified)
        throw new DomainError('Confirmed local receipt is missing from the ledger.', 503);
      if (!(await provider.getTransaction(record.hash))) {
        try {
          await provider.broadcastTransaction(signed);
        } catch {
          if (!(await provider.getTransactionReceipt(record.hash)))
            throw new DomainError('Local receipt is pending. Check this order again.', 503);
        }
      }
      receipt = await provider.getTransactionReceipt(record.hash);
    }
    const transaction = await provider.getTransaction(record.hash);
    if (!receipt || !transaction)
      throw new DomainError('Local receipt is pending. Check this order again.', 503);
    if (
      receipt.status !== 1 ||
      receipt.hash !== record.hash ||
      transaction.hash !== record.hash ||
      receipt.from !== signer.address ||
      receipt.to !== signer.address ||
      transaction.from !== signer.address ||
      transaction.to !== signer.address ||
      transaction.value !== 0n ||
      transaction.data !== record.commitment ||
      transaction.chainId !== BigInt(chainId) ||
      transaction.nonce !== record.nonce ||
      transaction.blockHash !== receipt.blockHash
    )
      throw new DomainError('Local transaction does not match the simulated receipt.', 409);
    if (!record.verified) store.put('bankLocalProof', { ...record, verified: true });
    return {
      network: 'local',
      chainId,
      commitment: record.commitment,
      txHash: record.hash,
      verified: true,
      blockNumber: receipt.blockNumber,
    };
  }
  return {
    async prove(id: string, digest: string) {
      let record = store.lookup<Journal>('bankLocalProof', id);
      if (record && record.commitment !== digest)
        throw new DomainError('The recorded order changed.', 409);
      if (!record) {
        // Recover any previous accepted-but-unacknowledged send before allocating the next nonce.
        for (const open of store
          .all<Journal>('bankLocalProof')
          .filter((row) => !row.verified)
          .sort((a, b) => a.nonce - b.nonce))
          await verifyOrBroadcast(open);
        const nonce = await provider.getTransactionCount(signer.address, 'pending');
        const hash = keccak256(await sign(digest, nonce));
        record = store.put('bankLocalProof', {
          id,
          nonce,
          hash,
          commitment: digest,
          verified: false,
        });
      }
      return verifyOrBroadcast(record);
    },
    async close() {
      provider.destroy();
      await chain.disconnect();
    },
  };
}

export function registerBankProof(
  app: FastifyInstance,
  store: Store,
  currentUser: (r: FastifyRequest) => Promise<CloudUser | null>,
) {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.RELAY_DEPLOYMENT !== 'cloud' ||
    process.env.RELAY_LOCAL_CLOUD_DEMO !== '1' ||
    process.env.RELAY_PUBLIC_ORIGIN !== 'http://127.0.0.1:5173' ||
    process.env.RELAY_PORT !== '4317' ||
    !process.env.RELAY_DATA_DIR
  )
    return;
  const directory = path.resolve(process.env.RELAY_DATA_DIR, 'ledger');
  let ledger: Promise<Awaited<ReturnType<typeof openLedger>>> | undefined;
  let queue: Promise<void> = Promise.resolve();
  app.post('/api/billing/bank/proof', async (request, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || ''))
      throw new DomainError('Local demo only.', 403);
    const user = await currentUser(request);
    if (!user) throw new DomainError('Sign in to view the receipt.', 401);
    const { id } = z.object({ id: orderId }).strict().parse(request.body);
    const candidate = candidateSchema.safeParse(store.lookup('bankFujiCandidate', id));
    if (!candidate.success || candidate.data.id !== id || candidate.data.ownerId !== user.id)
      throw new DomainError('Paid bank demo order not found.', 404);
    const digest = commitment(candidate.data);
    const job = queue.then(async () => {
      ledger ??= openLedger(store, directory).catch((e) => {
        ledger = undefined;
        throw e;
      });
      return (await ledger).prove(id, digest);
    });
    queue = job.then(
      () => undefined,
      () => undefined,
    );
    reply.header('Cache-Control', 'no-store');
    return job;
  });
  app.addHook('onClose', async () => {
    await queue;
    if (ledger) await (await ledger).close();
  });
}
