-- ===========================================================================
-- The Bestiary: a `monsters` entity kind whose reason for existing is artwork
-- and notes. An eighth archivable kind, so it joins every layer the other
-- seven already have — nothing here is new machinery, it's the established
-- shape applied once more:
--
--   * Columns follow the locations/items convention: `kind` is the free-text
--     creature type ("aberration", "undead"), "desc" is the long body,
--     image_url is the plate, notes is the party's record. `threat` and
--     `habitat` are the bestiary's own two fields. DM-only prep notes need
--     nothing here — dm_notes (0018) is a cross-kind side table.
--   * archived / pinned / hidden / updated_at + the touch trigger (0005/0015),
--     with the same two partial indexes on the hot filter paths.
--   * RLS in the 0023 shape: hidden-gated SELECT, and a FOR ALL write policy
--     carrying the full claim + membership + hidden truth table verbatim (a
--     non-DM editor can't target, unhide, or insert a hidden row).
--   * Realtime publication, guarded like 0016/0018.
--
-- The one edit to existing objects: entity_hidden() (0018) must learn about
-- monsters. It backs the connections / board_positions SELECT policies, and a
-- kind missing from its coalesce chain falls through to `false` — a hidden
-- monster's yarn and board pin would stay visible to players even though the
-- monster itself is filtered. Replacing the function is enough; the policies
-- that call it are unchanged.
--
-- Rollout: safe to apply before the client deploy. An old client simply never
-- selects the table.
-- ===========================================================================

-- ==========================================================================
-- 1. Table
-- ==========================================================================

create table if not exists public.monsters (
  id          text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name        text not null,
  kind        text,          -- creature type, free text (cf. locations.kind)
  threat      text,          -- 'harmless' | 'risky' | 'deadly' | 'legendary'
  habitat     text,
  "desc"      text,
  image_url   text,
  notes       text,
  archived    boolean     not null default false,
  pinned      boolean     not null default false,
  hidden      boolean     not null default false,
  updated_at  timestamptz not null default now()
);

-- Newer Supabase stacks don't auto-grant to anon/authenticated for new tables
-- (see 0018's note on campaign_members) — explicit is safe on both.
grant select on public.monsters to anon;
grant select, insert, update, delete on public.monsters to authenticated;

-- ==========================================================================
-- 2. updated_at trigger (0005) + partial indexes
-- ==========================================================================

drop trigger if exists tg_monsters_touch on public.monsters;
create trigger tg_monsters_touch
  before update on public.monsters
  for each row execute function public.touch_updated_at();

create index if not exists idx_monsters_active   on public.monsters(campaign_id) where archived = false;
create index if not exists idx_monsters_revealed on public.monsters(campaign_id) where hidden = false;

-- ==========================================================================
-- 3. RLS: hidden-gated read, claim + membership + hidden-aware write
--    (0018 §4-5 truth table, 0023 membership gate)
-- ==========================================================================

alter table public.monsters enable row level security;

drop policy if exists "visible or dm read monsters" on public.monsters;
create policy "visible or dm read monsters" on public.monsters
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));

drop policy if exists "member write monsters" on public.monsters;
create policy "member write monsters" on public.monsters
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

-- ==========================================================================
-- 4. entity_hidden(): add the monsters lookup (see the header)
-- ==========================================================================

create or replace function public.entity_hidden(eid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select hidden from public.people    where id = eid),
    (select hidden from public.locations where id = eid),
    (select hidden from public.quests    where id = eid),
    (select hidden from public.goals     where id = eid),
    (select hidden from public.factions  where id = eid),
    (select hidden from public.items     where id = eid),
    (select hidden from public.lore      where id = eid),
    (select hidden from public.monsters  where id = eid),
    false
  );
$$;

grant execute on function public.entity_hidden(text) to anon, authenticated;

-- ==========================================================================
-- 5. Realtime publication (guarded, 0016/0018 pattern)
-- ==========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monsters'
  ) then
    alter publication supabase_realtime add table public.monsters;
  end if;
end;
$$;
