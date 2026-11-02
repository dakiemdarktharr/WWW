# Architecture decisions

## ADR-001: local browser UI and local coordinator

Accepted. The requested product needs access to locally installed Codex, filesystem skills, plugin configuration and Git. A React UI served by a single Node/Fastify process keeps installation small and credentials on the operator's machine. No cloud database, provider API key or paid infrastructure is needed. The trade-off is that remote teammates on different machines are not supported in this release.

```mermaid
flowchart LR
  UI[Local browser] -->|session + CSRF| API[Coordinator]
  API --> DB[(SQLite task ownership)]
  API -->|private stdio| A[Codex profile A]
  API -->|private stdio| B[Codex profile B]
  A --> WA[Task worktree A]
  B --> WB[Task worktree B]
  A -->|room tools| API
  B -->|room tools| API
  API -->|human review + squash| MAIN[Project branch]
```

## ADR-002: deterministic ownership, model-driven work

Accepted. Models implement tasks and communicate progress. SQL transactions decide who owns which task, dependency checks decide readiness, and a human decides integration. We do not spend a second model call to make a decision that a transaction can enforce. One member holds one task lease, and overlapping scopes are mutually exclusive. Semantic duplicate tasks remain a product-level judgment.

## ADR-003: App Server per account

Accepted. Each account receives its own `CODEX_HOME` and App Server process. The bridge uses the installed protocol schema and official login flows. Subscription usage remains attached to the selected account. Skills/plugins are runtime configuration; account identity alone is not sufficient to infer capability. Dynamic room tools are experimental and require protocol opt-in.

## ADR-004: completion is not acceptance

Accepted. A successful turn moves a task into review while retaining its ownership reservation. Dependencies only become runnable after explicit acceptance and integration. Review compares against a recorded base commit and uses squash integration. Retaining worktrees costs disk space but preserves evidence and makes failed merges recoverable.

## ADR-005: fail closed after uncertain termination

Accepted. A request timeout is not proof that a worker stopped. The coordinator terminates its process tree before releasing locks. Failed termination retains an orphan lease. Restart never silently steals a task. This favors correctness over automatic availability; the operator may need to confirm recovery.

## ADR-006: one host is not a hostile multi-tenant boundary

Accepted. The first release is intended for trusted accounts on one machine. A worktree is not a container. Exposing the application over the Internet or running hostile agents would require a new authentication and execution-isolation design, not merely changing the bind address.

## ADR-007: whole-team planning with bounded execution

Accepted. One prompt starts one proposal turn per signed-in profile, concurrently in read-only repository access. The coordinator selects the least-used lead, preferring an engineer on equal lead counts. The lead synthesizes the proposals into a strict plan with stages, dependencies, relative scopes, acceptance criteria and effort estimates. Model output cannot select credentials, change approvals, supply commands to the scheduler, or assign a second task to a busy worker.

The coordinator validates the DAG and persists all execution tasks in one transaction. It allocates the largest estimated tasks first to the member with the least cumulative effort; specialization breaks equal-load ties. This balances planned effort, not measured tokens or elapsed time. All profiles contribute to planning even if the request has fewer meaningful implementation tasks than members.

```mermaid
flowchart LR
  Prompt[One prompt] --> Proposals[All profiles: read-only proposals]
  Proposals --> Lead[Lead: read-only synthesis]
  Lead --> Validate[Validate DAG and allocate effort]
  Validate --> Tasks[Run independent scoped tasks]
  Tasks --> Review[Human review and integration]
  Review -->|dependencies satisfied| Tasks
  Review --> Done[All accepted: complete]
```

Planning submissions are fenced to the active lease and accepted only after a successful turn. Invalid plans return structured tool errors so the lead can correct them in the same turn. Missing output blocks the workflow; retries require Resume. A late materialization conflict rolls back every generated task and sends synthesis back for revision.

The team roster stays reserved for that workflow. A single-flight event-driven pump responds to completions, integrations and revisions; it is not a polling loop that repeatedly spends usage. Read-only planning releases its lease on completion; execution retains ownership through review. Pause blocks new claims, Cancel blocks Resume and drains in-flight starts before stopping workers, and control revisions ensure a later Pause wins over an older Resume. Every unfinished workflow starts paused after a coordinator restart.
