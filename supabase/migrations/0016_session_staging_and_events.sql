-- M5 Live Session Mode, PR 2 (issues #65 + #66): the session data layer.
--
-- session_staging — the DM's prep queue: hidden entities linked to a session,
-- each one click from live. Mirrors the session_participants junction (0013):
-- composite PK, campaign/session FKs cascade. entity_id is a cross-kind text
-- ref spanning seven tables (like connections.from_id/to_id) so it carries no
-- FK — deleteEntity sweeps it app-side. released_at is written by PR 3's
-- one-click release; staged rows with released_at null are "queued".
--
-- session_events — the append-only live feed (notes + reveals + start/end
-- brackets). One author per row, INSERT-only: no UPDATE/DELETE policies exist,
-- which is what makes the log append-only at the DB layer (the session-delete
-- FK cascade still wipes rows — cascades are system actions that bypass RLS).
-- This table is the persistent backing for every reveal notification: a toast
-- is never the only place a reveal lives, late joiners replay the feed.
--
-- Like 0015, DM-only visibility of staged rows is CLIENT-gated in V1: rows
-- transit realtime to every client including anonymous viewers (the central
-- projection strips them for non-DM users). RLS enforcement via
-- campaign_members is issue #73.

-- ==========================================================================
-- Staging queue
-- ==========================================================================

create table if not exists public.session_staging (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  session_id  text not null references public.sessions(id)  on delete cascade,
  entity_id   text not null,
  released_at timestamptz,
  primary key (session_id, entity_id)
);
create index if not exists session_staging_campaign_idx on public.session_staging (campaign_id);
create index if not exists session_staging_entity_idx on public.session_staging (entity_id);

alter table public.session_staging enable row level security;

drop policy if exists "session_staging is readable by anyone" on public.session_staging;
create policy "session_staging is readable by anyone"
  on public.session_staging for select
  using (true);

-- One whole-row write policy (0006 style) instead of per-command: staging
-- needs INSERT (stage), DELETE (unstage) and UPDATE (PR 3's release sets
-- released_at; the stage upsert's merge path also relies on it).
drop policy if exists "non-anonymous users can manage session staging" on public.session_staging;
create policy "non-anonymous users can manage session staging"
  on public.session_staging for all
  to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

-- ==========================================================================
-- Session feed
-- ==========================================================================

create table if not exists public.session_events (
  id          bigserial primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  session_id  text not null references public.sessions(id)  on delete cascade,
  type        text not null check (type in ('note', 'reveal', 'start', 'end')),
  author      text,
  entity_id   text,
  text        text,
  created_at  timestamptz not null default now()
);
create index if not exists session_events_campaign_idx on public.session_events (campaign_id);
create index if not exists session_events_session_idx on public.session_events (session_id, id);

alter table public.session_events enable row level security;

drop policy if exists "session_events are readable by anyone" on public.session_events;
create policy "session_events are readable by anyone"
  on public.session_events for select
  using (true);

drop policy if exists "non-anonymous users can append session events" on public.session_events;
create policy "non-anonymous users can append session events"
  on public.session_events for insert
  to authenticated
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

-- ==========================================================================
-- Realtime: both tables must be published or nothing syncs. Guarded for
-- re-runs (ALTER PUBLICATION ... ADD TABLE errors on duplicates).
-- ==========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_staging'
  ) then
    alter publication supabase_realtime add table public.session_staging;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_events'
  ) then
    alter publication supabase_realtime add table public.session_events;
  end if;
end;
$$;
