# Kivuno

## Names and voice

**Kivuno** is the desktop workspace for people and their AI teammates. Say it as **ki-vu-no**. **Chat** is the current name of its project conversation area. **Sade** coordinates work in Chat, including assignments, independent review and handoffs. Use sentence case and describe what the product does in concrete language.

Neralu is a historical name. Keep it only where a stored identifier, route, event or compatibility requirement still uses it. New interface copy and product documentation should say Chat.

## Palette

The identity uses black, white, lime and violet. Neutral and tinted derivatives support text, borders and quiet surfaces.

| Color                | Value     | Use                                                        |
| -------------------- | --------- | ---------------------------------------------------------- |
| Ink                  | `#171619` | Website text, logo ground and dark editorial areas         |
| Paper                | `#f7f7f4` | Website background and primary desktop text                |
| White                | `#ffffff` | Glass highlights, light surfaces and human message bubbles |
| Lime                 | `#d5ff5f` | Primary action fills, selected controls and brand details  |
| Violet               | `#a88bfa` | Coordination cues, glass refraction and secondary accents  |
| Deep violet          | `#7651c8` | Readable accents and focus indicators on light surfaces    |
| Desktop background   | `#141316` | Default dark workspace                                     |
| Desktop panel        | `#1d1b21` | Dark workspace cards and panels                            |
| Desktop raised panel | `#26232c` | Raised controls and secondary surfaces                     |

Use dark text on lime buttons. Use deep violet for small accent text and focus rings on white. Pale lime and violet are surface colors; they need a contrasting foreground. Keep error and warning states legible, with a label or icon as well as color. Preserve user-selected teammate colors.

## Surfaces and typography

The website has light and dark appearances. Light mode uses a paper canvas; dark mode uses a near-black `#101014` canvas with violet glass panels. Both use a four-row refracted wordmark and prominent violet and lime accents. Authentication, plan selection, checkout and the group-chat demonstration follow the selected appearance.

The initial website appearance follows `prefers-color-scheme`. An explicit choice persists in `kivuno-portal-theme`, including across the website and billing page. The document attribute `data-portal-theme` scopes those styles and includes authentication dialogs rendered outside the page container. Keep that preference independent from the desktop's `data-workspace-theme`.

The desktop defaults to dark neutral surfaces so long conversations and tools remain comfortable to read. Its optional light theme uses the same paper, ink, lime and violet palette.

Use Geist for interface text and JetBrains Mono for code, checksums and short technical labels. Keep body copy readable and let spacing establish hierarchy. Glass surfaces use a restrained translucent fill, a thin edge highlight and soft depth. Keep enough surface opacity behind text; blur is decorative and must not be required for readability. Avoid placing animated refraction behind controls, code or long passages.

The K symbol remains recognizable: lime strokes on a dark rounded square with a violet joint. The abstract glass artwork is an accent, not a replacement for the product interface.

The botanical footer uses a collage of cropped real flower photographs from multiple sources, with source and license attribution retained. Do not substitute AI-generated botanical images. Use empty sky above the flowers for readable copy, and a translucent glass treatment that leaves the photographic details visible. Adjust the overlay and foreground for each appearance without changing the photographs' provenance.

## Motion and interaction

Preserve the established navigation docking, scroll-driven message reveals, hover feedback, home transition and dialog motion when their behavior remains useful. A visual refresh should not change timing or interaction contracts without a reason.

Honor `prefers-reduced-motion`. Present complete, readable content when motion is reduced, disable automatic chat playback and keep manual controls available. Automatic demonstrations need pause and replay controls. Do not scroll the page when a local chat adds a message, and let readers scroll back through its transcript without being pulled to the bottom.

Use visible keyboard focus, readable selected states and accessible control labels. A translucent surface must still distinguish hover, focus, disabled, loading and error states.

## Product illustrations

The initial website screen introduces Kivuno and offers platform downloads. Feature sections below it explain Chat, Sade, machine connections, checkpoint handoff, review and permission controls. Illustrations should reflect implemented behavior and distinguish optional services such as AEGIS on Avalanche Fuji testnet.

The group conversation is an interactive local simulation. Its messages, activity indicators, test results and approval are examples; they do not claim that an AI is running, a real review has passed or a project has been changed. Label the simulation clearly. Demo messages and approval stay local.

## Compatibility

The application identity `club.nosleep.relay`, existing `RELAY_*` environment variables, `relay-*` events, local state directories and `mesh` API identifiers remain stable. Existing chat history is not rewritten. Visual and copy changes do not migrate or delete credentials, wallets, projects or checkpoints.

The public website and packaged desktop cloud default use `https://kivuno.vercel.app`. Preserve configured origins and existing sign-in compatibility, including installations using `https://nosleepclub-relay.vercel.app`. The source repository remains `dakiemdarktharr/WWW`.
