-- ===========================================================================
-- Feedback: bugs and ideas from the party, raised inside the codex.
--
-- The alternative considered and rejected was GitHub issues. Players don't
-- have accounts, a public repo turns "the map thing is broken" into a
-- permanent public artifact under a real name, and an issue template has to
-- ASK for the context (which page, which theme) that the app already knows.
-- So the capture surface lives here and the triage stays on GitHub, done by
-- hand by the maintainer — nothing in this schema files an issue.
--
-- Two tables, and the split is the whole design:
--
--   feedback        one row per report. APPEND-ONLY for players — no edit, no
--                   delete, the same contract as party_notes and
--                   session_events. `status` is the single mutable column and
--                   only the DM may move it.
--   feedback_votes  one row per (report, person). "Me too", nothing more.
--
-- Why votes are ROWS and not a counter column on feedback. Two reasons, both
-- fatal to the counter:
--   * every client write in this app is fire-and-forget with no transaction
--     (see src/mutations.ts), so `votes = votes + 1` is a read-modify-write
--     that silently drops a concurrent vote — and a vote count that loses
--     votes is worse than no vote count.
--   * a vote has to be togglable and idempotent, which needs to know WHO
--     voted. That's a uniqueness key, so it's a primary key, so it's a row.
--
-- Note which identity each table stores, because they differ on purpose:
--   * feedback.author is a DISPLAY NAME, following the party_notes /
--     connections / session_attendance convention — it's a byline, it's what
--     the panel renders, and it must survive the account going away.
--   * feedback_votes.user_id is a uuid, because it is not a byline. Nothing
--     renders who voted; the panel shows a count and whether YOU voted. A
--     display name can't enforce one-vote-per-person (two players named Kris
--     would collide, and a renamed account would double-vote).
--
-- No anonymous voting, and that follows from the above rather than from
-- caution. Anonymous JWTs hold a per-browser-session identity, so an
-- anon-writable vote is forgeable by reloading in a private window — the
-- count would measure enthusiasm for clicking. Reads stay open to everyone,
-- as everywhere else here.
--
-- No entity_hidden()/0018 gating: a report is about the software, not about
-- the fiction, so there is nothing here for the DM to keep from players and
-- the client projection leaves the array untouched.
--
-- ROLLOUT IS ONE-WAY: this must be applied BEFORE (or with) the client deploy,
-- never after. fetchCampaign selects all 16 tables in one Promise.all and
-- throws on the first error, so a client that knows about `feedback` against a
-- database that doesn't shows every player "The codex could not be opened —
-- Could not find the table 'public.feedback' in the schema cache" and no
-- journal at all. Verified, not theorised. The reverse order is safe: this
-- schema is additive and inert until something reads it, so applying it early
-- costs nothing. Same property 0023's header claims for itself, and the same
-- coupling 0039 created — the difference is only that the failure here takes
-- the whole journal with it rather than one panel.
-- ===========================================================================

-- ==========================================================================
-- 1. feedback
-- ==========================================================================

create table if not exists public.feedback (
  id          bigserial primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  -- Two kinds, not a taxonomy. "Is it broken or is it missing" is the only
  -- split that changes what the maintainer does next; anything finer is a
  -- label the reporter has to think about before they can complain.
  kind        text not null check (kind in ('bug', 'idea')),
  text        text not null check (btrim(text) <> ''),
  author      text not null,
  -- Captured context, the reason this beats an issue template: the client
  -- knows both at write time and nobody has to be asked. Nullable because
  -- they're circumstantial, never load-bearing — a report with neither is
  -- still a report.
  --
  -- `route` is the hash the reporter was looking at (#/c/:id[/e/:id]), so it
  -- is campaign-and-entity-shaped and NOT a secret: reads here are open, and
  -- an entity id in a route says a row exists, which the hash already says to
  -- anyone holding the link. It is stored as free text and never resolved
  -- against an entity table — a report outlives the thing it was filed about.
  route       text,
  theme       text,
  -- The maintainer's half of the loop, and the reason this isn't a write-only
  -- suggestion box: a reporter who watches an item move reports the next one.
  status      text not null default 'open'
                check (status in ('open', 'planned', 'done', 'wontfix')),
  created_at  timestamptz not null default now()
);

create index if not exists feedback_campaign_idx on public.feedback (campaign_id, created_at desc);

alter table public.feedback enable row level security;

grant select on public.feedback to anon, authenticated;
grant insert, update, delete on public.feedback to authenticated;
-- bigserial: the INSERT privilege above doesn't cover the sequence on stacks
-- that don't auto-grant to authenticated (0018's note).
grant usage, select on sequence public.feedback_id_seq to authenticated;

drop policy if exists "feedback is readable by anyone" on public.feedback;
create policy "feedback is readable by anyone"
  on public.feedback for select
  using (true);

-- Insert: any non-anonymous member, exactly as party_notes (0023). No author
-- check — `author` is a display name, so there is nothing here to verify it
-- against, which is equally true of every other byline column in this schema.
drop policy if exists "member insert feedback" on public.feedback;
create policy "member insert feedback"
  on public.feedback for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_member(campaign_id)
  );

-- Update: DM only, and this is what enforces append-only for everyone else.
-- Deliberately NOT a FOR ALL policy — a member-writable update would make the
-- text editable, and an append-only record whose text can be rewritten after
-- other people have voted on it is a different (worse) thing than what this
-- table is for.
--
-- The DM can move `status` and, because a column-level grant would be the
-- only way to say otherwise, technically the text too. That's an acceptable
-- asymmetry: the DM is the maintainer's proxy here, and the alternative is a
-- trigger asserting column equality for a threat model of one person.
drop policy if exists "dm update feedback" on public.feedback;
create policy "dm update feedback"
  on public.feedback for update
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id));

-- Delete: DM only, as the escape hatch for a duplicate or a misfire. Note the
-- asymmetry with party_notes, which nobody can delete at all: a note is part
-- of the campaign record, while a duplicate bug report is just noise, and the
-- alternative to a delete is a board that fills with dead rows.
drop policy if exists "dm delete feedback" on public.feedback;
create policy "dm delete feedback"
  on public.feedback for delete
  to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(campaign_id));

-- ==========================================================================
-- 2. feedback_votes
-- ==========================================================================

create table if not exists public.feedback_votes (
  feedback_id bigint not null references public.feedback(id) on delete cascade,
  -- Denormalized from feedback.campaign_id so is_campaign_member() can gate a
  -- vote without a join (the shape every campaign-scoped junction here uses)
  -- and so the client can fetch votes campaign-scoped alongside the reports.
  -- Kept honest by the trigger below rather than by trusting the client.
  campaign_id text not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One vote per person per report, enforced by the database rather than by
  -- the client checking first. The toggle is insert-or-delete on this key.
  primary key (feedback_id, user_id)
);

create index if not exists feedback_votes_campaign_idx on public.feedback_votes (campaign_id);

-- The client sends campaign_id (it has it) but must not be believed: a wrong
-- one would put the vote outside the campaign it belongs to, where the panel
-- would never load it and is_campaign_member would test the wrong membership.
-- Overwrite from the parent row instead of raising — there is no useful
-- caller-side recovery from "you sent the wrong campaign", and a vote is not
-- worth failing over.
create or replace function public.feedback_votes_fix_campaign()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  select f.campaign_id into new.campaign_id
  from public.feedback f
  where f.id = new.feedback_id;
  return new;
end;
$$;

drop trigger if exists trg_feedback_votes_fix_campaign on public.feedback_votes;
create trigger trg_feedback_votes_fix_campaign
  before insert or update on public.feedback_votes
  for each row execute function public.feedback_votes_fix_campaign();

alter table public.feedback_votes enable row level security;

grant select on public.feedback_votes to anon, authenticated;
grant insert, delete on public.feedback_votes to authenticated;

drop policy if exists "feedback_votes is readable by anyone" on public.feedback_votes;
create policy "feedback_votes is readable by anyone"
  on public.feedback_votes for select
  using (true);

-- `user_id = auth.uid()` is the load-bearing clause: without it a member
-- could vote as somebody else and the count would stop meaning anything.
-- Note it is checked against the CLIENT-SUPPLIED value; the client also
-- defaults it from the session, but the policy is what makes that true.
drop policy if exists "member insert own feedback vote" on public.feedback_votes;
create policy "member insert own feedback vote"
  on public.feedback_votes for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_member(campaign_id)
    and user_id = (select auth.uid())
  );

-- Un-voting is deleting your own row. No membership clause needed and none
-- wanted: someone removed from a campaign must still be able to withdraw a
-- vote they left, and the row is theirs by primary key either way.
drop policy if exists "member delete own feedback vote" on public.feedback_votes;
create policy "member delete own feedback vote"
  on public.feedback_votes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE policy and no update grant: both columns of the key are the key,
-- and a vote carries no mutable state. Changing your mind is delete + insert.

-- ==========================================================================
-- 3. Realtime
-- ==========================================================================
-- Nothing syncs unless the table is published. Guarded for re-runs
-- (ALTER PUBLICATION ... ADD TABLE errors on duplicates).
--
-- Both tables are published because the client folds them into one array and
-- refetches the pair on any change (the connections/board_positions/
-- party_notes pattern) — a vote arriving without its own event would leave
-- every other client's count stale until reload, which is exactly the number
-- people are looking at.
--
-- REPLICA IDENTITY FULL, which is NOT boilerplate here. Under the default
-- replica identity a DELETE publishes only the primary key, so the client's
-- `campaign_id=eq.<id>` subscription filter has no column to match and the
-- event is never delivered. Every other table this app subscribes to gets away
-- with the default because its deletes are either absent (party_notes,
-- session_events are append-only) or keyed by an id the client already holds.
-- Un-voting IS a delete, and it is half of the toggle — dropping it would show
-- a count that only ever goes up on everyone else's screen. `feedback` gets it
-- for the same reason on the DM's delete. Cheap on both: four narrow columns,
-- and one short text column on a table that holds tens of rows.

alter table public.feedback             replica identity full;
alter table public.feedback_votes       replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feedback'
  ) then
    alter publication supabase_realtime add table public.feedback;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feedback_votes'
  ) then
    alter publication supabase_realtime add table public.feedback_votes;
  end if;
end;
$$;
