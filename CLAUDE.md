# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (usually 5173, falls back if in use)
- `npm run build` — `tsc -b && vite build`; always run this to verify a change typechecks
- `npm run preview` — serve the production build

No test framework is set up.

Supabase migrations live in [supabase/migrations/](supabase/migrations/). Apply them via the Supabase dashboard SQL editor or the Supabase MCP server (`mcp__plugin_supabase_supabase__apply_migration`). Project ref: `nsemknuzupcnvctevgfd` (URL: `https://nsemknuzupcnvctevgfd.supabase.co`).

## Architecture

This is a **collaborative read-write campaign journal** for a D&D group, hardcoded to one campaign at a time via `CURRENT_CAMPAIGN_ID` in [src/data.ts](src/data.ts) (currently `"fendwick"`).

### Data flow: writes go out through mutations, state comes back through realtime

There is **no optimistic UI, no local scratch state, no manual cache patching**. The read path and write path are decoupled on purpose:

- **Reads / state**: [src/campaignContext.tsx](src/campaignContext.tsx) loads the full campaign on mount via parallel `.select()` calls across 13 tables, transforms rows with per-table mappers (`mapPerson`, `mapQuest`, etc. — snake_case → camelCase, `desc` → `desc`, FK columns like `location_id` → `location`), then subscribes to every table via Supabase realtime. Entity tables (people, locations, quests, goals, factions, items, lore, sessions, presence_users) splice incremental changes in through `applyArrayChange`. Three tables — `connections`, `board_positions`, `party_notes` — **refetch the whole table on any change** (see the handlers at the bottom of `CampaignProvider`); this is intentional for v1 simplicity and is the reason a single entity delete may trigger several full refetches.
- **Writes**: Every mutation goes through [src/mutations.ts](src/mutations.ts). Callers fire-and-forget (`.catch(console.error)`), then realtime brings the change back through the reader path. Never bypass this file or write a `.insert/.update/.delete` from a component. `updateEntity`/`createEntity` handle the camelCase → snake_case translation via `fieldAlias`.

Practical implication: if you find yourself adding `useState` to mirror DB state, stop — read from `useCampaign()` instead.

### Auth

[src/auth.tsx](src/auth.tsx) runs `signInAnonymously()` on first load if there's no session, then gates the app on a display name (stored in `user_metadata.display_name`, used as the `author` on `party_notes`). RLS (migration [0003_enable_writes.sql](supabase/migrations/0003_enable_writes.sql)) requires `authenticated` — anonymous JWTs satisfy this. Reads remain open to `anon`.

Anonymous sign-ins must be enabled in the Supabase dashboard (Authentication → Providers), otherwise `AuthProvider` surfaces a gate-barred error screen.

### Entity model

Eight kinds share a `KindKey` union: `people | locations | quests | goals | factions | items | lore | sessions`. The primary display field differs per kind (`name` vs `title` vs `text`) — see `primaryField` in [src/detail.tsx](src/detail.tsx) and `entityLabel()` in [src/data.ts](src/data.ts). Connections (`connections` table) are free-form edges between any two entities regardless of kind; since entity IDs span seven tables there are no FKs on `from_id`/`to_id`, which is why `deleteEntity` has to sweep connections app-side.

### Editable UI primitives

[src/components.tsx](src/components.tsx) exports `<EditableText>` (contentEditable, blur-to-save, Esc cancels, Enter saves single-line / ⌘↵ multi-line) and `<EnumSelect>`. Reuse these on the detail sheet rather than hand-rolling contentEditable — see [src/detail.tsx](src/detail.tsx) for the patterns.

### Host-page integration

The app supports an "edit mode" handshake with a parent window via `window.__TWEAKS__` and `postMessage` (see [src/App.tsx](src/App.tsx)). Theme / presence / density live here. Do not use `localStorage` for these — the parent page owns persistence through the `__edit_mode_set_keys` message.

## Conventions

- **Route everything campaign-scoped through `CURRENT_CAMPAIGN_ID`**; never query without the `campaign_id` filter. RLS doesn't enforce per-campaign access today ([issue #4](https://github.com/Kminkjan/the-codex/issues/4)).
- **New entity IDs are `crypto.randomUUID()` strings** generated client-side. All PKs are `text` except `connections.id` (bigserial) and `party_notes.id` (bigserial).
- **Styling is inline style objects + a few CSS classes** in [src/styles.css](src/styles.css). CSS variables (`--ink`, `--vellum`, `--bloodred`, `--font-fell-sc`, etc.) carry the parchment aesthetic — reach for those before inventing colors.
- **Committed `.js` / `.d.ts` siblings of the `.tsx` files are gitignored** (`src/**/*.js`, `src/**/*.d.ts` except `global.d.ts`). They're `tsc` outputs — ignore them.

## Ritual

Per user's global instructions, after `/commit-push-pr` run `/code-review list all the issues` and fix anything the reviewer scored ≥80. After a PR merges, run `/clean_gone` to prune stale local branches.
