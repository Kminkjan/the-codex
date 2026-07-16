-- M5 Live Session Mode, V2 (issue #73), part 2 of 2.
-- 0018 copied every dm_notes value into the DM-only public.dm_notes side
-- table and NULLed the source columns (closing the read leak while keeping
-- the schema reversible). Apply this ONLY after the client built against
-- 0018 is deployed and verified — the old client still reads/writes these
-- columns for the DM's notes editor.
--
-- Down-path before this is applied: repopulate the columns from
-- public.dm_notes and drop the side table.

alter table public.people    drop column if exists dm_notes;
alter table public.locations drop column if exists dm_notes;
alter table public.quests    drop column if exists dm_notes;
alter table public.goals     drop column if exists dm_notes;
alter table public.factions  drop column if exists dm_notes;
alter table public.items     drop column if exists dm_notes;
alter table public.lore      drop column if exists dm_notes;
alter table public.sessions  drop column if exists dm_notes;
