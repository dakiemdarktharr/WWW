import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  NonceManager,
  Signature,
  getAddress,
  hexlify,
  randomBytes,
  Wallet,
  type Eip1193Provider,
  verifyTypedData,
} from 'ethers';
import plansArtifact from '../shared/kivuno-plans-test-shanghai-artifact.json' with { type: 'json' };
import usdcArtifact from '../shared/mock-usdc-test-shanghai-artifact.json' with { type: 'json' };

const AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

async function fixture(chainId = 43113) {
  const raw = ganache.provider({
    chain: { chainId, hardfork: 'shanghai' },
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 100 },
  });
  const provider = new BrowserProvider(raw as unknown as Eip1193Provider);
  const accounts = (
    raw as unknown as { getInitialAccounts(): Record<string, { secretKey: string }> }
  ).getInitialAccounts();
  const keys = Object.values(accounts).map((account) => account.secretKey);
  const payer = new NonceManager(new Wallet(keys[0], provider));
  const treasury = new Wallet(keys[1], provider);
  const mockFactory = new ContractFactory(usdcArtifact.abi, usdcArtifact.bytecode, payer);
  const token = (await mockFactory.deploy()) as unknown as Contract;
  await token.waitForDeployment();
  let payment: Contract | undefined;
  if (chainId === 43113) {
    const paymentFactory = new ContractFactory(plansArtifact.abi, plansArtifact.bytecode, payer);
    const deployed = (await paymentFactory.deploy(
      await token.getAddress(),
      await treasury.getAddress(),
    )) as unknown as Contract;
    await deployed.waitForDeployment();
    payment = deployed;
  }
  return { raw, provider, payer, treasury, token, payment };
}

async function authorizeAndPay(
  state: Awaited<ReturnType<typeof fixture>>,
  planId: 1 | 2,
  paymentIntentId = hexlify(randomBytes(32)),
) {
  const { provider, payer, token, payment } = state;
  assert.ok(payment);
  const payerAddress = getAddress(await payer.getAddress());
  const tokenAddress = await token.getAddress();
  const contractAddress = await payment.getAddress();
  const treasuryAddress = await state.treasury.getAddress();
  const amount = planId === 1 ? 2_000_000n : 6_000_000n;
  const head = await provider.getBlock('latest');
  assert.ok(head);
  const validAfter = head.timestamp - 1;
  const validBefore = head.timestamp + 3600;
  const nonce = hexlify(randomBytes(32));
  const signature = Signature.from(
    await payer.signTypedData(
      {
        name: 'USD Coin',
        version: '2',
        chainId: 43113,
        verifyingContract: tokenAddress,
      },
      AUTHORIZATION_TYPES,
      {
        from: payerAddress,
        to: contractAddress,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
    ),
  );
  assert.equal(
    getAddress(
      verifyTypedData(
        {
          name: 'USD Coin',
          version: '2',
          chainId: 43113,
          verifyingContract: tokenAddress,
        },
        AUTHORIZATION_TYPES,
        {
          from: payerAddress,
          to: contractAddress,
          value: amount,
          validAfter,
          validBefore,
          nonce,
        },
        signature.serialized,
      ),
    ),
    payerAddress,
  );
  await (await token.mint(payerAddress, amount)).wait();
  const transaction = await payment.connect(payer).getFunction('pay')(
    paymentIntentId,
    planId,
    validAfter,
    validBefore,
    nonce,
    signature.v,
    signature.r,
    signature.s,
    { gasLimit: 1_000_000 },
  );
  const receipt = await transaction.wait();
  assert.ok(receipt);
  return { receipt, amount, payerAddress, contractAddress, treasuryAddress, paymentIntentId };
}

test('Fuji-only manual USDC payments use exact plan prices and prevent intent replay', async (t) => {
  const state = await fixture();
  t.after(async () => state.raw.disconnect());
  assert.ok(state.payment);
  const first = await authorizeAndPay(state, 1);
  assert.equal(await state.payment.usedIntents(first.paymentIntentId), true);
  assert.equal(await state.token.balanceOf(first.treasuryAddress), first.amount);

  const replay = state.payment.connect(state.payer).getFunction('pay')(
    first.paymentIntentId,
    1,
    0,
    Math.floor(Date.now() / 1000) + 3600,
    hexlify(randomBytes(32)),
    27,
    `0x${'00'.repeat(32)}`,
    `0x${'00'.repeat(32)}`,
  );
  await assert.rejects(replay);

  const invalidIntent = hexlify(randomBytes(32));
  await assert.rejects(
    state.payment.connect(state.payer).getFunction('pay')(
      invalidIntent,
      1,
      0,
      Math.floor(Date.now() / 1000) + 3600,
      hexlify(randomBytes(32)),
      27,
      `0x${'00'.repeat(32)}`,
      `0x${'00'.repeat(32)}`,
    ),
  );
});

test('same-tier early renewal extends paidUntil; a tier switch starts a new 30-day period', async (t) => {
  const state = await fixture();
  t.after(async () => state.raw.disconnect());
  assert.ok(state.payment);
  await authorizeAndPay(state, 1);
  const first = await state.payment.subscriptions(await state.payer.getAddress());
  await authorizeAndPay(state, 1);
  const renewed = await state.payment.subscriptions(await state.payer.getAddress());
  assert.equal(Number(renewed.planId), 1);
  assert.ok(Number(renewed.paidUntil) >= Number(first.paidUntil) + 29 * 24 * 60 * 60);

  await authorizeAndPay(state, 2);
  const switched = await state.payment.subscriptions(await state.payer.getAddress());
  const now = Math.floor(Date.now() / 1000);
  assert.equal(Number(switched.planId), 2);
  assert.ok(Number(switched.paidUntil) > now + 29 * 24 * 60 * 60);
  assert.ok(Number(switched.paidUntil) < Number(renewed.paidUntil));
});

test('contract constructor rejects non-Fuji chain IDs', async (t) => {
  const state = await fixture(31337);
  t.after(async () => state.raw.disconnect());
  const factory = new ContractFactory(plansArtifact.abi, plansArtifact.bytecode, state.payer);
  await assert.rejects(
    factory.deploy(await state.token.getAddress(), await state.treasury.getAddress()),
  );
});
