# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (usually 5173, falls back if in use)
- `npm run build` — `tsc -b && vite build`; always run this to verify a change typechecks
- `npm run preview` — serve the production build

No test framework is set up.

Supabase migrations live in [supabase/migrations/](supabase/migrations/). Apply them via the Supabase dashboard SQL editor or the Supabase MCP server (`mcp__plugin_supabase_supabase__apply_migration`). Project ref: `nsemknuzupcnvctevgfd` (URL: `https://nsemknuzupcnvctevgfd.supabase.co`).

## Architecture

This is a **collaborative read-write campaign journal** for a D&D group. The active campaign is dynamic (issue #18): it lives in the URL hash — `#/c/:campaignId`, optionally `#/c/:campaignId/e/:entityId` for an entity deep link — parsed by [src/route.ts](src/route.ts). `CampaignProvider` resolves it as hash → `window.__TWEAKS__.campaignId` → first row of the `campaigns` table, and a picker in the Topbar switches it. Switching tears down the realtime channel, clears state, and reloads under the new id; every realtime handler is gated on the campaign id it was subscribed for, so late events from the old channel can't splice into the new campaign's arrays. Mutations read the active id from the module-level store in [src/activeCampaign.ts](src/activeCampaign.ts) (`getActiveCampaignId()`), which only `CampaignProvider` writes.

### Data flow: writes go out through mutations, state comes back through realtime

There is **no optimistic UI, no local scratch state, no manual cache patching**. The read path and write path are decoupled on purpose:

- **Reads / state**: [src/campaignContext.tsx](src/campaignContext.tsx) loads the full campaign on mount via parallel `.select()` calls across 13 tables, transforms rows with per-table mappers (`mapPerson`, `mapQuest`, etc. — snake_case → camelCase, `desc` → `desc`, FK columns like `location_id` → `location`), then subscribes to every table via Supabase realtime. Entity tables (people, locations, quests, goals, factions, items, lore, sessions, presence_users) splice incremental changes in through `applyArrayChange`. Three tables — `connections`, `board_positions`, `party_notes` — **refetch the whole table on any change** (see the handlers at the bottom of `CampaignProvider`); this is intentional for v1 simplicity and is the reason a single entity delete may trigger several full refetches.
- **Writes**: Every mutation goes through [src/mutations.ts](src/mutations.ts). Callers fire-and-forget (`.catch(console.error)`), then realtime brings the change back through the reader path. Never bypass this file or write a `.insert/.update/.delete` from a component. `updateEntity`/`createEntity` handle the camelCase → snake_case translation via `fieldAlias`.

Practical implication: if you find yourself adding `useState` to mirror DB state, stop — read from `useCampaign()` instead.

### Auth

**Two tiers** (issue #4): anonymous sessions are read-only **viewers**; email magic-link sessions are **editors**.

[src/auth.tsx](src/auth.tsx) runs `signInAnonymously()` on first load if there's no session — every visitor always has a session. Anonymous users skip the display-name gate and land straight in the journal read-only. "Sign in to edit" in the Topbar opens `SignInDialog` → `signInWithOtp` (magic link, `emailRedirectTo: window.location.origin`; the client's default `detectSessionInUrl` consumes the link token). Editors' display name comes from `user_metadata.display_name`, falling back to their email prefix; it signs `party_notes`. `signOut` drops back to a fresh anonymous session, not a blank screen.

`useAuth().canEdit` (`!!user && !user.is_anonymous`) is the single gate for edit affordances — `EditableText`/`EnumSelect` check it themselves and render plain text when false; buttons that mutate (Pin new, Draw string, sidebar `+`, PIN/ARCHIVE/STRIKE, note composer, Add Relation, portrait upload, bulk archive) are hidden behind it. Gate any new edit surface the same way.

RLS (migration [0006_reject_anonymous_writes.sql](supabase/migrations/0006_reject_anonymous_writes.sql)) keeps reads open to `anon` but write policies require `(auth.jwt() ->> 'is_anonymous')::boolean is not true` — anonymous JWTs hold the `authenticated` *role*, so the claim is the only reliable gate. Storage (`entity-images`) writes are gated the same way. Advisors may still flag the policies as claim-based rather than row-based; per-campaign membership is issue #18.

Dashboard config this depends on (Authentication → …):
- Providers: **Anonymous ON** (viewer JWTs) and **Email ON** (magic link).
- **Sign-ups disabled** — editors are invite-only, added manually via the dashboard.
- URL Configuration: Site URL = production URL; `http://localhost:5173` in Redirect URLs for dev.

### Entity model

Eight kinds share a `KindKey` union: `people | locations | quests | goals | factions | items | lore | sessions`. The primary display field differs per kind (`name` vs `title` vs `text`) — see `primaryField` in [src/detail.tsx](src/detail.tsx) and `entityLabel()` in [src/data.ts](src/data.ts). Connections (`connections` table) are free-form edges between any two entities regardless of kind; since entity IDs span seven tables there are no FKs on `from_id`/`to_id`, which is why `deleteEntity` has to sweep connections app-side.

### Editable UI primitives

[src/components.tsx](src/components.tsx) exports `<EditableText>` (contentEditable, blur-to-save, Esc cancels, Enter saves single-line / ⌘↵ multi-line) and `<EnumSelect>`. Reuse these on the detail sheet rather than hand-rolling contentEditable — see [src/detail.tsx](src/detail.tsx) for the patterns.

### Host-page integration

The app supports an "edit mode" handshake with a parent window via `window.__TWEAKS__` and `postMessage` (see [src/App.tsx](src/App.tsx)). Theme / presence / density live here. Do not use `localStorage` for these — the parent page owns persistence through the `__edit_mode_set_keys` message.

## Conventions

- **Route everything campaign-scoped through the active campaign id** — components read it via `useCampaign()`/`useCampaignSwitcher()`, mutations via `getActiveCampaignId()` from [src/activeCampaign.ts](src/activeCampaign.ts); never query without the `campaign_id` filter. RLS doesn't enforce per-campaign access today — any signed-in editor can write to any campaign (per-campaign membership is future work).
- **New entity IDs are `crypto.randomUUID()` strings** generated client-side. All PKs are `text` except `connections.id` (bigserial) and `party_notes.id` (bigserial).
- **Styling is inline style objects + a few CSS classes** in [src/styles.css](src/styles.css). CSS variables (`--ink`, `--vellum`, `--bloodred`, `--font-fell-sc`, etc.) carry the parchment aesthetic — reach for those before inventing colors.
- **Ink tiers are picked by role** (see the `:root` comment in styles.css): `--ink-secondary` is the contrast floor for any text ≤14px — IM Fell's thin strokes need it, especially on the grimoire theme. `--ink-faded`/`--ink-ghost` are reserved for off-states, hints, and decoration, never for small content text. Colors that read as text on card stock (tags, chips) must be theme-aware variables — hardcoded light-paper colors vanish on grimoire.
- **Committed `.js` / `.d.ts` siblings of the `.tsx` files are gitignored** (`src/**/*.js`, `src/**/*.d.ts` except `global.d.ts`). They're `tsc` outputs — ignore them.

## Ritual

Per user's global instructions, after `/commit-push-pr` run `/code-review list all the issues` and fix anything the reviewer scored ≥80. After a PR merges, run `/clean_gone` to prune stale local branches.
