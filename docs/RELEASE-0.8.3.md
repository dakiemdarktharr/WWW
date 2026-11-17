# Kivuno 0.8.3

## Desktop updates

The desktop title bar shows a small download button when a newer installer is available for the user's platform. The user can skip optional releases. After three newer releases, Kivuno blocks workspace use until the latest installer is installed and the app is reopened.

The desktop process checks the public release manifest and opens only validated Kivuno installer URLs. Release history is published in `release.json` from `release-history.json`; add each new package version at the top of that file. Existing installs older than 0.8.3 need one manual install from the website because they do not contain the updater code.

The 0.8.3 macOS installer still needs to be packaged and uploaded separately before it appears in the release manifest. The current published macOS artifact is 0.8.2.
