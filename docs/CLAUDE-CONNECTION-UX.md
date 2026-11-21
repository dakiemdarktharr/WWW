# Claude connection architecture and usability

## Connection status

A transient status request failure previously stopped the renderer polling loop. Pending checks also slowed after two minutes, disconnected results were not polled, and a connected grant could schedule a timeout beyond the browser's 32-bit timer limit. The renderer now retries failures after five seconds, checks an open pending connection every 3.5 seconds, and rechecks other states every thirty seconds while visible. Returning to the window or coming online triggers a check. A manual Check connection action and last successful check time are available.

OAuth token exchange is exposed as an authorized-but-unverified phase. Only a valid MCP initialization for the current device/profile grant produces Claude connected. Opening Claude, completing OAuth alone, or a screenshot of a different/older connector is not proof of that state.

Kivuno cannot infer that an external connector has been deleted unless Claude revokes its credential or the grant expires. Disconnect Claude in Kivuno immediately revokes the local account grant. Recreate a deleted connector in Claude before linking it again.

Starting or reopening a connection records a server-side request time. Consent highlights and preselects the unique most recently requested valid owner grant from the last ten minutes. Older grants remain available; no approval is submitted automatically. Status polling never changes this hint.

## Authentication boundaries

The code in server/codex.ts calls the official Codex app-server account/login/start with type chatgpt. Codex handles the browser authorization and local callback. Kivuno verifies account/read and receives completion events. This explains the automatic return and absence of manual code transfer.

Claude web currently uses the reverse direction. Claude is an OAuth client of the Kivuno MCP server. Kivuno authorizes access to its own data, then marks the account connected only after Claude initializes MCP. This does not give Kivuno a Claude inference credential. Project sharing remains a separate user action.

Browser sign-in to Claude, browser sign-in to Kivuno, and consent to link a profile are separate identity boundaries. Provider login challenges still apply if browser sessions have expired.

## Setup and session lifetime

The setup now opens the existing-connector list. First-time manual setup is collapsed under help with Copy address. The documented prefilled install URL was removed from the primary flow: it redirected without a form in live testing and was not permitted by the desktop's exact external-link allowlist. Progress uses the component used by Codex.

New account links may last up to thirty days. Access tokens remain limited to one hour. Refresh tokens are stored only as hashes, rotated transactionally, bound to the client, resource, owner and account grant, and capped by the original grant expiry. Replaying a consumed refresh token revokes that grant. New authorization invalidates the previous token family. Revoked devices and account grants prevent refresh. Existing grants retain their original expiry.

Refresh preserves verified connection status and existing separately approved project access. The eight-hour limit on an individual project share is unchanged. MCP initialization is still required before a newly authorized account is reported connected.

Desktop authorization has its own expiry. A Claude link ends earlier if its owning device expires or is revoked. Thirty days is the connector's maximum lifetime, not a guarantee that a signed-out device remains authorized.

## Desktop, Code, and usage

- Desktop selection opens the installed native application through Electron, with an explicit installation error rather than silently substituting a browser tab. Browser approval is labeled separately: the remote connector belongs to the Claude account and syncs to Desktop. Project-specific local MCP remains available under optional project sharing.
- Code selection uses the official, unmodified CLI. Kivuno prepares it when absent, opens its own authentication command in a terminal (which opens Anthropic in the browser), and checks official auth status. Credentials remain in Claude Code. Opening a process alone is not a successful login. The UI distinguishes Code signed-in status from a verified MCP connection or project access. No model request, usage credit purchase, or API fallback is initiated by sign-in.
- Existing Kivuno profiles can be reused for all three client choices. The client choice is remembered per local profile. Project membership/configuration is not required to sign in.
- The usage action opens the exact official HTTPS settings page. No private cookie/token scraping is used and no percentage is fabricated. The UI warns that detailed usage requires a supported paid plan.

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
