# Project browser and desktop lifecycle

Verified against the installed Codex **0.166.0** protocol on 2026-11-04.

Kivuno runs real Codex App Server conversations. Its browser is a **Kivuno-owned, local Electron browser**, not the proprietary browser UI inside ChatGPT or Codex. The generated App Server `ClientRequest.ts` has no browser-control RPC. Its experimental `ThreadStartParams.dynamicTools`, `DynamicToolSpec`, and `DynamicToolCallParams` do provide a supported host-tool boundary. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server) documents dynamic tools and their restoration when resuming a thread.

## User workflow

1. Select a project conversation and open **Browser**.
2. Open the website requested by Codex, or type a public HTTPS address. Interact and sign in directly in the page.
3. Choose **Chia sẻ trang**, review or edit the extracted text, then **Chia sẻ & tiếp tục**. Codex's `browser_read` tool can retrieve that approved snapshot. Kivuno continues the same conversation through its normal quota, login and ownership checks; a paused or interrupted conversation remains paused and the UI explains the next action.
4. Closing the browser panel destroys its page process. Reopening the same project keeps its website login through an owner/project-specific browser partition.

`browser_open` creates a request and a group message; it cannot enter credentials, automatically approve a page share, or navigate a browser currently being operated by a person. `browser_read` only returns explicitly shared text. Snapshots are marked untrusted task material and do not authorize commands, purchases, account changes, or skill installation. A fresh request invalidates the previous snapshot.

## Boundaries

- Exactly one optional `WebContentsView`; no hidden browser per Codex or session. Electron's documented [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) keeps the real page interactive without an iframe or a popup.
- Browser partitions are keyed by owner and project. Different projects do not share cookies. Browser pages have no Kivuno preload, Node integration, or IPC bridge. Context isolation, sandboxing, web security, and background throttling stay enabled.
- Camera, microphone, clipboard permission requests, downloads, webview attachments, file URLs, OS protocols, local IP literals, and the privileged coordinator origin are denied. Production navigation requires a public HTTPS hostname. A test-only localhost exception is unavailable in packaged builds. This is application isolation, not a complete network/DNS firewall.
- URL query strings and fragments are removed from shared snapshots. Passwords, input values, textareas, editable regions, hidden DOM nodes, script content, and frames are not extracted. Known bearer/API-token patterns are redacted. Because visible page text can still contain private information, the person reviews and may edit every snapshot before it is sent.
- Reviewed snapshots and requests remain in coordinator memory for at most 30 minutes, capped at 64 exchanges and 20,000 text characters each. Restarting the coordinator clears them. They are not a credential vault.
- Some identity providers reject embedded browsers or require popup/device integrations. This implementation does not bypass that policy, stream a cloud/SSH machine's browser, or export cookies to agent processes. A remote Codex connected to this coordinator can request/retrieve a human-approved snapshot, but cannot use the user's authenticated browser session as its own browsing credential. New tools are available on new conversations; existing saved Codex threads retain their registered tool set.

## Window and memory behavior

The 40px custom titlebar has three controls: minimize, maximize/restore, and hide to tray. F11 toggles fullscreen even when the project website has focus. Native IPC requires the trusted app's exact main frame; browser operations additionally require a signed-in owner. Website frames cannot operate the window or browser bridge. Native pages hide during app dialogs and snapshot review. Closing the main window preserves the existing tray behavior and active Codex work. **Quit Kivuno and stop agents** remains the explicit shutdown action.

The project browser opens only on demand, closes on panel removal/sign-out, and is suspended after 60 seconds while the main window is hidden or minimized. Browser suspension does not kill Codex sessions; unsaved website forms can be lost, while website cookies persist. Signed-in identity polling is reduced to every 10 seconds, and unchanged status no longer re-renders the entire workspace.

### Measured baseline

One instrumented development Electron E2E run on this Windows machine, with a local static page and **no model workers**:

| State                     | Electron aggregate working set |
| ------------------------- | -----------------------------: |
| Signed in, browser closed |                     418,904 KB |
| One browser page open     |                     524,864 KB |
| Browser closed again      |                     450,368 KB |

These are instantaneous development-test readings, not a memory guarantee or the complete backend/Codex workload. Measurements varied across runs (approximately 364–425 MB at idle). Chromium retains some shared allocations after closing a page. The deterministic regression check is that opening a browser adds exactly one web contents and closing removes it. Each real Codex worker and website adds its own resource use.

## Verification

`tests/browser.test.ts` checks forbidden URLs, coordinator protection, native bounds, scoped exchanges, stale-snapshot invalidation, expiry, redaction, bounded retention, and immutable reads. `tests/desktop.e2e.ts` launches actual Electron, the actual local runtime, and probes the installed Codex binary without a model turn. It checks isolated browser globals/cookies, excluded form/private text, snapshot URL stripping, the single-browser lifecycle, fullscreen controls, encrypted app identity, and sign-out. Its UI path clicks Session view → Browser, navigates a deterministic HTTPS page in a test-only partition, reviews/edits text, shares it through the real server route, and closes the panel. It never logs into an external account or starts a model inference.
