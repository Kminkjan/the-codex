-- 0032: party-note provenance + `annotate` session events
--
-- Issue #127, the direct follow-up to 0031. A party note written on an entity's
-- detail sheet during a live session should leave a row in the session feed —
-- annotating an NPC as the scene happens is a more common table action than
-- drawing a string, and today it lands in party_notes and never reaches the
-- night's record.
--
-- Cheaper than 0031 was: party_notes has carried `created_at` since 0001 and
-- the initial select already orders by it, so the only missing fact is WHICH
-- SESSION the note was written in. Same doctrine as 0031 either way — the fact
-- gets recorded, not reconstructed. Inferring session membership from
-- created_at falling between the start and end markers breaks on a session
-- with no end marker and cannot tell "written at the table" from "written the
-- next morning".

-- ==========================================================================
-- 1. party_notes: which session
-- ==========================================================================

-- NULL means the note was written outside a session — a fact about the note,
-- not missing data (same reading as connections.session_id).
-- on delete set null: losing a session must not take its notes with it.
--
-- No created_at work here: 0001 already has it, nullable with a default, which
-- is exactly the shape 0031 had to construct by hand.
--
-- Deliberately WRITE-ONLY for now. Nothing client-side reads it — mapPartyNoteRow
-- drops it, as it already drops id and created_at. It is recorded so that
-- "the notes from session 8" becomes a pure-UI change later rather than another
-- migration, which is the same reason 0031 stamped provenance it had no
-- immediate reader for.
alter table public.party_notes add column if not exists session_id text
  references public.sessions(id) on delete set null;

create index if not exists party_notes_session_idx
  on public.party_notes (campaign_id, session_id);

-- ==========================================================================
-- 2. session_events: the `annotate` type and a label snapshot
-- ==========================================================================

-- An annotate row shows an excerpt of the note, so `text` is taken — and it
-- still needs the reveal branch's fallback, a snapshot of the entity's label,
-- so a note on a later-struck entity keeps reading "a note on Maerwyn" instead
-- of "a note on something struck from the codex". That snapshot gets a real
-- column rather than being packed into `text` alongside the excerpt: 0031 made
-- the same call for entity_id_b, and the SHOW_MARK comment in src/data.ts
-- documents what one data-as-flag field already cost in renderer discipline.
--
-- Nullable, no backfill: pre-0032 rows honestly read NULL and their renderers
-- fall through to the stock phrase.
alter table public.session_events add column if not exists entity_label text;

-- Dropped by lookup rather than by name, carried over verbatim from 0031. The
-- constraint 0031 left behind DOES have a name we chose, but the lookup matches
-- it either way and stays correct if some other hand renamed it; asserting a
-- name risks a silent no-op drop that would leave the old constraint rejecting
-- 'annotate' at runtime instead of failing here. Re-running this block is safe.
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
  check (type in ('note', 'reveal', 'start', 'end', 'link', 'annotate'));

-- ==========================================================================
-- 3. RLS: any member may announce a note they were already allowed to leave
-- ==========================================================================

-- The trap 0031 hit, in exactly the same shape. The member side of this policy
-- is an allow-list of types (0018 made reveal/start/end the DM's ceremony), but
-- `party_notes` INSERT is open to ANY non-anonymous campaign member (0023, FOR
-- ALL, no DM check). Without adding 'annotate' here, a non-DM editor leaving a
-- note would have the note succeed and the accompanying event rejected with
-- 42501 — a "that change wasn't saved" toast for a write that saved.
-- reveal/start/end unchanged.
drop policy if exists "non-anonymous users can append session events" on public.session_events;
create policy "non-anonymous users can append session events"
  on public.session_events for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_member(campaign_id)
    and (type in ('note', 'link', 'annotate') or public.is_campaign_dm(campaign_id))
  );

-- No realtime work: party_notes (0001) and session_events (0016) are already
-- members of the supabase_realtime publication, and neither a new column nor a
-- new `type` value changes that.
--
-- No read-policy work either, and that is a decision rather than an omission.
-- An annotate row on a hidden entity is kept off players by the client
-- projection (projectCampaignForViewers already filters sessionEvents on
-- entity_id), not by RLS — same as every other session_events row, and the
-- 0018 leak inventory records both session_events and party_notes as
-- deliberately open-read.
