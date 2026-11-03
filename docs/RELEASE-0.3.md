# RELAY 0.3 — Windows desktop and AEGIS

## Scope

- Public web: introduction, owner sign-in, explicit desktop activation and Windows download with SHA256.
- Desktop: bundled Node, MinGit and official Windows Codex App Server, isolated account homes, MESH, conversations, model/reasoning selection, worktrees and review.
- Machines: outbound authenticated bridge to the local coordinator; private pairing files for another Windows desktop or headless Linux runner. No router port forwarding.
- Quota/handoff/recovery: actual reported provider limits, shared-account reservations, pushed checkpoints before handoff, stale-lease fencing and explicit recovery after uncertain outcomes.
- AEGIS: Fuji-only registry, project/machine grant epochs, expiring exact-source merge approvals and signed handoff commitments. No production chain or real-currency purchase path.

## Free-only boundary

The release uses the existing free hosting allocation and local CPU. It never provisions a paid server, upgrades a plan or buys AVAX. Fuji test AVAX is required before a registry can be deployed. The UI reports missing funds and never pretends an undeployed registry is confirmed.

GitHub-hosted CI is manual for this alpha, preventing automatic private-repository runner usage from consuming paid minutes. Local verification is the release gate. Vercel Hobby limits may stop the website/bridge; the app cannot promise a free always-on service. Packaging disables certificate discovery and automatic publication; the Windows installer is unsigned. SHA256 is an integrity check, not publisher authentication.

## Trust and privacy

This is a single trusted workspace-owner alpha. Web signup remains disabled. Each desktop session requires browser consent plus PKCE; bearer tokens are hashed server-side and protected by DPAPI in Windows. The local coordinator additionally requires an ephemeral main-process secret. Preview frames receive no desktop privilege.

AEGIS owner/executor keys remain in ACL-restricted local state. They are not sent to renderers or model context. The same Windows user still controls the host OS: this is not isolation from hostile local software or a hardware-wallet security claim. Source code, prompts, provider credentials and quota details are not stored on chain. A receipt proves a signed commitment matches, not that tests were truthful or code is correct.

New ordinary projects work without blockchain. Protected projects fail closed when current grants or confirmations cannot be verified. A consumed merge approval is not retried automatically after an uncertain Git or chain result. Inspect the outcome and request a fresh approval if needed.

## Verification

The suite exercises API authentication/CSRF, concurrent task claims, scopes, quotas, real Git checkpoints, interrupted handoffs, model protocol and recovery. AEGIS tests deploy real bytecode to a local EVM using Fuji's chain ID and test owner checks, replay/expiry/revocation, evidence tampering, same-scope Git-hook changes, rollback and uncertain-transaction recovery. Local EVM tests are distinct from deployment on the public Fuji network.

Browser tests use real Fastify/SQLite/auth with controlled provider fixtures. Electron tests launch the actual app and Node coordinator, check browser-to-app PKCE, credential encryption, the local secret boundary and shutdown. A separate native smoke test starts four official Codex processes with four empty homes and calls account/read only; it does not authenticate four user accounts or consume model usage. The owner must sign into their own accounts for an authenticated end-to-end project run.

## Data continuity

Desktop state is under `%APPDATA%/RELAY/workspace`; closing or updating the app does not delete it. Existing cloud state is retained separately. Cloud projects are not silently migrated into a new desktop state directory. Reopen or clone the intended repository in the desktop; inspect unfinished cloud tasks before changing their coordinator.

## Build

Use Node 24.22.1. `npm run check` verifies source, tests and the web/cloud build. `npm run test:portal`, `npm run test:cloud`, `npm run test:desktop` and `npm run test:codex-native` cover the interfaces. `npm run build:release` stages the allowlisted Windows runtime, builds the installer and copies its metadata into the website build. Credentials and workspace databases are excluded from both source control and the installer.
