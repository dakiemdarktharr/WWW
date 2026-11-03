# WWW on Vercel

Source: private repository [dakiemdarktharr/WWW](https://github.com/dakiemdarktharr/WWW).

Production: [nosleepclub-relay.vercel.app](https://nosleepclub-relay.vercel.app). The domain tracks production deployments from `main`. Existing team deployment protection remains enabled.

Vercel builds the Vite frontend with `npm run build` and serves `dist`. The full UI now runs on the hosted origin: [MESH](https://nosleepclub-relay.vercel.app/#mesh), [Sessions](https://nosleepclub-relay.vercel.app/#sessions), Team, Workroom, Tasks, Reviews and Settings stay on that URL. Disconnected views show runner setup rather than fabricated project data. The direct local UI remains available.

The coordinator requires a local Codex binary, long-lived processes, SQLite, account homes and Git worktrees. Vercel serves the frontend; it does not run those workers or host their state. The hosted UI connects through an explicitly approved browser window on the same computer. This does not connect from another device or implement a remote multi-user SaaS.

## Connect

1. Update/build the local checkout and start the runner on the same computer as the browser:

   ```sh
   git clone https://github.com/dakiemdarktharr/WWW.git
   cd WWW
   npm ci
   npm run build
   npm start
   ```

   An existing checkout needs the latest source, `npm ci` and `npm run build` before restarting. Requires Node.js 24.22.1+, Git and Codex CLI.

2. Open the canonical Vercel URL and select **Kết nối runner**. Use port 4317 unless `RELAY_PORT` is different. Allow the connection popup.
3. In the local popup, verify `https://nosleepclub-relay.vercel.app` and choose **Cho phép kết nối**. Approval gives that web tab operator access to workspace data, prompts, file operations and Git through this runner. Approval alone does not start a model turn.
4. Keep the popup and runner open. Return to the Vercel tab; navigation, MESH messages and session interaction happen there. Session popouts inherit the approved connection from the tab that explicitly opens them. Sign in to each Codex account yourself in Team.
5. Choose **Ngắt kết nối** in the popup or hosted Settings, or close the popup, to revoke further browser requests. Already accepted operations and running Codex tasks continue; use Pause/Stop first if needed.

Reloading the hosted tab requires approval again. An unrelated tab, preview domain, old alias or different device does not inherit permission. Use the canonical domain to connect. An old launcher-only local build cannot complete this handshake.

If the popup reports connection refused, start the runner on this computer and check its port. An unavailable/outdated runner produces an error after 12 seconds; approval has a 90-second timeout. Opening the web app on a phone does not make a computer's localhost reachable. **Hướng dẫn** works without private GitHub docs. **Private repository** requires source access.

## Browser transport

Only the explicit Connect action opens `GET /#connect` on loopback. The existing narrow top-level document-navigation exception still applies; cross-site HTTP APIs remain denied. No CORS wildcard, public runner port, tunnel, credential upload or cloud API proxy is introduced.

The popup checks the exact HTTPS origin, opener Window and invitation nonce before presenting consent. After approval it transfers a memory-only MessagePort to that opener with an exact `targetOrigin`. All HTTP/API/SSE traffic remains same-origin inside the popup, retaining the existing HttpOnly cookie, JSON and CSRF checks. The hosted tab receives workspace responses/events through the browser channel, never the cookie or CSRF token. Pending requests are bounded; timeouts and heartbeats detect failure. Mutations are not replayed after an ambiguous transport failure. See [security boundaries](SECURITY.md).

The hosted CSP retains `connect-src 'self'`; it does not fetch localhost directly. `Cross-Origin-Opener-Policy: same-origin-allow-popups` preserves the explicit popup relationship. The transport follows the origin/source validation required by [browser messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

Repository privacy and Vercel deployment protection are separate. No runtime account files, `.relay`, database or environment secrets belong in the deployment.

## Regression check

After `npm run build`, run `npm run test:bridge` (install Chromium with `npx playwright install chromium` if necessary). The test serves production assets at a controlled HTTPS origin with the deployment headers and uses a real isolated HTTP coordinator/SQLite. It checks consent, profile/project/message persistence, session popout transport using an inert paused fixture, revocation/reconnection, popup blocking/closure, invalid ports and foreign-origin rejection. It uses no real account/model turn or production data. Ubuntu CI runs it after the normal Windows/Ubuntu unit suite/build. This controlled-origin check does not claim browser authentication against the protected live Vercel deployment.
