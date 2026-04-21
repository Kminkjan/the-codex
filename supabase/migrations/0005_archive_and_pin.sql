-- Clutter management for large campaigns.
-- Adds archived/pinned flags and a tracked updated_at to every mutable entity
-- table (sessions are permanent history and intentionally excluded).

-- ==========================================================================
-- Columns
-- ==========================================================================

alter table public.people
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.locations
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.factions
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.items
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.quests
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.goals
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.lore
  add column if not exists archived   boolean     not null default false,
  add column if not exists pinned     boolean     not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- ==========================================================================
-- updated_at trigger
-- ==========================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tg_people_touch    on public.people;
drop trigger if exists tg_locations_touch on public.locations;
drop trigger if exists tg_factions_touch  on public.factions;
drop trigger if exists tg_items_touch     on public.items;
drop trigger if exists tg_quests_touch    on public.quests;
drop trigger if exists tg_goals_touch     on public.goals;
drop trigger if exists tg_lore_touch      on public.lore;

create trigger tg_people_touch    before update on public.people    for each row execute function public.touch_updated_at();
create trigger tg_locations_touch before update on public.locations for each row execute function public.touch_updated_at();
create trigger tg_factions_touch  before update on public.factions  for each row execute function public.touch_updated_at();
create trigger tg_items_touch     before update on public.items     for each row execute function public.touch_updated_at();
create trigger tg_quests_touch    before update on public.quests    for each row execute function public.touch_updated_at();
create trigger tg_goals_touch     before update on public.goals     for each row execute function public.touch_updated_at();
create trigger tg_lore_touch      before update on public.lore      for each row execute function public.touch_updated_at();

-- ==========================================================================
-- Partial indexes on the hot "active, not archived" filter path
-- ==========================================================================

create index if not exists idx_people_active    on public.people(campaign_id)    where archived = false;
create index if not exists idx_locations_active on public.locations(campaign_id) where archived = false;
create index if not exists idx_factions_active  on public.factions(campaign_id)  where archived = false;
create index if not exists idx_items_active     on public.items(campaign_id)     where archived = false;
create index if not exists idx_quests_active    on public.quests(campaign_id)    where archived = false;
create index if not exists idx_goals_active     on public.goals(campaign_id)     where archived = false;
create index if not exists idx_lore_active      on public.lore(campaign_id)      where archived = false;
