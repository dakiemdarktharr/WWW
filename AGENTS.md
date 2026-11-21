# Repository release policy

- Every new public Kivuno desktop release must ship the same version for Windows x64, Linux x64, and macOS Apple Silicon. macOS requires both the installer DMG and the in-app update ZIP.
- Build and verify all packages from the release source before promoting the release. If a platform is missing, keep the release staged and leave the public update feed on the current version.
- Follow [the desktop release procedure](docs/DESKTOP.md#publish-a-desktop-release). A version bump on `main` starts the Desktop Release workflow. Keep the GitHub Release in draft until every platform has passed verification. The portal publishes the verified GitHub artifacts for the same version.

## Repository contents

- Commit application code, tests, runtime assets, build/deployment configuration, and maintained product documentation.
- Keep submission dossiers, unpublished legal drafts, personal handoffs, session notes, and one-off verification reports outside Git in the ignored `.local/` directory or the local project vault. Do not publish these files as part of a code change.
- Keep reusable test scripts and relevant architecture, usage, release, and license documentation. Record temporary test results separately rather than appending session histories to product guides.
