# Deploy KivunoPlans on Fuji

This runbook deploys the Kivuno subscription contract with the user's Core wallet. It applies only to Avalanche Fuji C-Chain, chain ID `43113`. The deployment transaction costs test AVAX for gas; it does not transfer USDC.

## Fixed deployment values

| Field             | Value                                        |
| ----------------- | -------------------------------------------- |
| Contract          | `KivunoPlans`                                |
| Fuji USDC         | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| Treasury          | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805` |
| Expected deployer | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805` |
| Network           | Avalanche Fuji C-Chain (`43113`)             |

The deployed contract fixes the token and treasury as immutable constructor values. Plus costs 2 Fuji test USDC per 30-day period; Max costs 6. The buyer manually confirms each payment and pays gas.

## Prepare and deploy

From the repository root:

```powershell
npm run payment:compile
npm run dev:web
```

Open `http://127.0.0.1:5173/tools/kivuno-fuji-deploy.html` in the browser with Core enabled. Connect the configured deployer account and check the wallet address, Fuji C-Chain, token, treasury, balance, and gas estimate. Select **Review deployment in Core** only after reviewing those values; Core presents the contract-creation transaction for the user to sign.

The page waits for Fuji confirmation and reads the deployed bytecode, `usdc()` and `treasury()` back from chain. Save the public deployment address and transaction hash. It stores only a public attempt marker in browser `localStorage` so a reload or second tab cannot silently enable a duplicate deployment. If a wallet request ends without a hash, check Core activity and the [Fuji C-Chain Explorer](https://build.avax.network/explorer/fuji/c-chain); clear the retry lock only after confirming no successful or pending deployment exists. A confirmed deployment remains locked in this tool.

## Configure a local demo

Set the public contract address in the local billing server environment, then restart the server:

```powershell
$env:KIVUNO_FUJI_PAYMENT_CONTRACT = '0x<verified-contract-address>'
$env:KIVUNO_FUJI_USDC_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65'
$env:KIVUNO_FUJI_TREASURY_ADDRESS = '0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805'
```

`KIVUNO_FUJI_RPC_URL` defaults to Avalanche's Fuji C-Chain RPC. These values are public configuration, not secrets. Do not commit any private key, seed phrase, or wallet credential. No Vercel deployment is part of this runbook.

Before calling the system ready, verify a full payment: the buyer signs the exact EIP-3009 authorization and contract call in Core; Fuji confirms the receipt and `PlanPaid` event; the server verifies chain, contract, token, payer, plan, amount and intent; then Kivuno updates the entitlement and enforces profile/group quotas. A contract deployment alone does not prove the payment flow works.
