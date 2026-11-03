# Kivuno 0.4

RELAY becomes **Kivuno**. MESH becomes **Neralu**. The website handles discovery, downloads and identity; the desktop remains the workspace for real Codex accounts.

## Website

- Ocean, mint and smoked-glass palette; a full-height name and download screen.
- Scramble title, spring hover/press, floating navigation dock, pixel return transition and a revealed footer. Effects use the free Motion library and original CSS, with reduced-motion support.
- Interactive Neralu examples for task ownership, knowledge sharing, quota handoff and code review. These are labeled demonstrations and make no model calls.
- Windows and Linux downloads are enabled only by the release manifest after packaging. Unavailable macOS is hidden. SHA256 and installation requirements are available in the download dialog.
- Real email/password signup and login through the existing Better Auth service. Desktop access requires explicit device-code approval. Existing owners can choose **Chủ workspace cũ**.

The Motion reference pages inspired the interactions; this release does not copy paid Motion+ examples or provision Clerk. Public account signup does not verify email ownership or offer password recovery. The free alpha caps accounts at 200 and active desktop credentials at 10 per account. New identities cannot access the original owner's hosted workspace; browser CSRF sessions and desktop grants are bound to their owner.

## Desktop

Windows retains the bundled official Codex CLI, Node and MinGit. Linux x64 has a portable archive containing Electron, Node and Codex; the host supplies Git, a supported keyring and Chromium sandbox support. The Linux build verifies the runtime and real Codex App Server handshake. That check is not a claim that every Linux distribution or desktop environment has been tested.

Internal identifiers, the legacy data directory, wallet location and canonical sign-in origin are preserved. Renaming does not migrate or discard projects and credentials. See [desktop installation](DESKTOP.md) and [brand choices](BRAND.md).

## Native gas coin

The requested custom coin is a **native gas coin for a separate Avalanche L1**, not a C-chain ERC-20 token. This release only [researches a local, free development approach](CUSTOM-L1.md). It does not start a chain, mint a token, pay a validator fee or change AEGIS's Fuji-only guards. Existing AEGIS remains optional and requires a funded test wallet and explicit deployment before it is active on public Fuji.

## Verification and limits

The unit/integration suite passes 176 tests, including owner separation, CSRF, one-use device grants, task ownership, quotas, Git handoff/recovery and local EVM AEGIS checks. Browser tests exercise real signup/login, explicit desktop approval, the existing workspace flow, keyboard navigation, reduced motion and mobile overflow without model usage.

Release validation also covers the packaged Windows executable with system-only PATH, bundled Git commits and Codex protocol access. The production build checks Linux native runtime binaries before publishing its download. Windows remains unsigned; the release does not purchase a signing certificate. No paid provider, blockchain mainnet or new model account is provisioned.

Four live paid Codex accounts still require the user to sign in and test their own provider entitlements. Free cloud availability is bounded by the existing provider plan and cannot guarantee an always-on production service.
