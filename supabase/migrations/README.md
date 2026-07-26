# Migrations

Since 2026-07-16 the **Supabase GitHub integration (Branching)** is enabled on this repo: every PR gets a preview branch that rebuilds the full migration chain from scratch, and **merging a PR auto-applies its new migrations to prod** (confirmed with 0021 on PR #89 — no dashboard step needed anymore). Before that, migrations were applied by hand via the dashboard SQL editor or the Management API, which is why this directory and the remote migration history (`supabase migration list`) drifted; the notes below record the known divergences so nobody "fixes" them.

Consequences of the integration:

- **One file per version, strictly.** The integration keys migrations by the numeric filename prefix. Two files sharing a prefix hard-fail every preview branch with `duplicate key value violates unique constraint "schema_migrations_pkey"` — this is empirical, from PR #90's branch error when a second `0014_*.sql` was added.
- **Migrations must apply cleanly from scratch** (preview branches replay 0001→head on an empty database) and should be idempotent where possible.
- **Never renumber a file whose version is already in the remote history** — that would desync repo and remote forever.

**Picking a number for a new migration:** take the next number after the highest across (a) this directory, (b) the remote history, and (c) any in-flight branch or open PR that adds a migration. As of 2026-07-26 that next number is **0030** — 0029 (`fendwick_timeline_and_appearances`) is the highest here, following 0028 (`fendwick_dm_notes_restructure`) and 0026/0027 (session 8's rows and board curation). `supabase migration list --linked` showed the directory and the remote history matching through 0025 before 0026 was added.

**`people.last_seen_session_id` is DERIVED — do not hand-write it.** [0013_active_session.sql](0013_active_session.sql) feeds it from the `session_participants` junction through the `recompute_last_seen` trigger, which sets it to the highest-num session the person appears in. A seed that writes the column directly and leaves the junction empty produces a value that looks right and is unstable: the first "mark seen" tap in the app recomputes that person from a junction holding only the row just created, silently rewriting their history. It also leaves four features dark, because they read the junction and not the column — the sidebar's "This Session" roster, the poster `seen-live-dot`, the detail sheet's seen toggle, and `sagaScope`'s Cast tier. **Every seed in this directory got this wrong**: the Fist of Ilmater seeds (0011/0012) hand-write 33 of 41 pointers with an empty junction, and 0026 did the same for Fendwick. Only Fendwick is corrected, in [0029](0029_fendwick_timeline_and_appearances.sql) — FOI's 162 chapters are still unbacked. Write `session_participants` rows and let the trigger do the rest.

**The `events` table is not the same thing as a session summary.** [0009_events.sql](0009_events.sql) is "events as a first-class timeline primitive" and backs a top-level nav view that groups rows by `in_game_date`. Narrating a campaign's chronology inside `sessions.summary` markdown leaves that whole page empty — which is what happened to Fendwick between 0026 and 0029. Also note `sessions.date` (real-world play date) is a *separate* column from `in_game_date`, and the charter's LAST PLAYED tile and chronicle epigraph read `date`.

**Curating seed data?** [0027_fendwick_board_and_tidy.sql](0027_fendwick_board_and_tidy.sql) documents two traps worth knowing before you write board or archive data by hand: `board_positions.kind` has no CHECK constraint but only the eight archivable kinds render (a `sessions` pin draws a blank thumbtack, because `CardBody`'s switch falls through to `default: return null`), and a manual `connections` row suppresses the FK-derived edge for the same pair — so hand-writing a "member of" string on top of a `faction_id` *downgrades* that link from weight 3 to weight 2.

Worked cautionary tale: `monsters` was briefly renumbered 0024 → 0026 on the theory that it was still branch-local and should land after the in-flight sagas migration. It wasn't — 0024 was already registered remotely, so the rename immediately produced a `local="" remote="0024"` orphan plus an unapplied local 0026, which is precisely the drift documented below. `supabase migration list --linked` is the cheap way to check *before* renaming, and the rule it enforces has no exceptions: **never renumber a version that is already in the remote history.**

**Adding an entity kind?** [0024_monsters.sql](0024_monsters.sql) is the worked example of everything a new archivable kind needs at the DB layer, including the one easy-to-miss edit: `entity_hidden()` (0018) has to learn the new table, or hidden rows of that kind leak their connections and board pins to players.

**Touching arcs?** Nesting is capped at two levels (saga → arc) by the `tg_arcs_depth` trigger in [0025_arc_nesting.sql](0025_arc_nesting.sql), which is also what makes cycles impossible. Any UI that writes `arcs.parent_id` must mirror its four rules or it will offer writes the database refuses.

## Known anomaly: prod's version 0014 is not this directory's 0014

- The **remote history's version 0014** is `foi_last_seen_and_archive` — Fist-of-Ilmater board maintenance (last_seen corrections + archiving concluded arcs). It was applied to prod through the migration history but never committed here. Its content is preserved verbatim in [../history/0014_foi_last_seen_and_archive.sql](../history/0014_foi_last_seen_and_archive.sql); it can't live in this directory because of the one-file-per-version rule above.
- This directory's [0014_person_tier_status.sql](0014_person_tier_status.sql) is **not in the remote history at all** — it was applied via the dashboard SQL editor (NPC roster rollout, PRs #58–#61), which doesn't register a version. The integration treats it as applied because version 0014 is registered remotely (by the foi script), so pushes skip it; preview branches apply it as their 0014, which is fine — it's idempotent, and the foi script is fendwick/foi seed-data curation a preview branch doesn't need.

Both scripts are live in prod. Don't renumber `0014_person_tier_status.sql` and don't move the foi file into this directory.

## `supabase migration fetch` warning

`supabase migration fetch` **overwrites every file in this directory** with normalized remote content (and deletes files with no remote entry, e.g. `0014_person_tier_status.sql`). If you need it, back up the directory first and restore tracked files with `git checkout -- supabase/migrations` afterwards, keeping only the remote-only files you were after.
