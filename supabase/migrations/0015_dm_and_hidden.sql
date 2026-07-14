-- M5 Live Session Mode, PR 1 (issues #63 + #64).
-- DM role: one DM per campaign via campaigns.dm_user_id (nullable, assigned
-- manually through the dashboard/SQL — no assignment UI yet).
-- Hidden entities: a coarse party-wide `hidden` flag on the 7 archivable
-- kinds (sessions/arcs/events are permanent history, excluded per 0005).
-- V1 is client-gated only: the client filters hidden rows for non-DM users;
-- RLS enforcement via campaign_members is deferred (issue #73). The 0003/0006
-- write policies are whole-row gates and already cover the new columns, the
-- touch_updated_at triggers (0005) fire on any update, and campaigns is
-- already in the realtime publication (0013) — no other plumbing needed.

-- ==========================================================================
-- DM role
-- ==========================================================================

alter table public.campaigns
  add column if not exists dm_user_id text;

-- ==========================================================================
-- Hidden flag
-- ==========================================================================

alter table public.people    add column if not exists hidden boolean not null default false;
alter table public.locations add column if not exists hidden boolean not null default false;
alter table public.quests    add column if not exists hidden boolean not null default false;
alter table public.goals     add column if not exists hidden boolean not null default false;
alter table public.factions  add column if not exists hidden boolean not null default false;
alter table public.items     add column if not exists hidden boolean not null default false;
alter table public.lore      add column if not exists hidden boolean not null default false;

-- ==========================================================================
-- Partial indexes on the player-visible path (matches 0005's style)
-- ==========================================================================

create index if not exists idx_people_revealed    on public.people(campaign_id)    where hidden = false;
create index if not exists idx_locations_revealed on public.locations(campaign_id) where hidden = false;
create index if not exists idx_quests_revealed    on public.quests(campaign_id)    where hidden = false;
create index if not exists idx_goals_revealed     on public.goals(campaign_id)     where hidden = false;
create index if not exists idx_factions_revealed  on public.factions(campaign_id)  where hidden = false;
create index if not exists idx_items_revealed     on public.items(campaign_id)     where hidden = false;
create index if not exists idx_lore_revealed      on public.lore(campaign_id)      where hidden = false;
