# Kivuno 0.7.0

## Authentication and provider readiness

Desktop Codex uses the browser callback by default on this computer. Remote/cloud Codex keeps device-code authentication. The provider's own device-code polling interval is not overridden. Kivuno's separate desktop identity endpoint advertises a one-second interval; desktop honors that interval, pushes status through IPC, and refreshes the UI without waiting for a periodic timer. Temporary cloud/network failures retain the pending confirmation until its expiry.

An authenticated account is published before quota and capability loading. The sign-in dialog shows actual steps, an explicit connected state and Done; it does not invent a completion percentage or estimated time. Focus refresh and bounded, single-flight local account probes recover missed notifications. Attempt generations prevent late reads and cancellation from completing a different sign-in.

After successful sign-in, that profile's skills and plugins load automatically in the background, concurrently with quota. Team displays loading separately. A new profile starts with empty inventories; logout clears them and stale reads cannot restore a prior account's inventory. These are capabilities reported by the provider runtime in its isolated profile: ChatGPT login does not promise to download every skill or plugin installed on another computer. Gemini's adapter currently exposes no skill/plugin inventory. Claude/Antigravity remain externally authenticated clients connected through scoped MCP; their connection progress reports a real client heartbeat, not a fabricated subscription OAuth flow.

## Kivuno account isolation

Every new desktop launch requires explicit Kivuno sign-in. Switching accounts stops the old runtime and machine processes before opening the next database. New accounts use SHA-256-namespaced directories containing their own profiles, projects and machine links. A recorded legacy owner retains its existing workspace path so absolute Git worktree paths are not broken; an unowned legacy directory is never automatically assigned to a new user. No existing dataset or workspace is deleted by this release.

The locked startup server rejects workspace API access. Renderer state remounts by owner and session tokens/drafts clear on sign-out. Previous launch leases are revoked without reusing them to open a workspace. Credential files remain OS-encrypted. This separates users inside the application; it does not add OS-level isolation against another process running as the same Windows/Linux user.

## Neralu → Groups

Create a shared group, invite an exact Kivuno email/account ID, accept or decline from the other account, then select **Members → Your teammates → Save my teammates**. The owner controls invitations/removal. Each participant controls only their own roster. Invitations expose no chat history before acceptance. Removing/leaving revokes group access and removes that participant's shared teammates. No provider credentials, local paths or private skill files are uploaded with a roster.

Messages and rosters persist in the existing authenticated cloud database. Message IDs make retries idempotent; history is ordered and paginated. Normal refresh is three seconds for an open group and ten seconds for the list, with focus refresh. Limits: 50 owned groups per user, 32 people per group, 32 teammates per person, 10,000 messages per group and 180 requests/minute per user. Cloud free-tier sleep/outages can delay synchronization; failed sends keep the draft.

Shared group membership does not grant another person access to your local filesystem, subscription, or model execution. This release implements shared human chat and owned AI rosters; it does not automatically dispatch group messages to another participant's AI. Local project sessions and the existing scoped MCP execution flow remain explicit.

## Fullscreen and Windows

F11 hides window controls and removes their reserved height. Move to the top edge or press F10 to reveal them; Escape hides keyboard-revealed controls. Reduced-motion preferences are respected. Git operations enable long paths per command on Windows, covering longer account-specific storage paths without changing the user's global Git configuration.

## Verification

Use Node 24.22.1. Tests use isolated temporary data and controlled provider responses, never real user invitations or paid model turns.

- `npm test`: backend, provider attempts, ownership, PKCE, persistence, group authorization, retry deduplication, pagination and revocation.
- `npm run test:desktop`: real Electron, local runtime, locked API, fullscreen pointer/keyboard controls, two Kivuno identities on one OS profile, switching back without losing projects, fresh-launch sign-in, project browser isolation and scoped external MCP lifecycle.
- `npm run test:collaboration`: production React in two browser contexts, invite/accept, both owners adding their own teammates, two-way messages, reload and revoked access; Codex/Gemini confirmation while plugin loading is intentionally blocked, followed by automatic skill loading.
- `npm run test:cloud` and `npm run test:portal`: existing workspace, account signup/login, explicit desktop consent, responsive portal and browser interactions.
- `npm run build:release` and `npm run test:desktop-package`: distributable Windows runtime/installer checks, using an explicit temporary Electron profile.

The tests do not prove real OpenAI/Google browser approval latency, live Claude authentication, or simultaneous model conversations across paid accounts. Provider/network delay remains external to Kivuno. Linux package generation is performed by the Vercel release build; the native desktop interaction checks here run on Windows.

### Recorded local result (2026-11-07)

TypeScript, formatting and production web/cloud builds passed. The final backend run passed **235 tests**, with **1 Linux boot-ID test skipped** on Windows and no failures. Desktop, two-account group/provider UI, existing cloud UI and portal suites passed. The external connection UI reached its connected step after a controlled MCP client initialized, for both Claude and Antigravity.

A production Electron directory built from the final application sources passed the packaged runtime smoke test in a temporary profile: Node 24.22.1, Codex 0.166.0, Gemini 0.66.0, bundled Git, protected local API and zero renderer errors. The Windows NSIS pipeline also completed. The website's release pipeline rebuilds both downloadable platforms from the published Git commit; local staged installer hashes are not presented as the production download hashes.
