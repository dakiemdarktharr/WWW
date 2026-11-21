# Connector implementation review

Scope: the remote endpoint `/api/claude/mcp`, its OAuth flow, and desktop message relay. Other Kivuno capabilities are not included in the directory submission.

## Implemented boundaries

| Area                  | Evidence and behavior                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool catalog          | `server/claude-web.ts` exposes only `mesh_read` for a valid shared project. It now includes a title and read-only/non-destructive annotations. Account-only links return an empty catalog.     |
| Tool input            | Optional nonnegative integer `after`; strict schemas reject arbitrary project IDs, file paths, and write tools.                                                                                |
| Response              | `server/external-provider.ts` allows only project name, message sequence/kind/content, and next cursor. At most 12 messages, 550 characters each; project name capped at 100 characters.       |
| Source of data        | First-party desktop workspace. No Claude chat/history API, no cookie scraping, no arbitrary third-party proxy.                                                                                 |
| Identity              | `server/claude-oauth.ts` binds client, resource, redirect, owner, grant, PKCE, and token family. `server/claude-web.ts` rechecks device and project grants.                                    |
| OAuth                 | CIMD client ID is the exact Claude web identity. DCR also exists for the exact web callback. Token endpoint uses public-client `none` plus S256 PKCE; no new confidential client is needed.    |
| Expiry/revocation     | Short access tokens, rotating refresh tokens, replay revocation, parent/child grant checks. Thirty-day account-link maximum; eight-hour project-share maximum; device expiry can shorten both. |
| Transport             | JSON responses over the MCP HTTP endpoint; initialized session IDs. GET streaming is unsupported and returns 405 after authentication.                                                         |
| Failures              | Missing desktop, expiry, invalid parameters, wrong session, and revoked access produce bounded errors. No general request forwarding tool.                                                     |
| Financial/media scope | No payment, cryptocurrency transfer, AI image/video/audio generation, or message-writing tool is exposed by this remote endpoint. Broader Kivuno features do not change that catalog.          |

## Review findings addressed

The tool lacked its user-facing title, a directory requirement. A title was added and its description made a narrow capability description. No endpoint, grant, access scope, model provider, or auth method was changed.

## Limitations that must remain visible

- A directory entry is distribution, not a credential for Kivuno to invoke Claude inference.
- Existing browser sessions can reduce sign-in steps; consent is still explicit.
- A fresh account needs Kivuno installed, open, and a pending profile link. Direct entry from the directory without that preparation cannot finish linking immediately.
- Project sharing is intentionally separate. For directory tool discovery/review, use a synthetic shared project; an account-only link has no tools. Do not advertise the latter as a working project-reading demo.
- The remote OAuth implementation here permits the Claude web callback, not arbitrary Code loopback redirects. Do not claim that this directory endpoint has been validated in Claude Code. Kivuno's separate official Code/local MCP path is outside this submission.
- Live refresh after one hour, fresh-account listing installation, and a synthetic tool call from the eventual Pro submitting account still need recorded acceptance.
- Production retention, deletion/export operations, hosting geography, and backup behavior are not established by unit tests or this code review.
- No external security certification or Anthropic review has been completed. This is a focused implementation review, not a full application audit.

## Verification commands

Run with the repository's pinned Node 24 runtime:

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/claude-web.test.ts tests/claude-oauth.test.ts tests/claude-web-relay.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/verify-claude-directory.mjs
```

The last command reads public discovery metadata and checks the unauthenticated MCP challenge. It does not create a connector, perform OAuth, access a project, or consume model quota. Save its JSON output as release evidence. A successful probe is not proof of a live authenticated tool call.
