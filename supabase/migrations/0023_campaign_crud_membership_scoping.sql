-- ===========================================================================
-- M6 Campaign Management, phase 3 (issue #87): campaign CRUD + per-campaign
-- write scoping. Closes the follow-up deferred in 0018's header ("any editor
-- can write any campaign") and fills the campaigns INSERT gap 0020 left
-- deny-all "until issue #87".
--
-- Pieces (order is load-bearing: column → helper → seed → flips → RPC):
--   1. campaigns.archived_at — soft archive. No read-policy change: archived
--      campaigns stay world-readable; the client picker filters them and the
--      resolution chain falls back to the first live campaign.
--   2. is_campaign_member() helper, the membership sibling of is_campaign_dm
--      (0018). SECURITY DEFINER like its sibling (campaign_members is
--      open-read today, but the helper must not depend on that staying true).
--   3. Membership seed BEFORE the policy flips: every existing non-anonymous
--      auth user becomes a player of every campaign (on conflict do nothing
--      preserves dm rows). Entity writes are fire-and-forget on the client,
--      so an unseeded editor's writes would start failing silently the
--      moment the policies flip. All×all is deliberate: we cannot know which
--      campaigns an editor "uses", and the current behavior being
--      grandfathered is exactly any-editor-writes-anywhere. Scoping is
--      go-forward: post-0023 sign-ups hold no memberships until they redeem
--      an invite (0022) or found a campaign. NO count assertion here — the
--      PR preview branch replays this chain on a database with zero
--      auth.users rows, where the seed correctly inserts nothing.
--   4. Write-policy flips: every campaign-scoped table's write policy gains
--      `and public.is_campaign_member(campaign_id)`. The 7 entity tables
--      keep their 0018 hidden truth-table verbatim; connections /
--      board_positions keep their per-command shape (their clauses must not
--      count toward SELECT); party_notes / sessions / arcs / events /
--      event_participants / session_participants trade their 0006/0008/0009/
--      0013-era claim-only gates for claim + membership (reads on all of
--      them stay open via their own SELECT policies, so a FOR ALL USING
--      narrowing leaks nothing — policies OR per command); session_events
--      keeps its note-vs-DM split. DM-only surfaces (session_staging,
--      dm_notes, campaigns UPDATE, reveal/start/end) are unchanged — DM
--      implies member. Storage (entity-images) stays claim-gated: images are
--      not campaign-addressed, out of scope here.
--   5. create_campaign() RPC — the one INSERT path for campaigns (the verb
--      stays deny-all for direct client writes). Definer, so it can insert
--      the campaign row and the creator's dm membership row in one
--      transaction: the creator can never end up DM-less. Duplicate ids must
--      raise (no on-conflict — a do-nothing would let a caller graft a DM
--      membership onto an existing campaign by passing its id).
--
-- Archive/delete: archiving is a plain client UPDATE through 0020's
-- "dm updates campaign" policy (sets archived_at, nulls active_session_id).
-- Un-archive is dashboard-only for now. Hard delete is deliberately not
-- shipped (issue #87 prefers archive; a hard delete needs a definer sweep
-- across ~15 tables because connections/board_positions have no entity FKs).
--
-- Advisor notes: as with 0006/0018/0020/0022 the claim-based policy halves
-- may trip rls heuristics — by design. is_campaign_member(campaign_id) is
-- row-correlated (like is_campaign_dm) and cannot be initplan-wrapped.
--
-- Rollout: safe to apply before the client deploy. The seed grandfathers
-- every current editor, so the old client keeps working during the
-- apply→deploy gap; the new client adds founding/archiving UI and surfaces
-- rejected writes as a toast.
-- ===========================================================================

-- ==========================================================================
-- 1. campaigns.archived_at
-- ==========================================================================

alter table public.campaigns add column if not exists archived_at timestamptz;

-- ==========================================================================
-- 2. is_campaign_member helper (sibling of is_campaign_dm, 0018)
-- ==========================================================================

create or replace function public.is_campaign_member(cid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members m
    where m.campaign_id = cid
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_campaign_member(text) to anon, authenticated;

-- ==========================================================================
-- 3. Seed: grandfather every existing editor into every campaign
-- ==========================================================================

insert into public.campaign_members (campaign_id, user_id, role)
select c.id, u.id, 'player'
from public.campaigns c
cross join auth.users u
where coalesce(u.is_anonymous, false) = false
on conflict (campaign_id, user_id) do nothing;

-- ==========================================================================
-- 4. Write-policy flips: claim gate → claim + membership gate
-- ==========================================================================

-- 4a. The 7 entity tables (0018 shape, hidden truth-table preserved).

drop policy if exists "member write people" on public.people;
create policy "member write people" on public.people
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write locations" on public.locations;
create policy "member write locations" on public.locations
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write quests" on public.quests;
create policy "member write quests" on public.quests
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write goals" on public.goals;
create policy "member write goals" on public.goals
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write factions" on public.factions;
create policy "member write factions" on public.factions
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write items" on public.items;
create policy "member write items" on public.items
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

drop policy if exists "member write lore" on public.lore;
create policy "member write lore" on public.lore
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id) and (hidden = false or public.is_campaign_dm(campaign_id)));

-- 4b. connections / board_positions (0018 per-command shape — write clauses
--     must never count toward SELECT visibility).

drop policy if exists "member insert connections" on public.connections;
create policy "member insert connections" on public.connections
  for insert to authenticated
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));
drop policy if exists "member update connections" on public.connections;
create policy "member update connections" on public.connections
  for update to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));
drop policy if exists "member delete connections" on public.connections;
create policy "member delete connections" on public.connections
  for delete to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "member insert board_positions" on public.board_positions;
create policy "member insert board_positions" on public.board_positions
  for insert to authenticated
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));
drop policy if exists "member update board_positions" on public.board_positions;
create policy "member update board_positions" on public.board_positions
  for update to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));
drop policy if exists "member delete board_positions" on public.board_positions;
create policy "member delete board_positions" on public.board_positions
  for delete to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

-- 4c. The 0006/0008/0009/0013-era claim-only tables. Reads on all of these
--     stay open via their own "readable by anyone" SELECT policies, so the
--     FOR ALL USING contribution to SELECT (which ORs) changes nothing.

drop policy if exists "member write sessions" on public.sessions;
create policy "member write sessions" on public.sessions
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "member write party_notes" on public.party_notes;
create policy "member write party_notes" on public.party_notes
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "member write arcs" on public.arcs;
create policy "member write arcs" on public.arcs
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "member write events" on public.events;
create policy "member write events" on public.events
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "member write event_participants" on public.event_participants;
create policy "member write event_participants" on public.event_participants
  for all to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "non-anonymous users can add session participants" on public.session_participants;
create policy "non-anonymous users can add session participants"
  on public.session_participants for insert
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

drop policy if exists "non-anonymous users can remove session participants" on public.session_participants;
create policy "non-anonymous users can remove session participants"
  on public.session_participants for delete
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_member(campaign_id));

-- 4d. session_events: keep the 0018 note-vs-DM split, add membership.

drop policy if exists "non-anonymous users can append session events" on public.session_events;
create policy "non-anonymous users can append session events"
  on public.session_events for insert
  to authenticated
  with check (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_member(campaign_id)
    and (type = 'note' or public.is_campaign_dm(campaign_id))
  );

-- ==========================================================================
-- 5. create_campaign RPC — founding a campaign makes the founder its DM
-- ==========================================================================

create or replace function public.create_campaign(cid text, ctitle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_editor();

  -- House convention: ids are client-side crypto.randomUUID() (0018's regex).
  if cid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'campaign id must be a UUID';
  end if;
  if ctitle is null or btrim(ctitle) = '' then
    raise exception 'campaign title is required';
  end if;

  -- No on-conflict: a duplicate id must raise, otherwise a caller could
  -- graft a DM membership onto an existing campaign by passing its id.
  -- dm_user_id is legacy (superseded by campaign_members, 0018) but kept
  -- populated on every row for pre-0018 compatibility — match that here.
  insert into public.campaigns (id, title, dm_user_id)
  values (cid, btrim(ctitle), auth.uid()::text);

  insert into public.campaign_members (campaign_id, user_id, role)
  values (cid, auth.uid(), 'dm');
end;
$$;

revoke execute on function public.create_campaign(text, text) from public, anon;
grant execute on function public.create_campaign(text, text) to authenticated;
