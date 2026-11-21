# Sponsored Fuji demo billing

The public contest demo collects **0 USDC**. Plus **2 USDC** and Max **6 USDC** are simulated prices for a 30-day term. Users do not fund wallets or pay gas. Each activation or renewal needs an explicit confirmation; there is no automatic renewal.

## Account wallet

Signup and sign-in call `ensureAccountWallet` before completing the UI flow. Existing sessions also provision a missing wallet on the portal or billing page, before checkout. Creation happens in the browser using cryptographic randomness; the private key is AES-GCM encrypted in IndexedDB. The backend stores the public binding and a per-account wrapping key, never the private key or encrypted wallet backup. Concurrent tabs reuse the committed candidate. Another device preserves the existing account address rather than replacing it. A failed or interrupted setup retries at the next sign-in.

The encrypted backup plus access to the same Kivuno account is required to recover the private key on another browser. The free receipt flow itself only needs the authenticated account and its existing public binding; it does not require the buyer to sign or pay an on-chain transaction.

## Receipt and entitlement

`server/sponsored-billing.ts` creates an authenticated order. On confirmation a dedicated server signer sends a **0 AVAX self-transaction on chain 43113**. Its data is the keccak256 hash of this UTF-8 JSON array:

```text
["kivuno-sponsored-receipt-v1",43113,orderId,wallet,plan,0,simulatedUsdc,createdAt]
```

The random order ID makes the commitment distinct. Email, name and Kivuno user ID are not published on chain. The authenticated status response contains the public fields needed to recompute the commitment and the explorer transaction hash. This is a project-signed receipt attestation, **not a USDC transfer or a `PlanPaid` contract event**. The old `KivunoPlans` deployment is not called by this flow.

The server persists the signed transaction before sending it, verifies the successful chain receipt, sender, recipient, zero value and commitment, and only then writes the normal `billingEntitlement`. Existing quota and desktop entitlement synchronization consume that same record. Same-plan renewals add 30 days to the active term; a different plan starts a fresh 30-day term at the block timestamp. Retrying the same order never grants a second term.

A durable, fenced signer lane serializes nonces. Pending transactions retain their original bytes/hash across restarts. Status retries query the existing transaction and rebroadcast the same bytes only when the RPC cannot find it. User input cannot select signer, recipient, amount, nonce or transaction data. The service permits at most 10 orders per account per rolling day, 200 signed receipts globally per rolling day, and a maximum gas budget of 0.002 test AVAX per receipt. These are demo limits; account creation is not a Sybil-resistant identity check.

## Production configuration

Set these on the `www` Vercel project's **Production** environment and redeploy:

- `KIVUNO_BILLING_MODE=sponsored-demo`
- `KIVUNO_FUJI_RECEIPT_KEY`: sensitive server-only variable for the dedicated receipt wallet. Never prefix it with `VITE_`, place it in source, or use the user's wallet key.
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

The local chain tests cover empty buyer wallets, actual zero transfers, sponsor-paid gas, cross-account access, concurrent confirmation, persisted pending transactions across restart, idempotent entitlement, renewals, upgrades and insufficient sponsor gas. The browser test uses real signup, wallet binding and API routes. Separately verify a receipt on public Fuji after deployment; local Ganache evidence alone is not proof of a public Fuji transaction.
