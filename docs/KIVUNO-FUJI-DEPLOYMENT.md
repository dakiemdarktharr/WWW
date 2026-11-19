# Kivuno payments on Avalanche Fuji

The existing KivunoPlans contract accepts Plus and Max purchases on Avalanche Fuji C-Chain, chain ID `43113`. Buyers can use a Kivuno account and the wallet created by the billing page. Core is used for the separate contract deployment procedure below.

## Run a purchase locally

1. Install the repository dependencies and start the local application with `npm run dev:fuji-demo`. Open [Kivuno billing](http://127.0.0.1:5173/billing) in a regular browser window. The command starts the API and Vite on loopback and supplies the deployment addresses below.
2. Sign in or create a Kivuno account. The first authenticated visit to billing creates an EVM wallet in this browser and binds its public address to the account. Download the encrypted wallet backup before funding the address. Keep the file and retain access to this Kivuno account.
3. Copy the **buyer wallet address** from billing. Select Avalanche Fuji on the [Circle test USDC faucet](https://faucet.circle.com/) and request test USDC for that address. Send the same buyer a small amount of **Fuji C-Chain test AVAX** for gas from a funded test wallet. The operator can refill their test wallet through the [Avalanche Builder Hub faucet](https://build.avax.network/console/primary-network/faucet). A new buyer wallet starts empty. The treasury in the table below receives subscription revenue.
4. Select Plus for 2 test USDC or Max for 6. Review the amount, recipient, network and 30-day term. Confirm the purchase on the Kivuno page. Each purchase requires a new confirmation.
5. Open the resulting transaction in the Fuji explorer. Check success, the `PlanPaid` event and the USDC transfer to the treasury. In Kivuno, confirm the new plan, expiration date and quota. Keep the transaction hash as the evidence for this purchase.

### Use the wallet on another device

Sign in to the same Kivuno account, open billing and restore the encrypted backup. The page checks the restored address against the existing binding. The device record and backup contain encrypted wallet data. The server provides the account-specific wrapping key to the authenticated browser and does not receive the encrypted file or the EVM private key. Recovery needs both the encrypted wallet data and access to the same account on the same backend. Preserve the demo database in `.relay-fuji-demo/` across restarts. Clearing browser data without a backup removes that browser's copy. An existing external-wallet binding remains valid and address changes require proof from both addresses.

To change a legacy external wallet to a new Kivuno wallet, first finish any pending purchase and use the current paid term. A checkout that was never submitted expires after 15 minutes. Once Fuji has advanced beyond that window and the old address has no active subscription, sign the address change with both wallets. Restoring a backup of the same address works during an active term.

## Reproduce the checkout checks

From the repository root, run the following with Playwright Chromium installed, or set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge.

```sh
node tests/embedded-wallet.e2e.mjs
node --import tsx --test tests/billing.test.ts tests/billing-settlement.test.ts
node --import tsx --test --test-force-exit tests/billing-checkout.e2e.ts
```

The funded browser test runs the Kivuno signup and checkout screen against the billing API and a local Avalanche-compatible EVM fixture. For the live RPC funding check, start `npm run dev:fuji-demo`, set `KIVUNO_RUN_FUJI_SMOKE=1` and run `node tests/billing-embedded-local.e2e.mjs`. This creates a local test account, reads Fuji balances and checks an unfunded Plus purchase stops before broadcast.

## Fixed deployment values

| Field             | Value                                        |
| ----------------- | -------------------------------------------- |
| Contract          | `KivunoPlans`                                |
| Fuji USDC         | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| Treasury          | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805` |
| Expected deployer | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805` |
| Network           | Avalanche Fuji C-Chain (`43113`)             |

The deployed contract fixes the token and treasury as immutable constructor values. Plus costs 2 Fuji test USDC per 30-day period; Max costs 6. The buyer manually confirms each payment and pays gas.

## Verified deployment

The user approved the contract-creation transaction in Core. Fuji C-Chain Explorer reports it as **SUCCESS** and **Final**. The local deployment tool also confirmed the deployed bytecode and read back the immutable USDC and treasury values.

| Field       | Verified value                                                       |
| ----------- | -------------------------------------------------------------------- |
| Contract    | `0xBA7321C1F3107b95Acec6C3490e3130aFaE7a220`                         |
| Transaction | `0x87d0e5b524d729fbe8e8bc67c57201d1729105e41a7cf0a02bb66400cb80bf1f` |
| Deployer    | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805`                         |
| Network     | Avalanche Fuji C-Chain (`43113`)                                     |
| Confirmed   | 2026-11-19 12:11:45 UTC                                              |

The deployment transaction created the contract and transferred no USDC. Explorer evidence: [Fuji transaction](https://build.avax.network/explorer/fuji/c-chain/tx/0x87d0e5b524d729fbe8e8bc67c57201d1729105e41a7cf0a02bb66400cb80bf1f).

## Deploy a new contract (operator only)

From the repository root:

```powershell
npm run payment:compile
npm run dev:web
```

Open `http://127.0.0.1:5173/tools/kivuno-fuji-deploy.html` in the browser with Core enabled. Connect the configured deployer account and check the wallet address, Fuji C-Chain, token, treasury, balance, and gas estimate. Select **Review deployment in Core** only after reviewing those values; Core presents the contract-creation transaction for the user to sign.

The page waits for Fuji confirmation and reads the deployed bytecode, `usdc()` and `treasury()` back from chain. Save the public deployment address and transaction hash. It stores only a public attempt marker in browser `localStorage` so a reload or second tab cannot silently enable a duplicate deployment. If a wallet request ends without a hash, check Core activity and the [Fuji C-Chain Explorer](https://build.avax.network/explorer/fuji/c-chain); clear the retry lock only after confirming no successful or pending deployment exists. A confirmed deployment remains locked in this tool.

## Configure the billing backend

The billing backend reads these public addresses at startup:

```powershell
$env:KIVUNO_FUJI_PAYMENT_CONTRACT = '0xBA7321C1F3107b95Acec6C3490e3130aFaE7a220'
$env:KIVUNO_FUJI_USDC_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65'
$env:KIVUNO_FUJI_TREASURY_ADDRESS = '0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805'
```

Billing routes require `RELAY_DEPLOYMENT=cloud`. The local demo launcher enables this mode with a loopback-only development origin and its own data directory. A hosted instance requires HTTPS and the deployment addresses at startup. `KIVUNO_FUJI_RPC_URL` defaults to Avalanche's Fuji C-Chain RPC. The verifier checks chain, contract, token, payer, plan, amount and payment intent before applying an entitlement.
