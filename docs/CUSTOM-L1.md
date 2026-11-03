# Kivuno native coin: research proposal

Verified against official documentation on **2026-11-03**. This document proposes future work; it does not create a coin, start a node, or deploy a blockchain. The current application still uses the existing optional AEGIS Fuji integration.

## What would meet the requirement

An **Avalanche L1 running Subnet-EVM** can use its own native coin for transaction gas. **KIV** is a provisional symbol for that coin, not a launched asset or a claim that the symbol is unique. Initial balances can be allocated in genesis. Additional native minting is possible through a configured precompile; the proposed first demo would use a fixed initial allocation and leave additional minting disabled. An ERC-20 deployed on Avalanche C-Chain would still require AVAX for gas, so it would not satisfy the requested native-coin design. [Avalanche L1 architecture and native gas coins](https://docs.avax.network/docs/avalanche-l1s)

| Environment            | Transaction gas            | Other resources or fees                                                          | Fits the free-only phase?                                               |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ERC-20 on Fuji C-Chain | Test AVAX                  | Faucet availability                                                              | Free testing is possible, but it is not the requested native coin.      |
| Local development L1   | Genesis-allocated test KIV | Existing CPU, memory, disk, electricity                                          | **Recommended first experiment.** No purchased tokens or rented server. |
| Own L1 on public Fuji  | Test KIV                   | Test AVAX for P-Chain operations and validator balance; an available node        | Possible later, subject to faucet and infrastructure limits.            |
| Own L1 on mainnet      | KIV                        | Real AVAX for P-Chain operations and ongoing validator fees, plus node operation | **Excluded.** It cannot be promised as a zero-cost service.             |

Creating a subnet requires a P-Chain balance. Sovereign L1 validators use a continuously charged AVAX balance rather than the old requirement to stake AVAX as a Primary Network validator. That fee is dynamic; a depleted balance makes a validator inactive. KIV transaction gas does not replace this separate AVAX obligation. We should query current network fees when estimating a future deployment, not present an old monthly example as a guaranteed price. [Platform CLI subnet operations](https://build.avax.network/docs/tooling/platform-cli/subnets), [L1 validator fee mechanism](https://docs.avax.network/blog/l1-validator-fee)

The official [Builder Hub faucet](https://build.avax.network/console/primary-network/faucet) and [testnet node service](https://build.avax.network/console/testnet-infra/nodes) exist, but their public pages require eligibility checks. This research did not verify an account-specific allocation, hosting duration, or unlimited free capacity. Do not purchase AVAX to unlock a faucet or register a paid host. Local testing remains the fallback if free test resources are unavailable.

## Windows and local resource limits

Keep the Kivuno desktop application on Windows. Run a future chain experiment in a separate Linux environment, using WSL 2 or an existing Linux machine. This is a proposed integration path, not a tested Windows chain package. Avalanche CLI explicitly supports Linux/macOS and has been in maintenance mode since December 2025. The newer Platform CLI documents Linux/macOS installation and P-Chain/L1 management; it is not itself a hosted validator or a complete local network launcher. Pin and check compatible AvalancheGo, Subnet-EVM, and tooling versions before a future implementation. [Avalanche CLI status](https://github.com/ava-labs/avalanche-cli), [Platform CLI installation](https://build.avax.network/docs/tooling/platform-cli/installation), [Platform CLI scope](https://build.avax.network/docs/tooling/platform-cli)

Current official guidance for a low-throughput L1 validator lists **2 CPU cores, 4 GB RAM, 100 GB storage, and 25 Mbps networking**. These are planning figures for a validator, not a measured footprint for our short local demo. A local development network may run several processes; its combined footprint must be measured. Public L1 validators sync the P-Chain; `partial-sync-primary-network` avoids also syncing X/C-Chain state. Do not accidentally provision a full Primary Network node for this experiment. [Avalanche node requirements](https://build.avax.network/docs/nodes/system-requirements)

WSL 2 can cap memory and processor use through `.wslconfig`, but those settings apply globally to WSL 2 distributions. Do not overwrite the user's configuration or restart WSL while other work is running. Lattice is already used for model training, so its spare capacity is not assumed. A future run should have an explicit resource budget, storage location, and stop control. No WSL installation, node process, firewall change, or SSH workload is started by this research. [Microsoft WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

## Concrete future AEGIS example

1. A Codex completes a task and prepares a merge. The application creates a digest of the exact source change and its project/machine context.
2. The owner reviews and approves that digest. A transaction on the development L1 records the approval and spends test KIV as gas.
3. The coordinator verifies the approval, expiry, epochs, and current source before consuming it and attempting Git integration.
4. A handoff stores its signed payload privately and anchors only the receipt digest on the L1. Another machine verifies that commitment before accepting the handoff.

This example reuses AEGIS's existing policy/evidence concept. Chain inclusion proves a recorded commitment, not that tests passed, a Codex behaved correctly, or Git integration succeeded. A local chain controlled by one operator is a functional demonstration, not independent decentralized security.

Code, Neralu messages, prompts, Codex credentials, authentication sessions, signing keys, and full receipts stay off chain. Salted identifiers and digests reduce disclosure but do not hide transaction timing or public addresses. KIV would not buy Codex quota, extend a subscription, authenticate a user, or replace device authorization. Those mechanisms remain separate application responsibilities. See [the existing AEGIS security boundary](AEGIS.md).

## Changes required before implementation

The current code intentionally rejects this proposed chain:

- `contracts/RelayAegis.sol` restricts construction to chain ID **43113**.
- `shared/aegis.ts` fixes Fuji's chain ID, RPC, explorer, and receipt metadata.
- `server/aegis.ts` checks the live RPC chain ID and binds transactions, signatures, and verification to Fuji.

A future implementation needs a distinct development chain ID, explicit allowed-network configuration, a new registry deployment, and network-bound state. Approval digests and typed signatures must retain chain/contract separation; existing Fuji approvals and receipts must never silently become valid on the new chain. Tests must cover wrong-network rejection, replay attempts, reset/restart recovery, depleted gas balances, and a stopped validator. Broadly removing the current chain checks would weaken the existing boundary.

For a first experiment, use test-only keys and allocations, bounded nonzero gas, no bridge, no sale, and no automatic mainnet path. Preserve the current Fuji module until the separate development-chain implementation has been reviewed and tested. There is no deployable L1 configuration or KIV implementation in this release.
