-- ===========================================================================
-- Session attendance: who was at the table.
--
-- Deliberately NOT session_participants (0013). That junction is the
-- *appearance* record — who was seen in the fiction — and three things read it
-- as such: the recompute_last_seen trigger feeds people.last_seen_session_id
-- from it, sagaScope() treats it as cast reachability, and the board/sheet
-- "+ Seen this session" taps write it incidentally during play. Attendance is a
-- different fact, asserted deliberately about the party: a PC can be seen in a
-- session their player missed (someone else ran them), and a player can sit at
-- the table all night while their character is off-screen. Overloading 0013
-- would make "absent" unrepresentable and would let an attendance edit silently
-- rewrite a person's last-seen history.
--
-- Character-anchored (person_id), not account-anchored (auth.users). The
-- deciding constraint is the same one 0030's header records: the Fist of Ilmater
-- import has PCs whose players will never hold an account, so a user-anchored
-- table could not hold 190 chapters of history. The human is one hop away via
-- people.player_user_id when a stat wants it. person_id also carries no
-- is_pc CHECK — a guest character sitting in for one night is attendance, and
-- an ex-PC keeps the sessions they attended (see the client's roster union).
--
-- Present-only rows, no status column: absent is the absence of a row. That
-- leaves one ambiguity worth closing — "nobody came" vs "nobody recorded it" —
-- so sessions.attendance_taken_at is stamped the first time any row is written
-- for that session. Stamped by trigger rather than by the client because the
-- client's writes are fire-and-forget with no transaction around them, and a
-- dropped second write would leave the sheet reading "not recorded" over rows
-- that exist. Deleting every row does NOT clear the stamp: "we took attendance
-- and nobody came" is a real (if rare) state, and the stamp is what says so.
--
-- One attendance tap therefore produces two realtime events (an attendance
-- change plus the sessions UPDATE from the stamp) exactly as 0013's does. That
-- is intentional and cheap.
--
-- RLS follows the 0023 standard for campaign-scoped junctions: open read,
-- claim + is_campaign_member() write. No entity_hidden() gating (0018) —
-- session_participants doesn't have it either, and the client projection
-- strips hidden ids from both maps for the player view.
-- ===========================================================================

alter table public.sessions
  add column if not exists attendance_taken_at timestamptz;

create table if not exists public.session_attendance (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  session_id  text not null references public.sessions(id)  on delete cascade,
  person_id   text not null references public.people(id)    on delete cascade,
  -- Provenance, same shape as 0031/0032: a display name, not a uuid, because
  -- that is what the sheet shows and it must survive the account going away.
  recorded_by text,
  recorded_at timestamptz not null default now(),
  primary key (session_id, person_id)
);
create index if not exists session_attendance_campaign_idx on public.session_attendance (campaign_id);
-- Partial-free on purpose: "how many sessions has this character attended" is
-- the query this index exists for, and every row qualifies.
create index if not exists session_attendance_person_idx on public.session_attendance (person_id);

alter table public.session_attendance enable row level security;

drop policy if exists "session_attendance is readable by anyone" on public.session_attendance;
create policy "session_attendance is readable by anyone"
  on public.session_attendance for select
  using (true);

-- Insert + delete only (a row carries no mutable state), so one FOR ALL policy
-- rather than the 0013-era pair. Its USING half contributes nothing to SELECT
-- that the open read policy doesn't already grant — policies OR per command.
drop policy if exists "member write session_attendance" on public.session_attendance;
create policy "member write session_attendance"
  on public.session_attendance for all
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

-- ==========================================================================
-- "Attendance was taken" stamp
-- ==========================================================================
-- Invoker rights, like 0013's recompute_last_seen and unlike the membership
-- RPCs: the UPDATE lands through the caller's own "member write sessions"
-- policy (0023). That is the property worth keeping — the stamp succeeds in
-- exactly the cases the INSERT above already succeeded in, and it can never
-- become a way to write sessions rows a caller couldn't otherwise write.
--
-- `is null` guard: the stamp records the first time attendance was taken for
-- the chapter, so later corrections don't move it, and an unchanged row emits
-- no realtime UPDATE.
create or replace function public.session_attendance_stamp()
returns trigger language plpgsql as $$
begin
  update public.sessions s
     set attendance_taken_at = now()
   where s.id = new.session_id
     and s.attendance_taken_at is null;
  return new;
end;
$$;

drop trigger if exists trg_session_attendance_stamp on public.session_attendance;
create trigger trg_session_attendance_stamp
  after insert on public.session_attendance
  for each row execute function public.session_attendance_stamp();

-- ==========================================================================
-- Realtime: nothing syncs unless the table is published. Guarded for re-runs
-- (ALTER PUBLICATION ... ADD TABLE errors on duplicates). `sessions` is
-- already published, which is what carries the stamp to other clients.
-- ==========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_attendance'
  ) then
    alter publication supabase_realtime add table public.session_attendance;
  end if;
end;
$$;
