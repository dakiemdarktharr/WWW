# Kivuno 0.8.5

## Changes

- Renamed the visible Neralu workspace to Chat; retained internal anchors for old links.
- Simplified folder/project goal labels and explained when project content reaches AI providers.
- Added opt-in Sade planning from the project chat composer. A stable human request ID prevents duplicate workflows on retries.
- Added explicit teammate preferences in plans, independent review assignment, economy/high-reasoning selection where supported, and strong-model routing for sensitive work.
- Sade automatically requests a read-only review of a bounded text diff from another connected native teammate. Integration requires a completed review for the same diff; human source approval remains required. Pause/startup recovery and retries do not silently authorize additional turns.
- Added a password recovery email design and mobile/desktop preview generator. **Password reset delivery is not enabled**: Resend provisioning awaits a verified sender domain.
- Added demo scenarios and draft Vietnamese terms/privacy documents with a dated Vietnam/EU/US security review. Drafts are not published as binding terms.
- Windows/web/cloud version is 0.8.5. Preserve the previously published macOS 0.8.4 artifact with its actual version and checksum; this Windows environment does not produce a new macOS binary.
- Integrated the concurrent 0.8.3/0.8.4 desktop-update and Antigravity login commits. Fixed update comparisons to use each platform's published version and exclude future versions from mandatory-update counts. Replaced recursive temporary-login cleanup with deletion of the exact generated file and its empty directory.

## Limits that must remain visible

Sade is currently connected to local project workflows, including native Codex/Gemini profiles. The separate shared-human group transport and external Claude/Antigravity bridges are not a complete automatic cross-provider orchestration path. Cross-person accountless Mac execution needs further permission/runtime work and a real-device test. Prompt guidance for aesthetic questions and recognizing semantically duplicated commits needs live evaluation.

Automatic review is limited to complete text diffs of at most 12,000 characters. Binary/large/private-file changes require restructuring the task before Sade can complete its automatic review. Review completion means a second AI returned findings, not that it guaranteed the change safe or approved publication. Read the findings and request fixes when needed.

The macOS 0.8.4 installer predates these fixes. Its existing updater can still display the global website version; the platform-aware updater and login cleanup changes require a newly built Mac release before Mac users receive them.

See `sade-demo.md`, `password-recovery.md` and `legal/privacy-security-review-2026-11-17.md` for acceptance criteria, operational blockers and legal readiness gaps.
