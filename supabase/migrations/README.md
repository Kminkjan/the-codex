# Migrations

Since 2026-07-16 the **Supabase GitHub integration (Branching)** is enabled on this repo: every PR gets a preview branch that rebuilds the full migration chain from scratch, and **merging a PR auto-applies its new migrations to prod** (confirmed with 0021 on PR #89 — no dashboard step needed anymore). Before that, migrations were applied by hand via the dashboard SQL editor or the Management API, which is why this directory and the remote migration history (`supabase migration list`) drifted; the notes below record the known divergences so nobody "fixes" them.

Consequences of the integration:

- **One file per version, strictly.** The integration keys migrations by the numeric filename prefix. Two files sharing a prefix hard-fail every preview branch with `duplicate key value violates unique constraint "schema_migrations_pkey"` — this is empirical, from PR #90's branch error when a second `0014_*.sql` was added.
- **Migrations must apply cleanly from scratch** (preview branches replay 0001→head on an empty database) and should be idempotent where possible.
- **Never renumber a file whose version is already in the remote history** — that would desync repo and remote forever.

**Picking a number for a new migration:** take the next number after the highest across (a) this directory, (b) the remote history, and (c) any in-flight branch or open PR that adds a migration. As of 2026-07-17 that next number is **0023** — 0022 is reserved by coordination for issue #86's in-flight `campaign_invites` work (not yet an open PR; re-verify when it lands).

## Known anomaly: prod's version 0014 is not this directory's 0014

- The **remote history's version 0014** is `foi_last_seen_and_archive` — Fist-of-Ilmater board maintenance (last_seen corrections + archiving concluded arcs). It was applied to prod through the migration history but never committed here. Its content is preserved verbatim in [../history/0014_foi_last_seen_and_archive.sql](../history/0014_foi_last_seen_and_archive.sql); it can't live in this directory because of the one-file-per-version rule above.
- This directory's [0014_person_tier_status.sql](0014_person_tier_status.sql) is **not in the remote history at all** — it was applied via the dashboard SQL editor (NPC roster rollout, PRs #58–#61), which doesn't register a version. The integration treats it as applied because version 0014 is registered remotely (by the foi script), so pushes skip it; preview branches apply it as their 0014, which is fine — it's idempotent, and the foi script is fendwick/foi seed-data curation a preview branch doesn't need.

Both scripts are live in prod. Don't renumber `0014_person_tier_status.sql` and don't move the foi file into this directory.

## `supabase migration fetch` warning

`supabase migration fetch` **overwrites every file in this directory** with normalized remote content (and deletes files with no remote entry, e.g. `0014_person_tier_status.sql`). If you need it, back up the directory first and restore tracked files with `git checkout -- supabase/migrations` afterwards, keeping only the remote-only files you were after.
