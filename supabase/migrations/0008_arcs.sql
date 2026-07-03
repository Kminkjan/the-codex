-- Issue #11: story arcs grouping sessions and quests.
create table public.arcs (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  title text not null,
  summary text,
  start_session_id text references public.sessions(id) on delete set null,
  end_session_id   text references public.sessions(id) on delete set null,
  order_num int not null default 0
);

-- Deleting an arc leaves its sessions/quests intact and unassigned.
alter table public.sessions add column if not exists arc_id text references public.arcs(id) on delete set null;
alter table public.quests   add column if not exists arc_id text references public.arcs(id) on delete set null;

alter table public.arcs enable row level security;

create policy "anon read arcs" on public.arcs
  for select to anon, authenticated using (true);

create policy "member write arcs" on public.arcs
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

alter publication supabase_realtime add table public.arcs;
