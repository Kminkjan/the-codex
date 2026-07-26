# Modern Atlas — the design reference

Until now this lived only in the commit messages of PRs #98–#106. That is why a
whole feature (the Complete Saga wizard, PR: sagas) got built parchment-first
and had to be reworked: `CLAUDE.md` described the parchment aesthetic, nothing
said Atlas was the default. This file is the missing half.

## The short version

**Atlas is the default theme** (#102). Cartographer (parchment) and Grimoire
remain first-class and selectable. Every surface must read correctly in all
three, and the way that's achieved is an **override layer**, never a branch in
the component.

- Parchment is the *ceremony* voice: "Tidy the Codex", "Draw string", `✦`.
- Atlas is the *function* voice: "Tidy the codex", "Connect", no flourishes.
- Same DOM, same data, two dresses.

## The four mechanisms

### 1. Variable remap does the heavy lifting

`[data-theme="modern"]` near the top of [../src/styles.css](../src/styles.css)
rebinds the role variables. Write role variables and most of Atlas is free:

| Variable | Parchment | Atlas | Role |
|---|---|---|---|
| `--font-body` | Bookinsanity | **Inter** | all content text |
| `--font-fell-sc` | IM Fell SC | **Inter** | small chrome labels |
| `--font-fell` | IM Fell | Cormorant | decorative flourishes only |
| `--font-display` | Cormorant | **Cormorant** — *unchanged* | display titles |

**`--font-display` is deliberately not remapped.** Atlas reserves the serif for
display titles: page `h1`s, section headings, panel titles, entity names. Do not
"modernise" a title to `--font-ui` — [../src/events.tsx](../src/events.tsx) is
the reference for both altitudes. The one exception in the tree is the #105
breadcrumb chip, which was intentionally de-titled to chrome.

Corollary: an Atlas rule restating `font-family: var(--font-ui)` on something
already using `--font-body`/`--font-fell-sc` is a no-op. Harmless, and the tree
does it ~19 times, but new code needn't bother.

### 2. `<ThemedLabel parchment=… atlas=…>` carries the voice

Defined in [../src/components.tsx](../src/components.tsx). Both strings render;
the theme CSS shows exactly one (`.label-parchment`/`.label-atlas`). Use it for
**every user-facing control label and any prose whose register differs**: button
text, step names, panel titles, empty-state copy, explanatory notes.

Skip it when both voices are identical — counts and IDs (`"12 to archive"`,
`"S191"`) have one voice, and a `ThemedLabel` with two equal strings is noise.

Pure modules can't use it. [../src/saga.ts](../src/saga.ts) generates the
wizard's reason strings and is React-free, so those are written in a
**voice-neutral register** that reads correctly under both — "continues in S05",
not "still afoot in S05".

### 3. Ornaments live in a `.fleuron` span

`[data-theme="modern"] .fleuron { display: none }`. A bare `✦` in JSX text is
unreachable by the theme layer, so it survives into Atlas where every other
flourish is suppressed. Use `<Fleurons>` (both sides) or an explicit
`<span className="fleuron">✦ </span>` (one side).

Exception: ornaments nested inside an element Atlas hides wholesale — e.g.
`.scratch-divider` — need no wrapper of their own.
`scripts/ui-check.ts` enforces this and knows about that case.

### 4. Inter needs explicit uppercase

The parchment themes got small-caps free from IM Fell SC. With Inter, Atlas has
to ask: there's a shared `[data-theme="modern"] :is(…)` list in styles.css
carrying `text-transform: uppercase`. **A new small-caps label class must be
added to that list** or it renders sentence-case among uppercase neighbours.
This is the single easiest thing to forget — it was missed for every label class
the saga feature added.

Exempt: free-form user input, and text already uppercase in source.

## The Atlas visual language

From the section preamble in styles.css: `#1d212c` cards on a `#14161d`
dot-grid canvas, **6–10px radii**, Inter labels in letterspaced uppercase,
Cormorant for display titles.

What Atlas switches **off**: paper textures, torn edges, pin heads, card
rotation, wool yarn shadows, fleurons, engraving icons on chrome buttons
(`.topbar .btn svg`, `.board-toolbar .btn svg` — scope a new selector the same
way rather than inventing an icon class), italics on labels and empty states.

What Atlas adds: pills and chips (`.filter-pill`, the `S191 ⌄` session chip, the
`Search the codex… ⌘K` chip), a breadcrumb topbar, flat borders over shadows.

## Rules that bite

- **Structural additions are CSS-gated to `[data-theme="modern"]`.** The
  parchment themes must render byte-identically after your change. When #105
  needed structure, it moved parchment's inline styles verbatim into classed
  base rules and added Atlas rules on top.
- **Any new dark theme joins the `color-scheme: dark` list.** Native `<select>`
  popups are painted by the OS; a theme missing from that list renders
  light-on-white options and the menu vanishes (#106). `ui-check.ts` enforces it.
- **`--ink-secondary` is the contrast floor for text ≤14px**, in every theme.
  `--ink-faded`/`--ink-ghost` are for off-states and decoration only.
- **Theme-aware variables for anything that reads as text on card stock.**
  Hardcoded light-paper colours vanish on Grimoire.

## Checks

```bash
npx tsx scripts/ui-check.ts
```

Enforces the mechanical rules (ornament wrapping, dark-theme `color-scheme`).
Fonts are judgement, not rule — they're not checked, on purpose; see the note at
the top of that script.

## Still parchment-only

These surfaces have had no Atlas pass and are allowlisted in `ui-check.ts`.
Shrinking this list is the ongoing work:

- `App.tsx` — boot splash, "the pages will not turn" error screen
- `auth.tsx` — gate, display-name, membership screens
- `join.tsx` — invite summons
- `campaign.tsx` — charter title and section rules
- `events.tsx` — date-group headings
