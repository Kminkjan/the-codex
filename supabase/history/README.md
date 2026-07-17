# Remote-only migration history

Verbatim copies (as fetched via `supabase migration fetch`) of migrations that exist in the **remote migration history** of prod (`nsemknuzupcnvctevgfd`) but cannot live in `supabase/migrations/` — see the version-collision notes in [../migrations/README.md](../migrations/README.md). These are records, not runnable chain members: the Supabase GitHub integration only scans `supabase/migrations/`, and everything here is already applied to prod.

- `0014_foi_last_seen_and_archive.sql` — prod's registered version 0014 (Fist-of-Ilmater last_seen corrections + arc archiving). The `supabase/migrations/0014_person_tier_status.sql` file shares that version number in-repo; only one file per version may exist in the scanned directory.
