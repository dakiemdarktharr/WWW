# Kivuno visual refresh verification

Date: 19 November 2026. Runtime: Node 24.22.1 on Windows. This work was developed in an isolated worktree; unrelated edits in the original workspace were preserved.

## Scope

- Black, white, lime and violet across the website, authentication, billing and desktop workspace surfaces.
- Persistent website light/dark appearance, independent of the desktop appearance preference.
- Continuous local group-chat demonstration with Sade, assignments, independent review, handoff, pause/replay, local replies and simulated approval.
- Four rows of inflated Blender letters, baked pressure/contact deformation, interactive web rotation and a matching rendered fallback.
- A five-species photographic footer assembled from seven real photographs, with optical glass, downloads, copyright and photo attribution.
- Latest upstream QR account-wallet behavior, including encrypted backup restoration and consistent controls.

## Completed checks

| Check                 | Result and scope                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build      | Passed: TypeScript, Vite and cloud bundle. Three.js is loaded through the artwork modules; Vite reports a 573 kB minified shared graphics chunk.                                                                                                                                                                                                                                                                                      |
| Unit suite            | 339 tests: 338 passed, 1 skipped, 0 failed. The skipped reused-PID test requires Linux process semantics.                                                                                                                                                                                                                                                                                                                             |
| Portal E2E            | Passed against the production bundle and real local auth service: downloads and unpublished-platform states, locale persistence, keyboard focus/trapping/Escape, signup validation, member/owner login, explicit desktop consent and one-use token exchange. No page errors or CSP violations.                                                                                                                                        |
| Continuous group chat | Passed: timed delivery, pause/replay, disabled blank submission, local replies, locale changes, keyboard approval and reduced-motion transcript. Demo actions made no service calls. Existing reversible scroll stories and session graph interactions passed.                                                                                                                                                                        |
| Blender title         | Verified 24 letter meshes arranged as four KIVUNO rows. Passed mouse drag, exact spring return, arrow keys, Home reset, immediate reduced-motion return, vertical touch scrolling and poster fallback without WebGL. A slow-frame return issue was fixed using bounded physics substeps before the final passing run.                                                                                                                 |
| Optical footer        | Passed actual canvas initialization, click-through downloads, copyright/credits and no-WebGL photographic fallback. Separate checks cover lazy loading, context-loss disposal and no idle animation frames. Full-bottom screenshots show no visible seam.                                                                                                                                                                             |
| Desktop Electron E2E  | Passed: runtime/Codex probe, authenticated activation, protected API, browser isolation, account separation, DPAPI/session persistence, sign-out and relaunch. The fixture now follows reserve → create → commit profile provisioning and verifies that unreserved creation is rejected.                                                                                                                                              |
| Cloud E2E             | Passed after updating profile-provisioning fixtures to the current lifecycle.                                                                                                                                                                                                                                                                                                                                                         |
| Chat E2E              | Passed.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Theme verification    | Passed: OS preference and live changes, explicit preference and reload, keyboard toggle, billing navigation, standalone photo credits, authentication rendered through React portal, and desktop-preference isolation.                                                                                                                                                                                                                |
| Billing/checkout      | Passed: plan controls, QR demo, invalid amounts, local settlement and receipt, sign-out; local Ganache wallet settlement. No external payment was sent.                                                                                                                                                                                                                                                                               |
| QR account wallet     | Passed with real browser AES encryption and signatures: account binding, collapsed details, keyboard controls, encrypted download, reload, missing-device restore, wrong-account/corrupted-backup rejection and preservation of the original binding. No external RPC was called.                                                                                                                                                     |
| Responsive appearance | Reviewed at 320, 390, 768 and 1440px for the relevant page surfaces. Hero screenshots cover light/dark at 1440 and 390px. Footer checks at 1366×720, 1024×768, 768×768, 768×568, 390×667 and 320×568 verify controls stay within the viewport and clear of the floating dock. A tablet overlap found at 768×768 was fixed and retested against the rebuilt production bundle; short-tablet screenshots also confirm text readability. |

The portal demonstration is intentionally local. These checks do not establish live paid-model quality, production bank settlement, or a real-money blockchain payment.

## Reproducible commands

```sh
npm run format:check
npm run build
npm test
npm run test:portal
npm run test:cloud
npm run test:chat
npm run test:desktop
npx tsx tests/bank-wallet.e2e.ts
```

The unit suite was serialized with `--test-concurrency=1` on this memory-constrained host. Browser and Electron checks were also serialized where needed. Early runs encountered host commit-memory exhaustion and transient process failures; supported-runtime reruns passed after diagnostic processes were closed. This report claims the native flows listed above, not every platform or live provider integration.

## Artwork provenance

- [Photographic sources and reproduction](FOOTER-PHOTO-SOURCES.md).
- [Blender modeling, pressure bake and export](PUFFY-TITLE.md).
- `scripts/make-prism-art.mjs` reproduces the procedural glass accent.

Local evidence is retained under `.local/prism-qa/`, `.local/theme-qa/`, `.local/footer-sources/`, `.local/puffy-title/` and the test logs in `.local/`. These generated review files are excluded from Git.

Final portal evidence: `.local/build-3d-final.log`, `.local/portal-3d-final.log`, `.local/kivuno-hero-desktop.png`, `.local/kivuno-hero-desktop-dark.png`, `.local/kivuno-hero-mobile.png`, `.local/kivuno-hero-mobile-dark.png`, and `.local/kivuno-footer-{1366x720,390x667,320x568}.png`.

The final tablet CSS adjustment was checked with `.local/footer-tablet-bounds.mjs` against the rebuilt bundle, with WebGL disabled to inspect the photographic fallback. Results and screenshots: `.local/footer-tablet-bounds.json`, `.local/footer-tablet-{768x568,768x768,1024x768}.png`. The 768×768 overlap check is also retained in the portal E2E suite.
