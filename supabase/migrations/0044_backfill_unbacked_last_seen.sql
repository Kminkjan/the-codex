-- ===========================================================================
-- Back the last-seen pointers that no junction row supports.
--
-- `people.last_seen_session_id` is DERIVED: 0013's recompute_last_seen trigger
-- sets it to the highest-num session in `session_participants` for that person.
-- A seed that writes the column by hand and leaves the junction empty produces
-- a value that looks right and is unstable — the first junction write for that
-- person recomputes the pointer from a junction holding only the row just
-- created. This directory's README has warned about it since 0029 and every
-- seed here did it anyway; 0029 fixed Fendwick, and this migration finishes the
-- job for everyone else (36 people at time of writing, all Fist of Ilmater,
-- hand-written by 0011/0012).
--
-- WHY NOW. Until now the hazard was survivable, because the only writer was the
-- app's "+ Seen this session" tap, which always writes the LIVE session — so a
-- collapse could only move a pointer forward, which is defensible. The Cast
-- register that follows this migration lets a DM record appearances for any
-- chapter, including old ones. Backfill "chapter 12" for someone whose ribbon
-- says 187 and, unbacked, their pointer would jump back 175 chapters: they drop
-- into the cleanup panel's archive suggestions and lose carriesForward in the
-- saga wizard. There is no error. It looks exactly like the feature working.
--
-- That silence is also why this migration ships and is verified BEFORE the
-- client change. It adds no schema, so the usual protection does not apply:
-- there is no 16-table fetchCampaign select to fail loudly (0040's note) — a
-- client deployed ahead of this works perfectly, right up until it corrupts.
--
-- WHAT IT ASSERTS. For each person with a pointer and NO junction rows, one row
-- (their pointer's own session). The trigger then recomputes that pointer to
-- the value it already had, so nothing visible changes — the value simply
-- becomes real. This is not inference: the row asserts exactly what the column
-- already claimed. 0029 used the same trick for the same reason.
--
-- The predicate is "no junction rows AT ALL", not "no row for this session".
-- Someone who already has rows has a pointer the trigger derived honestly, and
-- adding their pointer's session on top could fabricate an appearance.
--
-- DELIBERATELY NOT HERE: the 33 Fist of Ilmater people with no pointer at all.
-- Absence of a pointer is honest, and there is nothing to protect — their first
-- backfill sets NULL -> chapter N, which is the feature working, not a
-- collapse. Inventing appearances for them would also be a bigger inference
-- than 0029's (which at least had the DM's notes), and it would flip 33 people
-- from "never seen" to "seen", emptying a cleanup-panel bucket the DM uses.
--
-- Campaign-agnostic on purpose. The README's complaint is that *every* seed got
-- this wrong, so the statement is written to catch future ones too.
--
-- NOT a no-op on preview branches. They are created with_data = false but they
-- replay 0001 -> head, and the FOI seeds are in that chain — so a preview
-- branch inserts its own ~33 rows here and ends up in prod's post-fix shape.
-- That is the point. Idempotent on replay: once a person has rows, the NOT
-- EXISTS is false.
--
-- Two side effects worth knowing, neither harmful:
--   * tg_people_touch (0005) bumps people.updated_at on every row the trigger
--     rewrites, so ~36 people land on a near-identical timestamp. The default
--     People order keys on the resolved session number first and only falls
--     through to updated_at as a tiebreak, so the visible order barely moves —
--     but the `recent` / `oldest` sorts will. 0029 did this to Fendwick too.
--   * Both tables are in the supabase_realtime publication (0013 §5), so this
--     publishes ~72 events in one burst. Merge it when nobody is live.
-- ===========================================================================

-- Guard. The insert below copies the PERSON's campaign_id onto the junction
-- row, which is a lie if a pointer ever crossed campaigns — and nothing in the
-- schema would catch it: session_participants has three independent FKs and no
-- composite check tying campaign_id to the session's own. Such a row would then
-- be selected under the wrong campaign by fetchCampaign and fold into
-- sagaScope. Verified zero against prod on 2026-08-02; fail loudly rather than
-- launder a data bug into permanence if that ever stops being true.
--
-- Dangling pointers need no guard: 0001 declares the column
-- `references public.sessions(id) on delete set null`, so it cannot outlive its
-- session.
do $$
declare bad int;
begin
  select count(*) into bad
  from public.people p
  join public.sessions s on s.id = p.last_seen_session_id
  where s.campaign_id is distinct from p.campaign_id;

  if bad > 0 then
    raise exception
      'ABORT: % people have a last_seen_session_id pointing at another campaign''s session. Resolve by hand before backfilling.', bad;
  end if;
end;
$$;

insert into public.session_participants (campaign_id, session_id, person_id)
select p.campaign_id, p.last_seen_session_id, p.id
from public.people p
join public.sessions s
  on  s.id = p.last_seen_session_id
  and s.campaign_id = p.campaign_id          -- belt and braces behind the guard
where p.last_seen_session_id is not null
  and not exists (
    select 1 from public.session_participants sp where sp.person_id = p.id
  )
on conflict (session_id, person_id) do nothing;
