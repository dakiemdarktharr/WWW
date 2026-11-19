import { sha256, toUtf8Bytes } from 'ethers';

export const ISSUER = '0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805';
export const CHAIN = 43113;
export const RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const SCHEMA = 'kivuno.qr.simulated-grant.v1';
export const EXPLORER = 'https://build.avax.network/explorer/fuji/c-chain/tx/';
const bytes32 = /^0x[0-9a-f]{64}$/;

function requireMatch(condition, message) {
  if (!condition) throw new Error(message);
}

export function grantDigest(grant) {
  const {
    schema,
    chainId,
    issuer,
    plan,
    grantedAt,
    paidUntil,
    localChainId,
    localCommitment,
    localTxHash,
  } = grant;
  const keys = [
    'schema',
    'chainId',
    'issuer',
    'plan',
    'grantedAt',
    'paidUntil',
    'localChainId',
    'localCommitment',
    'localTxHash',
  ];
  requireMatch(
    Object.keys(grant).length === keys.length && keys.every((k) => Object.hasOwn(grant, k)),
    'Unexpected grant fields.',
  );
  requireMatch(
    schema === SCHEMA && chainId === CHAIN && issuer === ISSUER && localChainId === 31337,
    'Wrong attestation domain.',
  );
  requireMatch(plan === 'plus' || plan === 'max', 'Unknown plan.');
  for (const value of [grantedAt, paidUntil])
    requireMatch(
      typeof value === 'string' &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value,
      'Invalid UTC date.',
    );
  requireMatch(Date.parse(paidUntil) > Date.parse(grantedAt), 'Invalid grant duration.');
  requireMatch(
    bytes32.test(localCommitment) && bytes32.test(localTxHash),
    'Invalid local receipt.',
  );
  return sha256(
    toUtf8Bytes(
      JSON.stringify([
        schema,
        chainId,
        issuer.toLowerCase(),
        plan,
        grantedAt,
        paidUntil,
        localChainId,
        localCommitment,
        localTxHash,
      ]),
    ),
  );
}

export async function verifyFuji(grant, hash, rpc) {
  const digest = grantDigest(grant);
  requireMatch(bytes32.test(hash), 'Invalid transaction hash.');
  const [network, tx, receipt] = await Promise.all([
    rpc('eth_chainId', []),
    rpc('eth_getTransactionByHash', [hash]),
    rpc('eth_getTransactionReceipt', [hash]),
  ]);
  requireMatch(BigInt(network) === BigInt(CHAIN), 'RPC is not Fuji.');
  requireMatch(tx && receipt, 'Transaction has no confirmed Fuji receipt yet.');
  const sender = ISSUER.toLowerCase();
  requireMatch(
    tx.hash === hash &&
      receipt.transactionHash === hash &&
      tx.from?.toLowerCase() === sender &&
      tx.to?.toLowerCase() === sender &&
      receipt.from?.toLowerCase() === sender &&
      receipt.to?.toLowerCase() === sender &&
      BigInt(tx.chainId) === BigInt(CHAIN) &&
      BigInt(tx.value) === 0n &&
      tx.input === digest &&
      BigInt(receipt.status) === 1n &&
      tx.blockHash === receipt.blockHash &&
      tx.blockNumber === receipt.blockNumber &&
      tx.transactionIndex === receipt.transactionIndex,
    'Fuji transaction does not attest this grant.',
  );
  const [block, finalized] = await Promise.all([
    rpc('eth_getBlockByNumber', [receipt.blockNumber, false]),
    rpc('eth_getBlockByNumber', ['finalized', false]),
  ]);
  requireMatch(
    finalized && BigInt(finalized.number) >= BigInt(receipt.blockNumber),
    'Fuji has not finalized this height yet.',
  );
  requireMatch(
    block &&
      block.hash === receipt.blockHash &&
      block.number === receipt.blockNumber &&
      block.transactions[Number(BigInt(receipt.transactionIndex))] === hash,
    'Receipt is not in the canonical Fuji block.',
  );
  requireMatch(
    Number(BigInt(block.timestamp)) * 1000 + 999 >= Date.parse(grant.grantedAt),
    'Transaction predates the grant.',
  );
  return { hash, blockNumber: Number(BigInt(block.number)), blockHash: block.hash };
}

export async function publicRpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Fuji RPC HTTP ' + response.status);
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
