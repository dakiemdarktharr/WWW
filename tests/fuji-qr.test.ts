import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256, toUtf8Bytes } from 'ethers';
// @ts-expect-error The browser and standalone CLI share this ES module directly.
import { CHAIN, ISSUER, SCHEMA, grantDigest, verifyFuji } from '../shared/fuji-qr.mjs';

const grant = {
  schema: SCHEMA,
  chainId: CHAIN,
  issuer: ISSUER,
  plan: 'plus',
  grantedAt: '2026-11-19T10:00:00.000Z',
  paidUntil: '2026-12-19T10:00:00.000Z',
  localChainId: 31337,
  localCommitment: '0x' + '11'.repeat(32),
  localTxHash: '0x' + '22'.repeat(32),
};
const hash = '0x' + '33'.repeat(32);
const blockHash = '0x' + '44'.repeat(32);
const common = {
  from: ISSUER,
  to: ISSUER,
  blockHash,
  blockNumber: '0xbd',
  transactionIndex: '0x0',
};
const tx = { ...common, hash, chainId: '0xa869', value: '0x0', input: grantDigest(grant) };
const receipt = { ...common, transactionHash: hash, status: '0x1' };
const block = {
  hash: blockHash,
  number: '0xbd',
  timestamp: '0x' + (Date.parse(grant.grantedAt) / 1000).toString(16),
  transactions: [hash],
};
function rpc(values: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    eth_chainId: '0xa869',
    eth_getTransactionByHash: tx,
    eth_getTransactionReceipt: receipt,
    eth_getBlockByNumber: block,
    ...values,
  };
  return async (method: string, params: unknown[]) => {
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized')
      return values.finalized ?? block;
    assert(Object.hasOwn(responses, method));
    return responses[method];
  };
}

test('public grant binds both ledgers, issuer, tier, dates and local receipt', () => {
  assert.equal(
    grantDigest(grant),
    sha256(
      toUtf8Bytes(
        JSON.stringify([
          SCHEMA,
          43113,
          ISSUER.toLowerCase(),
          'plus',
          grant.grantedAt,
          grant.paidUntil,
          31337,
          grant.localCommitment,
          grant.localTxHash,
        ]),
      ),
    ),
  );
  assert.notEqual(grantDigest({ ...grant, plan: 'max' }), tx.input);
  assert.throws(() => grantDigest({ ...grant, chainId: 43114 }));
  assert.throws(() => grantDigest({ ...grant, email: 'unused@example.test' }));
  assert.throws(() => grantDigest({ ...grant, paidUntil: grant.grantedAt }));
});

test('Fuji evidence requires exact digest, successful zero-value issuer transaction and canonical inclusion', async () => {
  assert.deepEqual(await verifyFuji(grant, hash, rpc()), { hash, blockNumber: 189, blockHash });
  const bad = [
    { finalized: { number: '0xbc' } },
    { eth_chainId: '0xa86a' },
    { eth_getTransactionReceipt: null },
    { eth_getTransactionByHash: { ...tx, to: '0x' + '55'.repeat(20) } },
    { eth_getTransactionByHash: { ...tx, value: '0x1' } },
    { eth_getTransactionByHash: { ...tx, input: '0x' } },
    { eth_getTransactionReceipt: { ...receipt, status: '0x0' } },
    { eth_getBlockByNumber: { ...block, transactions: [] } },
    { eth_getBlockByNumber: { ...block, hash: '0x' + '66'.repeat(32) } },
    { eth_getBlockByNumber: { ...block, timestamp: '0x1' } },
  ];
  for (const change of bad) await assert.rejects(verifyFuji(grant, hash, rpc(change)));
  await assert.rejects(verifyFuji({ ...grant, plan: 'max' }, hash, rpc()));
});
