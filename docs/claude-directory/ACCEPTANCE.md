# Acceptance and reviewer demo

Do not mark a row complete until that exact check has run. Local fixtures are not a live Claude account.

## Evidence record

| Check                                                               | Status                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| Local OAuth ownership, PKCE, refresh/replay, scope, and grant tests | Passed 21 November 2026; see [EVIDENCE.md](EVIDENCE.md) |
| Local shared-project read and revoked/wrong-device isolation        | Passed 21 November 2026; see [EVIDENCE.md](EVIDENCE.md) |
| Tool title and read-only annotations in actual MCP tools/list       | Passed in local HTTP integration test                   |
| Public OAuth metadata and unauthenticated MCP challenge             | Passed 21 November 2026, 16:18 UTC                      |
| Fresh Claude account installs Kivuno from a published listing       | Not run: listing does not exist yet                     |
| Pro publisher account connects and calls mesh_read                  | Not run in this preparation                             |
| One-hour real Claude token refresh                                  | Not run in this preparation                             |
| Final terms and submission                                          | Not accepted/submitted                                  |

## Synthetic project

Create a disposable project named **Kivuno connector review** only after the owner approves using it with Claude. It must contain no real project files, messages, email addresses, passwords, or tokens. Add the selected Claude profile to its group. Suggested human-authored messages:

1. `Review sample: the landing page draft is complete.`
2. `Review sample: the demo is blocked until the team chooses a meeting time.`
3. `Review sample: the next handoff is to check keyboard navigation.`

Share this project for a short period (for example 30 minutes). Keep Kivuno open. Connect using the same Kivuno owner and approve the profile highlighted as the latest request.

## Functional test to run with the account holder

1. Before project sharing, confirm the account link can become Claude connected but no project messages/tools are available.
2. Enable the synthetic share, refresh Claude's tool list, and confirm `mesh_read` is present with its title.
3. Ask: **“Use Kivuno to read the shared review project's messages. List the completed item, blocker, and next handoff.”**
4. Inspect the actual tool result, not only the model's answer. Confirm the project name, the three sample messages, and a next cursor. Record tool-call success and time; do not publish session IDs or tokens.
5. Request the next page with the returned `after` cursor through MCP Inspector or an explicit tool call. Empty pages should succeed without crossing into another project.
6. Revoke the project share in Kivuno, then verify a fresh read cannot retrieve messages. Reconnect as needed for the portal's final tool sync.
7. Disconnect the account in Kivuno and verify new authenticated reads are rejected. Re-enroll only if the account holder wants to leave the review connection active.

Use MCP Inspector only on localhost with its authentication protections enabled. Do not disable authentication or bind it to a public interface. Supply test credentials through the local tool's secure input, never through command-line arguments, screenshots, or this packet.

## Evidence to keep

- A screenshot of the approved profile and Kivuno's verified state, with account identifiers redacted for public use.
- A screenshot/tool transcript of the synthetic result and revocation failure.
- Versions, commit, test date, and whether this was custom-connector or directory installation.

No screenshot in this packet is fabricated. The included PNG is the existing Kivuno logo, not proof of live connector acceptance. Model requests for this scenario require the account holder's approval and should use only existing included quota.
