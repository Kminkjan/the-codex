# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (usually 5173, falls back if in use)
- `npm run build` — `tsc -b && vite build`; always run this to verify a change typechecks
- `npm run check` — chains every wired harness below; run it alongside `build` before calling a change done
- `npm run preview` — serve the production build

There's no test *framework*, but there are nine assertion harnesses in [scripts/](scripts/), each runnable as `npx tsx scripts/<name>.ts` and exiting non-zero on failure:

| harness | guards | wired into `npm run check` |
| --- | --- | --- |
| `saga-check.ts` | the pure derivations in [src/saga.ts](src/saga.ts) — the Complete Saga wizard's rules | yes (`check:saga`) |
| `ui-check.ts` | theme drift (see [docs/design-atlas.md](docs/design-atlas.md)) | yes (`check:ui`) |
| `relations-check.ts` | the read-projection in [src/relations.ts](src/relations.ts) — `source` (which decides whether a rail chip gets a delete control), the unordered-pair dedupe that makes one edge stand for a mirrored row pair, and the provenance fold across that pair | yes (`check:relations`) |
| `listsort-check.ts` | the pure derivations in [src/listSort.ts](src/listSort.ts) — the sort catalogue the overview pages offer, and the comparator's two silent rules: unknown values (no `updatedAt`, unrated CR, un-inked plate) sort **last** in every direction, and pinned/archived precedence holds in **every** order, not just `default`. Also [src/chronicle.ts](src/chronicle.ts), the Events page's order/grouping pair — it sorts by `order_num` (free-text `in_game_date` can't be compared) so it can't use the catalogue above, and ordering must run **before** grouping or newest-first reverses the date bands without reversing their contents | yes (`check:listsort`) |
| `feed-check.ts` | `projectCampaignForViewers` and `sessionFeedToMarkdown` in [src/data.ts](src/data.ts) — both are `SessionEventType` if-chains ending in a fallthrough to the plain-note shape, so a new event type silently renders as a bare note, and the digest lands in the **public** `sessions.summary` | yes (`check:feed`) |
| `bestiary-check.ts` | the pure derivations in [src/monsters.ts](src/monsters.ts) — chiefly that a plate's "inked" state is derived from a `reveal` event and never stored | yes (`check:bestiary`) |
| `focus-check.ts` | [src/imageFocus.ts](src/imageFocus.ts), the boundary between a client-written `text` column and an inline `style` attribute | yes (`check:focus`) |
| `image-check.ts` | [src/imageResize.ts](src/imageResize.ts) (the upload compressor) and [src/storagePath.ts](src/storagePath.ts) (which object a sweep may delete). Both are about what may be **destroyed**: never upscale, never re-encode a file you can't beat, never touch a GIF or SVG, take the extension from the bytes not the filename — and, for the parser, refuse any URL that isn't unmistakably one this app wrote | yes (`check:image`) |
| `drafts-check.ts` | the module store in [src/noteDrafts.ts](src/noteDrafts.ts) — unsent note drafts. Three silent rules: empty means **absence**, eviction drops the **oldest** so the draft being typed is never the one discarded, and entity/session keys can't collide across namespaces or campaigns | yes (`check:drafts`) |
| `layout-check.ts` | board layout | **no — run it by hand** after touching [src/boardLayout.ts](src/boardLayout.ts) |

**A harness fixture can encode the bug it should catch.** `saga-check.ts` asserted the behaviour of a broken owner-as-id check in `sagaScope`, using person ids for a free-text column — so it agreed with the bug rather than catching it, and the bug shipped (#121). When a fix flips what a harness asserts, that's a prompt to check the fixture's *model*, not just to update the expected value.

Supabase migrations live in [supabase/migrations/](supabase/migrations/). The **Supabase GitHub integration auto-applies merged migrations to prod** and rebuilds the full chain on every PR's preview branch — so files must be one-per-version (duplicate numeric prefixes hard-fail the preview branch), apply cleanly from scratch, and never be renumbered once their version is in the remote history. Before numbering a new migration, check the highest version across the directory, the remote history, and in-flight PRs. Prod's remote version 0014 differs from the directory's 0014 — see [supabase/migrations/README.md](supabase/migrations/README.md) for that anomaly, the numbering rules, and the `supabase migration fetch` overwrite warning. Project ref: `nsemknuzupcnvctevgfd` (URL: `https://nsemknuzupcnvctevgfd.supabase.co`).

## Architecture

This is a **collaborative read-write campaign journal** for a D&D group. The active campaign is dynamic (issue #18): it lives in the URL hash — `#/c/:campaignId`, optionally `#/c/:campaignId/e/:entityId` for an entity deep link — parsed by [src/route.ts](src/route.ts). `CampaignProvider` resolves it as hash → `window.__TWEAKS__.campaignId` → first row of the `campaigns` table, and a picker in the Topbar switches it. Switching tears down the realtime channel, clears state, and reloads under the new id; every realtime handler is gated on the campaign id it was subscribed for, so late events from the old channel can't splice into the new campaign's arrays. Mutations read the active id from the module-level store in [src/activeCampaign.ts](src/activeCampaign.ts) (`getActiveCampaignId()`), which only `CampaignProvider` writes.

### Data flow: writes go out through mutations, state comes back through realtime

There is **no optimistic UI, no local scratch state, no manual cache patching**. The read path and write path are decoupled on purpose. (One deliberate exception: the picker's `campaigns` list loads once and isn't realtime-subscribed for inserts, so founding/archiving a campaign patches it locally via `adoptCampaign`/`retireCampaign` — issue #87.) Otherwise:

- **Reads / state**: [src/campaignContext.tsx](src/campaignContext.tsx) loads the full campaign on mount via parallel `.select()` calls across 14 tables, transforms rows with per-table mappers (`mapPerson`, `mapQuest`, etc. — snake_case → camelCase, `desc` → `desc`, FK columns like `location_id` → `location`), then subscribes to every table via Supabase realtime. Entity tables (people, locations, quests, goals, factions, items, lore, monsters, sessions) splice incremental changes in through `applyArrayChange`. Three tables — `connections`, `board_positions`, `party_notes` — **refetch the whole table on any change** (see the handlers at the bottom of `CampaignProvider`); this is intentional for v1 simplicity and is the reason a single entity delete may trigger several full refetches. **"Who's at the table" is channel Presence, not a table** (issue #74, migration 0021 dropped `presence_users`): the same campaign channel `.track()`s `{ id, name, initials, color }` for signed-in named editors, `CampaignProvider` exposes the deduped roster as `presenceUsers` (`usePresence()`), and occupancy expires with the socket. Presence is occupancy only — the "session is live" fact stays the `campaigns.active_session_id` row.
- **Writes**: Every mutation goes through [src/mutations.ts](src/mutations.ts). Callers fire-and-forget (`.catch(console.error)`), then realtime brings the change back through the reader path. Never bypass this file or write a `.insert/.update/.delete` from a component. `updateEntity`/`createEntity` handle the camelCase → snake_case translation via `fieldAlias`.

Practical implication: if you find yourself adding `useState` to mirror DB state, stop — read from `useCampaign()` instead.

### Auth

**Two tiers** (issue #4): anonymous sessions are read-only **viewers**; email magic-link or Discord OAuth sessions are **editors**.

[src/auth.tsx](src/auth.tsx) runs `signInAnonymously()` on first load if there's no session — every visitor always has a session. Anonymous users skip the display-name gate and land straight in the journal read-only. "Sign in to edit" in the Topbar opens `SignInDialog`, which offers two paths: `signInWithOAuth({ provider: "discord", options: { redirectTo: window.location.origin } })` and `signInWithOtp` (magic link, `emailRedirectTo: window.location.origin`); the client's default `detectSessionInUrl` consumes the callback token for both. A failed OAuth redirect lands back with `#error_description=…` and no session — `AuthProvider` strips it from the hash (before [src/route.ts](src/route.ts) can misparse it) and shows a dismissible `AuthNotice` banner. Editors' display name comes from `user_metadata.display_name`, falling back to their email prefix; it signs `party_notes`. Discord editors hit the `DisplayNameGate` with the input prefilled from Discord metadata (`custom_claims.global_name` → `full_name` → `name`), and their `user_metadata.avatar_url` shows as a small round avatar in the Topbar. `signOut` drops back to a fresh anonymous session, not a blank screen.

`useAuth().canEdit` (`!!user && !user.is_anonymous`) is the single gate for edit affordances — `EditableText`/`EnumSelect` check it themselves and render plain text when false; buttons that mutate (Pin new, Draw string, sidebar `+`, PIN/ARCHIVE/STRIKE, note composer, Add Relation, portrait upload, bulk archive) are hidden behind it. Gate any new edit surface the same way.

RLS (migration [0006_reject_anonymous_writes.sql](supabase/migrations/0006_reject_anonymous_writes.sql)) keeps reads open to `anon` but write policies require `(auth.jwt() ->> 'is_anonymous')::boolean is not true` — anonymous JWTs hold the `authenticated` *role*, so the claim is the only reliable gate. Since migration [0023](supabase/migrations/0023_campaign_crud_membership_scoping.sql) (issue #87) writes additionally require a `campaign_members` row for that `campaign_id` (`is_campaign_member()`); rejected writes surface through the `onWriteError` toast wired in [src/mutations.ts](src/mutations.ts). Storage (`entity-images`) writes are still claim-gated only. Advisors may flag the claim-based policy halves — by design.

Dashboard config this depends on (Authentication → …):
- Providers: **Anonymous ON** (viewer JWTs), **Email ON** (magic link), and **Discord ON** (client ID/secret from the Discord developer app; its OAuth2 Redirects must include `https://nsemknuzupcnvctevgfd.supabase.co/auth/v1/callback`).
- **Sign-ups open** — anyone with the URL can become an editor via Discord or magic link.
- URL Configuration: Site URL = production URL; `http://localhost:5173` in Redirect URLs for dev.

**Testing edit-gated surfaces locally.** Anonymous visitors are read-only, so any change behind `canEdit` needs a real non-anonymous session. Set `VITE_DEV_EDITOR_EMAIL`/`VITE_DEV_EDITOR_PASSWORD` in `.env` and call `window.__devSignIn()` from the console — it's compiled out of production by an `import.meta.env.DEV` guard. The account is a throwaway living only in the remote project, so nothing here recreates it and **it goes stale silently**; `__devSignIn` prints the provisioning steps when it hits `invalid_credentials`. Two steps, and the second is the one that gets missed: create the user with **Auto Confirm** ticked, *then* grant it a `campaign_members` row for the campaign under test — since 0023 writes require membership, and that table is deny-all for client writes (0018/0022), so only `create_campaign` or `redeem_campaign_invite` can grant it. Without it you get a session that passes `canEdit` but has every write RLS-rejected into the toast. See [.env.example](.env.example).

### Entity model

Nine kinds share a `KindKey` union: `people | locations | quests | goals | factions | items | lore | monsters | sessions`. The primary display field differs per kind (`name` vs `title` vs `text`) — see `primaryField` in [src/detail.tsx](src/detail.tsx) and `entityLabel()` in [src/data.ts](src/data.ts). Connections (`connections` table) are free-form edges between any two entities regardless of kind; since entity IDs span eight tables there are no FKs on `from_id`/`to_id`, which is why `deleteEntity` has to sweep connections app-side. Since [migration 0031](supabase/migrations/0031_connection_provenance.sql) a row also carries provenance — `created_at` / `session_id` / `author` — and **`created_at` is nullable on purpose**: the seeded back-catalogue was not backfilled, so `undefined` means "predates the column", never "today". Drawing a string while a session is live also appends a `link` row to the session feed; the visibility rule and the mirrored-pair fold are documented at [src/relations.ts](src/relations.ts) and guarded by `relations-check.ts`.

**Adding a kind is a wide but mechanical change** — [migration 0024](supabase/migrations/0024_monsters.sql) plus the `monsters` thread through `data.ts` / `campaignContext.tsx` / `mutations.ts` / `icons.tsx` / `entitySearch.ts` / `upload.ts` / `boardLayout.ts` / `components.tsx` / `board.tsx` / `cleanupPanel.tsx` / `detail.tsx` is the worked example. Two things are easy to miss: `entity_hidden()` in the DB (0018) has to learn the new table or hidden rows leak their connections and board pins, and if the kind takes a bespoke page it must ALSO be excluded from the `KindList` catch-all in [src/App.tsx](src/App.tsx).

### The Bestiary (monsters)

The monsters kind exists for artwork and notes, so it bypasses the generic `KindList` grid for a bespoke plate wall — [src/bestiary.tsx](src/bestiary.tsx) (page + `PlateLightbox`) over pure derivations in [src/monsters.ts](src/monsters.ts). **Discovery is derived, never stored**: a plate is "inked" once `campaign.sessionEvents` holds a `reveal` row for that monster, which is exactly what `releaseEntity`/`showEntity` already write — so the DM's existing RELEASE / ⚡ SHOW NOW ceremony is what fills the field guide in, with no extra table and nothing to remember. A ⚡ SHOW NOW on an illustrated monster additionally opens the plate full-bleed on every player's screen. Note the boundary, which is documented at length in `monsters.ts`: the un-inked frame is **presentation, not secrecy** — a visible monster's art is already in the client's data; `hidden` (RLS-enforced) is the real secrecy tool.

### Image uploads

**There is no image service in front of the `entity-images` bucket** (Supabase's transformations are a Pro-plan feature), so whatever object [src/upload.ts](src/upload.ts) writes is exactly what every viewer downloads on every load, forever. Compression therefore happens once, client-side, at the only moment the original is still in hand: [src/imageResize.ts](src/imageResize.ts) decodes with EXIF orientation applied, downscales the longest edge to `MAX_EDGE` (2000px) and re-encodes to WebP at q0.82 before the bytes leave the browser. A 12 MP phone photo lands around 10× smaller and arrives upright.

Two things follow from "one copy, and it's lossy":

- **Every failure path returns the original file.** An unsupported codec, a canvas that won't emit WebP, a re-encode that comes back no smaller — all degrade to uploading what the user picked, never to an error. `compressImage` doesn't throw.
- **`MAX_EDGE` is set by `MAX_ZOOM` in [src/imageFocus.ts](src/imageFocus.ts), not by the well size.** A focus zooms up to 2.5×, which is a straight upscale of the stored file. Lowering `MAX_EDGE` (or raising `MAX_ZOOM` without it) buys blur at max zoom.

**The project is deliberately on Supabase's free tier, and the binding constraint there is egress, not storage** — 1 GB of storage but only 5 GB cached + 5 GB uncached bandwidth per month. So `upload.ts` sets `cacheControl` to a year explicitly; the SDK default is **one hour**, which would have every player's browser re-fetching every portrait it has already seen, several times an evening. That value is **seconds only** — it is a duration everywhere Supabase documents it and the SDK interpolates it as `max-age=${value}`, so adding a directive like `immutable` bets on undocumented server tolerance for a failure mode of "every upload 400s". That long TTL is only safe because the path is content-addressed by construction (`upsert: false` + a `Date.now()` suffix means an object at a given path is never rewritten, and replacing an image mints a new URL). **Anything that starts overwriting a path in place has to revisit that value.**

**Replacing or deleting an image sweeps the object it replaced** — `setEntityImage` / `setCampaignImage` / `deleteEntity` in [src/mutations.ts](src/mutations.ts). Before this the bucket only ever grew: `upsert: false` plus the timestamp suffix means each re-upload abandoned the old object. The sweep always runs *after* the row write lands (a rejected or 0-row write throws first, so a rename that didn't happen can't take the artwork with it) and its own failure is only logged.

Which object to sweep is decided by [src/storagePath.ts](src/storagePath.ts), and **that parser is deliberately built to refuse**. A missed sweep leaks a few hundred KB; a wrong match deletes a group's artwork with no undo and no free-tier backup. It accepts only the exact shape `upload.ts` writes and rejects everything else — other buckets, off-platform URLs, signed/render routes, traversal, and any path prefix the app doesn't itself write. That is not theoretical: of the 102 stored `image_url` values in the live campaign, 31 are shapes the app never wrote (seeded `foi/…` session art, a legacy `portraits` bucket, a Discord CDN crest) and all 31 are correctly left alone. Read that module's header before widening it.

`upload.ts` has two size limits and the order matters: `MAX_INPUT_BYTES` (30 MB) gates what may be *picked*, `MAX_BYTES` (5 MB) gates what may be *stored*, and compression runs between them — so a big photo that was always going to shrink isn't rejected for its original size. Re-encoding also strips EXIF as a side effect, which matters more than it sounds: these are public objects and phone photos carry GPS.

### Editable UI primitives

[src/components.tsx](src/components.tsx) exports `<EditableText>` (contentEditable, blur-to-save, Esc cancels, Enter saves single-line / ⌘↵ multi-line) and `<EnumSelect>`. Reuse these on the detail sheet rather than hand-rolling contentEditable — see [src/detail.tsx](src/detail.tsx) for the patterns.

**Blur-to-save is for MUTABLE FIELDS ONLY, and that boundary is load-bearing.** `<EditableText>`/`<EditableMarkdown>` edit a value that's still on screen to fix, so committing on blur is safe and matches the industry norm (Notion, Linear, Airtable). Notes are the opposite: `party_notes` rows and `session_events` feed rows are **append-only — no edit, no delete**. So both note surfaces go through `<NoteComposer>`, which commits only on an explicit act (its `sendOn` keystroke or its button) and **never on focus loss** — clicking away keeps the draft in the module store at [src/noteDrafts.ts](src/noteDrafts.ts). Party notes shipped with `onBlur={addNote}` and players reported half-typed thoughts becoming permanent records; the live panel never had it. If you add a third composer, reuse `<NoteComposer>` — the original bug was two near-identical hand-rolled `contentEditable`s drifting apart.

Related: the detail sheet's backdrop dismiss requires **both** mouse endpoints on the overlay (`mousedown` + `mouseup`). Closing on `mousedown` alone silently discarded field edits — the browser moves focus as mousedown's *default action*, so unmounting on down means a focused `EditableText` never fires its blur-commit. `<DetailSheet>` is also keyed on the entity id in [src/App.tsx](src/App.tsx): the sheet stays mounted across relations-rail navigation, and unkeyed it would carry one entity's mid-edit DOM text onto the next entity's write.

### Host-page integration

The app supports an "edit mode" handshake with a parent window via `window.__TWEAKS__` and `postMessage` (see [src/App.tsx](src/App.tsx)). Theme / presence / density live here. Do not use `localStorage` for these — the parent page owns persistence through the `__edit_mode_set_keys` message.

That rule is about *host-owned* state, not a ban on `localStorage`. Two things are deliberately browser-local and go through it instead: the pending invite code ([src/join.tsx](src/join.tsx)) and the remembered list sort ([src/listPrefs.ts](src/listPrefs.ts)). The latter persists **sort only, never the facets or the name query** — a remembered filter means reopening a page with rows missing and nothing on screen explaining why.

## Conventions

- **Route everything campaign-scoped through the active campaign id** — components read it via `useCampaign()`/`useCampaignSwitcher()`, mutations via `getActiveCampaignId()` from [src/activeCampaign.ts](src/activeCampaign.ts); never query without the `campaign_id` filter. Since migration 0023 (issue #87) RLS also enforces per-campaign **write** access: editors can only write to campaigns where they hold a `campaign_members` row (reads stay open to everyone, minus hidden-row gating).
- **New entity IDs are `crypto.randomUUID()` strings** generated client-side. All PKs are `text` except `connections.id` (bigserial) and `party_notes.id` (bigserial).
- **Styling is inline style objects + a few CSS classes** in [src/styles.css](src/styles.css). CSS variables (`--ink`, `--vellum`, `--bloodred`, `--font-fell-sc`, etc.) carry the aesthetic — reach for those before inventing colors.
- **Fonts are picked by role** (see the `:root` comment in styles.css): `--font-body` (Bookinsanity, self-hosted from [public/fonts/](public/fonts/), the 5e-book body face) is for ALL content text — descriptions, notes, rows, inputs; `--font-fell-sc` is small-caps chrome labels; `--font-fell` (IM Fell) is decorative flourishes only, never content; `--font-display` (Cormorant) is display titles.
- **Ink tiers are picked by role** (see the `:root` comment in styles.css): `--ink-secondary` is the contrast floor for any text ≤14px — the Fell SC labels' thin strokes need it, especially on the grimoire theme. `--ink-faded`/`--ink-ghost` are reserved for off-states, hints, and decoration, never for small content text. Colors that read as text on card stock (tags, chips) must be theme-aware variables — hardcoded light-paper colors vanish on grimoire.
- **Committed `.js` / `.d.ts` siblings of the `.tsx` files are gitignored** (`src/**/*.js`, `src/**/*.d.ts` except `global.d.ts`). They're `tsc` outputs — ignore them. If any exist on disk, **delete them** — Vite resolves `.js` before `.tsx`, so a stale sibling silently shadows the real source in dev *and* in `vite build`.

## Themes: Modern Atlas is the default

**Do not build parchment-first.** Since PR #102 the default theme is **Modern Atlas** — flat, dark, Inter, functional — while Cartographer (parchment) and Grimoire stay first-class. Most users see Atlas. Read [docs/design-atlas.md](docs/design-atlas.md) before touching UI; the essentials:

- **One DOM, two dresses.** Never branch a component on theme. Structural additions are CSS-gated to `[data-theme="modern"]`, and the parchment themes must render identically after your change.
- **Voice goes through `<ThemedLabel parchment=… atlas=…>`** ([src/components.tsx](src/components.tsx)) — parchment speaks ceremony ("Tidy the Codex", "Draw string"), Atlas speaks function ("Tidy the codex", "Connect"). Use it for every control label, panel title, empty state and register-differing note. Skip it when both voices are identical (counts, session codes). Pure modules can't use it, so their strings must be voice-neutral.
- **Ornaments go in a `.fleuron` span** — `<Fleurons>` or `<span className="fleuron">✦ </span>`. Atlas hides them; a bare `✦` in JSX survives where every other flourish is suppressed.
- **Atlas remaps the font *variables*** (`--font-body`/`--font-fell-sc` → Inter), so role variables mostly Atlas themselves. `--font-display` is deliberately **not** remapped: Atlas keeps Cormorant for display titles — never demote a title to `--font-ui`.
- **New small-caps label classes must join the shared `[data-theme="modern"] :is(…)` uppercase list**, or they render sentence-case among uppercase neighbours. Easiest thing to forget.
- **A new dark theme must join the `color-scheme: dark` list**, or its native `<select>` popups render light-on-white (#106).

Run `npx tsx scripts/ui-check.ts` to catch the mechanical half of this.

## Ritual

Per user's global instructions, after `/commit-push-pr` run `/code-review list all the issues` and fix anything the reviewer scored ≥80. After a PR merges, run `/clean_gone` to prune stale local branches.
