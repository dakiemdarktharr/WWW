# WWW on Vercel

Source: private repository [dakiemdarktharr/WWW](https://github.com/dakiemdarktharr/WWW).

Production entry: [nosleepclub-relay.vercel.app](https://nosleepclub-relay.vercel.app). The project domain tracks production deployments from `main`. The page title includes NoSleepClub RELAY to make it easier to find in browser history. Existing team deployment protection remains enabled.

Vercel builds the Vite frontend from `main` using `npm run build` and serves `dist`. On the hosted origin the application presents a launch/setup page with links to the local MESH and session workspace. On localhost it renders the full existing app.

The **Hướng dẫn** button opens an illustrated Vietnamese introduction and an on-screen tour. See [onboarding behavior](ONBOARDING.md).

The current coordinator requires a local Codex binary, long-lived processes, SQLite, account homes and Git worktrees. The static Vercel deployment does not run those workers or host their state. Start the local runner on the computer where the browser opens the workspace. A fully remote multi-user deployment would require a separate persistent runner and an authenticated relay protocol; it is outside this deployment.

The hosted page never probes localhost or proxies credentials. Its Open buttons launch the local workspace in a new tab, keeping setup instructions available. The coordinator accepts a user-initiated top-level `GET /` document navigation from another site; this narrow exception does not apply to API calls, subresources, iframes, mutations, invalid hosts or foreign Origin headers. Authentication and workspace operations remain same-origin. The port field only accepts numeric non-privileged ports; it cannot be used as an arbitrary redirect.

If the new tab reports connection refused, start `npm start` on the same computer as the browser and use the runner's port. Opening the Vercel site on a phone does not make the computer's localhost reachable. **Setup guide** opens help inside the web app; it does not require access to a private GitHub documentation page. **Private repository** still requires GitHub access to the private source repository.

The GitHub repository stays private. Vercel deployment access is governed by the team's deployment protection settings separately from repository visibility. No runtime account files, `.relay`, local databases or environment secrets belong in a deployment.

To run locally:

```sh
git clone https://github.com/dakiemdarktharr/WWW.git
cd WWW
npm ci
npm run build
npm start
```

Requires Node.js 24.22.1+, Git and Codex CLI. Open `http://127.0.0.1:4317`. Sign in to each account yourself in Team.
