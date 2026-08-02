-- ===========================================================================
-- 0042: give the byline a foreign key.
--
-- Attribution has been a bare display-name string since 0001: party_notes.author,
-- session_events.author (0016), connections.author (0031). None of them links to
-- the account that wrote the row, so the name is frozen at write time. Rename
-- yourself in the Topbar and every note you have ever left keeps the old name,
-- permanently and with no way to correct it. The string also can't be grouped
-- ("show my notes"), can't reach the profiles mirror (0020) for an avatar, and
-- can't reach people.player_user_id (0030) to say which character its author
-- was playing.
--
-- This records the account fact ALONGSIDE the name fact. It does not replace it.
-- That distinction matters because 0039 chose the other way for
-- session_attendance.recorded_by, on the reasoning that provenance must "survive
-- the account going away". It still does: `author` stays exactly as it is, keeps
-- being written on every insert, and `on delete set null` clears only the uuid —
-- so a deleted account degrades a row to precisely what it stores today, never
-- to nothing. The uuid is the live-resolution path, the text is the durable
-- floor, and the client prefers the former and falls back to the latter. 0039's
-- recorded_by is left alone deliberately: it is write-only today (nothing
-- renders it), so there is no read path to improve yet.
--
-- Nullable, and NOT backfilled. NULL means "predates this column" — the same
-- doctrine 0031 set for connections.created_at and 0032 for entity_label. There
-- is no honest value to backfill: the seeded back-catalogue's authors are names
-- of people who mostly hold no account at all.
-- ===========================================================================

-- on delete set null, matching 0032's FK reasoning ("losing a session must not
-- take its notes with it"): a deleted account must not delete the chronicle. The
-- row survives, signed with the name it was written under.
alter table public.party_notes
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;

alter table public.session_events
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;

alter table public.connections
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;

-- ==========================================================================
-- Indexes
-- ==========================================================================
-- Not for reads: the client resolves a byline by uuid lookup against an
-- already-loaded profiles map, never with a WHERE clause. These exist for the
-- FK's own sake. `on delete set null` has to find the referencing rows when an
-- account is deleted, and unindexed that is a sequential scan of all three
-- tables per deleted user. Cheap insurance either way, and it matches 0030,
-- which indexed people.player_user_id — the directly analogous auth.users FK.
--
-- Partial, like 0030's. Every row written before this migration is NULL and
-- stays NULL — that is most of the table today and all of the seeded
-- back-catalogue — and no lookup by uuid can ever hit one, so there is nothing
-- to gain from carrying them.
create index if not exists party_notes_author_user_idx
  on public.party_notes (author_user_id) where author_user_id is not null;

create index if not exists session_events_author_user_idx
  on public.session_events (author_user_id) where author_user_id is not null;

create index if not exists connections_author_user_idx
  on public.connections (author_user_id) where author_user_id is not null;

-- ==========================================================================
-- Deliberate omissions
-- ==========================================================================
-- No RLS change. 0031 and 0032 each rewrote the session_events write policy, but
-- only because they added a value to its `type` CHECK; this adds none, so all
-- three tables' existing policies apply unchanged. Note this leaves author_user_id
-- as unconstrained as `author` already is — a member can write any value, exactly
-- as they can already sign a note with any name. Tying it to auth.uid() would be
-- the first attribution constraint in the schema and would need care: the
-- party_notes policy is FOR ALL, so a with-check would also govern UPDATE of the
-- legacy NULL-author seed rows (0001:329).
--
-- No realtime work: party_notes (0001), session_events (0016) and connections
-- (0001) already belong to the supabase_realtime publication, and a new column
-- does not change that.
