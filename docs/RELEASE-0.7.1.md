# Kivuno 0.7.1

## Codex sign-in and capability loading

An authenticated Codex could show quota and then become “Not signed in”. Team requested `plugin/list`, including the remote marketplace catalog. On the affected machine that response exceeded the 8 MB stdio frame limit, which correctly stopped the transport but also disconnected the account. Stored quota remained visible in Settings.

Team now requests `plugin/installed`, supported by the bundled Codex 0.166.0 protocol. It only needs installed capabilities. The transport limit remains in place. Plugin errors are reported separately; ordinary inventory errors do not invalidate account identity. The skill scan runs after plugin loading, so newly materialized plugin skills appear on the first refresh. Gemini's inventory adapter and machine runners use the same inventory method.

Local Codex runtimes register the current OS user's `.codex/skills` and `.agents/skills` directories through `skills/extraRoots/set`. Team clients and session clients use the same roots, including on linked machines. Missing directories are skipped. This reads the local library without copying it into every profile. Each machine uses its own local roots; this does not upload a user's files to another machine.

Provider credentials, account configuration and plugin authorization remain isolated. The same machine can share local skills while accounts still have different plugin inventories and plugin-provided skills. Disabled, unavailable and uninstalled plugins are not counted as usable capabilities. Existing profiles with saved sign-in are restored on startup without another OAuth flow.

## Verification

Tests cover installed-only inventory selection, plugin-before-skill ordering, partial inventory failures, account restoration with separate usage, and shared local skills across four real Codex processes. Existing malformed/oversized-frame checks remain enabled.

Live read-only probes against the affected Atlas and Vega profiles verified sign-in before and after inventory loading, both with an email present and no capability errors. Atlas reported 295 skills and 34 plugins; Vega reported 191 skills and 24 plugins. Both could see the machine's `agency-agents` skill. Installed-plugin responses were approximately 75 KB and 55 KB. Counts reflect the accounts at verification time, not guaranteed entitlements. No model turn, paid service, credential export or account logout was used for these probes.

Recorded on 2026-11-07: formatting and production web/cloud build passed; backend suite passed 237 tests with one Linux-only test skipped on Windows. Native Codex, collaboration/sign-in UI, portal and Electron desktop suites passed. The first native tool check timed out during a concurrent full-suite run on a low-memory, low-disk host; rerunning with bounded test concurrency and temporary files on D: passed. No transport limits or sandbox checks were relaxed.
