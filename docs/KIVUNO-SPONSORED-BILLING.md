# Sponsored Fuji demo billing

The public contest demo collects **0 USDC**. Plus **2 USDC** and Max **6 USDC** are simulated prices for a 30-day term. Users do not fund wallets or pay gas. Each activation or renewal needs an explicit confirmation; there is no automatic renewal.

## Account wallet

Signup and sign-in call `ensureAccountWallet` before completing the UI flow. Existing sessions also provision a missing wallet on the portal or billing page, before checkout. Creation happens in the browser using cryptographic randomness; the private key is AES-GCM encrypted in IndexedDB. The backend stores the public binding and a per-account wrapping key, never the private key or encrypted wallet backup. Concurrent tabs reuse the committed candidate. Another device preserves the existing account address rather than replacing it. A failed or interrupted setup retries at the next sign-in.

The encrypted backup plus access to the same Kivuno account is required to recover the private key on another browser. Checkout requires that private key to sign an EIP-3009 authorization after the user clicks **Ký mua gói · 0 USDC**. A browser without the key must restore the backup or return to the original browser. It never silently creates a replacement wallet or lets the server sign as the buyer.

## Receipt and entitlement

`server/sponsored-billing.ts` creates an authenticated order for `KivunoPlansSponsored` (protocol `kivuno-plans-sponsored-v3`). The account wallet signs Circle USDC's `ReceiveWithAuthorization` typed data: `from` is the account wallet, `to` is the plans contract, `value` is always zero, and the authorization expires after 15 minutes. Its nonce is the keccak256 of this ABI-encoded tuple:

```text
[contract, 43113, keccak256(UTF8(orderId)), wallet, planId, previousPlan, previousPaidUntil]
// address, uint256, bytes32, address, uint8, uint8, uint64
```

The EIP-712 domain is `USD Coin`, version `2`, chain `43113`, with the configured USDC contract as verifier. Both client and server construct the authorization independently; the server recovers the buyer's address before spending any sponsor gas. The project wallet calls `paySponsored` on the plans contract. Only the immutable project relayer may call it. The contract validates the plan and intent, consumes the buyer's authorization, and transfers zero USDC onward to the owner. USDC emits `AuthorizationUsed(buyer, nonce)` and two **Transfer** events: **buyer → plans contract → treasury**, both amount **0**. No balances change and no token approval is required. Explorer's outer From/To show **sponsor → plans contract**, not the two token transfer hops.

The contract stores `subscriptions(wallet)` and emits **PlanPaid** with intent, buyer, plan, token, amount zero and expiry. Same-plan renewal adds 30 days to an active term; changing plans starts 30 days at the block timestamp. The old immutable `KivunoPlans` charged 2/6 USDC and cannot be changed to this sponsored zero-payment protocol. It remains historical; the new version has its own address. Email, name and Kivuno user ID are not published on chain.

The server persists the signed relay transaction before sending it, then checks the successful receipt, exact contract/sponsor, authorization nonce, both zero Transfer events and PlanPaid fields. Only then does it update `billingEntitlement` with the **on-chain expiry**. Existing quota and desktop entitlement synchronization consume that same record. Retrying an order never grants a second term. ReceiveWithAuthorization prevents a third party consuming the authorization directly; changing the plan or imported term invalidates the buyer signature.

On a wallet's first contract purchase, the service can import its active purchased v1/v2 term. This one-time import trusts the project relayer's prior database record; the buyer signature binds the imported plan/expiry, and `LegacyTermImported` makes it visible. Subsequent purchases use the contract's term. Legacy records and entitlements are retained, and already-pending v1/v2 transactions still reconcile. New quotes use v3 only. No historical Fuji transactions are deleted or hidden.

A durable, fenced signer lane serializes nonces. Pending transactions retain their original bytes/hash across restarts. Status retries query the existing transaction and rebroadcast the same bytes only when the RPC cannot find it. User input cannot select signer, recipient, amount, nonce or transaction data. The service permits at most 10 orders per account per rolling day, 200 signed receipts globally per rolling day, and a maximum gas budget of 0.002 test AVAX per receipt. These are demo limits; account creation is not a Sybil-resistant identity check.

## Production configuration

Set these on the `www` Vercel project's **Production** environment and redeploy:

- `KIVUNO_BILLING_MODE=sponsored-demo`
- `KIVUNO_FUJI_RECEIPT_KEY`: sensitive server-only variable for the dedicated receipt wallet. Never prefix it with `VITE_`, place it in source, or use the user's wallet key.
- `KIVUNO_FUJI_USDC_ADDRESS`: Circle Fuji USDC, `0x5425890298aed601595a70AB815c96711a31Bc65`.
- `KIVUNO_FUJI_TREASURY_ADDRESS`: owner's receiving wallet, currently `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`. Changes invalidate outstanding unsigned quotes.
- `KIVUNO_FUJI_SPONSORED_CONTRACT`: deployed `KivunoPlansSponsored`, currently **`0xC3b323443C6964404880b04F949636f742671474`** on Fuji. Readiness checks its protocol, token, treasury, relayer and fixed zero price.
- Optional `KIVUNO_FUJI_RPC_URL`: Fuji C-Chain RPC. Every submission also checks `eth_chainId`.

`cloud/runner.ts` forwards these settings to the protected coordinator and includes them in its HMAC configuration revision. The public API exposes only the sponsor address. Fund that dedicated address with test AVAX; account wallets need no funds. `/api/billing/demo/config` reports network/sponsor readiness. Insufficient project gas produces a clear retryable error, never a request to fund the buyer wallet. Both legacy `/api/billing/intent` and `/api/billing/verify` routes are disabled in this mode so a historical contract subscription cannot overwrite a newer sponsored term. Finish any outstanding legacy purchases before switching modes.

Back up the coordinator database: it contains encrypted-wallet wrapping keys, account bindings, orders, nonce lanes and entitlement state. Do not clear it or reuse the receipt key on another independent instance. Do not send unrelated transactions from the receipt signer. Before changing signers, finish pending receipts and retain the old signer lane in the same database. An unresolved nonce or underpriced pending transaction requires operator investigation; do not delete the order and grant a plan manually.

## Contract deployment

Compile with `npm run payment:compile` (Solidity 0.8.30, optimizer 200, Cancun). The public deployment is [KivunoPlansSponsored on Fuji](https://testnet.snowtrace.io/address/0xC3b323443C6964404880b04F949636f742671474), created by [this transaction](https://testnet.snowtrace.io/tx/0x4b09d7d60065bcebe03a53867d1a1f95f0fc734494f33b04d912bfa1d9a01785). Source and ABI are in `contracts/KivunoPlansSponsored.sol` and `shared/kivuno-plans-sponsored-artifact.json`.

`node --import tsx scripts/kivuno-sponsored-deploy.ts` prints a read-only gas quote using the server environment. Run it only inside the existing coordinator environment, or use `--coordinator` in its Vercel sandbox to read the validated coordinator process settings without exporting keys. `--deploy` uses the same durable sponsor nonce lane as checkout, caps gas at 0.002 test AVAX, persists the signed transaction before broadcasting, and verifies deployed settings. Re-running reconciles the same deployment instead of creating a second contract. If interrupted after signing, the lane remains paused; retry after two minutes. Resolve pending purchases first. Keep the server key inside the server; never copy it to a local environment or browser.

## Verification

```powershell
node --import tsx --test --test-force-exit tests/sponsored-billing.test.ts tests/billing.test.ts tests/cloud-runner.test.ts
node --import tsx --test --test-force-exit tests/sponsored-checkout.e2e.ts
npm run build
npm run test:portal
```

The local chain tests cover empty buyer wallets, both zero USDC transfers, sponsor-paid gas, on-chain expiry, legacy term import, distinct account wallets, invalid buyer/amount/recipient/nonce/plan signatures, cross-account access, concurrent confirmation, persisted pending transactions across restart, replay and third-party rejection, expiration, renewals, upgrades and insufficient sponsor gas. The browser test uses real signup, wallet binding, missing-key rejection and encrypted backup restoration. Separately verify a receipt on public Fuji after deployment; local Ganache evidence alone is not proof of a public Fuji transaction.

## No real-money spending

Signing happens locally and costs no gas. Relaying consumes only free Fuji test AVAX, never mainnet AVAX. The service checks chain 43113 before submission and never purchases tokens or falls back to mainnet. If project gas runs out, checkout stops and explains the temporary failure. Hosting remains a separate limit: the operator uses Vercel Hobby and MongoDB M0/Free; do not upgrade, enable paid RPC or purchase extra quota automatically. Exhausted free quotas can interrupt availability.

Protocol reference: [Circle EIP-3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol), [Circle token transfer implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v1/FiatTokenV1.sol).
