# Cloud deployment

Production: https://nosleepclub-relay.vercel.app. Source: private `dakiemdarktharr/WWW`.

The Vite frontend calls same-origin Vercel Node Functions at `/api/*`. The gateway resumes the named persistent Vercel Sandbox `relay-cloud-workspace`. That Linux VM runs Fastify, SQLite and the official `@openai/codex@0.166.0` App Server over stdio. Browser clients need neither localhost nor a connection popup. Optional conversation popouts are ordinary authenticated views.

## Sign in

The owner password is generated randomly during provisioning and delivered separately in `.local/cloud/WORKSPACE-ACCESS.txt`, never in Git or public assets. Enter it on the web, including on another device. Public signup creates separate Kivuno identities; only the immutable bootstrap owner can access the legacy hosted workspace. The owner can change the password through Better Auth's authenticated `/api/auth/change-password` endpoint; bootstrap never resets an existing owner's password.

In Team, add profiles and sign in to each OpenAI account yourself using device codes. The server forces device authentication, avoiding a localhost OAuth callback. Separate `CODEX_HOME` directories hold each profile's real ChatGPT subscription credentials. Skills/plugins are server installations; those on your desktop are not automatically copied or synchronized by OpenAI sign-in.

Choose New project, owner, competition name/link, deadline and goal. RELAY creates a real Git repository and MESH group. The proposed remote name is `NoSleepClub_[competition]_[project]`. It does not create a remote GitHub repository before GitHub credentials are connected. Projects group RELAY conversations; they are not native Codex Desktop or ChatGPT Projects.

Sessions lets each account open multiple conversations with model/reasoning from its real `model/list` catalog. Empty prompts save conversations without consuming a model turn. Sending starts a real App Server thread; Pause/Resume retains that thread ID. Selected model/reasoning and human-approval sandbox policies are checked before a turn starts. A deployed HTTPS URL can be opened as the project demo.

## Shared groups (0.7)

Desktop sends bounded commands to `/api/desktop/groups` using its private bearer in the main process. The existing cloud database stores groups, invitations, owned teammate metadata and messages; every command enforces membership. The renderer never receives the bearer. See [release scope and limits](RELEASE-0.7.md).

## Free limits and recovery

This installation uses Hobby only: 1 vCPU, 2 GB RAM, a 40-minute configured runtime (the Hobby maximum is 45 minutes). Current Sandbox allowances are 5 active CPU hours/month, 420 GB-hours memory/month and 15 GB retained snapshot/drive storage. See [official pricing and limits](https://vercel.com/docs/sandbox/pricing). These limits are shared with other usage in the Vercel team. It is not an always-on service. Four busy Codex accounts may exceed the small VM's resources.

The named Sandbox snapshots its filesystem on stop and restores it on resume. Its configuration keeps the latest automatic snapshot without expiration. Database, account homes, repositories and worktrees live outside the replaceable application directory. If the named workspace or snapshot is missing, the gateway fails closed; it never creates a blank replacement. Snapshot retention is not an independent backup: deleting the Sandbox or losing its snapshot can lose the workspace.

Opening the web wakes the VM. A cold start can take a while. Interrupted sessions retain their leases; confirm the old process stopped, Recover, then explicitly Resume. Active team workflows pause after restart. The gateway never retries ambiguous mutations. Closing a browser does not stop an active Codex turn. There is no automatic paid upgrade or purchase.

## Deployment and maintenance

`npm run build` creates the UI and a private allowlisted `.cloud/runner.tar.gz`. Only the API Function includes that archive; it is not in `dist`. No local account homes, databases, `.env`, Git credentials or `.local` files are packaged.

Production Vercel secrets: `RELAY_PUBLIC_ORIGIN`, `RELAY_GATEWAY_SECRET`, `RELAY_AUTH_SECRET`, `RELAY_OWNER_PASSWORD`. Sandbox access uses Vercel OIDC. Preview environments have no production secrets and cannot open the production runner. Existing Vercel deployment protection is retained.

An already healthy runner keeps its existing code until its next stop/resume; deployments do not kill active Codex work. For an immediate coordinated update, first pause all work and stop the named Sandbox in Vercel. The next request loads the current private Function payload. Never delete/recreate the Sandbox as an update mechanism. Rotate gateway/auth secrets during that same controlled stop; do not reset identity storage.

For local development, `npm ci`, `npm run build`, `npm start` still serves loopback port 4317. Cloud-only routes are protected by the owner and gateway; local mode preserves Host/Origin, cookie and CSRF protections.

`npm run check` runs formatting, backend tests and build. `npm run test:cloud` runs production browser assets against real isolated Fastify/SQLite/owner authentication, tests two independent browser contexts, project Git creation, MESH synchronization and saved conversations without model usage. CI runs the backend on Windows and Linux and the browser test on Linux. Real cloud authentication/snapshot-resume checks are separate provisioning checks and never use an OpenAI account.

Install the Vercel CLI with `npm i -g vercel` for `vercel env pull`, `vercel deploy` and `vercel logs` during future maintenance.
