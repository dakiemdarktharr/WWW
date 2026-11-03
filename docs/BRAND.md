# Kivuno and Neralu

## Names

**Kivuno** is the desktop workspace. Say it as **ki-vu-no**. **Neralu** is its project messaging space, pronounced **ne-ra-lu**. Use sentence case for both names in interfaces and documentation.

The naming brief asked for ten candidates to be discarded before selecting an eleventh. The discarded workspace names were Orvo, Veyra, Kivo, Nuvio, Tervo, Synlo, Sovra, Runo, Velto and Axora. The eleventh choice is **Kivuno**.

The discarded messaging names were Pingo, Nodi, Telli, Zuno, Orbi, Kora, Yuno, Miri, Vibi and Sona. The eleventh choice is **Neralu**.

These are product naming choices, not a claim of global trademark clearance. The preliminary search did not identify a directly matching software product; a future commercial launch still needs its own name review.

## Visual system

| Token        | Value     | Use                                        |
| ------------ | --------- | ------------------------------------------ |
| Deep ocean   | `#071925` | Main background                            |
| Smoked glass | `#143447` | Translucent surfaces and panels            |
| Mint         | `#8ce8cf` | Primary actions, focus and selected states |
| Ice          | `#eaf5f7` | Main text and glass highlights             |
| Amber        | `#f4bc83` | Attention, review and security findings    |

Glass surfaces use restrained blur, readable foregrounds and thin highlights. A surface's shape reflects its role: a compact floating navigation dock, a focused authentication card or a project message. Color does not replace text for status or errors. Motion should respect the user's reduced-motion preference.

The initial website screen is reserved for the name, logo and actions. Project conversations, usage demonstrations and features begin below the first screen. The message demonstration represents an example workflow, not a live security finding or a claim that a model is currently running.

## Compatibility

The application identity `club.nosleep.relay`, existing `RELAY_*` environment variables, `relay-*` events, local state directories and `mesh` API identifiers remain stable. Existing chat history is not rewritten. The public-facing names change without migrating or deleting credentials, wallets, projects or checkpoints.

The current sign-in origin remains `https://nosleepclub-relay.vercel.app` so existing desktop sign-in and machine configurations stay compatible. The GitHub repository remains `dakiemdarktharr/WWW` and private.
