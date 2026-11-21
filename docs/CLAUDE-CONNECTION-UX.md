# Claude connection architecture and usability

Verified on 21 November 2026. Connection UX updated for 0.9.9.

## Observed behavior

A real test in the installed Kivuno app used Add account → Codex → Connect Codex. The official browser flow completed and Kivuno displayed Connected with a Plus plan. It created an additional Codex profile named Nova in the selected test workspace. The original Atlas connection remained present. No model turn was needed.

The code in server/codex.ts calls the official Codex app-server account/login/start with type chatgpt. Codex handles the browser authorization and local callback. Kivuno verifies account/read and receives completion events. This explains the automatic return and absence of manual code transfer.

Claude web currently uses the reverse direction. Claude is an OAuth client of the Kivuno MCP server. Kivuno authorizes access to its own data, then marks the account connected only after Claude initializes MCP. This does not give Kivuno a Claude inference credential. Project sharing remains a separate user action.

## Causes of repeated setup

- The first-use UI opened the connector list and required users to enter an endpoint.
- The account enrollment lifetime was eight hours.
- Access tokens lasted up to one hour. The token endpoint supported authorization_code only, so Claude could not renew an expired token.
- Browser sign-in to Claude, browser sign-in to Kivuno, and consent to link a profile are separate identity boundaries. Provider login challenges still apply if browser sessions have expired.
- Desktop authorization currently has its own seven-day expiry. A Claude link ends earlier if its owning device expires or is revoked. Thirty days is the connector's maximum lifetime, not a guarantee that a signed-out device remains authorized.

## Changes

The setup now opens the existing-connector list. First-time manual setup is collapsed under help with Copy address. The documented prefilled install URL was removed from the primary flow: it redirected without a form in live testing and was not permitted by the desktop's exact external-link allowlist. Progress uses the component used by Codex.

On the account tested, the documented /customize/connectors install URL redirected to /plugins without displaying the prefilled dialog. The older hash-based variant also failed to open that form. The prefill route therefore cannot be claimed to work on this account. The fallback is necessary until Anthropic's deployed UI honors its documented install link.

With explicit user approval, new account links may last up to thirty days. Access tokens remain limited to one hour. Refresh tokens are stored only as hashes, rotated transactionally, bound to the client, resource, owner and account grant, and capped by the original grant expiry. Replaying a consumed refresh token revokes that grant. New authorization invalidates the previous token family. Revoked devices and account grants prevent refresh. Existing grants retain their original expiry.

Refresh preserves verified connection status and existing separately approved project access. The eight-hour limit on an individual project share is unchanged. MCP initialization is still required before a newly authorized account is reported connected.

## Patterns to adopt

Microsoft MSAL uses the system browser, existing browser session, authorization code with PKCE and a local callback for native applications. Slack's installation OAuth uses a clear install button, server-side state validation and automatic callback. Kivuno can use these interaction patterns for services where it is a registered OAuth client.

For Claude Free, the supported integration is a custom MCP connector. A directory listing would remove manual endpoint setup and give Kivuno a permanent install page. Submission requires a paid maintainer account and Anthropic review. No submission or purchase was made.

Anthropic distinguishes running its unmodified Claude Code with user-owned credentials from offering Claude.ai login for third-party inference. A direct Claude.ai login that gives Kivuno independent inference access is not a general replacement for this connector architecture.

## Validation and remaining work

TypeScript, production build and five targeted OAuth/MCP tests passed. Regression coverage includes expired access renewal, rotation, client/resource/scope mismatch, token-family replacement, replay revocation, project preservation and account revocation.

The real Codex round trip succeeded. Claude's new refresh flow is verified through the local HTTP integration tests. Production deployment 75706d6 is READY. The public feed advertises Windows/Linux 0.9.7 and OAuth discovery advertises refresh_token. macOS remains 0.9.2. A live Claude refresh after one hour and the packaged 0.9.7 UI still require verification.

## Desktop, Code, and usage in 0.9.9

- Desktop selection opens the installed native application through Electron, with an explicit installation error rather than silently substituting a browser tab. Browser approval is labeled separately: the remote connector belongs to the Claude account and syncs to Desktop. Project-specific local MCP remains available under optional project sharing.
- Code selection uses the official, unmodified CLI. Kivuno prepares it when absent, opens its own authentication command in a terminal (which opens Anthropic in the browser), and checks official auth status. Credentials remain in Claude Code. Opening a process alone is not a successful login. The UI distinguishes Code signed-in status from a verified MCP connection or project access. No model request, usage credit purchase, or API fallback is initiated by sign-in.
- Existing Kivuno profiles can be reused for all three client choices. The client choice is remembered per local profile. Project membership/configuration is not required to sign in.
- The usage action opens the exact official HTTPS settings page. No private cookie/token scraping is used and no percentage is fabricated. The UI warns that detailed usage requires a supported paid plan.

### Live findings

Claude Desktop on this machine was already signed in to a Free account. Its Plugins page showed the same Kivuno connector as the browser and reported **Connecté**. The separate Kivuno Echo profile was still disconnected, so this observation does not prove Echo was newly linked; the existing grant may belong to a previous profile.

On this same Free account, navigating to https://claude.ai/settings/usage redirected to /upgrade?from=wren and displayed a notice that usage settings are available only with Pro, Max, and Ultra. Desktop settings also had no Usage item. Therefore this account cannot supply a real usage dashboard. A paid-account Code login and usage display remain unverified; no subscription was purchased.

### Checks

TypeScript and production build passed. All 23 targeted tests for the native launcher, sanitized status, OAuth rotation/discovery, relay, package content and desktop security passed. The full Electron desktop E2E passed with updated connection wording, collapsed first-use instructions, verified web account, project scope/revocation, and the Desktop button present. The OAuth server in that automated test is a local fixture, not a live Claude account.

## Primary references

- https://claude.com/docs/connectors/building/directory-vs-custom
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/submission
- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
- https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/using-web-browsers
- https://docs.slack.dev/authentication/installing-with-oauth/

- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/cli-reference
- https://support.claude.com/en/articles/9797557-usage-limit-best-practices
