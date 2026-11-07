# Kivuno 0.6.2

Team now shows each account's sign-in email, provider/machine, remaining usage and skill/plugin counts in one compact card. Settings and quota permissions are collapsed. Usage remains explicitly unavailable or stale when it cannot be verified.

## Several accounts on one computer

Select **Team → This computer → Add account → Codex** for each account. Finish sign-in with the intended ChatGPT account, check its email, then add the next. Each addition creates a separate profile, even when an earlier profile never completed sign-in. Profiles keep separate credentials, capabilities and quota. Four official Codex App Server processes have been tested concurrently; machine admission limits still apply to actual work.

Closing or cancelling the sign-in dialog now cancels that attempt. Signing out another account or dismissing an older attempt cannot release the current account's sign-in lock. Authentication setup is serialized; authenticated accounts can work concurrently.

## Remove a teammate

The trash button removes a teammate from Team and its project groups and signs out its managed account. External MESH credentials lose group access. Project files, conversation records and author records remain. A removed profile cannot be reused for work or re-added to a roster; add a new account instead.

Removal is blocked while a teammate owns work, has interrupted sessions, queued starts, a pending handoff or an unfinished workflow. Resolve those items first. A transport shutdown failure leaves the member visible for recovery.

## Verification

- Backend suite: 232 passed, 1 Linux-only test skipped on Windows.
- Controlled protocol tests: four separate accounts, distinct email/quota, cancellation isolation, owner-authorized deletion, ownership preservation, failed shutdown and revoked external group access. These do not authenticate real accounts.
- Official Codex CLI 0.166.0: four isolated signed-out processes; per-profile skills and local plugin inventory; native worktree read/write; outside-write and read-only denial; dynamic tools and human approval policy. No model turns or account logins.
- Browser interaction test: four Team cards, email/usage/counts, collapsed controls, delete confirmation/cancel, light/dark modes and narrow layout; no page errors.
- Electron test: activation, local API protection, Codex runtime probe, project browser interaction/release, fullscreen controls, encrypted desktop session and sign-out passed in an isolated test workspace.

Authenticated conversations and subscription quota across four real signed-in accounts still need the owner to sign in and test. No paid services were provisioned.
