-- Active session (issue #33): a shared, campaign-wide "we're live in session N"
-- pin, plus an appearance-history junction so people can be marked "seen" in a
-- session with one tap. `people.last_seen_session_id` becomes DERIVED from the
-- junction via a trigger, so the existing detail ribbon / cleanup panel / board
-- filter keep reading it unchanged.

-- 1. Shared pin. One active session per campaign, synced to every client via
--    realtime. Survives session deletion (set null).
alter table public.campaigns
  add column active_session_id text
  references public.sessions(id) on delete set null;

-- 2. Appearance history — the M:N junction (mirrors event_participants).
--    Composite PK, no client-side id; FKs cascade on session/person delete, so
--    deleteEntity needs NO app-side sweep for this table (unlike connections).
create table public.session_participants (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  session_id  text not null references public.sessions(id)  on delete cascade,
  person_id   text not null references public.people(id)    on delete cascade,
  primary key (session_id, person_id)
);
create index session_participants_campaign_idx on public.session_participants (campaign_id);
create index session_participants_person_idx on public.session_participants (person_id);

-- 3. RLS — open read, non-anonymous write (same claim-based gate as 0006).
--    Anonymous JWTs hold the `authenticated` role, so the is_anonymous claim is
--    the only reliable gate. Rows are insert/delete only (no update policy).
alter table public.session_participants enable row level security;

create policy "session_participants are readable by anyone"
  on public.session_participants for select
  using (true);

create policy "non-anonymous users can add session participants"
  on public.session_participants for insert
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "non-anonymous users can remove session participants"
  on public.session_participants for delete
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

-- 4. Derive people.last_seen_session_id = the highest-num session the person
--    participates in (NULL if none). The trigger fires AFTER insert/delete on
--    the junction and updates the people row, which in turn emits its OWN
--    realtime people UPDATE — that is how clients receive the recomputed
--    lastSeen without any extra client work. One "mark seen" therefore produces
--    two realtime events (a session_participants change + a people update);
--    that is intentional and cheap.
create or replace function public.recompute_last_seen(p_person_id text)
returns void language sql as $$
  update public.people p set last_seen_session_id = (
    select sp.session_id
    from public.session_participants sp
    join public.sessions s on s.id = sp.session_id
    where sp.person_id = p_person_id
    order by s.num desc
    limit 1
  )
  where p.id = p_person_id;
$$;

create or replace function public.session_participants_sync()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_last_seen(old.person_id);
    return old;
  else
    perform public.recompute_last_seen(new.person_id);
    return new;
  end if;
end;
$$;

create trigger trg_session_participants_sync
  after insert or delete on public.session_participants
  for each row execute function public.session_participants_sync();

-- 5. Realtime: the shared pin only syncs if the campaigns table is published,
--    and the roster only updates if the junction is. ALTER PUBLICATION ... ADD
--    TABLE errors if the table is already a member, so guard for re-runs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_participants'
  ) then
    alter publication supabase_realtime add table public.session_participants;
  end if;
end;
$$;
