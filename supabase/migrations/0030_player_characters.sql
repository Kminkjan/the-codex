-- Player characters (issue #114): mark a person as a PC and bind them to the
-- account that plays them. Absorbs the unshipped half of #13 (0014 shipped
-- people.status; is_pc never landed).
--
-- Two columns, because the two facts come apart. is_pc is the roster fact,
-- player_user_id the account fact: the Fist of Ilmater import has PCs whose
-- players will never hold an account, the DM seeds people before invites are
-- redeemed, and a dead PC stays a PC. Deriving is_pc from the link breaks all
-- three.
--
-- No unique constraint: many people -> one user. A long campaign accumulates
-- dead and retired characters, and keeping their link is precisely what lets
-- the chronicle still say who played them. "The character I'm playing now" is
-- derived from status (0014), not stored as a second pointer that can drift.
--
-- No new RLS. Both columns fall under the existing "member write people" policy
-- (0023), so a player claiming their own character goes through the normal
-- write path -- unlike membership, this needs no SECURITY DEFINER RPC. That is
-- deliberate: the link is attribution, never permission (M6's "no permission
-- matrices" principle), so it must not become the schema's only per-row
-- ownership check.

alter table public.people
  add column if not exists is_pc boolean not null default false,
  add column if not exists player_user_id uuid references auth.users(id) on delete set null;

-- Partial: only linked rows are ever looked up by player.
create index if not exists people_player_user_id_idx
  on public.people (campaign_id, player_user_id)
  where player_user_id is not null;
