# Migrations

Migrations are applied to prod (`nsemknuzupcnvctevgfd`) via the Supabase **dashboard SQL editor** or the Supabase MCP server — never `supabase db push`. That means this directory and the remote migration history (`supabase migration list`) can drift, and they have; the notes below record the known divergences so nobody "fixes" them.

## Version numbers follow the remote history

The remote migration history is the source of truth for version numbers. When a migration was applied to prod under a version, commit it here under that same version — renumbering a file that's already in the remote history would desync the two forever.

**Picking a number for a new migration:** take the next number after the highest across (a) this directory, (b) the remote history, and (c) any open PR that adds a migration. As of 2026-07-17 that next number is **0023** (0022 is `campaign_invites`, issue #86's PR).

## Known anomaly: two migrations share version 0014

- `0014_foi_last_seen_and_archive.sql` — remote version **0014**. Fist-of-Ilmater board maintenance (last_seen corrections + archiving concluded arcs). Applied to prod through the migration history but originally never committed here; back-filled verbatim from the remote.
- `0014_person_tier_status.sql` — **not in the remote history at all.** It was applied via the dashboard SQL editor (NPC roster rollout, PRs #58–#61), which doesn't register a version. It kept its filename because renaming it wouldn't fix anything (there's no remote entry to match) and would churn history.

Both are live in prod. Order between them doesn't matter for a fresh rebuild: the foi script only touches `last_seen_session_id` (0001) and `archived` (0005), and `person_tier_status` only adds columns.

## `supabase migration fetch` warning

`supabase migration fetch` **overwrites every file in this directory** with normalized remote content (and deletes files with no remote entry, e.g. `0014_person_tier_status.sql`). If you need it, back up the directory first and restore tracked files with `git checkout -- supabase/migrations` afterwards, keeping only the remote-only files you were after.
