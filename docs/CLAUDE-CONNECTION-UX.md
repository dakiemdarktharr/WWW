# Claude connection architecture and usability

Verified on 21 November 2026. Release 0.9.7.

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

The setup uses Anthropic's documented prefilled install URL and exposes the existing-connector route and a visible manual fallback with Copy address. Progress is shown with the component used by Codex.

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

## Primary references

- https://claude.com/docs/connectors/building/directory-vs-custom
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/submission
- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
- https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/using-web-browsers
- https://docs.slack.dev/authentication/installing-with-oauth/
