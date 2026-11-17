# Kivuno 0.8.4

## Antigravity Google sign-in

Antigravity profiles now show **Sign in with Google**. Kivuno opens the official Antigravity CLI command `agy acp --login` in a Terminal window. Google and Antigravity handle authentication; Kivuno does not collect or store Google credentials. The Antigravity CLI, app, and IDE share the local Antigravity sign-in.

MESH MCP remains a separate connection that lets the signed-in Antigravity client access a Kivuno project. The Kivuno card identifies Antigravity sign-in as provider-managed and does not report Google account identity or usage that it cannot verify.

## Desktop updates

This release advances the desktop version to 0.8.4, publishes the macOS DMG, and adds its installer metadata to the website. The macOS DMG is opened externally by the earlier updater; those installs need one manual DMG install before receiving the in-app macOS updater.
