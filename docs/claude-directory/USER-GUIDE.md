# Use Kivuno with Claude

Kivuno's Claude connector brings messages from one explicitly shared project group into your Claude conversation. You can ask for a progress summary, a handoff review, or a list of blockers.

It reads project messages. It does not let Claude edit your files, send messages, run commands, access other projects, or make payments. It does not give Kivuno permission to run Claude inference using your browser session.

## Connect your account

1. Install [Kivuno](https://kivuno.vercel.app), sign in, and keep its desktop app open.
2. In **Team**, add or open a Claude profile and choose **Connect**. Choose Claude in your browser or Claude Desktop.
3. Open Kivuno's connector in Claude and choose **Connect**. Use the same Claude account in the browser and Desktop.
4. On the Kivuno authorization page, sign in to the same Kivuno account if asked. Approve the profile marked as just requested from Kivuno.
5. Return to Kivuno and wait for **Claude connected**. Use **Check connection** if you need an immediate recheck.

**Directory listing status:** Kivuno's directory application is being prepared. It is not currently represented here as published or verified by Anthropic. After publication, the actual listing will let you add Kivuno without entering a server address.

Until then, for a new account, open Claude's connector settings and add a custom web connector:

- Name: **Kivuno**
- Server: `https://kivuno.vercel.app/api/claude/mcp`
- Keep the detected OAuth sign-in and Claude published client identity settings. There is no client secret to copy.

Claude Free supports one custom connector according to [Anthropic's connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). If that slot is already used, manage it in Claude; Kivuno does not remove other connectors. Provider UI names and plan limits may change.

## Optionally share project messages

Connecting your account does **not** share a project. When you want Claude to read a project:

1. Open the project in Kivuno **Chat → Group team** and add the Claude profile to that group.
2. Choose **Share project messages**, select a duration, and confirm the project. Review its messages first.
3. In Claude, enable Kivuno for the conversation if needed. Try: “Use Kivuno to summarize the recent messages in my shared project and list any blockers.”

Only the selected project's name and message excerpts are returned. Each page has at most 12 messages; long messages are shortened. Claude can request the next page using the returned cursor. The connector does not retrieve your entire repository or Claude history.

If Claude cached an empty tool list before you shared the project, refresh the connector's tools or start a new conversation after sharing. Sharing is temporary, at most eight hours per grant; one project can be shared through an account link at a time. Keep the associated Kivuno desktop open and online. Restarting/signing out or removing group membership can require sharing again.

## Stop access

Revoke the project share in Kivuno to stop new project reads. **Disconnect Claude** revokes the account link and its dependent project access. You may also disconnect/remove the connector in Claude.

Removing it in Claude can leave an older Desktop screen looking connected until refreshed. Kivuno cannot infer that external deletion without revocation or expiry. A previously delivered response can remain in your Claude conversation; disconnecting does not delete that conversation.

## Troubleshooting

| What you see                                 | What to do                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| No profile on the authorization page         | Open the correct Kivuno workspace, start Connect on the desired Claude profile, then start a fresh Connect request in Claude.       |
| Several profiles with the same name          | Choose the one marked as just requested from Kivuno.                                                                                |
| Claude says Connected, but Kivuno is pending | It may be a different or older profile. Reconnect in Claude, approve the current profile, then use Check connection.                |
| Connected, but no Kivuno tools               | Share a project separately and refresh the connector tools. An account-only link intentionally exposes no project data.             |
| Desktop did not respond                      | Keep the correct Kivuno workspace open, check its network connection, and retry.                                                    |
| Authorization expired                        | Start Connect again from Kivuno and then Claude.                                                                                    |
| Usage is unavailable                         | Claude controls subscription entitlements and usage visibility. This connector does not supply a quota meter or unlock Claude Code. |

For help, contact **khoadao29082007@gmail.com**. Include the Kivuno version and a description of the issue. Do not email passwords, OAuth tokens, full authorization URLs, or private project messages.
