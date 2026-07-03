-- Issue #12: events as a first-class timeline primitive.
-- in_game_date is free-form text, so chronology comes from order_num.
create table public.events (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  title text not null,
  summary text,
  in_game_date text,
  session_id  text references public.sessions(id)  on delete set null,
  location_id text references public.locations(id) on delete set null,
  order_num int not null default 0
);

-- campaign_id is denormalized onto the junction so the client's
-- campaign_id-filtered realtime channel and scoped refetch work.
create table public.event_participants (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  event_id  text not null references public.events(id) on delete cascade,
  person_id text not null references public.people(id) on delete cascade,
  primary key (event_id, person_id)
);

alter table public.events             enable row level security;
alter table public.event_participants enable row level security;

create policy "anon read events" on public.events
  for select to anon, authenticated using (true);
create policy "anon read event_participants" on public.event_participants
  for select to anon, authenticated using (true);

create policy "member write events" on public.events
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
create policy "member write event_participants" on public.event_participants
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

alter publication supabase_realtime add table public.events, public.event_participants;
