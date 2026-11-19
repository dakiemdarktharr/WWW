import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import ganache from 'ganache';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Signature,
  Wallet,
  hexlify,
  randomBytes,
} from 'ethers';
import { registerBillingRoutes } from '../server/billing.ts';
import { Store } from '../server/store.ts';
import plans from '../shared/kivuno-plans-artifact.json' with { type: 'json' };
import mockUSDC from '../shared/mock-usdc-test-shanghai-artifact.json' with { type: 'json' };

test('Plus checkout transfers two local test USDC to treasury and applies the receipt once', async (t) => {
  const chainId = 43113;
  const chain = ganache.server({
    chain: { chainId, hardfork: 'shanghai' },
    logging: { quiet: true },
    wallet: { totalAccounts: 3, defaultBalance: 10 },
  });
  await chain.listen(0, '127.0.0.1');
  const rpcUrl = `http://127.0.0.1:${chain.address().port}`;
  const provider = new JsonRpcProvider(rpcUrl, chainId, { cacheTimeout: -1, pollingInterval: 20 });
  const store = new Store(':memory:');
  const app = Fastify();
  t.after(async () => {
    await app.close();
    store.close();
    provider.destroy();
    await chain.close();
  });
  const [deployer, buyer, treasury] = Object.values(chain.provider.getInitialAccounts()).map(
    ({ secretKey }) => new Wallet(secretKey, provider),
  );

  const token = await new ContractFactory(mockUSDC.abi, mockUSDC.bytecode, deployer).deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  // Use the release KivunoPlans artifact also consumed by the Fuji deployment tool.
  const deployed = await new ContractFactory(plans.abi, plans.bytecode, deployer).deploy(
    tokenAddress,
    treasury.address,
  );
  await deployed.waitForDeployment();
  const contractAddress = await deployed.getAddress();
  const settings = {
    KIVUNO_FUJI_PAYMENT_CONTRACT: contractAddress,
    KIVUNO_FUJI_USDC_ADDRESS: tokenAddress,
    KIVUNO_FUJI_TREASURY_ADDRESS: treasury.address,
    KIVUNO_FUJI_RPC_URL: rpcUrl,
  };
  const user = { id: 'buyer', name: 'Buyer', email: 'buyer@example.test' };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, settings);
    registerBillingRoutes(app, store, async () => user);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const post = async (route: string, payload: object, status = 200) => {
    const res = await app.inject({ method: 'POST', url: '/api/billing/' + route, payload });
    assert.equal(res.statusCode, status, res.body);
    return res.json();
  };
  const summary = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/billing/summary' });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  };
  const challenge = await post('wallet/challenge', { address: buyer.address });
  await post('wallet/bind', {
    challengeId: challenge.challengeId,
    signature: await buyer.signMessage(challenge.message),
  });
  const newWallet = Wallet.createRandom();
  const changeProof = async () => {
    const change = await post('wallet/challenge', { address: newWallet.address });
    return {
      challengeId: change.challengeId,
      signature: await newWallet.signMessage(change.message),
      currentSignature: await buyer.signMessage(change.currentWalletMessage),
    };
  };
  // A previously issued change challenge cannot bypass a newer checkout.
  const earlyChange = await changeProof();
  assert.equal((await summary()).tier, 'free');
  const intent = await post('intent', { plan: 'plus' }, 201);
  const amount = 2_000_000n;
  assert.equal(BigInt(intent.amount), amount);
  assert.equal(intent.payer, buyer.address);
  assert.equal(intent.chainId, chainId);
  assert.equal(intent.contract, contractAddress);
  assert.equal(intent.token, tokenAddress);
  assert.match((await post('wallet/bind', earlyChange, 409)).message, /pending payment/);

  const usdc = new Contract(tokenAddress, mockUSDC.abi, deployer);
  await (await usdc.mint(buyer.address, amount)).wait();
  assert.equal(await usdc.balanceOf(treasury.address), 0n);
  const validAfter = Math.floor(Date.now() / 1000) - 60;
  const validBefore = Math.floor(Date.parse(intent.expiresAt) / 1000);
  const nonce = hexlify(randomBytes(32));
  const sig = Signature.from(
    await buyer.signTypedData(
      { name: 'USD Coin', version: '2', chainId, verifyingContract: tokenAddress },
      {
        ReceiveWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      { from: buyer.address, to: contractAddress, value: amount, validAfter, validBefore, nonce },
    ),
  );
  const payment = new Contract(contractAddress, plans.abi, buyer);
  const tx = await payment.pay(intent.id, 1, validAfter, validBefore, nonce, sig.v, sig.r, sig.s);
  const receipt = await tx.wait();
  assert.equal(receipt.status, 1);
  assert.equal(await usdc.balanceOf(buyer.address), 0n);
  assert.equal(await usdc.balanceOf(treasury.address), amount);
  assert.equal((await summary()).tier, 'free');
  // The payment has settled on chain, but the user hasn't submitted its receipt.
  // Move both clocks beyond the intent window to exercise this recovery case.
  const originalNow = Date.now();
  const now = t.mock.method(Date, 'now', () => originalNow + 16 * 60_000);
  await provider.send('evm_mine', [Math.floor(Date.now() / 1000)]);
  const missedReceipt = await post('wallet/bind', await changeProof(), 409);
  assert.match(missedReceipt.message, /active Fuji subscription/);
  const verification = { intentId: intent.id, txHash: tx.hash };
  const first = await post('verify', verification);
  assert.equal(first.verified, true);
  const after = await summary();
  assert.equal(after.tier, 'plus');
  assert.equal(after.profileLimit, 10);
  const block = await provider.getBlock(receipt.blockNumber);
  assert.ok(block);
  assert.equal(Date.parse(after.paidUntil), (block.timestamp + 30 * 86400) * 1000);
  assert.equal((await post('verify', verification)).verified, true);
  assert.equal((await summary()).paidUntil, after.paidUntil);
  assert.equal(store.all('billingPayment').length, 1);
  assert.equal(store.all('billingAppliedIntent').length, 1);
  const activeTerm = await post('wallet/bind', await changeProof(), 409);
  assert.match(activeTerm.message, /current paid term/);
  // Starting checkout without sending a transaction must not permanently lock a wallet.
  await post('intent', { plan: 'plus' }, 201);
  now.mock.mockImplementation(() => originalNow + 31 * 86_400_000);
  await provider.send('evm_mine', [Math.floor(Date.now() / 1000)]);
  const migrated = await post('wallet/bind', await changeProof());
  assert.equal(migrated.address, newWallet.address);
});
