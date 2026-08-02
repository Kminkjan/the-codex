-- ===========================================================================
-- Feedback is about the APP, so the board is app-wide. 0040 scoped it per
-- campaign; this demotes `campaign_id` from a scope key to provenance — the
-- same status `route` and `theme` already have.
--
-- 0040 got this wrong, and the deciding argument is `status`. A bug is fixed
-- once, in the code. Scoped per campaign, "done" is a fact about a ROW rather
-- than about the app, so the same repaired bug sits `open` on every other
-- campaign's board forever unless someone remembers to close it N times.
-- Votes fail the same way and worse: three people hitting one bug in three
-- campaigns file three rows holding one vote each, so the signal — already
-- thin at five voters, which is the whole reason the vote is a single bit —
-- fragments into nothing. That defeats the feature 0040 shipped. With three
-- live campaigns this is not hypothetical.
--
-- What is NOT removed: which campaign a report came from. That is real
-- reproduction context and it stays recorded, exactly like the route and the
-- theme. The change is that nothing FILTERS on it.
--
-- Pieces (order is load-bearing: table → seed → helpers → columns → policies):
--   1. app_maintainers + is_app_maintainer(). 0040 let the DM move `status`,
--      which cannot survive going app-wide: sign-ups are open (anyone with the
--      URL can become an editor via Discord or magic link) and create_campaign
--      makes its caller a DM, so "any DM" would let a stranger found a throwaway
--      campaign and then edit or delete the whole party's board. A real
--      maintainer role is the only gate that doesn't hand that out.
--   2. is_any_campaign_member() — the insert gate. Holding a seat in at least
--      one campaign. Note the residual, accepted rather than solved: a stranger
--      CAN still found a campaign to obtain a seat and then post. Posting is
--      cheap to undo (the maintainer deletes) where editing others' reports is
--      not, so the two gates are deliberately different heights.
--   3. feedback.campaign_id → nullable, and its FK → on delete set null. Under
--      0040's `on delete cascade`, deleting a campaign would delete the reports
--      filed from it — right for a scope key, plainly wrong for provenance. A
--      report outlives the campaign it was written in, the same way 0032's
--      party_notes.session_id survives its session.
--   4. feedback_votes.campaign_id and its trigger are DROPPED. Both existed
--      only to gate and fetch by scope; app-wide there is nothing to gate. The
--      column was also the trigger's whole reason for being, so it goes too.
--
-- Rollout is far more forgiving than 0040's, but it is NOT symmetric, so both
-- directions are worth stating plainly:
--
--   * This migration ahead of the client (the correct order): fine. An old
--     client still sends campaign_id on a report — the column is still there,
--     merely nullable — and still filters its reads by it, so it sees a subset
--     of the board rather than an error. Its vote inserts would send a column
--     that no longer exists and take a 42703, so voting breaks for however long
--     the gap lasts. Nothing else does.
--   * The client ahead of this migration: the journal still LOADS (unlike 0040,
--     where a missing table killed the whole Promise.all), the board still
--     reads, and the app_maintainers lookup fails closed to "not a maintainer".
--     But voting breaks the other way — the new client omits campaign_id, which
--     0040 declared NOT NULL — and triage is unavailable.
--
-- So either order costs the vote button and nothing more. Apply this first
-- regardless; there is no reason not to.
--
-- Data: preserves the live rows. There is already a real report on this board
-- (a request for an image-blur option), so nothing here recreates a table.
-- ===========================================================================

-- ==========================================================================
-- 1. app_maintainers — who may triage
-- ==========================================================================

-- Deny-all for client writes, exactly like campaign_members (0018) and
-- campaign_invites (0022): RLS enabled with no write policy. Membership is
-- granted from the dashboard or a migration, never from the app. Open read so
-- the client can decide whether to render the status control at all.
create table if not exists public.app_maintainers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Free-text, for the human reading this table in a year.
  note    text,
  added_at timestamptz not null default now()
);

grant select on public.app_maintainers to anon, authenticated;

alter table public.app_maintainers enable row level security;

drop policy if exists "app_maintainers are readable by anyone" on public.app_maintainers;
create policy "app_maintainers are readable by anyone"
  on public.app_maintainers for select
  using (true);
-- No write policies. RLS-enabled + no policy = deny-all for anon/authenticated.

-- Seed: grandfather every CURRENT campaign DM, which is the set of people who
-- could already move `status` under 0040 — so this migration takes no
-- capability away from anyone who had it. Deliberately a snapshot: DMs created
-- after this point are NOT maintainers, which is the entire point of item 1.
--
-- No count assertion, for the reason 0023's seed documents: the PR preview
-- branch replays this chain against a database with zero auth.users rows,
-- where inserting nothing is correct.
insert into public.app_maintainers (user_id, note)
select distinct m.user_id, 'grandfathered from campaign dm at 0041'
from public.campaign_members m
where m.role = 'dm'
on conflict (user_id) do nothing;

create or replace function public.is_app_maintainer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_maintainers a where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_app_maintainer() to anon, authenticated;

-- ==========================================================================
-- 2. is_any_campaign_member — the app-wide sibling of is_campaign_member
-- ==========================================================================

-- SECURITY DEFINER like both its siblings (0018's is_campaign_dm, 0023's
-- is_campaign_member): campaign_members is open-read today, but the helper must
-- not depend on that staying true.
create or replace function public.is_any_campaign_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m where m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_any_campaign_member() to anon, authenticated;

-- ==========================================================================
-- 3. feedback.campaign_id becomes provenance
-- ==========================================================================

alter table public.feedback alter column campaign_id drop not null;

-- Dropped by lookup rather than by name, carried over from 0032/0031: the
-- constraint 0040 created does have a generated name, but matching on the
-- column keeps this correct if some other hand renamed it, and asserting a name
-- risks a silent no-op drop that would leave `on delete cascade` in place —
-- i.e. a campaign delete still taking the reports with it, which is exactly
-- what this section exists to prevent.
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  where con.conrelid = 'public.feedback'::regclass
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) like '%campaign_id%';
  if cname is not null then
    execute format('alter table public.feedback drop constraint %I', cname);
  end if;
end $$;

-- set null, not cascade: the report outlives the campaign it was filed from,
-- and "we no longer know where this came from" is a fact rather than a reason
-- to destroy someone's bug report.
alter table public.feedback
  add constraint feedback_campaign_id_fkey
  foreign key (campaign_id) references public.campaigns(id) on delete set null;

-- 0040's index led with campaign_id for the scoped fetch. App-wide the client
-- selects the whole table unfiltered, so the useful order is by recency alone.
drop index if exists public.feedback_campaign_idx;
create index if not exists feedback_created_idx on public.feedback (created_at desc);

-- ==========================================================================
-- 4. feedback_votes loses its scope column
-- ==========================================================================

-- The trigger existed solely to stop a client filing a vote into the wrong
-- campaign. With no campaign on the row there is nothing to correct.
drop trigger if exists trg_feedback_votes_fix_campaign on public.feedback_votes;
drop function if exists public.feedback_votes_fix_campaign();

drop index if exists public.feedback_votes_campaign_idx;
alter table public.feedback_votes drop column if exists campaign_id;

-- ==========================================================================
-- 5. Policies
-- ==========================================================================

-- Reads stay open to everyone, unchanged and deliberately: every other table
-- here is world-readable, and a board whose point is "watch your report move"
-- cannot be the one thing you must hold a seat to read. Consequence worth
-- naming, since app-wide widens it — a report is now visible to people in
-- other campaigns, under its author's display name.

-- Insert: a seat in at least one campaign. No campaign_id clause survives,
-- which is the change; `author` remains unverified for the same reason it is
-- everywhere else (it is a display name, not an identity).
drop policy if exists "member insert feedback" on public.feedback;
create policy "member insert feedback"
  on public.feedback for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_any_campaign_member()
  );

-- Update/delete: maintainers only, replacing 0040's DM check. Same reasoning
-- as 0040 for why UPDATE isn't split per column — a column-level grant is the
-- only way to say "status but not text", and a trigger asserting column
-- equality is not worth writing for a threat model of one person. The change
-- is only WHO that person is.
drop policy if exists "dm update feedback" on public.feedback;
drop policy if exists "maintainer update feedback" on public.feedback;
create policy "maintainer update feedback"
  on public.feedback for update
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_app_maintainer())
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_app_maintainer());

drop policy if exists "dm delete feedback" on public.feedback;
drop policy if exists "maintainer delete feedback" on public.feedback;
create policy "maintainer delete feedback"
  on public.feedback for delete
  to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_app_maintainer());

-- Votes. The insert gate loses its campaign clause and keeps the one that
-- matters: user_id = auth.uid() is what makes one-vote-per-person mean
-- anything, and it is checked against the client-supplied value.
drop policy if exists "member insert own feedback vote" on public.feedback_votes;
create policy "member insert own feedback vote"
  on public.feedback_votes for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_any_campaign_member()
    and user_id = (select auth.uid())
  );

-- Un-voting is unchanged: your own row, by primary key, with no membership
-- clause — someone dropped from every campaign must still be able to withdraw
-- a vote they left.

-- ==========================================================================
-- 6. Realtime
-- ==========================================================================
-- Both tables are already published (0040) and stay so; publication membership
-- doesn't change when a column is dropped.
--
-- REPLICA IDENTITY FULL is KEPT on both, though app-wide it is no longer
-- load-bearing: 0040 needed it so a DELETE would carry campaign_id for the
-- subscription filter to match, and the client no longer filters. It is
-- retained rather than reverted because it costs almost nothing on tables this
-- size and it is what would let a filter come back later without the delete
-- half silently going missing again — which is the failure 0040's header
-- describes and the exact bug that would be reintroduced.
--
-- Advisor note: as with 0006/0018/0020/0022/0023/0040, the claim-based policy
-- halves may trip RLS heuristics — by design. The two helpers here take no
-- arguments, so unlike is_campaign_member(campaign_id) they are not
-- row-correlated and Postgres may hoist them; that is a straight improvement.
