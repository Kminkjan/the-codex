-- NPC tiers (major/supporting/background) and life status, for bulk rosters.
-- Both nullable: null tier reads as 'major' in the app; null status is "unset".
-- RLS from 0003/0006 already covers people; plain column adds need no policy.

alter table public.people
  add column if not exists tier   text,
  add column if not exists status text;

alter table public.people
  drop constraint if exists people_tier_check;
alter table public.people
  add constraint people_tier_check
    check (tier is null or tier in ('major', 'supporting', 'background'));

alter table public.people
  drop constraint if exists people_status_check;
alter table public.people
  add constraint people_status_check
    check (status is null or status in ('alive', 'dead', 'missing', 'unknown'));
