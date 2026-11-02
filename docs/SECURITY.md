# Security model

RELAY trusts its local operator and the accounts they connect. It is a loopback application, not a multi-tenant server. The threat model distinguishes accidental parallel edits and stale worker events from hostile code running with the same OS identity.

## Enforced boundaries

- The coordinator binds only to `127.0.0.1`. HTTP Host, Origin and Fetch Metadata checks reject remote-origin and DNS-rebinding requests. No permissive CORS headers are emitted.
- A local HttpOnly, SameSite=Strict session cookie gates API reads. Mutations also require a session-bound CSRF token and JSON content type. Session tokens are memory-only; the UI obtains them from the same-origin bootstrap endpoint.
- Each member runs a separately spawned `codex app-server` over private stdio, with its own `CODEX_HOME`. It never attaches to the desktop app's logged-in daemon. Inherited provider keys, WIF settings, Codex tokens and unrelated environment secrets are excluded.
- Codex owns browser/device authentication and stores credentials in its profile. RELAY never reads or exposes `auth.json`, never handles passwords and never substitutes a shared API key. Profile directories use mode 0700 on Unix and restricted inherited ACLs on Windows.
- OAuth starts are serialized. Returned identity and limits come from the actual provider; a disconnected account has no fabricated balance.
- Turns request workspace-write sandboxing and human on-request approvals. The returned policy is verified before starting the turn. Unsupported requests fail closed.
- SQLite transactions plus a unique member lease enforce task ownership. File/directory scopes are checked for ancestor overlap. A fencing token rejects obsolete completion, room-tool and approval events. Locks are held through review.
- A timed-out turn-start might still be running. RELAY stops the owning process tree before releasing its lease; if termination cannot be confirmed the lease remains orphaned. Restart does not silently reassign interrupted work.
- Review uses the recorded base commit, including committed and uncommitted changes. Scope and common private-path checks are re-run around Git hooks. Squash integration avoids importing raw worker ancestry. Conflicts restore the pre-integration state when Git permits rollback.
- App Server stderr is drained without retaining it. Visible errors, events and structured approval details redact common credential formats. Redaction is defensive pattern matching, not a proof that arbitrary text contains no secrets.

## Trust that remains with the operator

All workers run as the same operating-system user. Git worktrees separate working copies; they do not isolate credentials, processes, network resources or every path that Codex can read. Skills, plugins, MCP servers, Git hooks and repositories can execute code. Do not use this version to run mutually hostile accounts or untrusted third-party code. Separate OS users, VMs or containers with explicit credential brokers would be needed for that threat model.

RELAY preserves Git hooks. An intentionally malicious hook has OS-user privileges; checking its resulting diff does not neutralize its other effects. Likewise, task scope is a scheduling and integration rule, not an OS access-control rule.

Skills import is opt-in. It ignores symlinks and recognizable credential/configuration filenames, enforces size/count bounds, and leaves existing files intact. It does not determine whether a skill's instructions or scripts are trustworthy. Plugins must be configured in the profile's own home; copying another profile's login material is not a supported migration route.

Room content and repository files are untrusted model context. Dynamic room tools only operate on the task's current project; they cannot claim tasks, approve requests or integrate code. A room message is not a higher-priority instruction. Models can still misunderstand content, so reviews remain necessary.

Accepting a review explicitly permits writing a squash commit on the project's currently checked-out branch. Clean-tree checks and an in-process integration lock reduce collisions; avoid editing or committing in that primary checkout while integration is underway. Worker worktrees and Git objects remain available locally. If a real secret was accidentally committed, rotate it and follow a deliberate Git-history cleanup procedure; squash is not secret erasure.

## Recovery

After a crash, the UI retains interrupted tasks and locks. Stop any old RELAY-owned Codex process trees before acknowledging recovery. The coordinator also stops any old client it still owns before releasing orphaned locks. Reviewed tasks keep their reservations through restart and need review or revision, not orphan recovery.

Never expose this HTTP service publicly. Authentication here protects a local browser session; it is not Internet access control. Do not put `.relay`, runtime profiles, SQLite databases or their backups in the repository or in public storage.

## Verification boundary

Automated coverage includes cross-origin/Host/CSRF checks, scoped room messages, stale approvals, sandbox downgrade rejection, competing SQLite claims, dependency and scope locks, shutdown failure, restart recovery, actual Git isolation/rollback, Unicode paths, and hook-time scope checks. Protocol tests use a controlled child process. An installed Codex handshake was also exercised without logging in.

Real OAuth completion, concurrent paid-account turns, quota updates and every installed plugin's permissions have not been verified without the user's accounts. No claim of a complete security audit or cross-user isolation is made.
