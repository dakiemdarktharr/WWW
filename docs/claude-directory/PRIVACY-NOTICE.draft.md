# Kivuno Claude connector — privacy notice draft

**Draft for operator review, 21 November 2026. Not yet adopted as the service's privacy policy.** This notice covers the remote Claude connector only. It does not replace the separate policies needed for all Kivuno account, AI, collaboration, or billing features.

Operator: **Đào Tiến Khoa**, individual developer of Kivuno. Contact for support and privacy requests: **khoadao29082007@gmail.com**. These contact details were confirmed by the operator. Effective date will be set on approval.

## Information used by this connector

To connect an account, Kivuno processes its account and device identifiers, the selected Claude profile name/identifier, connection identifiers, authorization scopes, creation/expiry/verification times, and token hashes. Your browser may need to sign in to Kivuno and Claude separately. Kivuno does not receive your Claude password through this connector.

When you separately share a project, Kivuno also records the selected project and sharing expiry. A read request contains an optional numeric message cursor. The desktop returns the selected project's name and a bounded page of message excerpts, including message sequence numbers and kinds. Messages can contain personal information entered by project participants. Only share a project whose content you are authorized to disclose to Claude.

The connector does not request Claude's conversation history, memory, or user files. Its remote tool does not accept file paths, shell commands, payment instructions, or arbitrary network URLs. It does not fetch unrelated project messages.

## Purpose and recipients

Connection data supports sign-in, authorization, status verification, and revocation. Shared message excerpts allow Claude to answer your request about that project.

Requests pass through Kivuno's cloud endpoint and the connected desktop. Vercel provides the deployed web/gateway infrastructure; Kivuno's configured cloud account and workspace services process the connection metadata. Returned excerpts are transmitted to Anthropic for your Claude conversation. Anthropic's terms, privacy settings, retention, and model-use rules apply to its copy. This notice does not promise a particular Claude plan's training or retention settings.

This connector has no advertising or AI-media-generation tool. The implementation does not train a model on your shared messages. This statement does not make a claim about every downstream provider's practices.

## Access and retention

Access tokens are short-lived, at most one hour. Account links and rotating refresh tokens have a maximum lifetime of thirty days and may end sooner when their owning device authorization expires or is revoked. Individual project shares last at most eight hours. These are **access lifetimes**, not promises that every stored record is deleted at those times.

The desktop keeps project data in the user's workspace. The relay temporarily holds pending reads and responses for delivery/retries. The cloud removes a completed response reference from the job record, and the desktop retry buffer has a short expiry. This is not a guarantee about hosting logs, process memory, backups, or content already delivered to Claude.

Kivuno's current connector code does not implement a comprehensive scheduled deletion policy for all account/grant records and backups. The operator must confirm and publish those operational retention details before adopting this notice. No fixed deletion period is claimed in this draft.

## Your controls

Connecting an account alone shares no project messages. You choose a project and duration separately. Revoke a share or disconnect Claude in Kivuno to block subsequent authorized reads. Revocation does not erase excerpts already present in a Claude conversation. Use Claude's controls for that conversation and contact Anthropic for requests relating to its copy.

Contact the operator for access, correction, or deletion requests concerning Kivuno-held data. Include only enough information to identify your account; do not send credentials or private message content. The operator may need to verify ownership before acting. The production procedure for exports, cloud records, and backups must be finalized before this draft is published as an effective policy.

## Security and limitations

The connector uses HTTPS, OAuth with PKCE, hashed token storage, owner/device/project checks, and revocation. It applies bounded responses and some secret-pattern redaction. Redaction cannot detect all personal data or secrets. This is not an end-to-end encryption or independent security-audit claim.

Hosting locations, log/backup retention, provider agreements, and applicable international-transfer arrangements remain operator review items. Do not publish unsupported claims about data residency or compliance certifications. The effective notice should be reviewed whenever the connector's data access changes.

## Approval required before publication

- Confirm the operator's required legal/contact details for the intended markets.
- Confirm the actual hosting, identity storage, logs, and backup inventory without publishing credentials.
- Approve an implementable retention/deletion process and request-handling owner.
- Set an effective date, publish the approved notice, and put its permanent URL in `listing.json`.

This draft records known behavior and remaining decisions; it is not a claim of legal compliance.
