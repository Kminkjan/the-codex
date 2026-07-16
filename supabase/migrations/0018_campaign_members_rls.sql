-- ===========================================================================
-- M5 Live Session Mode, V2 (issue #73): RLS-enforced hiding via
-- campaign_members. V1 secrecy (0015-0017) was client-gated: hidden rows,
-- the staging queue, and dm_notes all travel to every client and the client
-- projection strips them. This migration makes secrecy real at the DB layer:
-- a player client's network traffic never contains hidden rows or DM notes.
--
-- Design, verified empirically against a local Supabase stack (spike output
-- in the PR): Realtime postgres_changes authorizes every event against each
-- subscriber's SELECT policies at event time, checked against the NEW row —
-- so flipping hidden=false delivers the full-row UPDATE to player clients
-- that couldn't see the row before. That is what keeps one-click release
-- (0016/PR #78) round-tripping through realtime under RLS.
--
-- Pieces:
--   1. campaign_members(campaign_id, user_id, role dm|player) — supersedes
--      campaigns.dm_user_id (kept populated so pre-deploy clients keep
--      working; the new client reads membership instead). Seeded from
--      dm_user_id. Writes are dashboard/service-role only, like dm_user_id.
--   2. is_campaign_dm() / entity_hidden() helper functions. Both SECURITY
--      DEFINER: entity_hidden MUST be — with invoker rights the new SELECT
--      policies would make hidden rows invisible to its own subqueries,
--      returning NULL, and `not entity_hidden(x)` would read as visible.
--   3. dm_notes side table with DM-only read/write. Column-level privacy
--      can't be done with column grants (they don't compose with the app's
--      `select *`), so the 8 dm_notes columns (0017) are copied here and
--      NULLed. Migration 0019 drops them after the client deploy is
--      verified — NULL-then-drop keeps this step reversible.
--   4. Hidden-gated SELECT policies on the 7 entity tables:
--      hidden = false OR requester is the campaign's DM. Anonymous viewers
--      keep seeing everything non-hidden (first read-gating in the app).
--   5. Replacement write policies. CRITICAL: permissive policies OR
--      together per command, and a FOR ALL policy's USING clause counts
--      toward SELECT — the 0006 `for all using (nonanon)` write policies
--      would let any signed-in editor read hidden rows straight past the
--      new select policies. So every gated table's write policy is
--      replaced: entity tables get hidden-aware FOR ALL policies (editors
--      can't see, touch, delete, or unhide hidden rows; only the DM can),
--      connections/board_positions get per-command write policies (which
--      never count toward SELECT).
--   6. connections + board_positions SELECT gated on the hidden-ness of
--      the entities they reference (labels like "secretly serves" are
--      spoiler content). session_staging becomes DM-only outright. The
--      session_events INSERT policy restricts reveal/start/end to the DM;
--      editors keep posting notes.
--
-- Understood exceptions (leak inventory — all metadata-only, no content):
--   * DELETE events are never RLS-filtered by Realtime and carry only the
--     PK: an unstage leaks (session_id, entity_id), a dm_notes delete leaks
--     (campaign_id, entity_id). Opaque ids; the rows themselves stay
--     unreadable.
--   * event_participants / session_participants stay open-read: they can
--     reference a hidden person, leaking an opaque person id only.
--   * party_notes stay open-read: a party note on a hidden entity is only
--     writable through the DM's own UI — DM error, not an attack path.
--   * session_events stay open-read: a reveal row for a later re-hidden
--     entity keeps its text (entity label). Re-hide is off-doctrine
--     (reveal-forward, 0016) but the detail-sheet hide toggle exists; the
--     client projection still strips these for display. Related realtime
--     caveat: a re-hide UPDATE is invisible to player subscribers (RLS
--     filters it), so their in-memory copy lingers until reload.
--   * Per-campaign WRITE scoping (any editor can write any campaign) is
--     unchanged — split into its own follow-up per issue #73.
--
-- Advisor notes: helpers pin search_path; the is_anonymous claim checks are
-- wrapped in scalar subqueries for initplan caching. rls_policy heuristics
-- may still flag the claim-based halves, as with 0006 — by design.
--
-- Rollout: apply this, then deploy the client built against it,
-- back-to-back (not on a session night). Gap behavior on the old client:
-- players simply stop receiving hidden rows (the projection no-ops); the
-- DM's dm-notes editor reads/writes the NULLed columns until the deploy.
-- Then verify, then apply 0019 (drops the dm_notes columns).
-- ===========================================================================

-- ==========================================================================
-- 1. campaign_members
-- ==========================================================================

create table if not exists public.campaign_members (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('dm', 'player')),
  primary key (campaign_id, user_id)
);

-- Older projects have default privileges that cover new tables; newer
-- Supabase stacks don't auto-grant to anon/authenticated. Explicit is safe
-- on both (verified necessary on the spike stack).
grant select on public.campaign_members to anon, authenticated;

alter table public.campaign_members enable row level security;

drop policy if exists "campaign_members are readable by anyone" on public.campaign_members;
create policy "campaign_members are readable by anyone"
  on public.campaign_members for select
  to anon, authenticated
  using (true);
-- No write policies: membership is managed via dashboard/SQL (service
-- role), exactly like campaigns.dm_user_id was. RLS-enabled + no policy =
-- deny-all for client roles.

-- Seed the DM rows from campaigns.dm_user_id (text, so guard the cast).
insert into public.campaign_members (campaign_id, user_id, role)
select id, dm_user_id::uuid, 'dm'
from public.campaigns
where dm_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (campaign_id, user_id) do update set role = 'dm';

do $$
declare
  src bigint;
  dst bigint;
begin
  select count(*) into src from public.campaigns
    where dm_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  select count(*) into dst from public.campaign_members where role = 'dm';
  if dst < src then
    raise exception 'campaign_members seed incomplete: % dm rows for % campaigns with a dm_user_id', dst, src;
  end if;
end;
$$;

-- ==========================================================================
-- 2. Helpers
-- ==========================================================================

create or replace function public.is_campaign_dm(cid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members m
    where m.campaign_id = cid
      and m.user_id = auth.uid()
      and m.role = 'dm'
  );
$$;

-- Cross-kind hidden lookup for reference tables (connections/board). The
-- id may belong to sessions/arcs/events, which have no hidden column and
-- miss all seven lookups — coalesce(..., false) keeps those visible (NULL
-- in a USING clause would deny, vanishing every session-linked connection).
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
    false
  );
$$;

grant execute on function public.is_campaign_dm(text) to anon, authenticated;
grant execute on function public.entity_hidden(text) to anon, authenticated;

-- ==========================================================================
-- 3. dm_notes side table (+ copy, + NULL the source columns)
-- ==========================================================================

create table if not exists public.dm_notes (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  entity_id   text not null,  -- cross-kind ref (7 kinds + sessions), no FK
  text        text,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, entity_id)
);

grant select, insert, update, delete on public.dm_notes to authenticated;

drop trigger if exists tg_dm_notes_touch on public.dm_notes;
create trigger tg_dm_notes_touch
  before update on public.dm_notes
  for each row execute function public.touch_updated_at();

alter table public.dm_notes enable row level security;

drop policy if exists "dm reads dm_notes" on public.dm_notes;
create policy "dm reads dm_notes"
  on public.dm_notes for select
  to authenticated
  using (public.is_campaign_dm(campaign_id));

drop policy if exists "dm writes dm_notes" on public.dm_notes;
create policy "dm writes dm_notes"
  on public.dm_notes for all
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id));

-- Copy, assert, then close the read leak by NULLing (0019 drops the
-- columns once the deployed client is verified).
insert into public.dm_notes (campaign_id, entity_id, text)
select campaign_id, id, dm_notes from public.people    where dm_notes is not null union all
select campaign_id, id, dm_notes from public.locations where dm_notes is not null union all
select campaign_id, id, dm_notes from public.quests    where dm_notes is not null union all
select campaign_id, id, dm_notes from public.goals     where dm_notes is not null union all
select campaign_id, id, dm_notes from public.factions  where dm_notes is not null union all
select campaign_id, id, dm_notes from public.items     where dm_notes is not null union all
select campaign_id, id, dm_notes from public.lore      where dm_notes is not null union all
select campaign_id, id, dm_notes from public.sessions  where dm_notes is not null
on conflict (campaign_id, entity_id) do nothing;

do $$
declare
  src bigint;
  dst bigint;
begin
  select (select count(*) from public.people    where dm_notes is not null)
       + (select count(*) from public.locations where dm_notes is not null)
       + (select count(*) from public.quests    where dm_notes is not null)
       + (select count(*) from public.goals     where dm_notes is not null)
       + (select count(*) from public.factions  where dm_notes is not null)
       + (select count(*) from public.items     where dm_notes is not null)
       + (select count(*) from public.lore      where dm_notes is not null)
       + (select count(*) from public.sessions  where dm_notes is not null)
    into src;
  select count(*) into dst from public.dm_notes;
  if dst < src then
    raise exception 'dm_notes copy incomplete: % side-table rows for % source notes', dst, src;
  end if;
end;
$$;

update public.people    set dm_notes = null where dm_notes is not null;
update public.locations set dm_notes = null where dm_notes is not null;
update public.quests    set dm_notes = null where dm_notes is not null;
update public.goals     set dm_notes = null where dm_notes is not null;
update public.factions  set dm_notes = null where dm_notes is not null;
update public.items     set dm_notes = null where dm_notes is not null;
update public.lore      set dm_notes = null where dm_notes is not null;
update public.sessions  set dm_notes = null where dm_notes is not null;

-- Realtime publication (guarded, 0016 pattern).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_notes'
  ) then
    alter publication supabase_realtime add table public.dm_notes;
  end if;
end;
$$;

-- ==========================================================================
-- 4 + 5. The 7 entity tables: hidden-gated SELECT, hidden-aware writes
-- ==========================================================================
-- Write-policy truth table (FOR ALL: SELECT/DELETE check USING, INSERT
-- checks WITH CHECK, UPDATE checks USING on the old row and WITH CHECK on
-- the new): a non-DM editor can't target a hidden row (USING fails: no
-- blind update/delete), can't set hidden=true (WITH CHECK fails on the new
-- row), can't insert hidden rows; the DM can do all of it. `hidden` is
-- NOT NULL so the comparisons never NULL out.

drop policy if exists "anon read people" on public.people;
create policy "visible or dm read people" on public.people
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write people" on public.people;
create policy "member write people" on public.people
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read locations" on public.locations;
create policy "visible or dm read locations" on public.locations
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write locations" on public.locations;
create policy "member write locations" on public.locations
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read quests" on public.quests;
create policy "visible or dm read quests" on public.quests
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write quests" on public.quests;
create policy "member write quests" on public.quests
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read goals" on public.goals;
create policy "visible or dm read goals" on public.goals
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write goals" on public.goals;
create policy "member write goals" on public.goals
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read factions" on public.factions;
create policy "visible or dm read factions" on public.factions
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write factions" on public.factions;
create policy "member write factions" on public.factions
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read items" on public.items;
create policy "visible or dm read items" on public.items
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write items" on public.items;
create policy "member write items" on public.items
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "anon read lore" on public.lore;
create policy "visible or dm read lore" on public.lore
  for select to anon, authenticated
  using (hidden = false or public.is_campaign_dm(campaign_id));
drop policy if exists "member write lore" on public.lore;
create policy "member write lore" on public.lore
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and (hidden = false or public.is_campaign_dm(campaign_id)));

-- ==========================================================================
-- 6. Reference tables
-- ==========================================================================

-- connections: an edge to a hidden entity leaks its existence and the label
-- ("secretly serves"). Gate on both endpoints. Writes become per-command
-- policies so their clauses stop counting toward SELECT visibility.
drop policy if exists "anon read connections" on public.connections;
create policy "visible or dm read connections" on public.connections
  for select to anon, authenticated
  using (
    public.is_campaign_dm(campaign_id)
    or (not public.entity_hidden(from_id) and not public.entity_hidden(to_id))
  );
drop policy if exists "member write connections" on public.connections;
drop policy if exists "member insert connections" on public.connections;
create policy "member insert connections" on public.connections
  for insert to authenticated
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);
drop policy if exists "member update connections" on public.connections;
create policy "member update connections" on public.connections
  for update to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);
drop policy if exists "member delete connections" on public.connections;
create policy "member delete connections" on public.connections
  for delete to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);

-- board_positions: a hidden entity's pin leaks its existence.
drop policy if exists "anon read board_positions" on public.board_positions;
create policy "visible or dm read board_positions" on public.board_positions
  for select to anon, authenticated
  using (
    public.is_campaign_dm(campaign_id)
    or not public.entity_hidden(entity_id)
  );
drop policy if exists "member write board_positions" on public.board_positions;
drop policy if exists "member insert board_positions" on public.board_positions;
create policy "member insert board_positions" on public.board_positions
  for insert to authenticated
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);
drop policy if exists "member update board_positions" on public.board_positions;
create policy "member update board_positions" on public.board_positions
  for update to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);
drop policy if exists "member delete board_positions" on public.board_positions;
create policy "member delete board_positions" on public.board_positions
  for delete to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true);

-- ==========================================================================
-- 7. session_staging: the DM's prep queue is DM-only, read and write
--    (replaces 0016's editor-wide FOR ALL, which also leaked SELECT).
-- ==========================================================================

drop policy if exists "session_staging is readable by anyone" on public.session_staging;
drop policy if exists "non-anonymous users can manage session staging" on public.session_staging;
drop policy if exists "dm manages session_staging" on public.session_staging;
create policy "dm manages session_staging"
  on public.session_staging for all
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id));

-- ==========================================================================
-- 8. session_events: feed stays readable by anyone; notes stay open to
--    editors; reveal/start/end become DM-only.
-- ==========================================================================

drop policy if exists "non-anonymous users can append session events" on public.session_events;
create policy "non-anonymous users can append session events"
  on public.session_events for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and (type = 'note' or public.is_campaign_dm(campaign_id))
  );
