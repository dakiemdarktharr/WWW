# Sponsored Fuji demo billing

The public contest demo collects **0 USDC**. Plus **2 USDC** and Max **6 USDC** are simulated prices for a 30-day term. Users do not fund wallets or pay gas. Each activation or renewal needs an explicit confirmation; there is no automatic renewal.

## Account wallet

Signup and sign-in call `ensureAccountWallet` before completing the UI flow. Existing sessions also provision a missing wallet on the portal or billing page, before checkout. Creation happens in the browser using cryptographic randomness; the private key is AES-GCM encrypted in IndexedDB. The backend stores the public binding and a per-account wrapping key, never the private key or encrypted wallet backup. Concurrent tabs reuse the committed candidate. Another device preserves the existing account address rather than replacing it. A failed or interrupted setup retries at the next sign-in.

The encrypted backup plus access to the same Kivuno account is required to recover the private key on another browser. Checkout requires that private key to sign an EIP-3009 authorization after the user clicks **Ký mua gói · 0 USDC**. A browser without the key must restore the backup or return to the original browser. It never silently creates a replacement wallet or lets the server sign as the buyer.

## Receipt and entitlement

`server/sponsored-billing.ts` creates an authenticated order. The account wallet signs Circle USDC's `TransferWithAuthorization` typed data: `from` is the account wallet, `to` is the configured treasury, `value` is always zero, and the authorization expires after 15 minutes. Its nonce commits to this UTF-8 JSON array:

```text
["kivuno-usdc-purchase-v2",43113,orderId,wallet,plan,0,simulatedUsdc,createdAt,token,treasury]
```

The EIP-712 domain is `USD Coin`, version `2`, chain `43113`, with the configured USDC contract as verifier. Both client and server construct the authorization independently; the server recovers the buyer's address before spending any sponsor gas. The project wallet relays `transferWithAuthorization` directly to Circle USDC. No approval, funded buyer wallet or new contract deployment is needed. USDC emits `AuthorizationUsed(buyer, nonce)` and **`Transfer(buyer, treasury, 0)`**. The treasury receives zero USDC; balances do not increase or decrease. Explorer's outer From/To show the sponsor and USDC contract, while the token Transfer log shows the buyer and treasury.

Email, name and Kivuno user ID are not published on chain. The old `KivunoPlans` deployment is not called. Earlier v1 self-transfer receipts remain historical evidence and retain their granted terms; new unsigned v1 quotes are rejected. Pending v1 transactions can still reconcile safely, but all new orders require the buyer signature.

The server persists the signed relay transaction before sending it, verifies a successful Fuji receipt with the exact USDC contract, authorization nonce, buyer, treasury and zero Transfer event, and only then writes the normal `billingEntitlement`. Existing quota and desktop entitlement synchronization consume that same record. Same-plan renewals add 30 days to the active term; a different plan starts a fresh 30-day term at the block timestamp. Retrying the same order never grants a second term. If another relayer submits the same public authorization first, the sponsor transaction may revert; bounded log scans recover the matching successful USDC receipt rather than losing or duplicating the entitlement.

A durable, fenced signer lane serializes nonces. Pending transactions retain their original bytes/hash across restarts. Status retries query the existing transaction and rebroadcast the same bytes only when the RPC cannot find it. User input cannot select signer, recipient, amount, nonce or transaction data. The service permits at most 10 orders per account per rolling day, 200 signed receipts globally per rolling day, and a maximum gas budget of 0.002 test AVAX per receipt. These are demo limits; account creation is not a Sybil-resistant identity check.

## Production configuration

Set these on the `www` Vercel project's **Production** environment and redeploy:

- `KIVUNO_BILLING_MODE=sponsored-demo`
- `KIVUNO_FUJI_RECEIPT_KEY`: sensitive server-only variable for the dedicated receipt wallet. Never prefix it with `VITE_`, place it in source, or use the user's wallet key.
- `KIVUNO_FUJI_USDC_ADDRESS`: Circle Fuji USDC, `0x5425890298aed601595a70AB815c96711a31Bc65`.
- `KIVUNO_FUJI_TREASURY_ADDRESS`: owner's receiving wallet, currently `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`. Changes invalidate outstanding unsigned quotes.
- Optional `KIVUNO_FUJI_RPC_URL`: Fuji C-Chain RPC. Every submission also checks `eth_chainId`.

`cloud/runner.ts` forwards these settings to the protected coordinator and includes them in its HMAC configuration revision. The public API exposes only the sponsor address. Fund that dedicated address with test AVAX; account wallets need no funds. `/api/billing/demo/config` reports network/sponsor readiness. Insufficient project gas produces a clear retryable error, never a request to fund the buyer wallet. Both legacy `/api/billing/intent` and `/api/billing/verify` routes are disabled in this mode so a historical contract subscription cannot overwrite a newer sponsored term. Finish any outstanding legacy purchases before switching modes.

Back up the coordinator database: it contains encrypted-wallet wrapping keys, account bindings, orders, nonce lanes and entitlement state. Do not clear it or reuse the receipt key on another independent instance. Do not send unrelated transactions from the receipt signer. Before changing signers, finish pending receipts and retain the old signer lane in the same database. An unresolved nonce or underpriced pending transaction requires operator investigation; do not delete the order and grant a plan manually.

## Verification

```powershell
node --import tsx --test --test-force-exit tests/sponsored-billing.test.ts tests/billing.test.ts tests/cloud-runner.test.ts
node --import tsx --test --test-force-exit tests/sponsored-checkout.e2e.ts
npm run build
npm run test:portal
```

The local chain tests cover empty buyer wallets, actual zero USDC Transfer events to the treasury, sponsor-paid gas, distinct account wallets, invalid buyer/amount/recipient/nonce signatures, cross-account access, concurrent confirmation, persisted pending transactions across restart, idempotent entitlement, third-party relay reconciliation, expiration, renewals, upgrades and insufficient sponsor gas. The browser test uses real signup, wallet binding, missing-key rejection and encrypted backup restoration. Separately verify a receipt on public Fuji after deployment; local Ganache evidence alone is not proof of a public Fuji transaction.

## No real-money spending

Signing happens locally and costs no gas. Relaying consumes only free Fuji test AVAX, never mainnet AVAX. The service checks chain 43113 before submission and never purchases tokens or falls back to mainnet. If project gas runs out, checkout stops and explains the temporary failure. Hosting remains a separate limit: the operator uses Vercel Hobby and MongoDB M0/Free; do not upgrade, enable paid RPC or purchase extra quota automatically. Exhausted free quotas can interrupt availability.

Protocol reference: [Circle EIP-3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol), [Circle token transfer implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v1/FiatTokenV1.sol).
