# Kivuno web polish — 20 November 2026

The public site uses the existing four-row Blender lettering and photo-collage
footer. This update removes decorative captions/reset controls, increases light
theme contrast, adds local letter dents and a slower return, loops the group-chat
demo, and shares Free/Plus/Max banners between the homepage and billing. Page
navigation closes and opens horizontal blinds while preserving ordinary links,
browser history and reduced-motion behavior.

Billing shows the plans before authentication. Plus/Max offer one explicit
30-day trial per account; Free remains free indefinitely. Existing prices remain
2 and 6 **test USDC** on Avalanche Fuji, not real-dollar charges. Trial expiry,
group seats, provider-profile limits and existing wallet payments are enforced.

Password recovery uses short-lived hashed tokens, a fixed-origin fragment link,
session revocation and themed email banners. MongoDB support requires verified
TLS and fails closed when a configured connection is unavailable. Runtime
configuration changes now cause a coordinated restart even when source code is
unchanged. See [account operations](password-recovery.md).

## Verification

- TypeScript, production web build, cloud archive and changed-file formatting.
- 37 targeted tests: billing/trials, cloud configuration/upgrade, collaboration,
  gateway, recovery, email, offline reset and title physics.
- Real Ganache browser checkout: three banners, keyboard/touch selection,
  signup, USDC transfer to the treasury, trial without a wallet, reload and expiry.
- Cloud browser E2E: identity/PKCE, collaboration, project/chat boundaries and
  themes; zero page errors.
- Portal browser E2E covers 320/390/768/1440 widths, VI/EN, themes, downloads,
  looping chat, local composer/approval, blinds/history, title drag/dent,
  keyboard/touch/reduced motion, WebGL fallback, footer refraction and recovery
  request/reset/replay/sign-in using a local mail fixture. No real email or model
  call is made.
- A broad 350-test run initially had 347 passes, one skip and two failures.
  The email test caught a removed support address; it was restored and retested.
  A Shared Sade harness timed out under concurrent host load; the unchanged
  scenario passed when rerun separately. No unrelated workflow behavior was
  modified to silence that result.
- Blender contact preview validates bounded patches on representative I/V/O
  letters. The runtime uses a local soft-surface approximation, not a live cloth
  solver; see [title implementation](PUFFY-TITLE.md).

## Production operations and remaining setup

The authorized account reset backed up both SQLite databases privately, safely
drained/stopped the coordinator and removed four public identities, eight browser
sessions and two desktop connections. Post-reset inventory was zero for public
identities, browser sessions, desktop devices and outstanding grants. The private
bootstrap identity and project/chat/provider/billing records were preserved, and
the coordinator restarted successfully.

Atlas has the dedicated NoSleepClub-Kivuno project and free kivuno-identity
cluster. Database-user creation was rejected by the connector despite explicit
approval, including one approved temporary permission change that was immediately
reverted. No MongoDB credential or production URI was created. Production remains
on the existing persistent SQLite identity store until the database user, network
access and sensitive server configuration are completed and verified.

The owner has no sending domain yet. The recovery UI and email templates are
implemented and tested locally, but production mail remains explicitly unavailable
until a verified sender and delivery credentials are configured. No inbox delivery
is claimed.
