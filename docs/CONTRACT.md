# RELAY implementation contract

Local-only React/Vite + Fastify + node:sqlite. API listens on 127.0.0.1:4317; Vite on 5173. All API bodies JSON. GET /api/session returns {token}; browser must send X-Relay-Token for mutations. GET /api/state returns shared/types.ts WorkspaceState. SSE /api/events emits `change` (refresh state). Errors {error:string}.

- POST /api/members {name,role,color?} => Member (isolated empty profile, no login)
- POST /api/members/:id/login {method:'browser'|'device'} => LoginResult
- POST /api/members/:id/refresh {} => Member; POST /logout {}
- POST /api/members/:id/skills/import {} => imports local standalone skills, excludes auth/config/plugin secrets
- GET /api/members/:id/capabilities => {skills,plugins,errors}; POST /api/members/:id/terminal {} is NOT planned
- POST /api/projects {name,path,goal} => Project (existing local git repo required)
- PATCH /api/projects/:id {name?,goal?} => Project
- POST /api/tasks {projectId,title,description,kind,priority,scope:string[],dependsOn:string[],acceptance,assignedTo?:string|null,status?:'ready'|'backlog'} => Task
- PATCH /api/tasks/:id {title?,description?,status?:'backlog'|'ready',assignedTo?,scope?,dependsOn?,acceptance?,priority?} => Task (only idle tasks)
- POST /api/tasks/:id/run {memberId} => Task (claim+worktree+actual Codex turn)
- POST /api/projects/:id/dispatch {} => {started:string[],skipped:{taskId,reason}[]}
- POST /api/tasks/:id/stop {} => Task
- GET /api/tasks/:id/diff => TaskDiff
- POST /api/tasks/:id/accept {} => Task (commit worktree + reviewed squash integration into project's current branch, clean tree only, explicit user action)
- POST /api/tasks/:id/revise {feedback} => Task (review -> ready with feedback)
- POST /api/messages {projectId,content,taskId?} => RoomMessage; human is authorId null
- POST /api/approvals/:id {decision:'accept'|'decline'} => {ok:true}
- GET /api/tasks/:id/events => Activity[] (bounded logs, redact secrets)
- POST /api/recovery/acknowledge {} => recover stale locks only after user explicitly confirms prior orphan processes have stopped

No fake accounts, progress, tasks or quota. UI starts empty and offers project/account/task creation. Local existing repo can be added; onboarding may use this repo after bootstrap Git commit. Skills/plugins are filesystem/runtime capabilities, not assumed to travel with subscription. Plain agent output is untrusted text. No auto approval, auto merge, credential copying, remote server, or API key fallback.
