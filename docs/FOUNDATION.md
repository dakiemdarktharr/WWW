# RELAY 0.2 — Sessions, MESH, quota and handoff

This release implements the local foundation approved on 2026-11-03. Competition debate/voting, autonomous submission and SCOUT remain later features in [the full draft](FEATURES-NOSLEEP.md).

## Actual Codex sessions

RELAY launches the installed Codex App Server binary as an independent child process for each interactive session. Sessions of one account share that account's existing isolated `CODEX_HOME`; authentication is not copied between profiles. Account metadata/login uses the account control process. The session UI is an interactive rich console with streamed agent output, commands, files, approvals and follow-up/steering prompts. It displays real thread and process IDs. It does not emulate the native Codex TUI or embed the official Desktop window.

Multiple sessions may share an account, subject to account concurrency and quota. Every writing session owns a distinct task, worktree and scope lease. Read-only sessions hold no file scope. A free read-only conversation creates its own research task; it cannot mark an existing implementation task complete through a mode change. Legacy workflow turns are also visible as sessions.

An idle session starts a real model turn when prompted. Read-only completion preserves the conversation; writing completion holds the worktree reservation through review. Follow-up prompts use the same verified sandbox/approval policy. A running prompt can be steered; Pause confirms process-tree termination while retaining ownership. Stop releases ownership only after confirmed termination. Integration and revision cannot race with session follow-up edits.

## MESH

Projects act as separate groups. Common messages are available to every local teammate; mentions set priority and do not restrict delivery. Task replies preserve project boundaries. Sender identity is supplied by the coordinator: a leading `!!` only marks a command when the sender is the authenticated local human. It cannot elevate an agent or quoted webpage.

Per-account inbox cursors distinguish delivery, read-through and acknowledgement. Reading is recorded only after context is delivered to the runtime; acknowledgement is separate. Sequence allocation and request claims are atomic in SQLite, including independent connections. Introductions and open human questions deduplicate across restarts. New teammates see the actual known owner, plan and capabilities; absent account data is reported as unknown.

Session tools include `mesh_read`, `mesh_post`, `mesh_claim`, `mesh_ask`, `mesh_ack` and recipient-fenced handoff acknowledgement. Tools validate the current session, thread, turn and lease. A room message cannot approve a command, grant reserve usage or change ownership by itself.

Human chat requests are atomically claimed and dispatched to a read-only Codex conversation when a signed-in account has quota/capacity. Failed starts stay visible and are not retried in a paid loop. Agent/system messages do not dispatch further turns. New requests remain queued when the team is unavailable; posting a new request, completing a session or explicitly granting reserve usage can advance the queue. Restart alone never resumes it. Implementation changes still require an explicitly scoped writing task.

## Account quota

Provider windows are normalized without assuming a fixed Plus/Pro schedule. All buckets apply to all sessions/projects of the account. Sparse updates merge non-null data into the most recent full snapshot. A provider hard block remains blocked until explicit recovery; elapsed reset time alone is not recovery evidence.

The default reserve floor is 50% remaining. New turns refresh usage before claiming a task. Active sessions are checked by provider updates and a 30-second coordinator poll; snapshots older than two minutes are stale. Unknown/stale quota fails closed, rather than displaying a fabricated allowance. Provider latency means the floor is not an exact token-level stopping guarantee.

When an account reaches its applicable floor, all its running sessions pause. A writing session attempts a progress checkpoint and proposes an eligible recipient. If the team cannot continue, MESH creates a deduplicated Needs you request. A human can grant reserve usage for one account/project with a floor of 0–49% and an expiry up to seven days. Grants never override provider hard limits, unknown data or a different project's policy. Revocation triggers enforcement.

No API-key fallback, credit purchase, paid subscription signup or external email is performed. MESH is the notification channel for this foundation.

## Handoff transaction

1. Capture the source task/session and lease token, then block further source prompts/claims.
2. Stop the source process tree and confirm termination. Uncertain termination retains an orphan lock.
3. Validate the worktree and every outgoing commit against scope/private-path checks; keep Git hooks enabled.
4. Commit progress with the human-configured owner author identity, push to the existing `origin` branch, and verify the remote SHA.
5. Post summary, next actions, test evidence, quota/reset data and the checkpoint in MESH.
6. The recipient reads and acknowledges, or the human explicitly acknowledges on its behalf.
7. Revalidate quota, capacity and the original token; atomically rotate ownership to a paused recipient session. Resume is explicit.

The author identity is an operator-configured mapping, not proof that a GitHub signature is Verified. The Git committer remains the actual coordinator identity. Configure the owner name/email in Team and the project's existing origin before using code handoff. The foundation does not create competition repositories automatically.

Read-only conversations hand off persisted MESH/session context without inventing a Git commit. Failed push, changed ownership, hook edits outside scope and unexpected worker state block handoff and preserve the source reservation. Retry revalidates everything; Cancel ends the proposal without stealing a newer owner's lease. An accepted/replayed handoff cannot transfer a second time.

Test evidence supplied by an agent/operator is labeled as such. The coordinator independently runs `git diff --check` and checkpoint scope/history checks; it does not claim that arbitrary project tests passed.

## Recovery and migration

The database migration preserves existing records and leases, changes uniqueness from account to session, and backfills message sequences. Legacy task claims still retain their one-task-per-member behavior. Nested operations use SQLite savepoints; a failed outer transfer rolls back the complete operation.

After restart, uncertain sessions are interrupted and workflows are paused. Last-observed PIDs, worktrees, task reservations, conversations and unread messages remain available. Recovery requires the human to confirm that old workers stopped. If the current coordinator still owns a process, it stops that process before releasing its lock. Recovery never starts a model turn. Resume is a separate action.

The service remains loopback-only with same-origin sessions, CSRF, Host and Origin checks. Project demo windows accept only loopback HTTP(S) URLs. Backups and the `.relay` directory contain account credentials and private work; keep them outside Git. Sessions share an OS user, so this is not isolation for hostile tenants.

## Foundation HTTP routes

All mutations require the existing authenticated local session, JSON and `X-Relay-Token`.

- `PATCH /api/members/:id`: owner mapping and account concurrency.
- `POST /api/members/:id/quota/refresh`; `POST /api/members/:id/quota/grants`; `POST /api/quota/grants/:id/revoke`.
- `POST /api/sessions`; `GET /api/sessions/:id/events`; `POST /api/sessions/:id/send`.
- `POST /api/sessions/:id/pause`, `/stop`, `/resume`, `/recover`.
- `POST /api/mesh/messages`; `GET /api/mesh/:projectId/inbox?memberId=...`.
- `POST /api/mesh/:projectId/read`, `/ack`; `POST /api/mesh/messages/:id/claim`.
- `POST /api/requests/:id/resolve`.
- `POST /api/handoffs`; `POST /api/handoffs/:id/retry`, `/accept`, `/cancel`.

`GET /api/state` includes sessions, quota, grants, inbox cursors, human requests and handoffs. Session events and room history are bounded/redacted for display; no authentication files or lease tokens are exposed through these endpoints.

## Verification boundary

Protocol tests use controlled peers. Session tests verify concurrent account sessions, streams, steering, fencing, stop/start races, sandbox policy and recovery. MESH tests include competing SQLite clients. Handoff tests use real Git worktrees and bare remotes to exercise author attribution, remote acknowledgement, hooks, hidden root/merge ancestry, retries and ownership rotation. No test logs into the user's account or consumes model usage.

Live browser/device sign-in, actual paid-account concurrency, installed plugin permissions, real provider quota changes and the project's actual GitHub permissions still require the user's accounts. The native TUI `--remote` option was found in the installed CLI help; native TUI attachment is not claimed by the rich-console implementation.
