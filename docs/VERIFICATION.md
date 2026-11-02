# Verification record

Date: 2026-11-02. Host: Windows. Application runtime: Node.js 24.22.1. Installed Codex: `0.166.0-alpha.5.1`.

## Automated checks

The suite uses temporary repositories, real SQLite transactions, real worker threads competing over one database, real Git worktrees and controlled Codex protocol processes. It makes no paid model calls.

Final local run: **57 tests passed, 0 failed**. Prettier validation, TypeScript checking and the production Vite build also passed. The installed dependency audit reported no known vulnerabilities at verification time.

- Store: competing claims, unique member ownership, scope overlap, dependency acceptance, duplicate titles, cycle detection, fencing, persistence, restart and retained review locks.
- Git: real checkout isolation, clean-tree preflight, committed/uncommitted/Unicode diffs, squash history boundaries, conflict rollback and scope revalidation around hooks.
- Protocol: isolated environment, handshake, request correlation, active-capability filtering, redaction, malformed/oversized frames, human approval policy and sandbox downgrade rejection.
- Service: early completion, binding the thread before starting a turn, stale thread/turn events, fenced approvals, room scope, start timeout, failed process shutdown, review locks, login serialization and case-insensitive private-file detection.
- HTTP: session requirement, Host/Origin/Fetch Metadata, CSRF, JSON-only mutations, input validation, static path boundary, credential redaction and closing open SSE connections during shutdown.

An actual installed App Server completed `initialize` and `account/read` in a new isolated home; it returned no signed-in account. Windows desktop CLI discovery also succeeded with PATH cleared. These checks do not establish successful authenticated turns.

## Browser checks

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

## Still requires the user's accounts

Complete browser/device OAuth, verify the four actual identities, check provider quota, configure each desired plugin/MCP connection, and run simultaneous real tasks. Provider limits, sandbox setup and plugin-specific permissions can only be established in those authenticated environments. The workspace does not claim those tests have already passed.

Human review remains required for acceptance criteria and actual test output. UI and protocol tests are not a complete security audit.
