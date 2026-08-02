-- ===========================================================================
-- 0043: the feedback byline gets the same foreign key 0042 gave the others.
--
-- 0042 added author_user_id to party_notes, session_events and connections and
-- stated the rule it was following: a byline that is only a string is frozen at
-- write time, so a rename in the Topbar leaves every row that person ever wrote
-- reading under the old name, permanently. It skipped `feedback` for no reason
-- of principle — 0040 landed while 0042 was in review, and insertFeedback was
-- the one mutation still taking a byline as an argument. This closes that gap.
--
-- The one thing worth checking before copying 0042 here is that the read side
-- actually works for this table, because the feedback board is the only surface
-- in the app that is NOT campaign-scoped (0041). It does: `profiles` (0020) has
-- no campaign_id to scope by and its SELECT policy is `using (true)`, and
-- CampaignProvider's profiles fetch is correspondingly UNFILTERED — the same
-- map that names a note's author names a report's, whichever campaign it was
-- filed from. Nothing about resolving a uuid here is campaign-shaped.
--
-- NOT the choice 0039 made for session_attendance.recorded_by, and the
-- difference is the one 0042 named: recorded_by is write-only (nothing renders
-- it), so there is no read path to improve. feedback.author is rendered on
-- every row of the board, which is exactly the case for the uuid.
--
-- Nullable and NOT backfilled, per 0031/0032/0042 doctrine: NULL means
-- "predates this column". Unlike those three there is no seeded back-catalogue
-- here — every existing row was written by a signed-in member this year, so the
-- NULL population is small and shrinks to nothing as the board turns over. It
-- is still not backfilled: `author` is a free-text display name and matching it
-- against profiles by string would guess, and a wrong guess attributes a bug
-- report to the wrong person.
--
-- `author` stays `not null` and stays written on every insert. The uuid is the
-- live-resolution path, the text is the durable floor, and `on delete set null`
-- degrades a deleted account's report to precisely what it stores today.
-- ===========================================================================

alter table public.feedback
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;

-- For the FK's own sake, not for reads — the client resolves a byline against
-- an already-loaded profiles map, never with a WHERE clause. `on delete set
-- null` has to find referencing rows when an account is deleted, and unindexed
-- that is a sequential scan. Partial, like 0042's and 0030's: pre-migration
-- rows are NULL forever and no uuid lookup can hit one.
create index if not exists feedback_author_user_idx
  on public.feedback (author_user_id) where author_user_id is not null;

-- ==========================================================================
-- Deliberate omissions
-- ==========================================================================
-- No RLS change, for 0042's reason: the insert policy adds no CHECK this
-- touches, so 0040's "any non-anonymous member may insert" applies unchanged.
-- That leaves author_user_id as unconstrained as `author` already is. Note the
-- contrast with feedback_votes.user_id one table over, whose insert policy DOES
-- pin it to auth.uid() — load-bearing there because it is what makes
-- one-vote-per-person true, and merely decorative here, where a byline has
-- never been verified in this schema.
--
-- No realtime work: `feedback` joined the supabase_realtime publication in 0040
-- and a new column does not change that. Its `replica identity full` (0040,
-- kept by 0041) is likewise unaffected — it governs what a DELETE publishes,
-- and this column is never read from an old-row payload.
