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

## Verified deployment

The user approved the contract-creation transaction in Core. Fuji C-Chain Explorer reports it as **SUCCESS** and **Final**. The local deployment tool also confirmed the deployed bytecode and read back the immutable USDC and treasury values.

| Field | Verified value |
| --- | --- |
| Contract | `0xBA7321C1F3107b95Acec6C3490e3130aFaE7a220` |
| Transaction | `0x87d0e5b524d729fbe8e8bc67c57201d1729105e41a7cf0a02bb66400cb80bf1f` |
| Deployer | `0x2b5A65B5C404b48Ba775d3A9ea7ee9EAF2BC2805` |
| Network | Avalanche Fuji C-Chain (`43113`) |
| Confirmed | 2026-11-19 12:11:45 UTC |

The deployment transaction created the contract and transferred no USDC. Explorer evidence: [Fuji transaction](https://build.avax.network/explorer/fuji/c-chain/tx/0x87d0e5b524d729fbe8e8bc67c57201d1729105e41a7cf0a02bb66400cb80bf1f).

## Prepare and deploy

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

The server registers billing routes only when `RELAY_DEPLOYMENT=cloud`; the default local `npm run dev:server` mode does not expose them. A full browser-to-chain demo therefore needs a supported HTTPS cloud-mode environment with these variables set before startup. Vercel deployment remains deferred. `KIVUNO_FUJI_RPC_URL` defaults to Avalanche's Fuji C-Chain RPC. These values are public configuration, not secrets. Never commit a private key, seed phrase, auth secret, or wallet credential.

Before calling the system ready, verify a full payment: the buyer signs the exact EIP-3009 authorization and contract call in Core; Fuji confirms the receipt and `PlanPaid` event; the server verifies chain, contract, token, payer, plan, amount and intent; then Kivuno updates the entitlement and enforces profile/group quotas. A contract deployment alone does not prove the payment flow works.
