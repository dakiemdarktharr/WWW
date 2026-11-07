# Kivuno 0.7.2

Website: https://kivuno.vercel.app

## Group chat

- Type `@` to select a teammate from this project's roster. Arrow keys, Enter, Tab and Escape work; IME composition does not submit a message.
- A direct name or mention prioritizes that teammate. If they cannot start, an eligible online teammate may take over and the group receives an explanation.
- Reply to an agent message to continue its read-only conversation. A direct mention reuses the teammate's single active read-only conversation; multiple active sessions require a reply to select the intended context.
- Retrying the same send after a connection failure reuses a client request ID. Claims remain atomic and uncertain startup is not retried automatically.
- Reply, thread view, search and understood/agree/disagree reactions remain available. Feedback does not grant security, spending or publishing permission.
- Long introductions show a compact summary; the full owner, plan, capability inventory and working agreement remain in Details.

## Reserve usage and handoff

When the group is waiting for quota, write `@Vega tôi cho phép tiếp tục` or `Vega I allow you to continue`. Kivuno binds the allowance to that account and project, **stops at 20% remaining, and expires it after one hour**. `@Vega I allow you to work until 37% remaining` uses 37% instead. A named duration such as `for 30 minutes` or `trong 30 phút` replaces the default duration.

The system acknowledges the exact floor and expiry in chat, then dispatches pending work. A later allowance replaces the earlier allowance for the same account/project. An ambiguous recipient or multiple percentages triggers clarification without granting usage. Negations, quoted instructions and agent messages cannot grant usage. A recent addressed message or explicit reply can provide recipient context; stale conversations cannot silently choose an account.

Provider exhaustion (0%), unknown/stale usage and provider hard blocks still prevent execution. Quota is enforced from provider reports and periodic refreshes; it is not a prepaid token cap and cannot guarantee stopping at an exact percentage before a provider update arrives.

Low-quota sessions pause, checkpoint and transfer to an eligible teammate in the same group. Writing tasks require a verified Git checkpoint/push before transfer. Read-only sessions transfer saved conversation context without inventing a Git commit. Ownership of the original prompt follows the handoff, so completion is attributed to the recipient. If no teammate is eligible, work waits for an allowance or verified quota recovery. Manual pauses and paused/cancelled workflows are preserved.

Existing approval rules still apply: chat is read-only, implementation uses scoped project tasks, uncertain processes require recovery, planning ownership stays with its workflow, and external clients are not falsely represented as controllable native sessions.

## Sessions and website

Actual running/starting sessions show a working bubble and open the Sessions side panel. The animation indicates activity, not access to private model reasoning. Model and supported reasoning settings can be changed while running; changes apply to the next turn. Reduced-motion preferences disable the pulse.

Windows and Linux downloads use version 0.7.2. The old production hostname redirects to `kivuno.vercel.app`; canonical metadata, robots.txt and sitemap use the new hostname. Search engines decide when to index it. Existing desktop versions should be upgraded to use the new sign-in origin; workspace data and separate AI profiles remain intact.

## Validation

Local release checks: 246 tests passed, one Linux boot-identity test skipped on Windows; formatting, TypeScript and production build passed. Chat, portal/auth, collaboration/sign-in and Electron desktop E2E suites passed without model turns.

Regression coverage includes Vietnamese/English allowance parsing, denial/ambiguity, grant expiry/floors, provider exhaustion, idempotent sends, session reuse, quota recovery, ownership transfer, verified checkpoints, and concurrent claims. The production React chat test exercises mention selection, quota consent, queued dispatch, activity bubbles, automatic Sessions, model/reasoning settings, reaction, reply and search against real local HTTP routes and controlled provider execution.

No account model turns, paid services, mainnet transactions or paid domains are used for release validation. Installer and production deployment checks are performed separately after publishing the build.
