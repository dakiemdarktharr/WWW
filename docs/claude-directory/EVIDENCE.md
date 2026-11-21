# Preparation evidence — 21 November 2026

Source baseline: `38a66e3` plus this packet's small tool metadata change. Tests use local synthetic fixtures, not a signed-in Claude account.

- `tests/claude-web.test.ts`, `tests/claude-oauth.test.ts`, and `tests/claude-web-relay.test.ts`: **4 tests passed, 0 failed**.
- TypeScript `tsc --noEmit`: passed.
- Existing icon inspected: valid PNG header, **512 × 512** pixels.
- Public readiness probe at **2026-11-21 16:18:36 UTC**: passed. Resource discovery 399 ms; issuer discovery 418 ms; unauthenticated MCP request **401**, with resource metadata challenge. CIMD, S256 PKCE, authorization-code and refresh-token metadata matched the packet.

No authenticated production tool call, new login, model request, payment, project share, or directory submission was performed for this evidence. Public discovery describes the service but does not prove that every authenticated path is healthy. The added tool title is verified locally; the production deployment containing it must be checked before submission.

The documented custom-install URL was also tested earlier on the user's Claude account: it redirected to the plugins page without a prefilled dialog. That account already had a custom connector. This observation does not prove that all fresh accounts fail, and it is not directory-install acceptance.

For fresh-account and live tool acceptance, use [ACCEPTANCE.md](ACCEPTANCE.md). The application packet intentionally keeps those checks incomplete.
