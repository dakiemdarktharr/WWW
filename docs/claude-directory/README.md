# Kivuno — Claude Directory submission packet

Prepared 21 November 2026. **Draft for publisher review; not submitted or approved by Anthropic.**

Publisher confirmed by the owner: **Đào Tiến Khoa**, individual developer using the Kivuno product name. Public support and review contact: **khoadao29082007@gmail.com**. Do not describe Kivuno as an incorporated company without further confirmation. A team member has Claude Pro and can act as the authorized listing administrator; no purchase is needed for this preparation.

## Files to use

| File                                               | Purpose                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [listing.json](listing.json)                       | Copy-ready English listing, endpoints, contact, and proposed submission answers |
| [USER-GUIDE.md](USER-GUIDE.md)                     | Public setup, limitations, and troubleshooting documentation                    |
| [PRIVACY-NOTICE.draft.md](PRIVACY-NOTICE.draft.md) | Connector-specific privacy notice for operator review, not an effective policy  |
| [TECHNICAL-REVIEW.md](TECHNICAL-REVIEW.md)         | Implementation evidence, permissions, and remaining gaps                        |
| [ACCEPTANCE.md](ACCEPTANCE.md)                     | Synthetic test scenario and honest acceptance record                            |
| [assets/kivuno-512.png](assets/kivuno-512.png)     | Existing Kivuno icon, PNG, 512 × 512; ready to upload                           |
| [assets/kivuno.svg](assets/kivuno.svg)             | Existing vector brand asset                                                     |

This is a **remote MCP connector**, not an MCP App with an embedded UI. Do not submit mock screenshots or claim MCP App capabilities. Product screenshots can be added if the portal requests them; the MCP App carousel is not applicable to this submission.

## Desired first-use journey

1. In Kivuno, the user chooses a Claude profile and starts Connect. Kivuno records the current connection request.
2. After publication, this button should open the actual directory listing supplied by Anthropic. The name and server URL belong to that listing; users should not type either.
3. The user chooses Add/Connect, signs in if necessary, and approves the highlighted Kivuno profile.
4. Claude initializes MCP and Kivuno reports Claude connected. A successful OAuth exchange alone is not sufficient.
5. Sharing a project's messages is a separate, optional action in Kivuno. Linking the account does not share a project.

Directory publication removes endpoint setup. It does not remove provider login, Kivuno login, explicit consent, or the requirement to keep the connected desktop available. A new user arriving directly from the directory must first install/open Kivuno and start a profile connection. Do not promise universal one-click onboarding.

**No listing URL has been assigned.** The proposed slug is `kivuno`, subject to availability. Never ship a guessed directory URL or a personal custom-plugin ID as the public installation URL. Once the actual URL exists, update the Connect target and its exact desktop external-link allowlist, retain the existing-connector path for reconnection, and test on an account without Kivuno installed. This desktop change needs a normal release with matching Windows/Linux/macOS artifacts.

## Before opening the submission portal

- [x] Owner confirmed publisher name and public/review email.
- [x] Existing logo files collected without adding third-party branding.
- [x] One universal HTTPS endpoint, OAuth/PKCE, scopes, and restricted tool documented.
- [x] Missing tool title corrected in source, with protocol-level regression coverage.
- [ ] Operator approves the privacy draft, confirms hosting/log/backup retention and the process for data requests; publish the approved notice and set `privacyPolicyUrl`.
- [ ] Run the fresh-account acceptance scenario in Claude and record actual results. Existing-profile screenshots do not satisfy this.
- [ ] Call `mesh_read` against a synthetic, explicitly shared project from Claude. Do not use real private project messages for review.
- [ ] Confirm the cloud build containing the tool title is live before the portal syncs tools.
- [ ] Authorized Pro account holder signs in to the developer portal and reviews final terms/claims.

## Submission handoff

Portal: <https://claude.ai/directory/manage>. Select a remote MCP connector with one universal URL. Use the current CIMD/public-client OAuth flow; do not create a client secret or switch auth methods merely to fill the form. See `listing.json` for the values.

Before syncing tools, connect the publisher's Kivuno profile and share the **synthetic review project**. A link with no shared project intentionally advertises no project tools. If the portal shows no tools, complete that sharing step and resync; do not weaken access checks to make a tool appear.

The final submit step includes policy/terms acknowledgments. The account holder must review and approve those at submission time. This packet does not pre-check them. Do not transmit credentials through the packet, repository, email, or chat. If Anthropic later requests test access, arrange a separate, bounded review account through an approved channel.

## Sources checked

- [Submission requirements and publisher eligibility](https://claude.com/docs/connectors/building/submission)
- [Connector review checklist](https://claude.com/docs/connectors/building/review-criteria)
- [OAuth behavior](https://claude.com/docs/connectors/building/authentication)
- [Directory installation links](https://claude.com/docs/connectors/building/directory-vs-custom)

The portal's current fields and terms take precedence over this preparation. The source-backed requirements above are summarized; the product descriptions and test scenarios are Kivuno-specific.
