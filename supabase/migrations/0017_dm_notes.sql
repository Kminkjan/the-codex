-- M5 Live Session Mode, PR 5 (issue #70).
-- DM-only notes: one nullable free-text `dm_notes` column on the 7 archivable
-- kinds AND sessions (per-session DM prep notes are natural; sessions still
-- get no archived/updated_at/hidden — permanent history, excluded per 0005).
-- One coarse field, no per-section permissions — the Roll20 "GM notes on
-- every object" shape.
-- V1 is client-gated only, like the hidden flag (0015): the client strips
-- dmNotes from the campaign projection for non-DM users; column-level RLS is
-- deferred to issue #73 (needs a separate table or a view — column grants
-- don't compose with `select *`). The 0003/0006 write policies are whole-row
-- gates and already cover the new column, and every table here is already in
-- the realtime publication — no index, policy, or publication work needed.

alter table public.people    add column if not exists dm_notes text;
alter table public.locations add column if not exists dm_notes text;
alter table public.quests    add column if not exists dm_notes text;
alter table public.goals     add column if not exists dm_notes text;
alter table public.factions  add column if not exists dm_notes text;
alter table public.items     add column if not exists dm_notes text;
alter table public.lore      add column if not exists dm_notes text;
alter table public.sessions  add column if not exists dm_notes text;
