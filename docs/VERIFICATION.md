# Verification record

Latest verification: 2026-11-03. Host: Windows. Application runtime: Node.js 24.22.1. Installed Codex: `0.166.0-alpha.5.1`.

## Automated checks

The suite uses temporary repositories, real SQLite transactions, real worker threads competing over one database, real Git worktrees and controlled Codex protocol processes. It makes no paid model calls.

Foundation local full run: **136 tests passed, 0 failed**. The final quota-only run passed all **9 tests**, including the subsequently added queued-prompt regression; the complete suite now contains **137 tests**. Prettier validation, TypeScript checking and the production Vite build also passed. Dependencies are unchanged from the initial audited release.

- Store: competing claims, unique member ownership, scope overlap, dependency acceptance, duplicate titles, cycle detection, fencing, persistence, restart and retained review locks.
- Git: real checkout isolation, clean-tree preflight, committed/uncommitted/Unicode diffs, squash history boundaries, conflict rollback and scope revalidation around hooks.
- Protocol: isolated environment, handshake, request correlation, active-capability filtering, redaction, malformed/oversized frames, human approval policy and sandbox downgrade rejection.
- Service: early completion, binding the thread before starting a turn, stale thread/turn events, fenced approvals, room scope, start timeout, failed process shutdown, review locks, login serialization and case-insensitive private-file detection.
- HTTP: session requirement, Host/Origin/Fetch Metadata, CSRF, JSON-only mutations, input validation, static path boundary, credential redaction and closing open SSE connections during shutdown.
- Planning: bounded structured output, protected scopes, unknown dependencies, cycles, duplicate titles, topological sorting and deterministic effort allocation with specialist tie-breaks.
- Team workflow: four simultaneous read-only proposals, lead-only synthesis, turn/lease-fenced submissions, balanced hierarchy, dependency gating after actual Git integration, invalid-plan blocking without automatic usage retries, atomic rollback and fresh synthesis after a late title collision.
- Workflow controls: HTTP prompt/lifecycle validation, reserved roster, competing starts, pause during asynchronous preflight, newer Pause winning over older Resume, cancel/resume races, failed termination preserving ownership, restart pause and revision denied during integration.

An actual installed App Server completed `initialize` and `account/read` in a new isolated home; it returned no signed-in account. Windows desktop CLI discovery also succeeded with PATH cleared. These checks do not establish successful authenticated turns.

## Initial browser checks

An isolated server and separate Git fixture were used. The user-facing `.relay` database was not seeded with fake users, tasks or quota.

- Created a Team profile without signing in; inspected its isolated home setup instructions.
- Connected a local repository and created two tasks with explicit scopes and a dependency.
- Used Ctrl+K to search and open a task; verified modal focus trapping and Escape dismissal.
- Sent a room message and confirmed it survived reload.
- Dispatched with no authenticated member and received the expected actionable message.
- Verified required fields reject an empty profile submission.
- Checked Tasks, Reviews, Research and Settings on a 390px viewport with no horizontal overflow.
- Observed no browser console errors or warnings after moving font assets out of inline data URLs.
- Captured clean empty-state desktop and mobile screenshots before creating QA data.

## Compact workspace browser checks

The new interface was checked with browser-only workflow fixtures against a separate local QA server. No fixture data was written to the user's `.relay` directory and no real Codex turns were started.

- Submitted one prompt and verified the workflow endpoint and resulting four-member hierarchy.
- Checked stages, dependency links, workload totals and current assignments.
- Filtered the activity feed by member and conversation; sent a room message.
- Exercised Pause, Resume and Cancel, including enabling a new prompt after cancellation.
- Checked 1440px desktop and 390px mobile layouts with no horizontal overflow.
- Opened a task dialog and dismissed it with Escape.
- Verified actual profile/project forms and an unauthenticated Run team request, which returned the expected sign-in error without model usage.
- Checked all five views at 390px and the modal keyboard focus trap. No page errors; one expected HTTP 409 console entry came from the no-login test.

These browser fixtures verify rendering and interaction contracts. The separate controlled-protocol integration tests verify actual coordinator transitions, SQLite ownership and Git integration. Neither establishes live paid-account behavior.

## Foundation 0.2 checks

- Actual installed CLI initialized in a new isolated `.local/foundation-runtime-proof` profile, returned no signed-in account, and its owned process stopped successfully. This consumed no model turn.
- Session tests cover same-account concurrency, separate worktree/scope leases, output streams, steering, sandbox checks, foreign event/tool rejection, review reservations and cancellation during startup.
- MESH tests cover persistent unread/delivery/read/ACK boundaries, introductions, scoped threads, spoofed human prefixes and atomic competing request claims.
- Quota tests cover multiple buckets, sparse hard-block updates, unknown/stale data, scoped/time-limited reserve grants and enforcement across projects.
- Handoff tests exercise real Git commits and bare remotes: author mapping, remote SHA, failed pushes, hook changes, private root/merge history, stale source/session tokens, ACK replay and restart interruption.
- HTTP regressions verify the `/api/sessions` routes do not inherit the public `/api/session` bootstrap exception and that all mutations retain session/CSRF validation.
- Browser checks used isolated QA data plus explicitly marked browser fixtures. MESH threads, mentions, claims, Needs you, quota grant, handoff ACK, actual session event rendering, prompt controls, recovery checkbox and popout were checked.
- Actual unauthenticated profile/project/message forms were exercised; session startup failed before a model turn. Seven views at 390px had no horizontal overflow. Focus trap, Escape, loopback demo validation and session re-bootstrap after 401 passed.
- Production data was not seeded with fixture accounts/messages. Existing one-profile state remained present; the migrated service returned version 0.2.0, no sessions/tasks and honest unknown quota.

## Still requires the user's accounts

Complete browser/device OAuth, verify the four actual identities, check provider quota, configure each desired plugin/MCP connection, and run simultaneous real tasks. Provider limits, sandbox setup and plugin-specific permissions can only be established in those authenticated environments. The workspace does not claim those tests have already passed.

Human review remains required for acceptance criteria and actual test output. UI and protocol tests are not a complete security audit.
