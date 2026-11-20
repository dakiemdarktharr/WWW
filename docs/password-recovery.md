# Account storage and password recovery

Implementation is ready; production activation depends on credentials and a verified mail sender. As of 20 November 2026, the project owner has no sending domain. The UI therefore reports that recovery email is unavailable; it does not claim an email was sent. A MongoDB cluster existing in Atlas is not evidence that production is connected: the database user, network access and server environment must also be configured and verified.

## Server configuration

- `RELAY_MONGODB_URI`: Atlas `mongodb+srv://` URI, stored only as a sensitive production server variable. TLS and certificate verification are mandatory. Configured connection failure stops startup; there is no automatic SQLite fallback. Without this variable, the existing local `identity.db` continues to work.
- `RELAY_MONGODB_DATABASE`: dedicated database, defaults to `kivuno_identity`. Grant the runtime database user `readWrite` on this database only. Do not use administrative credentials. Restrict Atlas network access to the actual coordinator egress strategy; an ephemeral IP allowlist must be refreshed if the sandbox changes.
- `RELAY_RESEND_API_KEY` and `RELAY_MAIL_FROM`: both required to enable recovery mail. `RELAY_MAIL_FROM` is a plain email address on a verified sending domain. `RELAY_MAIL_REPLY_TO` is optional. Configure SPF/DKIM and appropriate DMARC with the domain owner; no domain purchase is implicit.
- Existing persistent `RELAY_AUTH_SECRET`, `RELAY_OWNER_PASSWORD`, gateway secret and exact public HTTPS origin remain required. None of these variables use a frontend `VITE_` prefix.

`cloud/runner.ts` forwards these variables into the persistent coordinator. Its runtime revision combines the payload digest with an HMAC of the normalized configuration, keyed by the auth secret. Changes to MongoDB, mail, origin, identity/gateway secrets or Fuji configuration trigger the coordinated drain/restart even when code is unchanged. Disabled optional variables are explicitly cleared. Secret rotation uses the validated running process's existing gateway secret to drain it, then starts the replacement with the new configuration. Do not revive an old revision to change auth state.

MongoDB uses Better Auth's installed adapter with a client and transactions enabled. The 1.7.15 adapter creates required schema indexes before writes, including unique user emails/session tokens. The local SQLite adapter also enables transactions. Password hashing and verification remain Better Auth's implementation; no plaintext passwords are saved.

## Recovery contract

- `POST /api/auth/request-password-reset` accepts only `{ email }`. No caller-supplied redirect URL. An absent sender returns `503 RECOVERY_UNAVAILABLE` for every account. With a sender, both existing and missing accounts receive the same `202` response: request received, check the inbox if the account exists. It does not assert delivery.
- Email delivery runs in tracked background work on the persistent coordinator, bounded by the transport's ten-second timeout. Provider failures are counted without retaining provider bodies, addresses or secrets in logs. The response stays identical for existing and missing users; a failure cannot enumerate accounts. Mail work is drained on orderly shutdown. This is not a durable delivery queue: an unexpected process exit can lose pending mail, and the user may request a new link.
- Additional limits: 20 recovery operations per IP per 15 minutes and 5 requests per normalized email per hour. Email/IP keys use an HMAC, not plaintext. This additional bounded limiter is per coordinator process; Better Auth's normal database-backed endpoint limits also remain enabled. The gateway forwards only a validated platform client IP, not an arbitrary caller-supplied header.
- Recovery tokens expire after 15 minutes and their identifiers are hashed in the database. The email link is fixed to `https://<public-origin>/reset-password#token=...`. Fragments do not reach HTTP access logs. The React page reads the fragment and removes it from visible history. No GET consumes a token; scanners cannot reset a password by following a link.
- `POST /api/auth/reset-password` accepts only `{ token, newPassword }`, with a 12–128 character password. Token query parameters are refused. Every mutation requires the exact public origin. The UI confirms the password and applies `no-referrer`.
- Better Auth consumes the token, revokes all browser sessions and writes the password in one transaction. Concurrent uses yield one success. The post-reset hook revokes the user's desktop devices, outstanding grants and coordinator browser-CSRF sessions. A confirmation email contains no password. The user must sign in again; reset does not create a session.
- Identity transactions and desktop grants are in separate databases. Desktop revocation is synchronous immediately after the identity commit; there is no distributed transaction. An unexpected process/storage failure between these operations requires operational investigation and account-session revocation, rather than claiming the whole distributed operation rolled back.

## Email design and tests

`server/reset-email.ts` contains violet/lime/black/white reset and password-changed banners. They use email-safe tables, inline styles, no remote images and no tracking. `scripts/preview-reset-email.ts` renders local previews without sending email.

`tests/password-recovery.test.ts` exercises actual SQLite/Better Auth flows: hash-only token storage, expiry, duplicate/racing consumption, old password and session invalidation, desktop revocation, origin and redirect rejection, rate limits, unavailable sender and failed transport. `tests/reset-accounts.test.ts` verifies the offline account-reset procedure and backup. These tests use an in-memory fake mail sink and do not send mail to a real inbox. MongoDB production connectivity and inbox delivery require separate operational verification once their credentials exist.

## Reset old accounts at cutover

`scripts/reset-legacy-accounts.ts` is an offline, scoped maintenance command. Dry-run:

```sh
node --import tsx scripts/reset-legacy-accounts.ts --data-dir /vercel/sandbox/state
```

The output contains counts only. Before applying, acquire the same `/vercel/sandbox/relay-upgrade.lock` used by the runner, call the private prepare-upgrade drain endpoint, validate the coordinator PID/cwd, stop it gracefully and wait for exit. Keep the upgrade lock held so web requests cannot start a replacement midway through the reset. Never kill an unidentified process or bypass a failed drain.

```sh
node --import tsx scripts/reset-legacy-accounts.ts \
  --data-dir /vercel/sandbox/state \
  --apply --expect-public-users <dry-run-count> \
  --backup-dir /vercel/sandbox/private-account-backups
```

Apply refuses a live coordinator or a changed account count. It writes private backups of both SQLite databases before mutation, then removes public identities/credentials, all browser sessions/verification tokens and all desktop devices/grants/shared-Sade grants. It keeps the private bootstrap identity required by the coordinator and leaves projects, chats, provider profiles and billing records untouched. The reset transaction attaches the workspace database; retain both backups together for crash recovery because SQLite WAL does not guarantee crash-atomic commits across attached databases. Backups contain sensitive account data and must never be served publicly or committed.

After the reviewed command succeeds, release the upgrade lock and let the current production runner start through its normal health-checked path. Recheck counts, verify an old session and desktop token fail, then test a new signup. If MongoDB was provisioned for this cutover, start with the dedicated empty identity database; do not migrate the deleted public accounts back into it. The reset utility operates only on the named legacy SQLite files and never drops a MongoDB database.

Implementation references: [Better Auth MongoDB transactions](https://better-auth.com/docs/adapters/mongo), [Vercel trusted request headers](https://vercel.com/docs/headers/request-headers), [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
