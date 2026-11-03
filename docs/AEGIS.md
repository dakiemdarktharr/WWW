# AEGIS on Avalanche Fuji

AEGIS is RELAY's optional policy and handoff-evidence module. It runs on Avalanche Fuji, chain ID **43113**. The application fixes the production RPC to the official Fuji endpoint, checks the live chain ID before operations, and the Solidity constructor rejects other chain IDs. It does not support mainnet, paid subscriptions, tokens, deposits, or purchases.

## Setup in the desktop app

1. Open **AEGIS** and choose **Set up**. RELAY creates a dedicated owner key, an executor key, and a random workspace identifier salt locally.
2. Copy the **owner** public address. Obtain free **Fuji test AVAX** from the linked faucet. Never buy AVAX or send mainnet assets for this setup. Faucet eligibility, coupons, and availability are controlled by the faucet; RELAY does not bypass them.
3. Choose **Deploy on Fuji**. RELAY deploys the registry and allocates 0.01 test AVAX from the owner to its executor when the executor has less than 0.002 test AVAX. Every transaction is capped at a maximum cost plus value of 0.1 test AVAX.
4. Select a project and enable its policy. The local machine initially receives run/merge permission for seven days. Grant any paired remote machine its own bounded permission before assigning protected work to it.
5. Inspect a completed task's exact diff in AEGIS, approve it, then integrate it through Reviews. Approvals expire after at most ten minutes and can be consumed once.

The desktop's default private state is `%APPDATA%\RELAY\workspace`. The private keys are in its ACL-restricted `aegis\identity.private.json`. Public status returns addresses and balances, never private keys. That directory is not part of an installer, repository, source snapshot, or handoff export. Keep a private backup of both the identity file and workspace database together; there is no password reset or automatic lost-key recovery for this alpha.

## What the registry enforces

`contracts/RelayAegis.sol` uses OpenZeppelin two-step ownership. The owner can enable a project, grant/revoke a machine, and approve a particular merge digest. A separate immutable executor can consume approved actions and anchor receipts. The contract makes no outgoing external calls and accepts no deposits.

Machine grants have permission bits, expiry, and an epoch. Changing a grant invalidates old approvals. Changing a project policy also increments its epoch, so disabling and re-enabling a project does not revive earlier approvals. A merge action binds the chain, registry, project, machine, both epochs, reviewed payload, expiry, and a fresh nonce.

The coordinator checks run grants before starting or steering protected model work. This is not an instantaneous remote kill switch. An offline machine cannot learn about revocation immediately, and an already running process is not made safe merely by a new blockchain record. Existing task leases, fencing, stop confirmation, and recovery rules remain necessary.

## Exact-source merge approval

The approval commits to the selected task, its file scope, base commit, target branch head, and a source fingerprint. Preview is checked again before approval to reject changes made while the user was reviewing it. After an approval is consumed, integration verifies the approved file set, Git-normalized file content and modes, and actual staged/committed blobs before and after Git hooks.

This also rejects a hook that alters a file inside the permitted scope or changes the Git index without leaving matching working-tree changes. Failed integration uses RELAY's existing rollback behavior. Consuming an approval and committing Git are separate operations: an approval can be consumed even if integration subsequently fails. A retry requires a new human review and approval, rather than silently replaying the prior authorization.

## Handoff evidence

A completed protected handoff creates an EIP-712 signed receipt containing the handoff identifier, project/task/session identifiers, confirmed checkpoint, next steps, test evidence, and reported quota snapshot. The full payload remains in private local state. The registry receives only salted project/receipt identifiers and a digest.

Use **Anchor** to put the receipt digest on Fuji. A protected handoff cannot be accepted until its current content matches the receipt and the configured registry confirms its anchor. Exported evidence includes the payload, signature, digest, registry, and transaction reference for verification. Treat exported evidence as private: it can contain repository and project details.

If explicit recovery produces a revised checkpoint, RELAY creates a new receipt and preserves earlier receipts. Repeating the same checkpoint does not create duplicates. Acceptance uses the latest receipt for that handoff and requires it to be anchored, so an older anchored receipt cannot silently authorize revised content.

Verification checks payload integrity, typed signature, the registry selected by this workspace, and the registry's authorized executor. A bundle cannot select an arbitrary attacker registry and become trusted. Evidence proves a signed commitment and its inclusion in the registry; it does not prove that code is correct, tests actually ran, a model was honest, or provider-reported quota was independently verified.

## Failure and recovery

The transaction hash and intended state changes are stored before broadcasting. If a response or confirmation is lost, the operation remains pending. Protected work fails closed while its policy outcome is uncertain. **Recover** checks receipts and applies confirmed effects; it never sends the transaction again. An unavailable RPC does not turn a pending transaction into success. A transaction that was never accepted and cannot be found may remain uncertain and require explicit operator investigation; this alpha does not guess that it is safe to replay.

Blockchain availability is only required for AEGIS-protected actions. Existing unprotected projects retain normal RELAY behavior. Disabling a project policy is an explicit owner action and itself requires a confirmed Fuji transaction.

## Security boundary

This release is a **single trusted owner alpha**. Its owner and executor keys are held by the same local coordinator under the Windows account's file permissions. Clicking an authenticated approval instructs that coordinator to sign; this is not an independent hardware-wallet confirmation, multisignature scheme, or defense against a fully compromised coordinator or Windows account.

Codex does not receive the signing keys through RELAY's RPC, renderer, environment, or snapshot export. However, separate account homes and Git worktrees are not OS sandboxes. Malicious plugins, repositories, Git hooks, or processes with the same Windows privileges remain part of the trusted-operator threat model. Blockchain cannot enforce filesystem or GitHub permissions on a host that deliberately bypasses the coordinator.

Public chain addresses and transaction timing remain linkable even though project identifiers are salted and source/chat content stays off chain. The implementation has automated security tests; it has not undergone an independent smart-contract or commercial product audit.

## Reproduce verification

Use the repository's pinned Node version and dependencies:

```text
npm run aegis:compile
node --import tsx --test tests/aegis.test.ts
```

Tests compile the real Solidity artifact and deploy it on a temporary local EVM. They exercise wrong-chain rejection, owner/executor permissions, grant and project epochs, replay/expiry protection, preview changes, source and target Git-hook tampering, signed handoff anchoring, content substitution, wrong registries, persisted identity, and recovery without rebroadcast. A local EVM test is not a claim that a Fuji deployment exists. The AEGIS screen shows the real deployed address only after a confirmed Fuji transaction.

For trusted local administration, `scripts/aegis-manage.ts` supports `setup`, `status`, `deploy`, and `recover` with an absolute private data directory. Its output contains public metadata only. Do not point it at an actively changing workspace without coordinating with the desktop owner.
