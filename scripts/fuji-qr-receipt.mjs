import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  CHAIN,
  ISSUER,
  SCHEMA,
  EXPLORER,
  grantDigest,
  publicRpc,
  verifyFuji,
} from '../shared/fuji-qr.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'public', 'kivuno-qr-fuji.json');
const directory = path.join(root, '.relay-fuji-demo');
const [action, argument] = process.argv.slice(2);

function fromCheckout(orderId) {
  const db = new DatabaseSync(path.join(directory, 'workspace.db'), { readOnly: true });
  try {
    db.exec('BEGIN');
    const lookup = db.prepare('SELECT data FROM records WHERE kind=? AND id=?');
    const get = (kind, id) => {
      const row = lookup.get(kind, id);
      assert(row, 'Missing ' + kind);
      return JSON.parse(row.data);
    };
    const candidate = get('bankFujiCandidate', orderId);
    const order = get('bankOrder', orderId);
    const credit = get('bankSimulatedCredit', orderId);
    const proof = get('bankLocalProof', orderId);
    const term = get('bankEntitlement', order.ownerId);
    for (const record of [candidate, order, credit, proof]) assert.equal(record.id, orderId);
    assert.equal(credit.ownerId, order.ownerId);
    assert.equal(candidate.ownerId, order.ownerId);
    assert.equal(candidate.plan, order.plan);
    assert.equal(credit.reference, order.reference);
    assert.equal(credit.accountNumber, 'DEMO-KIVUNO');
    assert.equal(credit.amountVnd, order.amountVnd);
    assert.equal(candidate.amountVnd, order.amountVnd);
    assert.equal(credit.creditedAt, candidate.paidAt);
    assert(
      credit.creditedAt >= order.createdAt && credit.creditedAt < order.expiresAt,
      'Credit is outside the quote window.',
    );
    assert.equal(candidate.paidUntil, order.paidUntil);
    assert.equal(term.id, order.ownerId);
    assert.equal(term.tier, order.plan);
    assert.equal(term.latestPaidAt, candidate.paidAt);
    assert.equal(term.paidUntil, candidate.paidUntil);
    assert(term.paidUntil > Date.now(), 'Select an active demo grant for publication.');
    assert.equal(proof.verified, true);
    assert.match(candidate.nonce, /^0x[0-9a-f]{64}$/);
    const commitment = keccak256(
      toUtf8Bytes(
        JSON.stringify([
          'kivuno.bank.simulated-receipt.v1',
          31337,
          candidate.nonce,
          order.id,
          order.ownerId,
          order.plan,
          order.amountVnd,
          candidate.paidAt,
          order.paidUntil,
        ]),
      ),
    );
    assert.equal(commitment, proof.commitment);
    const grant = {
      schema: SCHEMA,
      chainId: CHAIN,
      issuer: ISSUER,
      plan: order.plan,
      grantedAt: new Date(credit.creditedAt).toISOString(),
      paidUntil: new Date(order.paidUntil).toISOString(),
      localChainId: 31337,
      localCommitment: commitment,
      localTxHash: proof.hash,
    };
    grantDigest(grant);
    return grant;
  } finally {
    db.close();
  }
}

async function readDocument() {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function discover(grant) {
  const response = await fetch(
    'https://glacier-api.avax.network/v1/chains/43113/addresses/' +
      ISSUER +
      '/transactions?pageSize=50',
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error('Avalanche index HTTP ' + response.status);
  const { transactions } = await response.json();
  for (const { nativeTransaction: tx } of transactions) {
    if (
      tx.from?.address?.toLowerCase() !== ISSUER.toLowerCase() ||
      tx.to?.address?.toLowerCase() !== ISSUER.toLowerCase()
    )
      continue;
    const details = await publicRpc('eth_getTransactionByHash', [tx.txHash]);
    if (details?.input === grantDigest(grant) && BigInt(details.value) === 0n) {
      const receipt = await publicRpc('eth_getTransactionReceipt', [tx.txHash]);
      if (receipt?.status === '0x1') return tx.txHash;
    }
  }
  throw new Error(
    'No matching confirmed receipt in the latest 50 issuer transactions. A known hash can be verified directly.',
  );
}

if (action === 'prepare') {
  assert(
    argument && /^[0-9a-f-]{36}$/i.test(argument),
    'Pass the ID of the reconciled demo order.',
  );
  const grant = fromCheckout(argument);
  const data = { grant, commitment: grantDigest(grant) };
  try {
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readDocument();
    assert.equal(
      grantDigest(existing.grant),
      data.commitment,
      'A different public grant is already selected.',
    );
  }
  console.log(JSON.stringify(data, null, 2));
} else if (['verify', 'record', 'discover'].includes(action)) {
  const document = await readDocument();
  assert.equal(document.commitment, grantDigest(document.grant));
  const hash =
    argument ||
    document.transaction?.hash ||
    (action === 'discover' && (await discover(document.grant)));
  assert(hash, 'Pass the Fuji transaction hash or run discover.');
  const transaction = await verifyFuji(document.grant, hash, publicRpc);
  if (document.transaction)
    assert.deepEqual(transaction, document.transaction, 'Stored block or transaction changed.');
  if (action === 'record' && !document.transaction) {
    const tmp = file + '.' + process.pid + '.tmp';
    await writeFile(tmp, JSON.stringify({ ...document, transaction }, null, 2) + '\n', {
      flag: 'wx',
    });
    await rename(tmp, file);
  }
  console.log(
    JSON.stringify(
      {
        plan: document.grant.plan,
        grantedAt: document.grant.grantedAt,
        paidUntil: document.grant.paidUntil,
        commitment: document.commitment,
        ...transaction,
        explorer: EXPLORER + hash,
      },
      null,
      2,
    ),
  );
} else
  throw new Error(
    'Usage: node scripts/fuji-qr-receipt.mjs prepare ORDER_ID | discover | record TX_HASH | verify [TX_HASH]',
  );
