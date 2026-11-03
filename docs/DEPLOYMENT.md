# WWW on Vercel

Source: private repository [dakiemdarktharr/WWW](https://github.com/dakiemdarktharr/WWW).

Vercel builds the Vite frontend from `main` using `npm run build` and serves `dist`. On the hosted origin the application presents a launch/setup page with links to the local MESH and session workspace. On localhost it renders the full existing app.

The current coordinator requires a local Codex binary, long-lived processes, SQLite, account homes and Git worktrees. The static Vercel deployment does not run those workers or host their state. Start the local runner on the computer where the browser opens the workspace. A fully remote multi-user deployment would require a separate persistent runner and an authenticated relay protocol; it is outside this deployment.

The hosted page never probes localhost, proxies credentials or weakens the coordinator's same-origin rules. Its Open buttons navigate to the local workspace, where authentication and all operations remain same-origin. The port field only accepts numeric non-privileged ports; it cannot be used as an arbitrary redirect.

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
