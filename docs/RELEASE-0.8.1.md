# Kivuno 0.8.1

## Quota approval

The screenshot showed Vega at 9% remaining, below the default 20% stop limit. Permission cannot make a session run below its stop limit. Kivuno now reports that condition explicitly instead of saying it is continuing work.

Saving permission only resolves the open quota decision when the account can actually run under the current provider report. Unknown/stale usage and provider blocks remain paused. Repeated permission messages no longer resolve and recreate the same quota question. A new permission replaces previous grants for that account/project, so an older, lower floor cannot override a newer, stricter limit. The default remains 20% remaining for one hour; a lower stop limit must be chosen explicitly.

## Chats home

Neralu opens a list instead of automatically opening the first project. The list combines project chats and joined shared groups, ordered by latest activity, with unused chats last. Message, task, session, workflow and research updates contribute to project activity. Presence heartbeats and opening a chat do not move it to the top.

Rows show a name, message preview and activity time. Search filters the list. Choosing a row opens that project or shared group; Chats returns to the list. Projects and Groups remain available for their existing controls. Shared group previews are returned only to active members, and local project chats remain available if the cloud group service is unavailable.

## Local update

The previous app installation and old generated installer/runtime copies are removed. Chats, project repositories, Codex account profiles, settings, machine connections and the WWW source checkout are retained, as requested. The new Windows app is installed on D: because C: has limited space.

Verification covers the 9%/20% screenshot case, an explicitly lower limit, stricter replacement permissions, chat ordering, home-to-project/shared-group navigation, and the packaged runtime. Model-turn tests use controlled protocol peers, not the user's account usage.

Local checks: 253 tests passed, one Linux boot-identity test skipped on Windows; TypeScript/Vite build, chat/home, portal/auth and shared-group UI suites passed.
