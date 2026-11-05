# Kivuno Desktop

The public website introduces Kivuno, authenticates the workspace owner, approves a desktop sign-in code, and distributes Windows and Linux downloads. The workspace runs in the desktop app. Browser tabs do not keep Codex alive.

## Install and sign in

1. Download the Windows x64 installer and compare its SHA256 with the download page.
2. Install Kivuno for your Windows user. Choose a drive with enough free space; the installer displays its requirement, including temporary extraction space. If C: is nearly full, choose a folder such as `D:\Kivuno`. Version 0.6.1 keeps the large archive and extraction staging on that selected drive and does not cache another full installer in LocalAppData. A small writable Windows TEMP directory and space for your workspace data are still needed. This free alpha has no paid Authenticode certificate; Windows may show an unknown-publisher warning. A checksum detects a changed download but does not replace publisher signing.
3. Open Kivuno and choose **Sign in on the web**. Complete the website login and approve the displayed device code.
4. Return to Kivuno. The short-lived activation request is bound to a random proof verifier held only by the app. A consumed activation cannot issue another session.
5. Add accounts in **Team**, then select group members. Codex uses OpenAI sign-in and its bundled App Server. Gemini uses its own Google sign-in. Claude Code and Antigravity use your separately installed, signed-in client with the scoped [MESH MCP configuration](EXTERNAL-MESH.md); adding a profile does not sign that client in.

On Windows, a fresh Codex profile needs the official limited sandbox before write tasks can run. Kivuno 0.6.1 performs the official unelevated setup when that profile is not configured, then restarts its App Server. It does not downgrade an existing sandbox. A failed setup blocks execution and reports the error. Skills/plugins are account-specific; credentials and trusted-tool permissions are never automatically copied between accounts/providers.

## Recheck a download

From the source checkout, `npm run verify:download -- --platform=windows` downloads the complete current installer and checks HTTPS origin, status, exact size, checksum sidecar and SHA-256. Use `--platform=linux` for the Linux archive. Results go into `.local/download-audit`; the command never installs software, signs in or calls a model. `--version=0.6.0` can explicitly audit an older release while preparing an update.

The packaged smoke test accepts `KIVUNO_PACKAGE_DIR` pointing at an actual installed directory (for example `D:\Kivuno`). It runs bundled Node/Git/Codex/Gemini, opens the real Electron app, checks renderer isolation and protected local API, then closes it gracefully. Do not run it while another Kivuno instance or active tasks use the same Windows workspace.

Each Codex account has a separate home in the workspace. The app uses the official Codex App Server and the account's real provider entitlements. No API-key replacement or fake model turn is used. Multiple conversations share their account's actual quota.

## What runs where

- The Windows app bundles Electron, SHA256-verified Node 24 and MinGit runtimes, the coordinator and the Windows Codex CLI. A separate Git or Node installation is not required. Their directories are added only to Kivuno child processes, without changing the computer's PATH.
- Your local data is under `%APPDATA%\RELAY\workspace`. Application updates replace program files, not workspace data. Uninstalling does not delete workspace data.
- The desktop identity token is protected with Windows DPAPI in `%APPDATA%\RELAY\desktop-session.bin`; it is never returned to the renderer, copied into a runner profile, or included in the installer.
- The local server listens on a randomly selected loopback port and requires an ephemeral desktop secret in addition to its existing Origin, cookie and CSRF protections. Ordinary browser tabs cannot use this desktop server.
- A local workspace is pinned to its first verified Kivuno owner. Signing in as a different owner does not open the existing owner's local data.
- Paired remote machines connect outbound to the authenticated cloud bridge. The desktop forwards only runner exchange packets to its local coordinator. The cloud bridge does not receive a desktop credential in the renderer or expose arbitrary local HTTP proxying.
- Closing the window hides the app in the tray. **Quit Kivuno and stop agents** requests graceful shutdown; interrupted work remains subject to recovery on restart. Sleeping or shutting down Windows stops local work. Free cloud services can sleep or hit limits; remote work depends on a reachable bridge and coordinator.

## Connect another computer

In the coordinating desktop, use **Pair machine** to download its private configuration. On the other computer, install Kivuno, sign in and choose **Join as machine**. Select the private JSON file using the native file picker. The app validates the HTTPS website and transport, overrides any supplied storage path with its own private machine directory, and starts the bundled worker without a terminal. Its token never enters renderer state. Stop the connection from the machine list or quit Kivuno to stop all owned workers.

Saved enabled connections reopen after sign-in. An unclean worker shutdown preserves its files and recovery marker; Kivuno will not silently delete that marker or replay uncertain work. A headless Linux/SSH machine continues to use the runner command described in HYBRID.md.

## Linux portable desktop

Download the Linux x64 archive, extract the Kivuno directory, and run `./start-kivuno.sh` as your ordinary desktop user. Node and the official Codex binary are included. Git must be installed using your distribution's package manager. The launcher checks for Git before starting.

Use a Linux desktop compatible with the bundled Electron release, a working GNOME Secret Service or KDE Wallet, and Chromium's user-namespace sandbox. Kivuno does not disable Electron sandboxing and does not store credentials using Linux's plaintext fallback. A missing or locked keyring prevents session persistence. This portable release does not install system packages, change kernel security settings, or request root access.

State remains under `$XDG_CONFIG_HOME/RELAY` (normally `~/.config/RELAY`) so naming changes do not discard accounts or projects. Start the app from the extracted directory; keep its runtime and resources directories together. The build checks the real Linux Node/Codex binaries and App Server protocol without creating an account or running a model turn. This is distinct from testing every desktop distribution or compositor.

## Development and packaging

Use the Node version in `.node-version`. The desktop main process intentionally starts a separate Node runtime because the coordinator uses `node:sqlite`; it does not depend on Electron's embedded Node version.

Build the web application, then run the desktop staging and packaging scripts through npm. `scripts/build-desktop.mjs` copies an explicit source allowlist, installs production dependencies for Windows x64, downloads Node from `nodejs.org`, and verifies its published SHA256. It downloads MinGit 2.56.0.4 from the official Git for Windows release, verifies the pinned release SHA256, and retains its bundled licenses with source provenance. `scripts/package-desktop.mjs` produces a per-user NSIS installer plus `release/downloads.json` and a checksum file. Cross-building Windows on Linux uses the same pinned Windows Node executable, MinGit archive and Windows optional dependencies. On Linux builders, the release then stages Linux production dependencies and the verified Linux Node archive, packages a portable Electron directory, and publishes a SHA256-protected tar.gz. macOS is not published. No private state, `.env`, repository history or login material is staged.

For unpackaged development set `RELAY_NODE_BINARY` to the absolute Node 24 executable path and launch Electron with the `desktop` directory. `RELAY_CLOUD_ORIGIN` is a development-only override requiring HTTPS; the installed app pins its identity origin. Test-only loopback identity and temporary data directories are accepted only in an unpackaged Electron process.

## Security boundary

The renderer is sandboxed with context isolation and no Node integration. Its preload exposes a narrow set of functions for identity status, sign-in, sign-out, approved external links and a directory picker. Requests from child frames cannot invoke those functions. Preview frames do not receive the desktop secret.

Windows DPAPI protects stored identity data against other Windows users, not malicious software already running as the same Windows user. Worktrees and separate Codex homes are not operating-system isolation. A malicious plugin or compromised machine still requires separate OS-level isolation and credential controls. This release does not claim a commercial security audit or an Authenticode-signed installer.

The display name is Kivuno and the messaging area is Neralu. Internal appId, protocol identifiers, data paths and the canonical identity origin retain their legacy names for upgrade compatibility.
