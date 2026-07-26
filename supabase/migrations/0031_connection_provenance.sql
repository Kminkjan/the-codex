-- 0031: connection provenance + `link` session events
--
-- Two halves of one feature: drawing a string during a live session should
-- leave a row in the session feed, and a connection row should remember when,
-- where and by whom it was drawn.
--
-- Until now `connections` was (id, campaign_id, from_id, to_id, label) — no
-- timestamp at all, which is why deleteConnectionBetween has to match BOTH
-- orientations: with no ordering, which row of a mirrored pair survives a
-- dedupe isn't deterministic (see the comment at src/mutations.ts:195).

-- ==========================================================================
-- 1. connections: when / where / who
-- ==========================================================================

-- created_at is added NULLABLE and only THEN given a default, deliberately.
-- Adding a column with `not null default now()` would backfill every existing
-- row with the migration's run time — the whole seeded back-catalogue from
-- 0011/0012 would claim it was drawn today. Adding the default afterwards does
-- not rewrite existing rows, so historic strings honestly read NULL
-- ("unknown") and only new inserts get a real timestamp.
alter table public.connections add column if not exists created_at timestamptz;
alter table public.connections alter column created_at set default now();

-- The session the string was drawn in, when one was live. NULL means it was
-- drawn during prep, which is a meaningful distinction, not missing data.
-- on delete set null: losing a session must not take its connections with it.
alter table public.connections add column if not exists session_id text
  references public.sessions(id) on delete set null;

-- Display name of whoever drew it, same signing as party_notes.author.
alter table public.connections add column if not exists author text;

create index if not exists connections_session_idx
  on public.connections (campaign_id, session_id);

-- ==========================================================================
-- 2. session_events: the `link` type and a second endpoint
-- ==========================================================================

-- A link has two endpoints and the table had one entity_id slot. The far
-- endpoint gets a real column rather than being encoded into `text`: the
-- viewer projection has to filter on BOTH ends (a re-hidden entity must not
-- leak back through an old link row), and src/data.ts:239-244 already
-- documents what the SHOW_MARK sentinel cost us in renderer discipline.
alter table public.session_events add column if not exists entity_id_b text;

-- The CHECK is dropped by lookup rather than by name. The 0016 constraint was
-- created inline (`type text not null check (...)`), so its name is
-- Postgres-generated; asserting a name we didn't choose risks a silent no-op
-- drop, which would leave the old constraint rejecting 'link' at runtime
-- instead of failing here. Re-running this block is safe.
do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.session_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%reveal%';
  if cname is not null then
    execute format('alter table public.session_events drop constraint %I', cname);
  end if;
end $$;

alter table public.session_events
  add constraint session_events_type_check
  check (type in ('note', 'reveal', 'start', 'end', 'link'));

-- ==========================================================================
-- 3. RLS: any member may announce a string they were already allowed to draw
-- ==========================================================================

-- The 0018/0023 policy restricted non-DM members to type = 'note', so that
-- reveal/start/end stay the DM's ceremony. But `connections` INSERT is open to
-- ANY non-anonymous member (0018), so without this a non-DM editor drawing a
-- string would have the connection succeed and the accompanying link event
-- rejected with 42501 — a write-error toast for a write that worked.
-- 'link' therefore joins 'note' on the member side; reveal/start/end unchanged.
drop policy if exists "non-anonymous users can append session events" on public.session_events;
create policy "non-anonymous users can append session events"
  on public.session_events for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_member(campaign_id)
    and (type in ('note', 'link') or public.is_campaign_dm(campaign_id))
  );

-- No realtime work: session_events and connections are already members of the
-- supabase_realtime publication (0016), and neither a new column nor a new
-- `type` value changes that.
